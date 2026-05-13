# Human-in-the-Loop (HITL)

> **What this page is for.** How Clawthority routes high-stakes agent actions to a human operator for approval before execution — channel setup (Telegram, Slack), payload binding, retry/backoff, and fallback behaviour.

---

## Why HITL Matters

AI agents interpret instructions. Sometimes they interpret them wrong. "Clean up this thread" becomes "delete 340 emails." "Organize my files" becomes "move everything, including `.env`."

The HITL system ensures that irreversible or high-impact actions require explicit human approval before they execute. The agent pauses, a message is sent to you via Telegram or Slack, and the action only proceeds if you approve.

This is not a prompt asking the model to check with you. It is a code-level gate in the execution path. The model cannot decide to skip it, forget it, or reason its way around it.

---

## How It Works

```
Agent attempts email.delete
        |
        v
  Cedar / JSON-Cedar policy engines evaluate
        |
        +-- forbid? --> action blocked (no HITL check)
        |
        +-- permit? --> continue to HITL
                |
                v
          HITL matcher checks action against policies
                |
                +-- No match --> action proceeds
                |
                +-- Match found --> approval required
                        |
                        v
                Approval request sent to channel (Telegram or Slack)
                        |
                        +-- Operator approves  --> action proceeds
                        +-- Operator denies    --> action blocked
                        +-- Timeout            --> fallback applies (deny or auto-approve)
```

HITL runs **after** the policy engines. If a policy engine already blocks the action, the HITL check is never reached. This means HITL adds human oversight on top of hard policy boundaries — it cannot override a policy-level block.

---

## Setup

### 1. Create a policy file

Create `hitl-policy.yaml` in the plugin root (`~/.openclaw/plugins/clawthority/`):

```yaml
version: "1"

policies:
  - name: destructive-actions
    actions:
      - "email.delete"
      - "file.delete"
    approval:
      channel: telegram
      timeout: 120
      fallback: deny
```

### 2. Configure the channel

Set the required environment variables for your chosen channel (see [Telegram](#telegram) and [Slack](#slack) sections below).

### 3. Restart the plugin

The HITL policy file is loaded on plugin activation. After that, edits to the file are hot-reloaded automatically.

---

## Payload Hash Binding

Every approval request is cryptographically bound to the specific tool call that triggered it. This prevents an approval for one action from being replayed against a different action.

### How binding works

When a HITL approval request is created, the system computes a **binding** value:

```
binding = SHA-256(action_class + '|' + target + '|' + payload_hash)
```

Where:
- `action_class` — the semantic action class (e.g., `email.delete`)
- `target` — the target resource (e.g., a file path or email address)
- `payload_hash` — a SHA-256 digest of the tool call's parameters

The `payload_hash` itself is computed from a canonicalised representation of the tool call:

```
payload_hash = SHA-256(JSON({ tool: toolName, params: sorted_params }))
```

Parameters are sorted by key (using `localeCompare`) before hashing, so the hash is stable regardless of property insertion order. Nested object key order is **not** normalised — if nested stability is needed, callers must pre-sort recursively using `sortedJsonStringify` from `envelope.ts`.

The output is a 64-character lowercase hex string.

### Security rationale

Without binding, an attacker who observes a valid approval token could reuse it against a different action. The binding ties each token to:

1. **What** action was requested (`action_class`)
2. **What** resource it targets (`target`)
3. **Exactly which parameters** were passed (`payload_hash`)

A token issued for `email.delete` on `alice@example.com` will not resolve an approval for `email.delete` on `bob@example.com` — the bindings will differ.

When `resolveApproval` is called with a binding value, it is compared with the stored binding using direct equality. A mismatch causes the resolution to fail (returns `false`), as if the token did not exist.

### Implementation reference

| Symbol | Module | Description |
|---|---|---|
| `computePayloadHash` | `src/envelope.ts` | SHA-256 of sorted tool call parameters |
| `computeContextHash` | `src/envelope.ts` | SHA-256 of `action_class\|target\|summary` (context tracing) |
| `computeBinding` | `src/hitl/approval-manager.ts` | SHA-256 of `action_class\|target\|payload_hash` (approval binding) |

> **Note:** `computeContextHash` and `computeBinding` use the same pipe-separated format but differ in their third field (`summary` vs `payload_hash`). They serve different purposes: context tracing vs. approval replay prevention.

---

## Approval Modes

The approval mode controls how approval tokens are keyed.

### `per_request` (default)

Each approval request generates a unique UUID v7 token. Two requests for the same action class in the same session each get independent tokens and must each be approved independently.

```yaml
# No special configuration needed — per_request is the default.
policies:
  - name: file-writes
    actions: ["file.write"]
    approval:
      channel: telegram
      timeout: 60
      fallback: deny
```

Use `per_request` when:
- Actions are distinct and each warrants individual review
- You want a full audit trail of each approval decision
- Actions may have different targets or parameters

### `session_approval`

One approval covers all requests of the same action class within a session. The token is keyed as `session_id:action_class` rather than a unique UUID.

When a `session_approval` request arrives and a token for `session_id:action_class` is already pending or was already approved, the system reuses that token's approval state. A second `/approve` for the same session+action class is a no-op.

Use `session_approval` when:
- An agent may call the same action class many times in one session (e.g., `file.read` in bulk operations)
- Approving once per session is sufficient for your threat model
- You want to reduce operator fatigue for repetitive low-risk actions

> **Warning:** `session_approval` is more convenient but provides weaker guarantees. A compromised session could expand the scope of an approved action class without triggering new approvals. Use `per_request` for destructive or irreversible actions.

### Mode comparison

| Property | `per_request` | `session_approval` |
|---|---|---|
| Token format | UUID v7 (time-ordered) | `session_id:action_class` |
| Approvals per session | One per action call | One per action class per session |
| Audit granularity | Per action call | Per action class per session |
| Operator fatigue | Higher | Lower |
| Replay attack surface | Minimal | Session-scoped |

---

## Token Lifecycle

An approval token passes through the following states:

```
[created] --> [pending] --> [consumed]
                |
                +-- approved  --> consumed
                +-- denied    --> consumed
                +-- expired   --> consumed
                +-- cancelled --> consumed
```

### 1. Creation

When a matched action triggers a HITL check, `ApprovalManager.createApprovalRequest()` is called:

- In `per_request` mode: generates a UUID v7 token (`xxxxxxxx-xxxx-7xxx-8xxx-xxxxxxxxxxxx`)
- In `session_approval` mode: generates a composite key (`session_id:action_class`)

UUID v7 tokens encode the current Unix millisecond timestamp in their first 48 bits, giving them lexicographic time-ordering. The remaining bits are random.

The token is stored in the in-memory `pending` map along with:
- The tool name, agent ID, and channel ID
- The policy name and fallback
- The binding hash (for replay prevention)
- A TTL timer set to `policy.approval.timeout * 1000` ms
- A Promise resolver function

The method returns `{ token, promise }`. The caller awaits the promise, blocking the action until the request is resolved.

### 2. Pending

The token sits in the `pending` map until one of:
- An operator responds via the channel (Telegram command or Slack button click)
- The TTL timer fires

The channel adapter (Telegram or Slack) routes the operator's response to `ApprovalManager.resolveApproval(token, decision)`.

### 3. Resolution

`resolveApproval(token, decision, binding?)`:
1. Looks up the token in `pending`
2. If a `binding` is provided, verifies it matches the stored binding — returns `false` on mismatch
3. Clears the TTL timer
4. Moves the token from `pending` to `consumed`
5. Resolves the promise with `'approved'` or `'denied'`

### 4. Expiry

When the TTL timer fires:
1. The token is removed from `pending` and added to `consumed`
2. The promise resolves with `'expired'`
3. The pipeline applies the policy's `fallback` value (`deny` or `auto-approve`)

### 5. Consumed

Once a token is in the `consumed` set, `isConsumed(token)` returns `true` and `resolveApproval` returns `false`. Tokens cannot be reused.

### Important properties

- **In-memory only.** Pending approvals do not survive plugin restarts. If the plugin restarts mid-approval, in-flight requests are lost and the fallback applies.
- **No persistence.** Consumed tokens are also in-memory only. The consumed set resets on restart, so a replayed token from a previous session will appear as unknown (not consumed), but without a matching `pending` entry it cannot be resolved.
- **Concurrent approvals.** Multiple approvals for different actions can be pending simultaneously, each with its own independent token and timer.
- **Timer `unref`.** The TTL timers call `.unref()`, preventing them from keeping the Node.js process alive after all other work is done.

### Shutdown

`ApprovalManager.shutdown()` resolves all pending approvals as `'expired'` and clears the timers. Call this on plugin deactivation.

---

## Policy File Format

HITL policies are defined in YAML or JSON. The file is hot-reloaded — edit it while the plugin is running and the new policies take effect immediately.

### Development configuration (minimal)

```yaml
version: "1"

policies:
  - name: destructive-actions
    actions:
      - "email.delete"
      - "file.delete"
    approval:
      channel: telegram
      timeout: 120
      fallback: deny
```

### Production configuration (hardened)

```yaml
version: "1"

# Credentials in env vars, not in this file.
# TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SLACK_BOT_TOKEN,
# SLACK_CHANNEL_ID, SLACK_SIGNING_SECRET must be set.

policies:
  # Irreversible actions: long timeout, always deny on miss
  - name: destructive-actions
    description: Require approval before deleting or overwriting anything
    actions:
      - "email.delete"
      - "file.delete"
      - "file.overwrite"
      - "calendar.delete"
      - "db.drop"
    approval:
      channel: telegram
      timeout: 300
      fallback: deny
    tags: [safety, production]

  # Outbound communication: team channel visibility
  - name: external-communication
    description: Human must approve outbound messages
    actions:
      - "email.send"
      - "email.forward"
      - "slack.send"
    approval:
      channel: slack
      timeout: 180
      fallback: deny
    tags: [communication, production]

  # Financial operations: longest timeout
  - name: payment-namespace
    description: All payment actions need explicit sign-off
    actions:
      - "payment.*"
    approval:
      channel: telegram
      timeout: 600
      fallback: deny
    tags: [finance, production]

  # Deployment: catch any deploy or publish action
  - name: deployment-actions
    description: All deploy actions need sign-off
    actions:
      - "*.deploy"
      - "*.publish"
      - "*.release"
    approval:
      channel: telegram
      timeout: 300
      fallback: deny
    tags: [ops, production]
```

---

## Schema Reference

### Top-level: `HitlPolicyConfig`

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | `string` | Yes | Schema version. Must be `"1"`. |
| `policies` | `HitlPolicy[]` | Yes | Ordered list of policies. First match wins. |
| `telegram` | `TelegramConfig` | No | Telegram bot credentials. |
| `slack` | `SlackConfig` | No | Slack bot credentials and webhook config. |

### Policy: `HitlPolicy`

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Human-readable name for this policy. |
| `description` | `string` | No | Documentation / explanation. |
| `actions` | `string[]` | Yes | Action patterns that require approval. Min 1. |
| `approval` | `HitlApprovalConfig` | Yes | Where and how to request approval. |
| `tags` | `string[]` | No | Tags for filtering or categorisation. |

### Approval config: `HitlApprovalConfig`

| Field | Type | Required | Description |
|---|---|---|---|
| `channel` | `string` | Yes | Channel adapter to use: `"telegram"` or `"slack"`. |
| `timeout` | `number` | Yes | Seconds to wait for a response. Minimum: 1. |
| `fallback` | `"deny"` \| `"auto-approve"` | Yes | What happens when timeout elapses without a response. |

### Telegram config: `TelegramConfig`

| Field | Type | Description |
|---|---|---|
| `botToken` | `string` | Telegram Bot API token. Overridden by `TELEGRAM_BOT_TOKEN` env var. |
| `chatId` | `string` | Telegram chat ID. Overridden by `TELEGRAM_CHAT_ID` env var. |

### Slack config: `SlackConfig`

| Field | Type | Description |
|---|---|---|
| `botToken` | `string` | Slack Bot User OAuth Token (`xoxb-...`). Overridden by `SLACK_BOT_TOKEN` env var. |
| `channelId` | `string` | Slack channel ID. Overridden by `SLACK_CHANNEL_ID` env var. |
| `signingSecret` | `string` | Slack Signing Secret for webhook verification. Overridden by `SLACK_SIGNING_SECRET` env var. |
| `interactionPort` | `number` | Port for the interaction webhook server. Default: `3201`. Overridden by `SLACK_INTERACTION_PORT` env var. |
| `interactionHost` | `string` | Host/interface for the interaction webhook server. Default: `0.0.0.0`. Overridden by `SLACK_INTERACTION_HOST` env var. |

### Fallback behaviour

| Value | Behaviour |
|---|---|
| `"deny"` | Action is blocked. Agent receives a rejection. Safest option for production. |
| `"auto-approve"` | Action proceeds after timeout. Use only for low-risk actions where blocking would degrade the user experience. |

---

## Action Pattern Matching

Patterns use dot-notation with per-segment wildcards.

### Rules

1. `"*"` alone matches **any** action string, regardless of segment count.
2. Exact match: `"email.delete"` matches only `"email.delete"`.
3. Per-segment wildcard: `"email.*"` matches `"email.send"`, `"email.delete"`, etc.
4. Patterns with **different segment counts** do NOT match. `"email.*"` does not match `"email"` or `"email.draft.save"`.

### Examples

| Pattern | Input | Result |
|---|---|---|
| `"*"` | `"anything.at.all"` | Match |
| `"email.delete"` | `"email.delete"` | Match |
| `"email.delete"` | `"email.send"` | No match |
| `"email.*"` | `"email.send"` | Match |
| `"email.*"` | `"file.delete"` | No match |
| `"email.*"` | `"email.draft.save"` | No match (3 segments vs 2) |
| `"*.delete"` | `"email.delete"` | Match |
| `"*.delete"` | `"file.delete"` | Match |
| `"*.delete"` | `"email.send"` | No match |

### Evaluation order

Policies are evaluated in **declaration order**. The first policy with a matching pattern wins. Subsequent policies are not checked for that action.

This means you can layer policies from most specific to most general:

```yaml
policies:
  # Specific: financial deletes need longer timeout
  - name: finance-delete
    actions: ["invoice.delete", "payment.delete"]
    approval:
      channel: telegram
      timeout: 300
      fallback: deny

  # General: all other deletes
  - name: general-delete
    actions: ["*.delete"]
    approval:
      channel: slack
      timeout: 120
      fallback: deny
```

---

## Approval Channels

### Telegram

Uses the Telegram Bot API with long polling to receive operator responses.

#### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and note the token
2. Get your chat ID (message the bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
3. Set environment variables:
   ```bash
   export TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
   export TELEGRAM_CHAT_ID="987654321"
   ```

#### Approval flow (v1.3.0+ — inline buttons)

1. Agent triggers a matched action.
2. Bot sends a MarkdownV2-formatted message to your chat with action details and an inline keyboard with three buttons: **Approve Once**, **Approve Always** (optional), **Deny**.
3. You tap a button. The Telegram client sends a `callback_query` to the bot.
4. The plugin resolves the pending action via `answerCallbackQuery` and the agent continues or receives a rejection.
5. The original message is updated in place via `editMessageText` to show the decision; the buttons are removed.

The `/approve <token>` and `/deny <token>` text-command path is still supported as a fallback, and Telegram now also supports management commands for inspecting pending approvals and saved Approve Always rules.

#### Message format

Each approval message is rendered in MarkdownV2 and contains the following sections, in order. Optional sections are omitted when empty.

| Section | Always present | Source |
|---|---|---|
| `UNVERIFIED AGENT` warning | only when `verified === false` | identity resolver |
| `HITL Approval Request` header | yes | static |
| Tool / Agent / Policy / (Risk) / Expires-in | yes | approval request fields |
| Action class / Target | when populated | normaliser |
| Summary / Explanation | when populated | command explainer (v1.3.0+) |
| Effects (bullet list) | when non-empty | command explainer |
| Warnings (bullet list, prefixed `!`) | when non-empty | command explainer |
| Intent hint ("Why this is happening") | when `ctx.metadata.intent_hint` set | agent-supplied; truncated to 200 chars |
| Command (preformatted block) | when populated | original command string; truncated to 200 chars |
| Expiry timestamp / Approval ID | yes | approval request |
| Inline keyboard buttons | yes | static three-button row |

Example rendered message (formatting simplified):

```
HITL Approval Request

Tool: bash
Agent: main
Policy: shell-exec-gate
Risk: high
Expires in: 120s
Action Class: code.execute
Target: docker run -it --rm -v /:/host ubuntu bash

Explanation:
Starts an Ubuntu container with the host filesystem mounted

Effects:
• Starts a container
• Mounts the host filesystem at /host
• Executes a shell script inside the container

Warnings:
• Full disk access — host filesystem mounted at /host
• Privileged container

Why this is happening:
The agent is bootstrapping a development environment.

Command:
```docker run -it --rm -v /:/host ubuntu bash -c "setup.sh"```

Expires at: 2026-04-29T12:34:56Z
Approval ID: 01957b3c-...

[ Approve Once ] [ Approve Always ] [ Deny ]
```

After a decision, the original message is replaced via `editMessageText` with a one-line confirmation:

```
Action `01957b3c-...` — APPROVED
Tool: `bash`
```

(or `DENIED` for a denial). The buttons are removed.

#### Approve Always

Tapping **Approve Always** opens a follow-up confirmation message that proposes a permit pattern derived from the command (e.g. `docker run *`) with `Save` / `Cancel` buttons. On Save, the rule is appended to `data/auto-permits.json` and hot-reloaded; the next matching command bypasses HITL entirely. See the dedicated [Approve Always](#approve-always) section below for derivation rules, the auto-permit store format, the CLI helpers, and the `CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1` / `CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM=1` flags.

#### Telegram operator commands

The inline buttons are the primary approval UX, but the Telegram bot also accepts text commands in the configured `TELEGRAM_CHAT_ID`. Use these for status checks, keyboard-only workflows, and cleanup of saved Approve Always patterns.

| Command | What it does |
|---|---|
| `/help` or `/start` | Shows the available HITL bot commands. |
| `/approvals` or `/pending` | Lists pending HITL requests, including token, tool, action class, policy, target, expiry, and ready-to-send approve/deny commands. |
| `/approve TOKEN` | Approves one pending request. Kept as a fallback for buttonless clients and automation. |
| `/deny TOKEN` | Denies one pending request. Kept as a fallback for buttonless clients and automation. |
| `/approve_always TOKEN` | Starts the Approve Always flow for a pending request. |
| `/approve_always` | Lists saved Approve Always rules from `data/auto-permits.json`. Aliases: `/always`, `/auto_approvals`, `/auto_permits`. |
| `/revoke N` | Revokes saved Approve Always rule number `N` from the `/approve_always` list. |
| `/revoke PATTERN` | Revokes a saved Approve Always rule by exact pattern string. |

Examples:

```
/approve 01957b3c-4f2a-7d8e-9b1c-6e5f4a3b2c1d
/deny    01957b3c-4f2a-7d8e-9b1c-6e5f4a3b2c1d
/approve_always
/revoke 2
```

`/revoke` rewrites the auto-permit store atomically, reloads the in-memory checker and JSON rules, and clears in-memory session auto-approvals. Clearing the session set is intentionally conservative: session auto-approvals are keyed by channel/action class, while stored rules are pattern-based, so clearing all session entries prevents a revoked rule from lingering until restart.

To collapse the message body to the v1.2.x minimal style (raw command + buttons, no explainer / effects / warnings / intent-hint sections), set `CLAWTHORITY_HITL_MINIMAL=1`. Buttons (including Approve Always) continue to work — only the rich body is suppressed.

#### Security considerations

- **Secret storage:** Store `TELEGRAM_BOT_TOKEN` in a secrets manager or env file outside the repository. Never hardcode it in `hitl-policy.yaml`. Precedence: `TELEGRAM_BOT_TOKEN` env var > `telegram.botToken` config field > (no built-in default — missing token disables the adapter).
- **Access control:** The bot listens on the configured `TELEGRAM_CHAT_ID` only. Updates from other chats are silently ignored. Use a private chat or a group with restricted membership. Anyone who can see and tap a button in the chat can approve — restrict membership to operators.
- **No webhook verification needed:** Telegram long-polling fetches updates from the Telegram API; there is no incoming webhook to verify. Ensure the bot token is not exposed — possession of the token gives full control over the bot.
- **Callback-query parsing:** Only `callback_query` updates with `callback_data` matching `<verb>:<token>` (where verb ∈ `approve_once`, `approve_always`, `deny`, `confirm_approve_always`, `cancel_approve_always`) are processed; all other callback updates are ignored. Token format: UUID v7 or `session_id:action_class` for session approvals. Text approval commands use the same token shape. Management commands only run for the configured chat ID.

---

### Slack

Uses the Slack Web API with Block Kit interactive buttons. Requires a webhook endpoint for receiving button clicks.

#### Setup

1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Add the `chat:write` bot scope and install to your workspace
3. Note the Bot User OAuth Token (`xoxb-...`) and Signing Secret
4. Under **Interactivity & Shortcuts**, enable interactivity and set the Request URL to `http://<your-host>:3201/slack/interactions`
5. Set environment variables:
   ```bash
   export SLACK_BOT_TOKEN="xoxb-..."
   export SLACK_CHANNEL_ID="C0123456789"
   export SLACK_SIGNING_SECRET="your-signing-secret"
   # Optional: override default port 3201
   export SLACK_INTERACTION_PORT="3201"
   # Optional: override default bind host 0.0.0.0
   export SLACK_INTERACTION_HOST="0.0.0.0"
   ```

#### Approval flow

1. Agent triggers a matched action.
2. Bot posts a Block Kit message to the configured channel with action details and three buttons: **Approve Once**, **Approve Always** (optional), **Deny**.
3. Operator clicks a button.
4. Slack sends a signed POST request to the interaction webhook endpoint.
5. The webhook verifies the Slack signature and dispatches the decision.
6. The original message is updated to show the decision (buttons removed).

#### Message format

Slack messages use Block Kit. The body mirrors the Telegram MarkdownV2 layout — same fields, same explainer-driven content, same conditional sections — rendered as Block Kit blocks:

| Block | Always present | Source |
|---|---|---|
| `UNVERIFIED AGENT` warning context block | only when `verified === false` | identity resolver |
| `HITL Approval Request` header block | yes | static |
| Core fields: Tool / Agent / Policy / Expires-in (+ Risk when set) | yes | approval request fields |
| Action class / Target fields | when populated | normaliser |
| Summary / Explanation section | when populated | command explainer (v1.3.0+) |
| Effects bullet list | when non-empty | command explainer |
| Warnings bullet list (prefixed `!`) | when non-empty | command explainer |
| Intent hint context block | when `ctx.metadata.intent_hint` set | agent-supplied; truncated to 200 chars |
| Command preformatted block | when populated | truncated to 200 chars |
| Approval-ID footer | yes | approval request |
| Actions block — three buttons | yes | static |

The buttons carry action IDs and values:

| Button label | `action_id` | `value` |
|---|---|---|
| Approve Once | `hitl_approve_once` | `approve_once:<token>` |
| Approve Always (optional) | `hitl_approve_always` | `approve_always:<token>` |
| Deny | `hitl_deny` | `deny:<token>` |

After a decision, the original message is updated via `chat.update`. The buttons are removed and replaced with a one-line decision summary:

```
Action `01957b3c-...` — APPROVED
Tool: `email.send`
```

#### Approve Always

The third button opens a Block Kit confirmation message proposing a permit pattern derived from the command, with **Save** / **Cancel** buttons. On Save, the rule is appended to `data/auto-permits.json` and hot-reloaded. See the dedicated [Approve Always](#approve-always) section below.

To hide Approve Always controls on every HITL channel (keeping only Approve Once / Deny where applicable), set `CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1`.

To collapse the message body to v1.2.x minimal style (raw command + buttons only — no explainer / effects / warnings / intent-hint sections), set `CLAWTHORITY_HITL_MINIMAL=1`.

#### Approval URL structure and webhook endpoint

The plugin runs a lightweight HTTP server to receive Slack interaction callbacks.

**Endpoint:** `POST /slack/interactions`

**Default port:** `3201`

**Full URL (example):** `http://your-host:3201/slack/interactions`

This URL must be registered in your Slack App's **Interactivity & Shortcuts** settings as the Request URL. Slack will POST interaction payloads to this URL whenever a button is clicked.

The server only accepts:
- Method: `POST`
- Path: `/slack/interactions`
- All other methods or paths return `404`

**Interaction payload structure:**

Slack sends a URL-encoded `payload` parameter containing a JSON object:

```json
{
  "type": "block_actions",
  "actions": [
    {
      "action_id": "hitl_approve",
      "value": "approve:01957b3c-4f2a-7d8e-9b1c-6e5f4a3b2c1d"
    }
  ]
}
```

Only `block_actions` type payloads with values matching `approve:<token>` or `deny:<token>` are processed.

**Response timing:** The server responds `200 OK` immediately before processing the payload, satisfying Slack's 3-second response requirement.

#### Security considerations

- **Secret storage:** Store `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` in a secrets manager or env file outside the repository. Precedence for each credential: env var > config file field > (no built-in default — missing credential disables the adapter). Full chain:
  - `SLACK_BOT_TOKEN` > `slack.botToken` > (disabled)
  - `SLACK_CHANNEL_ID` > `slack.channelId` > (disabled)
  - `SLACK_SIGNING_SECRET` > `slack.signingSecret` > (disabled)
  - `SLACK_INTERACTION_PORT` > `slack.interactionPort` > `3201`
  - `SLACK_INTERACTION_HOST` > `slack.interactionHost` > `0.0.0.0`
- **Request verification:** Every incoming webhook request is verified using Slack's `v0=` HMAC-SHA256 scheme before any payload is processed:
  ```
  base_string = "v0:" + X-Slack-Request-Timestamp + ":" + raw_body
  expected    = "v0=" + HMAC-SHA256(signing_secret, base_string)
  ```
  The comparison uses `timingSafeEqual` to prevent timing attacks. Requests with invalid signatures return `401`.
- **Request age validation:** Requests with a timestamp older than 5 minutes are rejected, preventing replay of valid signatures.
- **Access control:** The bot posts to a single `SLACK_CHANNEL_ID`. Ensure the channel has appropriate membership restrictions. Any Slack workspace member who can see the channel can click Approve or Deny — restrict the channel to operators only.
- **Port exposure:** The interaction server listens on all interfaces by default. In production, put it behind a reverse proxy and restrict access at the network level.

---

### Console (fallback channel)

Added in v1.3.0. When neither Telegram nor Slack is configured (or both are unreachable and the policy has `fallback: deny` *and* the operator wants a synchronous prompt rather than a hard deny), the plugin can route the approval to the local terminal.

#### When it's used

- Local development and CI testing — no need to set up a Telegram bot just to run E2E suites.
- Operator-owned shell sessions where the agent and the human share a terminal.
- Disaster-recovery scenarios when the configured channel is reachable but you want a tighter feedback loop.

The console adapter is **not** intended for production use. There is no audit trail beyond the audit log entry itself, no operator-identity verification, and the prompt blocks the agent process.

#### Configuration

Set the channel to `console` in your HITL policy:

```yaml
policies:
  - name: dev-console-approvals
    actions:
      - "filesystem.delete"
    approval:
      channel: console
      timeout: 60
      fallback: deny
```

No env vars are required.

#### Approval flow

1. Agent triggers a matched action.
2. The plugin renders the same rich body (header / fields / explainer summary / effects / warnings / intent hint / command) as Telegram and Slack, in plain text with ANSI colour highlighting (red for warnings, yellow for risk, etc.).
3. The terminal prompts: `[a] Approve Once  [s] Approve Always  [d] Deny  >`.
4. Operator types `a` / `s` / `d` and Enter. The plugin resolves the pending action.
5. Result is printed to the same terminal.

`CLAWTHORITY_HITL_MINIMAL=1` collapses the body to a single command line + prompt.

---

## Approve Always

Added in v1.3.0. The third HITL button persists a permit pattern so the next matching command bypasses HITL entirely. This trades operator effort (one tap to save a pattern) against fewer prompts on recurring commands.

### How it works

1. Operator taps **Approve Always** on a Telegram / Slack / console approval.
2. The plugin derives a permit pattern from the original command using the algorithm in [`src/auto-permits/pattern-derivation.ts`](../src/auto-permits/pattern-derivation.ts) (e.g. `docker run -it --rm ubuntu bash` → `docker run *`).
3. A confirmation message is sent showing the derived pattern with `Save` / `Cancel` buttons. (When `CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM=1` is set, this step is skipped and the pattern is saved immediately.)
4. On `Save`, the rule is appended to `data/auto-permits.json` and the file watcher hot-reloads the JSON rules engine.
5. The original action proceeds with a normal approval.
6. The next call whose command matches the saved pattern returns `effect: 'permit', stage: 'auto-permit'` from Stage 2 — bypassing HITL entirely.

### Pattern derivation rules

The derivation is intentionally conservative. Only commands that fit a supported strategy produce a pattern; everything else is refused (operator must use Approve Once).

- **Registered-tool derivation** — applies when the call resolves to a registered non-exec tool name (e.g. `npm_install`). The saved pattern is derived from the tool name and uses `method: "default"`; it matches invocations of that tool name.
- **Shell-command derivation** — applies when the action class is `unknown_sensitive_action`, `shell.exec`, or `code.execute` and the target is a shell command. Tokenises the command, drops flags (`-it`, `-v ...`, `--rm`), retains binary + first positional argument as `<binary> <positional> *`. Example: `docker run -it --rm ubuntu bash` → `docker run *`.
- **`exact` method** — supported by the store and matcher for tooling-managed records. It normalises the full command with no wildcard, so only the exact command shape matches.

Refusal cases (Approve Always is offered but produces no pattern):
- Shell metacharacters present (`;`, `|`, `&&`, `>`, backticks, `$()`) — derivation is unsafe.
- Pattern length > 200 chars after derivation.
- Pattern derives to a bare wildcard (e.g. `*`) or empty string.

### Storage — `data/auto-permits.json`

Permits live in a hot-reloadable JSON file alongside `data/rules.json`. Schema:

```json
{
  "version": 5,
  "checksum": "sha256-...",
  "rules": [
    {
      "pattern": "docker run *",
      "method": "default",
      "createdAt": 1714390000000,
      "originalCommand": "docker run -it --rm ubuntu bash",
      "created_by": "main",
      "created_at": "2026-04-29T12:34:56Z",
      "derived_from": "docker run -it --rm ubuntu bash"
    }
  ]
}
```

| Field | Notes |
|---|---|
| `version` | Monotonic counter; bumped on every write. The watcher rejects bundles whose version is not strictly greater. |
| `checksum` | SHA-256 of the canonicalised `rules` array; verified on load. |
| `rules[].pattern` | The derived permit pattern. |
| `rules[].method` | `default` or `exact`. Approve Always currently writes `default`; exact rules can be managed by tooling. |
| `rules[].createdAt` | Epoch milliseconds. |
| `rules[].originalCommand` | The command the pattern was derived from. |
| `rules[].created_by` | Channel / agent identifier of the operator who approved. |
| `rules[].created_at` | ISO-8601 form of `createdAt`. |
| `rules[].derived_from` | Sanitised command snippet for audit display. |

The file is hot-reloaded by the same chokidar watcher that handles `data/rules.json` and `data/bundle.json` — no plugin restart required after a tool-assisted edit.

> **Operator note:** Prefer `/revoke`, `npm run remove-auto-permit`, or `npm run revoke-auto-permit` over hand-editing the file. These paths bump `version`, recompute `checksum`, reload rules, and avoid stale in-memory session approvals.

### CLI helpers

The plugin ships six npm scripts for managing the auto-permit store. Run from the plugin directory:

| Command | What it does |
|---|---|
| `npm run list-auto-permits` | Pretty-prints every saved pattern with origin metadata. |
| `npm run show-auto-permit <pattern>` | Full detail for a single rule (by pattern or by index). |
| `npm run validate-auto-permits` | Validates the file's schema + checksum without modifying anything. |
| `npm run test-auto-permit -- <command>` | Dry-run match: reports which (if any) saved pattern would match the supplied command, without executing. |
| `npm run remove-auto-permit -- <index>` | Removes a single rule by index; bumps the version counter. |
| `npm run revoke-auto-permit -- <pattern>` | Removes by pattern string. |

### Telegram bot helpers

The Telegram bot exposes the same common review/revoke loop without shell access:

| Command | What it does |
|---|---|
| `/approve_always` | Lists saved patterns with creation metadata and a matching `/revoke N` command for each entry. |
| `/revoke N` | Removes by list number, bumps the store version, reloads rules, and clears in-memory session auto-approvals. |
| `/revoke PATTERN` | Removes by exact pattern string. |

### Audit

Every Approve Always save emits an `auto_permit_added` audit entry alongside the normal `hitl approved` entry:

| Field | Notes |
|---|---|
| `type` | `"auto_permit_added"` |
| `pattern` | The saved pattern. |
| `method` | `default` or `exact`. Approve Always currently writes `default`. |
| `originalCommand` | The command the pattern was derived from. |
| `agentId`, `channel`, `policyName` | Same provenance as the underlying HITL entry. |

When a future command matches a saved pattern, Stage 2 emits an `auto_permit_match` entry recording which pattern fired.

### Feature flags

| Env var | Default | Effect |
|---|---|---|
| `CLAWTHORITY_DISABLE_APPROVE_ALWAYS` | unset | Set to `1` to hide the Approve Always button on every channel and refuse new auto-permit creation. Existing rules in `data/auto-permits.json` are still honoured. |
| `CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM` | unset | Set to `1` to skip the Save / Cancel confirmation step. The pattern is saved immediately on the first button tap. Use only when you trust the derivation algorithm in your environment. |
| `CLAWTHORITY_HITL_MINIMAL` | unset | Set to `1` to suppress the rich body (explainer summary / effects / warnings / intent hint / command block) — buttons (including Approve Always) still work. |

All three are read once at module load; restart the plugin to change them.

---

## Audit Logging

HITL decisions are written to the same JSONL audit log as policy decisions (`data/audit.jsonl`).

### HITL audit entry schema

| Field | Type | Description |
|---|---|---|
| `ts` | `string` (ISO 8601) | When the decision was recorded |
| `type` | `"hitl"` | Distinguishes HITL entries from policy entries |
| `decision` | `string` | One of: `approved`, `denied`, `expired`, `fallback-deny`, `fallback-auto-approve`, `telegram-unreachable`, `slack-unreachable` |
| `token` | `string` | The approval token |
| `toolName` | `string` | The tool that triggered the HITL check |
| `agentId` | `string` | The agent that requested the action |
| `channel` | `string` | The agent's channel context |
| `policyName` | `string` | The HITL policy that matched |
| `timeoutSeconds` | `number` | The configured timeout for this policy |

---

## Evaluation Pipeline

```
Agent action
  |
  v
1. Cedar engine (TypeScript rules, hot-reloaded)
  |-- forbid? --> BLOCK
  |-- pass? --> continue
  |
  v
2. JSON-Cedar engine (data/rules.json)
  |-- forbid? --> BLOCK
  |-- pass? --> continue
  |
  v
3. HITL check (does this action need human approval?)
  |-- no match --> ALLOW
  |-- match --> send approval request, await response
      |-- approved --> ALLOW
      |-- denied --> BLOCK
      |-- expired + fallback=deny --> BLOCK
      |-- expired + fallback=auto-approve --> ALLOW
  |
  v
4. Audit log (all decisions recorded)
```

A HITL-approved action has already passed through all policy engines. Approval from a human does not bypass budget caps, capability gates, or forbid rules. The two systems are complementary:

- **Policy engines** answer: "Is this action permitted by the rules?"
- **HITL** answers: "Does a human consent to this action?"

Both must pass for the action to execute.

---

## Hot Reload

The HITL policy file is watched for changes. When you edit and save the file:

1. The watcher detects the change (debounced at 300ms)
2. The file is re-parsed and validated
3. If valid, the new config is swapped in atomically
4. If invalid, the previous config remains active and an error is logged

This means you can add, remove, or modify HITL policies without restarting the plugin or the agent.

---

## Error Handling

The HITL system is designed to fail safely:

| Scenario | Behaviour |
|---|---|
| Channel unreachable (network error) | Fallback applies (`deny` or `auto-approve` per policy) |
| Channel not configured (missing credentials) | Fallback applies |
| HITL policy file missing | HITL disabled; all actions pass through to policy engines only |
| HITL policy file invalid | Previous config remains active; error logged |
| HITL evaluation error | Fail closed (action blocked) |
| Token expired | Fallback applies |
| Unknown token in response | Ignored; logged as warning |
| Binding mismatch on resolve | Treated as unknown token; resolution fails |
| Plugin restart with pending approvals | In-flight approvals lost; fallback applies |

---

## Troubleshooting

### Telegram: approvals are not received

**Symptom:** The plugin sends a message but `/approve TOKEN` has no effect.

**Checks:**
1. Confirm `TELEGRAM_BOT_TOKEN` is set and valid.
2. Confirm `TELEGRAM_CHAT_ID` matches the chat where you are sending commands.
3. Ensure the bot is a member of the chat.
4. The command must match exactly: `/approve TOKEN` with a single space. Leading or trailing whitespace (except a trim) will prevent matching.
5. Check the process logs for `[hitl-telegram] poll error` messages — these indicate network connectivity issues with the Telegram API.

### Telegram: bot sends messages but shows no confirmation after approval

**Symptom:** You send `/approve TOKEN` and nothing happens; no confirmation is sent.

**Checks:**
1. The token may have expired. If the policy `timeout` elapsed before you responded, the fallback applied and the token was consumed. Check the audit log for an `expired` entry.
2. The token string must match exactly. Copy it from the approval message rather than typing it.

### Slack: interaction buttons have no effect

**Symptom:** Clicking Approve or Deny in Slack produces no response.

**Checks:**
1. Confirm the interaction server is running (`[hitl-slack] interaction server listening on port 3201` in logs).
2. Confirm Slack can reach the server. The Request URL configured in your Slack App must be publicly accessible from Slack's servers.
3. Check `SLACK_SIGNING_SECRET` — an incorrect secret causes all interactions to fail with `401 Invalid signature`.
4. Check the process logs for `[hitl-slack] rejected request: invalid signature`.
5. If the server is behind a reverse proxy, ensure the raw request body (not a re-serialised version) is passed through. Signature verification requires the original body bytes.

### Slack: 401 errors on the interaction endpoint

**Symptom:** Interaction server logs show `rejected request: invalid signature`.

**Checks:**
1. Verify `SLACK_SIGNING_SECRET` matches the Signing Secret in your Slack App's **Basic Information** page.
2. Check the system clock — if the server clock is more than 5 minutes off from Slack's timestamp, requests will be rejected as too old. Use NTP.

### Approval falls back to `deny` even though the channel is configured

**Symptom:** Actions are blocked on timeout even though the operator responded in time.

**Checks:**
1. Confirm the channel adapter actually sent the notification. Look for `[hitl-telegram] sendMessage failed` or `[hitl-slack] chat.postMessage API error` in logs — if send failed, the fallback applies immediately.
2. Confirm the response reached the plugin. For Telegram, check the long-poll loop is running. For Slack, check the interaction server is reachable.
3. Check whether the token had already expired by the time the response arrived.

### Policy changes are not taking effect

**Symptom:** Edits to `hitl-policy.yaml` are not reflected in the running plugin.

**Checks:**
1. The hot-reload debounce is 300ms. Wait a moment after saving.
2. Check logs for `HitlPolicyValidationError` — a validation error will leave the previous config in place.
3. Verify the file path being watched is the same file you are editing (no symlink mismatch).

### `session_approval` token is not reusing a previous approval

**Symptom:** In `session_approval` mode, the agent sends a second request for the same action class but a new notification is sent.

**Explanation:** `session_approval` deduplications only work while the original token is still **pending**. If the first token was approved, denied, or expired, the pending entry is removed and a new token will be generated for the next request.

---

## Practical Examples

### Protecting against misinterpretation

Your agent has email access. A user types "clean up this thread." The agent interprets this as "delete all messages."

Without HITL: 340 emails deleted. No recovery.

With HITL: you get a Telegram message asking to approve `email.delete`. You deny and clarify. The agent calls `email.archive` instead. Data intact.

### Budget-sensitive operations

```yaml
- name: expensive-operations
  actions: ["api.batch_process", "ml.train"]
  approval:
    channel: telegram
    timeout: 60
    fallback: deny
```

The agent wants to kick off a batch job that will cost $50 in API calls. You get a Telegram ping. If you're available, you approve. If you're away, the timeout fires and the action is denied. Your bill stays bounded.

### Mixed channels

```yaml
policies:
  # Critical actions go to Telegram (direct, always on phone)
  - name: critical
    actions: ["*.delete", "*.deploy", "payment.*"]
    approval:
      channel: telegram
      timeout: 300
      fallback: deny

  # Reversible actions go to Slack (team visibility)
  - name: reversible
    actions: ["email.archive", "file.move"]
    approval:
      channel: slack
      timeout: 60
      fallback: auto-approve
```

### Bulk read operations with session approval

```yaml
- name: bulk-reads
  actions: ["file.read", "db.select"]
  approval:
    channel: telegram
    timeout: 30
    fallback: deny
```

With `session_approval` mode set in the pipeline context, approving the first `file.read` in a session covers all subsequent `file.read` calls in that session. The operator approves once rather than once per file.

---

## Testing

```bash
npm test
```

Key test areas:
- **Pattern matching**: wildcard, exact match, segment count rules
- **Policy evaluation**: first-match-wins semantics
- **Schema validation**: required fields, type checking, edge cases
- **File parsing**: JSON and YAML formats, error handling
- **Watcher**: debounce, reload on change, error isolation
- **Approval manager**: token generation, TTL expiry, concurrent requests, shutdown
- **Telegram adapter**: config resolution, message formatting, long-polling, command parsing
- **Slack adapter**: config resolution, Block Kit formatting, signature verification, interaction server
- **Envelope utilities**: payload hash determinism, key-order stability, canonical formula match

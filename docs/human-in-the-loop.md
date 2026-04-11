# Human-in-the-Loop (HITL)

This guide covers how OpenAuthority routes high-stakes agent actions to a human operator for approval before execution, using Telegram or Slack.

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
  Cedar / JSON / ABAC policy engines evaluate
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

Create `hitl-policy.yaml` in the plugin root (`~/.openclaw/plugins/openauthority/`):

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

#### Approval flow

1. Agent triggers a matched action
2. Bot sends a message to your chat with action details and the approval token
3. You reply `/approve <token>` or `/deny <token>`
4. The plugin resolves the pending action and the agent continues or receives a rejection
5. A confirmation message is sent to the chat showing the decision

#### Message format

Telegram messages use Markdown formatting:

```
🚨 *HITL Approval Request* — `01957b3c-4f2a-7d8e-9b1c-6e5f4a3b2c1d`

*Tool:* `email.delete`
*Agent:* `agent-1`
*Policy:* destructive-actions
*Expires in:* 120s

Reply with:
`/approve 01957b3c-4f2a-7d8e-9b1c-6e5f4a3b2c1d` or `/deny 01957b3c-4f2a-7d8e-9b1c-6e5f4a3b2c1d`
```

After a decision, a confirmation is sent:

```
✅ Action `01957b3c-4f2a-7d8e-9b1c-6e5f4a3b2c1d` — *APPROVED*
Tool: `email.delete`
```

Or for denial:

```
❌ Action `01957b3c-4f2a-7d8e-9b1c-6e5f4a3b2c1d` — *DENIED*
Tool: `email.delete`
```

#### Security considerations

- **Secret storage:** Store `TELEGRAM_BOT_TOKEN` in a secrets manager or in an env file outside the repository. Never hardcode it in `hitl-policy.yaml`. Precedence: `TELEGRAM_BOT_TOKEN` env var > `telegram.botToken` config field > (no built-in default — missing token disables the adapter).
- **Access control:** The bot listens on the configured `TELEGRAM_CHAT_ID` only. Commands from other chats are silently ignored. Use a private chat or a group with restricted membership.
- **No request verification:** Telegram long polling fetches updates from the Telegram API; there is no incoming webhook to verify. Ensure the bot token is not exposed, as possession of the token gives full control over the bot.
- **Command parsing:** Only messages matching `/approve TOKEN` or `/deny TOKEN` are processed; all other messages are ignored. Token validation uses `[A-Za-z0-9_-]{6,12}` to filter invalid inputs.

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
   ```

#### Approval flow

1. Agent triggers a matched action
2. Bot posts a Block Kit message to the configured channel with action details and two buttons: **Approve** and **Deny**
3. Operator clicks a button
4. Slack sends a signed POST request to the interaction webhook endpoint
5. The webhook verifies the Slack signature and dispatches the decision
6. The original message is updated to show the decision (buttons removed)

#### Message format

Slack messages use Block Kit with a section block and an actions block:

**Approval request:**

```
:rotating_light: *HITL Approval Request* — `01957b3c-4f2a-7d8e-9b1c-6e5f4a3b2c1d`

*Tool:* `email.send`
*Agent:* `agent-1`
*Policy:* external-communication
*Expires in:* 180s

[ Approve ]  [ Deny ]
```

The buttons carry action IDs `hitl_approve` and `hitl_deny` with values `approve:<token>` and `deny:<token>`.

**After decision:**

```
✅ Action `01957b3c-4f2a-7d8e-9b1c-6e5f4a3b2c1d` — *APPROVED*
Tool: `email.send`
```

The original message is updated via `chat.update`; the buttons are replaced with the decision text.

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
2. JSON Cedar engine (data/rules.json)
  |-- forbid? --> BLOCK
  |-- pass? --> continue
  |
  v
3. ABAC engine (TypeBox policies)
  |-- deny? --> BLOCK
  |-- pass? --> continue
  |
  v
4. HITL check (does this action need human approval?)
  |-- no match --> ALLOW
  |-- match --> send approval request, await response
      |-- approved --> ALLOW
      |-- denied --> BLOCK
      |-- expired + fallback=deny --> BLOCK
      |-- expired + fallback=auto-approve --> ALLOW
  |
  v
5. Audit log (all decisions recorded)
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

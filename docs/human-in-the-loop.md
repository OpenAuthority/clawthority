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

HITL runs **after** the policy engines. If a policy engine already blocks the action, the HITL check is never reached. This means HITL adds human oversight on top of hard policy boundaries --- it cannot override a policy-level block.

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

## Policy File Format

HITL policies are defined in YAML or JSON. The file is hot-reloaded --- edit it while the plugin is running and the new policies take effect immediately.

### Full YAML example

```yaml
version: "1"

# Channel credentials (env vars take precedence over these values)
# telegram:
#   botToken: ""
#   chatId: ""
# slack:
#   botToken: ""
#   channelId: ""
#   signingSecret: ""
#   interactionPort: 3201

policies:
  - name: destructive-actions
    description: Require approval before deleting anything
    actions:
      - "email.delete"
      - "file.delete"
      - "calendar.delete"
    approval:
      channel: telegram
      timeout: 120
      fallback: deny
    tags: [safety, production]

  - name: external-communication
    description: Human must approve outbound messages
    actions:
      - "email.send"
      - "slack.send"
    approval:
      channel: slack
      timeout: 180
      fallback: deny
    tags: [communication]

  - name: deployment-actions
    description: All deploy actions need sign-off
    actions:
      - "*.deploy"
      - "*.publish"
    approval:
      channel: telegram
      timeout: 300
      fallback: deny
    tags: [ops, deploy]
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

**Setup:**
1. Create a bot via [@BotFather](https://t.me/BotFather) and note the token
2. Get your chat ID (message the bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
3. Set environment variables:
   ```bash
   export TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
   export TELEGRAM_CHAT_ID="987654321"
   ```

**Approval flow:**
1. Agent triggers a matched action
2. Bot sends a message to your chat with action details and a unique 8-character token
3. You reply `/approve <token>` or `/deny <token>`
4. The plugin resolves the pending action and the agent continues or receives a rejection

**Message format:**
```
HITL Approval Request --- abc12345

Tool: email.delete
Agent: agent-1
Policy: destructive-actions
Expires in: 120s

Reply: /approve abc12345  or  /deny abc12345
```

### Slack

Uses the Slack Web API with Block Kit interactive buttons. Requires a webhook endpoint for receiving button clicks.

**Setup:**
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

**Approval flow:**
1. Agent triggers a matched action
2. Bot posts a message to the configured channel with action details and two buttons: **Approve** and **Deny**
3. Operator clicks a button
4. The interaction webhook receives the click, verifies the Slack signature, and resolves the pending action
5. The original message is updated to show the decision (buttons removed)

**Security:** All incoming webhook requests are verified using Slack's `v0=` HMAC-SHA256 signing scheme. Requests older than 5 minutes are rejected.

---

## Approval Tokens

Each HITL request generates a unique 8-character alphanumeric token (base64url). The token:

- Links the approval request to the pending action
- Is displayed in the notification message
- Has a TTL equal to the policy's `timeout` value
- Expires automatically --- expired tokens result in the configured `fallback` action
- Is stored in-memory only --- pending approvals do not survive plugin restarts

Multiple simultaneous HITL requests are supported. Each has an independent token and state.

---

## Audit Logging

HITL decisions are written to the same JSONL audit log as policy decisions (`data/audit.jsonl`).

### HITL audit entry schema

| Field | Type | Description |
|---|---|---|
| `ts` | `string` (ISO 8601) | When the decision was recorded |
| `type` | `"hitl"` | Distinguishes HITL entries from policy entries |
| `decision` | `string` | One of: `approved`, `denied`, `expired`, `fallback-deny`, `fallback-auto-approve`, `telegram-unreachable`, `slack-unreachable` |
| `token` | `string` | The 8-character approval token |
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

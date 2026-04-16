# Configuration Reference

> **What this page is for.** Complete reference for every config field the plugin accepts — plugin manifest schema, bundle layout, environment-variable overrides, and secrets handling.

---

## Table of Contents

1. [Plugin Registration](#plugin-registration)
2. [Bundle Path and Directory Structure](#bundle-path-and-directory-structure)
3. [Plugin Manifest Schema](#plugin-manifest-schema)
4. [Rules File](#rules-file)
5. [HITL Policy File](#hitl-policy-file)
6. [Telegram Bot Setup](#telegram-bot-setup)
7. [Slack App Setup](#slack-app-setup)
8. [Protected Paths](#protected-paths)
9. [Audit Log](#audit-log)
10. [Environment Variables](#environment-variables)
11. [Engine Options](#engine-options)
12. [Example Configurations](#example-configurations)
13. [Resource Types and Channel Values](#resource-types-and-channel-values)
14. [TypeScript Configuration](#typescript-configuration)

---

## Plugin Registration

Clawthority is registered as an OpenClaw plugin in `~/.openclaw/config.json`:

```json
{
  "plugins": ["clawthority"]
}
```

OpenClaw resolves the plugin by looking for a directory named `clawthority` inside `~/.openclaw/plugins/` and loading its `dist/index.js` entry point as defined in `openclaw.plugin.json`.

---

## Bundle Path and Directory Structure

### Install path

```
~/.openclaw/plugins/clawthority/       ← plugin root
├── openclaw.plugin.json                 ← manifest (read by OpenClaw)
├── dist/                                ← compiled output (must exist before activation)
│   ├── index.js                         ← plugin entry point
│   ├── index.d.ts                       ← type declarations
│   └── ...                              ← other compiled modules
├── data/                                ← default data directory
│   ├── rules.json                       ← persisted authorization rules
│   └── audit.jsonl                      ← JSONL audit log
├── hitl-policy.yaml                     ← HITL approval policy (optional)
└── src/                                 ← TypeScript source (not required at runtime)
```

### Building the bundle

```bash
cd ~/.openclaw/plugins/clawthority
npm install
npm run build        # outputs to dist/
```

The `dist/` directory must exist and contain a valid `index.js` before OpenClaw can activate the plugin. If the build has not been run, OpenClaw will fail to load the plugin at startup.

### Data directory

The `data/` directory is the default location for:

| File | Purpose | Override |
|---|---|---|
| `data/rules.json` | Authorization rules array | `RULES_FILE` env var |
| `data/audit.jsonl` | JSONL audit log | `AUDIT_LOG_FILE` env var |

The server creates `data/` automatically if it does not exist. Override both paths with absolute paths for production deployments where the plugin directory may be read-only.

### Custom data directory example

```bash
# Production: store data outside the plugin directory
export RULES_FILE=/var/clawthority/rules.json
export AUDIT_LOG_FILE=/var/log/clawthority/audit.jsonl
```

---

## Plugin Manifest Schema

`openclaw.plugin.json` declares how OpenClaw loads and registers the plugin. This file is read-only — do not modify it in production.

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique plugin identifier. Must match the directory name used in `config.json`. |
| `name` | `string` | Internal name (matches `id`). |
| `displayName` | `string` | Human-readable name shown in OpenClaw UI. |
| `version` | `string` | SemVer version string. |
| `description` | `string` | Short description of the plugin's purpose. |
| `author` | `string` | Plugin author. |
| `license` | `string` | SPDX license identifier. |
| `main` | `string` | Entry point path relative to plugin root. Default: `dist/index.js`. |
| `types` | `string` | TypeScript declaration file path. Default: `dist/index.d.ts`. |

### `openclaw` section

| Field | Type | Description |
|---|---|---|
| `apiVersion` | `string` | OpenClaw plugin API version. Currently `"1"`. |
| `type` | `string` | Plugin type. Must be `"plugin"`. |
| `capabilities` | `string[]` | Declared capabilities (informational). |
| `hooks` | `string[]` | Lifecycle hooks the plugin subscribes to. |
| `installPath` | `string` | Expected install location. Used by OpenClaw package manager. |

#### Supported hooks

| Hook | Fired when |
|---|---|
| `before_tool_call` | An agent is about to call a tool |
| `before_prompt_build` | A prompt is being assembled |
| `before_model_resolve` | A model identifier is being resolved |

### `configSchema` section

Defines the configuration properties accepted by the plugin in `config.json`. All properties are optional; defaults apply if not specified.

| Property | Type | Default | Description |
|---|---|---|---|
| `rulesFile` | `string` | `data/rules.json` | Path to the JSON rules file. Relative paths resolve from the plugin root. |
| `auditLogFile` | `string` | `data/audit.jsonl` | Path to the JSONL audit log. Relative paths resolve from the plugin root. |
| `uiPort` | `number` | `7331` | Port for the policy engine dashboard server. |
| `enabled` | `boolean` | `true` | Master switch. Set to `false` to disable the plugin without removing it. |

`additionalProperties: false` — any unrecognized property in the plugin config block is rejected at validation time.

---

## Rules File

Authorization rules are stored as a JSON array. The active file path is controlled by the `RULES_FILE` environment variable (default: `data/rules.json`).

The rules file is hot-reloaded: changes are picked up within 300 ms without restarting OpenClaw.

### Rule schema

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique identifier. Assigned automatically by the server on creation (UUID v4). |
| `effect` | `"permit"` \| `"forbid"` | Yes | Whether to permit or forbid the matched resource. `forbid` wins over `permit` when both match the same request. |
| `resource` | `"tool"` \| `"command"` \| `"channel"` \| `"prompt"` \| `"model"` | Yes | Type of resource this rule targets. |
| `match` | `string` | Yes | Pattern matched against the resource name. Supports exact strings, `*` wildcard, and `/regex/` syntax (e.g. `/^write_.*/`). |
| `condition` | `string` | No | Serialized function body for fine-grained runtime conditions evaluated against the request context. |
| `reason` | `string` | No | Human-readable description of why this rule exists. Shown in audit logs and the dashboard. |
| `tags` | `string[]` | No | Category labels for filtering and grouping in the dashboard. |
| `rateLimit` | `object` | No | Sliding-window rate limit. See below. |

### `rateLimit` object

| Field | Type | Required | Description |
|---|---|---|---|
| `maxCalls` | `integer` (≥1) | Yes | Maximum calls allowed within the window. |
| `windowSeconds` | `integer` (≥1) | Yes | Duration of the sliding window in seconds. |

When a rate limit is exceeded, the request is forbidden regardless of the rule's `effect`. Rate limit state is maintained in memory and resets on plugin restart.

### Match patterns

| Pattern | Matches |
|---|---|
| `"read_file"` | Exactly `read_file` |
| `"*"` | Any resource name |
| `"write_*"` | Any name starting with `write_` (prefix wildcard) |
| `"/^(read\|list)_/"` | Any name matching the regular expression |

### Example rules.json

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "effect": "permit",
    "resource": "tool",
    "match": "read_file",
    "reason": "File reads are permitted for all agents",
    "tags": ["read-only", "filesystem"]
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "effect": "forbid",
    "resource": "command",
    "match": "rm",
    "reason": "Destructive shell deletions are blocked",
    "tags": ["security", "destructive"]
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "effect": "permit",
    "resource": "tool",
    "match": "write_file",
    "rateLimit": {
      "maxCalls": 20,
      "windowSeconds": 60
    },
    "reason": "File writes permitted up to 20 per minute",
    "tags": ["write", "rate-limited"]
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440003",
    "effect": "forbid",
    "resource": "model",
    "match": "/.*-(preview|experimental|alpha|beta)$/",
    "reason": "Pre-release models blocked in production",
    "tags": ["model-policy"]
  }
]
```

---

## HITL Policy File

Create `hitl-policy.yaml` in the plugin root (`~/.openclaw/plugins/clawthority/`) to enable Human-in-the-Loop approval flows. The file is hot-reloaded — changes apply immediately without restart.

See [Human-in-the-Loop](human-in-the-loop.md) for the complete guide.

### Schema overview

```yaml
version: "1"                          # required, must be "1"

# Optional: inline channel credentials
# (environment variables always take precedence — see sections below)
telegram:
  botToken: ""
  chatId: ""

slack:
  botToken: ""
  channelId: ""
  signingSecret: ""
  interactionPort: 3201

policies:
  - name: string                      # required, human-readable label
    description: string               # optional documentation
    actions:                          # required, ≥1 action pattern
      - "action.name"
      - "namespace.*"
    approval:
      channel: telegram               # "telegram" or "slack"
      timeout: 120                    # seconds to wait for response
      fallback: deny                  # "deny" or "auto-approve"
    tags: [optional, labels]
```

### Policy fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Policy label. Shown in approval messages and audit logs. |
| `description` | `string` | No | Documentation string. Not sent to approval channels. |
| `actions` | `string[]` | Yes | Action patterns that trigger approval. Uses dot-notation with `*` per-segment wildcards. |
| `approval.channel` | `"telegram"` \| `"slack"` | Yes | Which approval channel to use. |
| `approval.timeout` | `number` | Yes | Seconds before timeout fallback fires. Minimum: 1. |
| `approval.fallback` | `"deny"` \| `"auto-approve"` | Yes | Behaviour on timeout. `"deny"` is the safe default for production. |
| `tags` | `string[]` | No | Arbitrary labels for filtering. |

---

## Telegram Bot Setup

Telegram approval requires a bot token and a chat ID. Tokens and IDs can be provided via environment variables (recommended) or inline in `hitl-policy.yaml`.

### Step 1 — Create a bot

1. Open Telegram and message **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the token BotFather provides — it looks like `123456789:ABCDEFGhijklmnop-qrstuvwxyz`

### Step 2 — Get your chat ID

1. Send any message to your new bot
2. Fetch recent updates:

   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
   ```

3. Find `"chat":{"id":...}` in the response — that number is your chat ID

For group chats, add the bot to the group and use the group's negative numeric ID.

### Step 3 — Set environment variables

```bash
export TELEGRAM_BOT_TOKEN="123456789:ABCDEFGhijklmnop-qrstuvwxyz"
export TELEGRAM_CHAT_ID="987654321"
```

### Step 4 — Reference in policy file

```yaml
version: "1"
policies:
  - name: destructive-actions
    actions: ["file.delete", "email.delete"]
    approval:
      channel: telegram
      timeout: 120
      fallback: deny
```

No `telegram:` block is required in the policy file when environment variables are set.

### How Telegram polling works

The plugin starts a long-polling listener when any HITL policy uses `channel: telegram`. The listener:

- Polls `getUpdates` with a 30-second timeout
- Parses `/approve <token>` and `/deny <token>` commands
- Retries on network errors with a 5-second backoff
- Stops cleanly when the plugin is deactivated

The polling process keeps no persistent server — it works behind firewalls and NAT without any open port.

### Approval message format

```
HITL Approval Request — abc12345

Tool: email.delete
Agent: agent-1
Policy: destructive-actions
Expires in: 120s

Reply: /approve abc12345  or  /deny abc12345
```

### Security considerations

- Store `TELEGRAM_BOT_TOKEN` in a secret manager or `.env` file that is not committed to version control
- Keep the chat ID private — anyone who can send commands to the bot can approve or deny requests
- For team environments, use a private group channel so approvals are visible to multiple operators
- The 8-character approval token expires after the configured `timeout`; expired tokens are ignored

---

## Slack App Setup

Slack approval uses the Slack Web API for sending messages and an HTTP interaction endpoint for receiving button clicks.

### Step 1 — Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**, give it a name (e.g., `Clawthority HITL`), and select your workspace

### Step 2 — Configure bot scopes

Under **OAuth & Permissions → Scopes → Bot Token Scopes**, add:

| Scope | Purpose |
|---|---|
| `chat:write` | Post approval request messages |
| `chat:write.public` | Post to channels the bot has not joined (optional) |

### Step 3 — Install to workspace

1. Under **OAuth & Permissions**, click **Install to Workspace**
2. Authorize the requested scopes
3. Copy the **Bot User OAuth Token** — it starts with `xoxb-`

### Step 4 — Enable interactivity

1. Under **Interactivity & Shortcuts**, toggle **Interactivity** to **On**
2. Set the **Request URL** to where the interaction webhook server will be reachable:

   ```
   http://<your-host>:<SLACK_INTERACTION_PORT>/slack/interactions
   ```

   Default port is `3201`. The host must be reachable from Slack's servers. For local development, use a tunnelling tool such as `ngrok` or `cloudflared`.

3. Click **Save Changes**

### Step 5 — Copy the Signing Secret

Under **Basic Information → App Credentials**, copy the **Signing Secret**. This is used to verify that interaction payloads originate from Slack.

### Step 6 — Set environment variables

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_CHANNEL_ID="C0123456789"          # channel ID, not name
export SLACK_SIGNING_SECRET="your-signing-secret"
export SLACK_INTERACTION_PORT="3201"           # optional, default is 3201
```

To find a channel ID: right-click the channel in Slack → **View channel details** → scroll to the bottom.

### Step 7 — Reference in policy file

```yaml
version: "1"
policies:
  - name: file-writes
    actions: ["file.write", "file.delete", "file.move"]
    approval:
      channel: slack
      timeout: 180
      fallback: deny
```

### How the interaction server works

The plugin starts an HTTP server on `SLACK_INTERACTION_PORT` when any HITL policy uses `channel: slack`. The server:

- Listens on `/slack/interactions` for POST requests from Slack
- Verifies every request using the `v0=` HMAC-SHA256 signing scheme
- Rejects requests older than 5 minutes to prevent replay attacks
- Resolves the pending HITL token on Approve or Deny button clicks
- Updates the original Slack message to show the decision (buttons are removed)

### Approval message format (Block Kit)

The bot posts an interactive Block Kit message containing:
- Action details: tool name, agent ID, policy name, timeout
- **Approve** button (green) and **Deny** button (red)

On decision, the message is updated in place to show the outcome and remove the buttons.

### Security considerations

- Store `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` in a secret manager — never commit them
- The signing secret verification makes the webhook tamper-proof; do not disable it
- Restrict the Slack channel to operators who should be able to approve agent actions
- In production, place the interaction server behind a reverse proxy with TLS
- If `SLACK_INTERACTION_PORT` is exposed directly to the internet, ensure your firewall only allows inbound connections from [Slack's IP ranges](https://api.slack.com/docs/ip-ranges)

---

## Protected Paths

Protected paths are file-system paths that agents are forbidden from reading, writing to, or deleting. They are enforced at the rule level using regex patterns or exact matches.

### Default protected paths (built-in rules)

The engine ships with built-in rules that unconditionally forbid credential access and sensitive system directories. These mirror what the SecuritySPEC `blockedPaths` field expresses:

| Path pattern | Reason |
|---|---|
| `~/.ssh/` (and `/home/*/.ssh/`) | SSH private keys — compromise leads to remote access |
| `/etc/passwd`, `/etc/shadow` | System credential files |
| `/home/*/.aws/` | AWS credentials |
| `/root/` | Root home directory |
| `/etc/` (broadly) | System configuration |

### Adding protected paths via rules

Add `forbid` rules with regex patterns to block specific paths:

```json
[
  {
    "id": "protect-ssh-keys",
    "effect": "forbid",
    "resource": "tool",
    "match": "/\\.(ssh|gnupg)\\//",
    "reason": "SSH and GPG key directories are protected",
    "tags": ["security", "protected_path"]
  },
  {
    "id": "protect-aws-creds",
    "effect": "forbid",
    "resource": "tool",
    "match": "/\\.aws\\/(credentials|config)$/",
    "reason": "AWS credential files are protected",
    "tags": ["security", "protected_path"]
  },
  {
    "id": "protect-env-files",
    "effect": "forbid",
    "resource": "tool",
    "match": "/(\\/|^)\\.env(\\..*)?$/",
    "reason": ".env files may contain secrets",
    "tags": ["security", "protected_path"]
  }
]
```

### SecuritySPEC `blockedPaths`

In the SecuritySPEC YAML schema, `blockedPaths` is a string array defined at the tenant or agent sandbox level:

```yaml
identities:
  tenants:
    - id: "tenant-production"
      sandbox:
        allowedPaths:
          - "/tmp"
          - "/workspace"
        blockedPaths:
          - "/etc"
          - "/root"
          - "/home/*/.aws"
          - "/home/*/.ssh"
          - "/home/*/.gnupg"
          - "/proc"
          - "/sys"
```

`blockedPaths` entries support glob patterns. A path matching any `blockedPaths` entry is blocked even if it also matches an `allowedPaths` entry — blocked takes precedence.

### Security implications

- **Forbid-wins semantics**: a single `forbid` rule blocks access regardless of how many `permit` rules match. This is the correct default — never rely on the absence of a forbid to mean "permitted."
- **Regex escaping**: when using `/regex/` syntax in JSON rules, double-escape backslashes (`\\` for a literal `\`).
- **Wildcard scope**: `*` in rule `match` fields is a simple glob, not a regex. Use `/regex/` for complex path patterns.
- **Home directory variants**: protect both `~/` (tilde) and `/home/username/` forms since tools may expand or not expand tildes.
- **Audit trail**: every blocked path access is recorded in the audit log with the matched rule ID and reason, enabling post-incident review.

### Minimum recommended protected paths (production)

```json
[
  { "effect": "forbid", "resource": "tool", "match": "/\\/\\.ssh\\//",      "reason": "SSH keys" },
  { "effect": "forbid", "resource": "tool", "match": "/\\/\\.aws\\//",      "reason": "AWS credentials" },
  { "effect": "forbid", "resource": "tool", "match": "/\\/\\.gnupg\\//",    "reason": "GPG keys" },
  { "effect": "forbid", "resource": "tool", "match": "/\\/\\.env/",         "reason": ".env files" },
  { "effect": "forbid", "resource": "tool", "match": "/^\\/etc\\//",        "reason": "System config" },
  { "effect": "forbid", "resource": "tool", "match": "/^\\/root\\//",       "reason": "Root home" },
  { "effect": "forbid", "resource": "command", "match": "/^rm\\s+-rf/",     "reason": "Recursive force delete" }
]
```

---

## Audit Log

The audit log is a newline-delimited JSON (JSONL) file. Each line represents one policy decision or HITL event.

Path is controlled by the `AUDIT_LOG_FILE` environment variable (default: `data/audit.jsonl`).

### Policy decision entry schema

| Field | Type | Description |
|---|---|---|
| `timestamp` | `string` (ISO 8601) | When the decision was made |
| `policyId` | `string` | ID of the matched rule |
| `policyName` | `string` | Human-readable rule reason |
| `context` | `object` | Evaluation context: subject, resource, action, environment |
| `result` | `object` | Outcome: allowed, effect, matchedRuleId, reason |

### HITL audit entry schema

| Field | Type | Description |
|---|---|---|
| `ts` | `string` (ISO 8601) | When the decision was recorded |
| `type` | `"hitl"` | Distinguishes HITL entries from policy entries |
| `decision` | `string` | One of: `approved`, `denied`, `expired`, `fallback-deny`, `fallback-auto-approve`, `telegram-unreachable`, `slack-unreachable` |
| `token` | `string` | The 8-character approval token |
| `toolName` | `string` | The tool that triggered the check |
| `agentId` | `string` | The requesting agent |
| `channel` | `string` | The agent's channel context |
| `policyName` | `string` | The HITL policy that matched |
| `timeoutSeconds` | `number` | Configured timeout for the policy |

---

## Environment Variables

Environment variables always take precedence over values in `hitl-policy.yaml`. This allows credentials to be injected at deploy time without modifying committed configuration files.

### Precedence rule

```
environment variable > hitl-policy.yaml field > built-in default
```

### Install mode

Controls the plugin's policy posture at activation.

| Variable | Default | Description |
|---|---|---|
| `CLAWTHORITY_MODE` | `open` | `open` — implicit permit with a critical-forbid safety net (six action classes: `shell.exec`, `code.execute`, `payment.initiate`, `credential.read`, `credential.write`, `unknown_sensitive_action`). `closed` — implicit deny, user adds explicit `permit` rules. Any other value logs a warning and falls back to `open`. Case- and whitespace-insensitive. Read once at module load — **restart the plugin to change modes.** |

Mode only affects Stage 2 policy evaluation and which default rule set is loaded. Stage 1 (capability gate, protected paths, HITL binding) fails closed in both modes regardless.

#### Mode-to-rule-set mapping

| Mode | `defaultEffect` | Rules loaded |
|---|---|---|
| `open` | `permit` | Six critical forbids (see above). Everything else permits unless explicitly forbidden. |
| `closed` | `forbid` | Full `defaultRules` — seven action-class rules + one intent-group rule covering filesystem, payment, credential, shell, code, HITL card-data, and unknown-sensitive-action classes. |

#### Example

```bash
# Fresh install, open mode (default) — no configuration needed
node dist/index.js

# Locked-down production
CLAWTHORITY_MODE=closed node dist/index.js
```

### HITL — Telegram

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Telegram Bot API token. **Required** for Telegram approvals. Takes precedence over `telegram.botToken` in the policy file. |
| `TELEGRAM_CHAT_ID` | — | Telegram chat or group ID. **Required** for Telegram approvals. Takes precedence over `telegram.chatId` in the policy file. |

### HITL — Slack

| Variable | Default | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | — | Slack Bot User OAuth Token (`xoxb-...`). **Required** for Slack approvals. Takes precedence over `slack.botToken`. |
| `SLACK_CHANNEL_ID` | — | Slack channel ID (not name). **Required** for Slack approvals. Takes precedence over `slack.channelId`. |
| `SLACK_SIGNING_SECRET` | — | Slack Signing Secret for webhook verification. **Required** for Slack interaction server. Takes precedence over `slack.signingSecret`. |
| `SLACK_INTERACTION_PORT` | `3201` | Port for the Slack webhook server. Takes precedence over `slack.interactionPort`. |

### Dashboard server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7331` | HTTP port for the dashboard server |
| `RULES_FILE` | `../../data/rules.json` | Absolute or relative path to the rules JSON file (relative to `ui/`) |
| `AUDIT_LOG_FILE` | `../../data/audit.jsonl` | Absolute or relative path to the audit JSONL file (relative to `ui/`) |

### Environment variable override pattern

For production deployments, do not store secrets in `hitl-policy.yaml`. Instead:

1. Commit `hitl-policy.yaml` with empty or omitted credential fields:

   ```yaml
   version: "1"
   # telegram and slack blocks intentionally omitted — use env vars
   policies:
     - name: destructive-actions
       actions: ["file.delete", "email.delete"]
       approval:
         channel: telegram
         timeout: 120
         fallback: deny
   ```

2. Inject credentials at runtime via your deployment environment (`.env` file, systemd `EnvironmentFile`, Docker secrets, or a secrets manager):

   ```bash
   # .env (not committed to git)
   TELEGRAM_BOT_TOKEN=123456789:ABCDEFGhijklmnop-qrstuvwxyz
   TELEGRAM_CHAT_ID=987654321
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_CHANNEL_ID=C0123456789
   SLACK_SIGNING_SECRET=abc123def456
   ```

3. Load the `.env` file when starting the process:

   ```bash
   # With a process manager
   node --env-file=.env dist/index.js

   # Or with dotenv-cli
   dotenv -- npm start
   ```

---

## Engine Options

### Cedar-style policy engine (`src/policy/engine.ts`)

```typescript
import { PolicyEngine } from "./policy/engine.js";

const engine = new PolicyEngine({ cleanupIntervalMs: 60_000 });
```

| Option | Type | Default | Description |
|---|---|---|---|
| `cleanupIntervalMs` | `number` | `0` (disabled) | Interval in ms for automatic rate-limit window cleanup. `0` disables the timer; call `cleanup()` manually instead. |

### Hot-reload watcher (`src/watcher.ts`)

The watcher starts automatically during plugin `activate()`. It monitors the rules file for changes.

| Option | Type | Default | Description |
|---|---|---|---|
| `debounceMs` | `number` | `300` | Milliseconds to debounce file change events before triggering a reload. |
| `persistent` | `boolean` | `false` | Whether the watcher keeps the process alive. Always `false` in production to allow clean shutdown. |

---

## Example Configurations

### Development configuration

Minimal setup for local development. Uses defaults wherever possible.

**`~/.openclaw/config.json`**
```json
{
  "plugins": ["clawthority"]
}
```

**`data/rules.json`**
```json
[
  {
    "id": "dev-permit-all-reads",
    "effect": "permit",
    "resource": "tool",
    "match": "/^read_/",
    "reason": "All read tools permitted in development",
    "tags": ["dev"]
  },
  {
    "id": "dev-permit-writes",
    "effect": "permit",
    "resource": "tool",
    "match": "write_file",
    "rateLimit": { "maxCalls": 100, "windowSeconds": 60 },
    "reason": "File writes permitted with loose rate limit",
    "tags": ["dev"]
  }
]
```

**`hitl-policy.yaml`** (optional for dev)
```yaml
version: "1"
policies:
  - name: payment-actions
    description: Catch payment actions even in dev
    actions: ["payment.*"]
    approval:
      channel: telegram
      timeout: 60
      fallback: deny
```

**Environment (shell)**
```bash
export TELEGRAM_BOT_TOKEN="<your-dev-bot-token>"
export TELEGRAM_CHAT_ID="<your-chat-id>"
```

---

### Production configuration

Hardened setup for a production deployment. All credentials are injected via environment variables; no secrets are stored in committed files.

**`~/.openclaw/config.json`**
```json
{
  "plugins": ["clawthority"]
}
```

**`data/rules.json`** (stored at `/var/clawthority/rules.json`)
```json
[
  {
    "id": "prod-forbid-ssh",
    "effect": "forbid",
    "resource": "tool",
    "match": "/\\/\\.ssh\\//",
    "reason": "SSH key directories are protected",
    "tags": ["security", "protected_path"]
  },
  {
    "id": "prod-forbid-env",
    "effect": "forbid",
    "resource": "tool",
    "match": "/(\\/|^)\\.env/",
    "reason": ".env files may contain secrets",
    "tags": ["security", "protected_path"]
  },
  {
    "id": "prod-forbid-aws",
    "effect": "forbid",
    "resource": "tool",
    "match": "/\\/\\.aws\\//",
    "reason": "AWS credential directories are protected",
    "tags": ["security", "protected_path"]
  },
  {
    "id": "prod-forbid-rm-rf",
    "effect": "forbid",
    "resource": "command",
    "match": "/^rm\\s+-rf/",
    "reason": "Recursive force delete is prohibited",
    "tags": ["security", "destructive"]
  },
  {
    "id": "prod-forbid-preview-models",
    "effect": "forbid",
    "resource": "model",
    "match": "/-(preview|experimental|alpha|beta)$/",
    "reason": "Pre-release models blocked in production",
    "tags": ["model-policy"]
  },
  {
    "id": "prod-permit-reads",
    "effect": "permit",
    "resource": "tool",
    "match": "/^read_/",
    "reason": "Read-only operations permitted",
    "tags": ["read-only"],
    "rateLimit": { "maxCalls": 200, "windowSeconds": 60 }
  },
  {
    "id": "prod-permit-writes",
    "effect": "permit",
    "resource": "tool",
    "match": "write_file",
    "reason": "File writes permitted with rate limit",
    "tags": ["write"],
    "rateLimit": { "maxCalls": 20, "windowSeconds": 60 }
  }
]
```

**`hitl-policy.yaml`** (committed — no secrets)
```yaml
version: "1"
# Credentials injected via environment variables at runtime

policies:
  - name: destructive-file-ops
    description: Any file deletion or overwrite requires explicit approval
    actions:
      - "file.delete"
      - "file.overwrite"
    approval:
      channel: telegram
      timeout: 120
      fallback: deny
    tags: [production, safety]

  - name: email-mutations
    description: Outbound email and deletions require approval
    actions:
      - "email.send"
      - "email.delete"
      - "email.forward"
    approval:
      channel: slack
      timeout: 180
      fallback: deny
    tags: [production, communication]

  - name: deployment-actions
    description: All deploy and publish actions need sign-off
    actions:
      - "*.deploy"
      - "*.publish"
      - "*.release"
    approval:
      channel: slack
      timeout: 600
      fallback: deny
    tags: [production, ops]

  - name: payment-namespace
    description: Any payment action requires explicit approval
    actions:
      - "payment.*"
    approval:
      channel: telegram
      timeout: 300
      fallback: deny
    tags: [production, high-risk, payment]
```

**Environment (production — stored in secret manager or `EnvironmentFile`)**
```bash
RULES_FILE=/var/clawthority/rules.json
AUDIT_LOG_FILE=/var/log/clawthority/audit.jsonl
PORT=7331

TELEGRAM_BOT_TOKEN=<secret>
TELEGRAM_CHAT_ID=<secret>

SLACK_BOT_TOKEN=<secret>
SLACK_CHANNEL_ID=<secret>
SLACK_SIGNING_SECRET=<secret>
SLACK_INTERACTION_PORT=3201
```

---

## Resource Types and Channel Values

### Resource types

| Value | Description |
|---|---|
| `tool` | OpenClaw tool calls (e.g., `read_file`, `write_file`) |
| `command` | Shell or system commands (e.g., `npm`, `git`, `rm`) |
| `channel` | Communication channels used by the agent |
| `prompt` | Prompt namespaces (e.g., `user:*`, `system:*`) |
| `model` | LLM model identifiers (e.g., `anthropic/claude-*`) |

### Channel values

The `channel` field in a `RuleContext` controls the authorization tier. Set in rule conditions to restrict access by caller type.

| Value | Intended use |
|---|---|
| `admin` | Human administrator sessions. Requires `admin-` prefix in agent ID. |
| `trusted` | Verified automated pipelines with elevated permissions. |
| `ci` | CI/CD environments. Typically read-only with narrow write permissions. |
| `readonly` | Read-only service accounts. No write or destructive operations. |
| `default` | Standard agent sessions. Most agents run here. |
| `untrusted` | Explicitly untrusted or anonymous callers. Blocked by default rules. |

Channels are asserted by the caller and validated by channel-level rules. The default built-in rules forbid `untrusted` callers and require the `admin-` agent ID prefix for the `admin` channel.

---

## TypeScript Configuration

The plugin requires strict TypeScript settings. Key `tsconfig.json` values:

| Setting | Value | Notes |
|---|---|---|
| `target` | `ES2022` | Required for modern class fields and top-level await |
| `module` | `NodeNext` | Required for native ESM with `.js` import extensions |
| `moduleResolution` | `NodeNext` | Mirrors `module` setting |
| `strict` | `true` | All strict checks enabled |
| `noUncheckedIndexedAccess` | `true` | Array/object index access returns `T \| undefined` |
| `exactOptionalPropertyTypes` | `true` | Optional properties must be explicitly set to `undefined`, not just absent |
| `declaration` | `true` | Generates `.d.ts` files for consumers |
| `sourceMap` | `true` | Source maps for debugging |

All imports of compiled modules must use `.js` extensions (e.g., `import { foo } from './bar.js'`), even when the source file is `bar.ts`. This is required by `NodeNext` module resolution.

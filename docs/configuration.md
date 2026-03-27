# Configuration Reference

This document describes all configuration options for the policy engine plugin and the UI dashboard.

## Plugin Configuration

### openclaw config.json

The plugin is registered in `~/.openclaw/config.json`:

```json
{
  "plugins": ["policy-engine"]
}
```

No additional plugin-level configuration options are required. All policy behavior is controlled through rules (see [Usage](usage.md)).

---

## Rules File

Rules are stored as a JSON array in the file specified by the `RULES_FILE` environment variable (default: `../../data/rules.json` relative to `ui/`).

### Rule schema

Each rule in the array has the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique identifier (UUID assigned by server on creation) |
| `effect` | `"permit"` \| `"forbid"` | Yes | Whether to permit or forbid the matched resource |
| `resource` | `"tool"` \| `"command"` \| `"channel"` \| `"prompt"` \| `"model"` | Yes | Type of resource this rule applies to |
| `match` | `string` | Yes | Pattern to match against the resource name (exact string, `*` wildcard, or `/regex/` syntax) |
| `condition` | `string` | No | Serialized function body for fine-grained runtime conditions |
| `reason` | `string` | No | Human-readable description of why this rule exists |
| `tags` | `string[]` | No | Category labels for filtering and grouping |
| `rateLimit` | `object` | No | Sliding-window rate limit configuration |

### rateLimit object

| Field | Type | Required | Description |
|---|---|---|---|
| `maxCalls` | `integer` (≥1) | Yes | Maximum number of calls allowed within the window |
| `windowSeconds` | `integer` (≥1) | Yes | Duration of the sliding window in seconds |

### Example rules.json

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "effect": "permit",
    "resource": "tool",
    "match": "read_file",
    "reason": "Allow reading files for all agents",
    "tags": ["read-only"]
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "effect": "forbid",
    "resource": "command",
    "match": "rm",
    "reason": "Prevent destructive deletions",
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
    "reason": "Allow writes but cap rate",
    "tags": ["write"]
  }
]
```

---

## Audit Log File

The audit log is a newline-delimited JSON (JSONL) file. Each line is a JSON object representing one policy decision.

Path is controlled by the `AUDIT_LOG_FILE` environment variable (default: `../../data/audit.jsonl` relative to `ui/`).

### Audit entry schema

| Field | Type | Description |
|---|---|---|
| `timestamp` | `string` (ISO 8601) | When the decision was made |
| `policyId` | `string` | ID of the policy that produced the result |
| `policyName` | `string` | Human-readable policy name |
| `context` | `object` | The evaluation context (subject, resource, action, environment) |
| `result` | `object` | The evaluation result (allowed, effect, matchedRuleId, reason) |

---

## Environment Variables

### HITL — Telegram

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Telegram Bot API token. Takes precedence over `hitl-policy.yaml` config. |
| `TELEGRAM_CHAT_ID` | — | Telegram chat ID to send approval requests to. Takes precedence over config. |

### HITL — Slack

| Variable | Default | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | — | Slack Bot User OAuth Token (`xoxb-...`). Takes precedence over config. |
| `SLACK_CHANNEL_ID` | — | Slack channel ID. Takes precedence over config. |
| `SLACK_SIGNING_SECRET` | — | Slack Signing Secret for verifying interaction webhooks. Takes precedence over config. |
| `SLACK_INTERACTION_PORT` | `3201` | Port for the Slack interaction webhook server. Takes precedence over config. |

### UI server (`ui/`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7331` | Port for the HTTP server |
| `RULES_FILE` | `../../data/rules.json` | Absolute or relative path to the rules JSON file |
| `AUDIT_LOG_FILE` | `../../data/audit.jsonl` | Absolute or relative path to the audit JSONL file |

---

## Plugin Engine Options

### ABAC PolicyEngine (src/engine.ts)

Instantiated with an optional options object:

```typescript
import { PolicyEngine, AuditLogger } from "@openauthority/policy-engine";

const engine = new PolicyEngine({ auditLogger });
```

| Option | Type | Default | Description |
|---|---|---|---|
| `auditLogger` | `AuditLogger` | `undefined` | Audit logger to receive policy decisions |

### Cedar-Style PolicyEngine (src/policy/engine.ts)

```typescript
import { PolicyEngine } from "./policy/engine.js";

const engine = new PolicyEngine({ cleanupIntervalMs: 60_000 });
```

| Option | Type | Default | Description |
|---|---|---|---|
| `cleanupIntervalMs` | `number` | `0` (disabled) | Interval in ms for automatic rate-limit window cleanup. Set to `0` to disable the automatic timer and call `cleanup()` manually. |

### Hot-reload watcher (src/watcher.ts)

The watcher is started automatically by the plugin during `activate()`. Configuration lives in `startRulesWatcher()`:

| Option | Type | Default | Description |
|---|---|---|---|
| `debounceMs` | `number` | `300` | Milliseconds to debounce file change events before triggering a reload |
| `persistent` | `boolean` | `false` | Whether the watcher keeps the process alive. Always `false` in production to allow clean shutdown. |

---

## TypeScript Configuration

The plugin uses strict TypeScript. Key `tsconfig.json` settings:

| Setting | Value | Notes |
|---|---|---|
| `target` | `ES2022` | Required for modern class fields and top-level await |
| `module` | `NodeNext` | Required for native ESM with `.js` import extensions |
| `moduleResolution` | `NodeNext` | Mirrors the `module` setting |
| `strict` | `true` | All strict checks enabled |
| `declaration` | `true` | Generates `.d.ts` files for consumers |
| `sourceMap` | `true` | Source maps for debugging |

---

## Channel Values

The `channel` field in a `RuleContext` controls authorization tier. Use these values in rule conditions:

| Value | Intended use |
|---|---|
| `admin` | Human administrator sessions |
| `trusted` | Verified automated pipelines |
| `ci` | CI/CD environments |
| `readonly` | Read-only service accounts |
| `default` | Standard agent sessions |
| `untrusted` | Explicitly untrusted or anonymous callers |

Channels are asserted by the caller and validated by channel-level rules. The default rules forbid `untrusted` and require the `admin-` agent ID prefix for the `admin` channel.

---

## Resource Types

| Value | Description |
|---|---|
| `tool` | openclaw tool calls (e.g., `read_file`, `write_file`) |
| `command` | Shell or system commands (e.g., `npm`, `git`) |
| `channel` | Communication channels used by the agent |
| `prompt` | Prompt namespaces (e.g., `user:*`, `system:*`) |
| `model` | LLM model identifiers (e.g., `anthropic/claude-*`) |

## Condition Operators

Available operators for ABAC policy rule conditions (`src/types.ts`):

| Operator | Description | Example |
|---|---|---|
| `eq` | Equality | `{ field: "subject.role", operator: "eq", value: "admin" }` |
| `neq` | Inequality | `{ field: "subject.role", operator: "neq", value: "guest" }` |
| `in` | Array membership | `{ field: "subject.role", operator: "in", value: ["admin", "editor"] }` |
| `nin` | Array non-membership | `{ field: "subject.role", operator: "nin", value: ["banned"] }` |
| `contains` | Substring match | `{ field: "resource.id", operator: "contains", value: "secret" }` |
| `startsWith` | Prefix match | `{ field: "subject.id", operator: "startsWith", value: "svc-" }` |
| `regex` | Regular expression | `{ field: "action", operator: "regex", value: "^(read|list)$" }` |

Field paths support dot notation for nested access (e.g., `"subject.role"`, `"environment.ipAddress"`).

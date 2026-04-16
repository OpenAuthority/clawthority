# Usage Guide

> **What this page is for.** Common policy patterns, rule examples, and day-to-day operation of the plugin.

## Policy Engine

Clawthority uses a Cedar-style policy engine with **forbid-wins** semantics. Rules are evaluated against normalised action contexts — either by action class (semantic matching) or by resource type (structural matching). A single `forbid` rule overrides any number of `permit` rules.

Rules are loaded from two sources:

| Source | Path | Format | Hot-reloads |
|---|---|---|---|
| TypeScript rules | `src/policy/rules/default.ts` | `Rule[]` array (action-class style) | Yes — watcher detects file saves |
| JSON rules | `data/rules.json` | JSON array (resource/match style) | Yes — watcher detects file saves |

---

## Rule Styles

### Action-class rules (recommended)

Action-class rules match against normalised semantic action classes produced by the enforcement pipeline. The action normalization registry maps raw tool names to canonical dot-separated classes (e.g. `read_file` → `filesystem.read`).

Priority tiers:
- **10** — permitted baseline (unconditional permit)
- **90** — HITL-gated (forbid pending human approval)
- **100** — unconditionally forbidden (hard forbid)

```typescript
import type { Rule } from './policy/types.js';

const rules: Rule[] = [
  // Permit all filesystem reads
  {
    action_class: 'filesystem.read',
    effect: 'permit',
    priority: 10,
    reason: 'Read-only filesystem access is safe for all agents',
    tags: ['filesystem', 'read-only'],
  },

  // Require HITL approval for file writes
  {
    action_class: 'filesystem.write',
    effect: 'forbid',
    priority: 90,
    reason: 'File writes require human-in-the-loop approval',
    tags: ['filesystem', 'hitl'],
  },

  // Unconditionally block shell execution
  {
    action_class: 'shell.exec',
    effect: 'forbid',
    priority: 100,
    reason: 'Direct shell execution is never permitted',
    tags: ['system', 'security'],
  },
];
```

### Resource-match rules

Resource-match rules match against the raw resource type and name pattern, before action normalization. Useful for fine-grained per-tool or per-command policies in `data/rules.json`.

```typescript
// Permit a specific tool
{
  effect: "permit",
  resource: "tool",
  match: "read_file",
  reason: "Allow reading files"
}
```

#### Wildcard matching

Use `*` as the entire match string to match any resource name of the given type:

```typescript
{
  effect: "permit",
  resource: "tool",
  match: "*",
  reason: "Permit all tools (catch-all)"
}
```

#### RegExp matching

```typescript
{
  effect: "permit",
  resource: "tool",
  match: /^(read_file|list_dir|glob)$/,
  reason: "Read-only tool set"
}
```

#### Restricting by channel

Use a `condition` function to gate access by the caller's channel:

```typescript
{
  effect: "permit",
  resource: "tool",
  match: "write_file",
  condition: (ctx) => ["trusted", "admin", "ci"].includes(ctx.channel),
  reason: "Only trusted channels may write"
}
```

#### Restricting by agent ID

```typescript
{
  effect: "permit",
  resource: "channel",
  match: "admin",
  condition: (ctx) => ctx.agentId.startsWith("admin-"),
  reason: "Admin channel reserved for admin agents"
}
```

#### Forbidding destructive commands

`forbid` rules take precedence over any `permit` rule (Cedar semantics):

```typescript
{
  effect: "forbid",
  resource: "command",
  match: /^(rm|rmdir|dd|shred)$/,
  reason: "Destructive commands are never permitted"
}
```

#### Restricting models by provider

```typescript
{
  effect: "forbid",
  resource: "model",
  match: /^(openai|google|mistral)\//,
  reason: "Only Anthropic models are approved"
}
```

#### Rate limiting

Add a `rateLimit` object to any `permit` rule. The engine converts it to a `forbid` if the window is exceeded:

```typescript
{
  effect: "permit",
  resource: "tool",
  match: "write_file",
  rateLimit: {
    maxCalls: 20,
    windowSeconds: 60
  },
  reason: "Allow writes, but max 20 per minute"
}
```

Rate limits track per-rule and per `agentId:resourceName` pair using a sliding window.

#### Combined pattern: read-write split with rate limit

```typescript
const rules: Rule[] = [
  // Read-only tools: unlimited
  {
    effect: "permit",
    resource: "tool",
    match: /^(read_file|list_dir|search_files|glob)$/,
    reason: "Unrestricted read access"
  },

  // Write tools: rate-limited, trusted channels only
  {
    effect: "permit",
    resource: "tool",
    match: /^(write_file|edit_file|create_file)$/,
    condition: (ctx) => ["trusted", "admin", "ci"].includes(ctx.channel),
    rateLimit: { maxCalls: 50, windowSeconds: 3600 },
    reason: "Writes capped at 50/hour on trusted channels"
  },

  // Shell commands: forbidden entirely
  {
    effect: "forbid",
    resource: "tool",
    match: /^(bash|shell|terminal|run_command)$/,
    reason: "Shell access is disabled"
  }
];
```

---

## Audit Logging

The enforcement pipeline writes every policy decision to a JSONL audit log via `JsonlAuditLogger`.

### File logging (JSONL)

```typescript
import { JsonlAuditLogger } from "./audit.js";

const auditLogger = new JsonlAuditLogger("/var/log/clawthority/audit.jsonl");
```

Configure the audit log path in `openclaw.plugin.json` or via the `AUDIT_LOG_FILE` environment variable. Each line in the file is a JSON object containing the `ExecutionEnvelope`, `CeeDecision`, timestamp, and trace ID.

### Reading audit entries

Use `GET /api/audit` to query entries with pagination and filters, or tail the JSONL file directly:

```bash
tail -f data/audit.jsonl | jq .
```

---

## Hot Reload

The plugin watches `src/policy/rules/` and `data/rules.json` and reloads the Cedar engine automatically when files change, without restarting openclaw.

1. Edit `src/policy/rules/default.ts` (or `data/rules.json`)
2. Save the file
3. After a 300 ms debounce, the engine reloads
4. The new rule set takes effect immediately for all subsequent requests

If the updated file fails to parse or throws during import, the previous engine instance remains active and an error is logged.

---

## UI Dashboard

### Managing rules

1. Open `http://localhost:7331` in your browser
2. Navigate to **Authorities** in the top navigation
3. The **Rules Table** shows all current rules with sort and filter options
4. Click **New Rule** to open the rule editor
5. Fill in effect, resource, match, and optional fields
6. Click **Save** — the rule is persisted to the rules file immediately

### Viewing the audit log

1. Navigate to **Audit Log**
2. Use the date range, agent ID, and resource type filters to narrow entries
3. Live entries stream in real time via SSE as policy decisions are made
4. Historical entries are paginated (default 10 per page)

### Policy coverage map

Navigate to **Coverage Map** to see a matrix of which resource types have permit and forbid rules defined. Cells with rate-limited rules display an ⏱ badge. Hover over a cell to see matched rules and their rate limit details.

---

## Default Rule Set

The plugin ships with a baseline rule set in `src/policy/rules/default.ts` covering the most common action classes. These rules are production-ready defaults suitable for most deployments. Override or extend them by editing the file directly or adding JSON rules to `data/rules.json`.

> **Which rules load depends on the install mode.** In the default `open` mode, only the six priority-90/100 critical forbids marked below with 🔒 are loaded; the priority-10 `filesystem.read` permit and the `external_send` intent-group rule are redundant under implicit-permit semantics and are skipped. In `closed` mode the full table below loads. See [configuration.md — Install mode](configuration.md#install-mode).

### Default rule tiers

| Priority | Action class | Effect | Loaded in `open` | Reason |
|---|---|---|---|---|
| 10 | `filesystem.read` | permit |  | Read-only filesystem access is safe |
| 90 | `payment.initiate` | forbid | 🔒 | Requires HITL approval |
| 90 | `credential.read` | forbid | 🔒 | Requires HITL approval |
| 90 | `credential.write` | forbid | 🔒 | Requires HITL approval |
| 90 | *(intent group: `external_send`)* | forbid |  | Card data in payload requires HITL approval |
| 100 | `shell.exec` | forbid | 🔒 | Direct shell execution is never permitted |
| 100 | `code.execute` | forbid | 🔒 | Arbitrary code execution is never permitted |
| 100 | `unknown_sensitive_action` | forbid | 🔒 | Fail-closed on unrecognised sensitive actions |

All `action_class` values map to entries in the normalization registry at [`src/enforcement/normalize.ts`](../src/enforcement/normalize.ts); see [action-registry.md](action-registry.md) for the full list.

### Extending the default rules

Create a sibling file in `src/policy/rules/` and register it in `KNOWN_RULE_FILES` inside `src/watcher.ts`:

```typescript
// src/policy/rules/my-agent.ts
import type { Rule } from '../types.js';

const MY_AGENT_RULES: Rule[] = [
  {
    action_class: 'filesystem.write',
    effect: 'permit',
    priority: 10,
    condition: (ctx) => ctx.agentId.startsWith('trusted-agent-'),
    reason: 'trusted-agent- prefixed agents may write files',
    tags: ['filesystem', 'trusted'],
  },
];

export default MY_AGENT_RULES;
```

Use `mergeRules(agentSpecificRules, defaultRules)` to combine them:

```typescript
import { mergeRules } from './policy/rules/index.js';
import defaultRules from './policy/rules/default.js';
import myAgentRules from './policy/rules/my-agent.js';

const allRules = mergeRules(myAgentRules, defaultRules);
```

# Architecture Overview

This document describes the design of the OpenAuthority policy engine plugin, the decisions behind the architecture, and how the components fit together.

---

## System Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                           OpenClaw Gateway                        │
│                                                                   │
│  ┌─────────────┐   hook events   ┌─────────────────────────────┐  │
│  │   Agent /   │ ──────────────► │   OpenAuthority Plugin      │  │
│  │   Gateway   │ ◄────────────── │   (index.ts)                │  │
│  └─────────────┘  allow/block/   └──────────┬──────────────────┘  │
│                    ask-user                 │                     │
└─────────────────────────────────────────────┼─────────────────────┘
                                              │
              ┌───────────────────────────────┼────────────────┐
              │           Plugin Core         │                │
              │                               │                │
              │  ┌──────────────────┐  ┌──────▼────────┐       │
              │  │  ABAC Engine     │  │  Cedar Engine │       │
              │  │  (engine.ts)     │  │  (policy/     │       │
              │  │                  │  │   engine.ts)  │       │
              │  └──────────────────┘  └──────┬────────┘       │
              │                               │                │
              │  ┌──────────────────┐  ┌──────▼────────┐       │
              │  │  HITL Matcher    │  │  Rules Watcher│       │
              │  │  (hitl/)         │  │  (watcher.ts) │       │
              │  └───────┬──────────┘  └───────────────┘       │
              │          │                                     │
              │          │  ┌──────────────────┐               │
              │          │  │  Audit Logger    │               │
              │          │  │  (audit.ts)      │               │
              │          │  └──────────────────┘               │
              │          │                                     │
              └──────────┼─────────────────────────────┬───────┘
                         │                             │
        ┌────────────────▼────────┐  ┌─────────────────▼───────┐
        │   Approval Channel      │  │   UI Dashboard (ui/)    │
        │   (Telegram / Slack /   │  │                         │
        │    Webhook / Console)   │  │   Express ─── React SPA │
        └─────────────────────────┘  │   REST API ─── SSE      │
                                     └─────────────────────────┘
```

---

## Action Pipeline

Every agent action flows through a structured pipeline before it can execute. This is the core enforcement mechanism.

```
Agent
 └──► 1. Normalise (raw event → action request)
       │
       ▼
      2. Policy evaluation (Cedar engine: permit / forbid)
       │── forbid → block, log, return rejection to agent
       │── permit → continue (check rate limits)
       │
       ▼
      3. Execute (if permitted) or block (if denied)
       │
       ▼
      4. Audit (request + decision + result → provenance log)
```

**Planned addition:** A HITL check step will be inserted between normalisation and policy evaluation. When an action matches a HITL policy, execution will pause and route to a human for approval via Telegram or other channels. See the [roadmap](roadmap.md).

### Decision outcomes

The policy engine currently returns one of two outcomes:

| Outcome | Meaning | What happens |
|---|---|---|
| `permit` | Action is allowed by policy | Tool call proceeds |
| `forbid` | Action is blocked by policy | Call never placed, agent receives rejection |

A third outcome, `ask-user`, is planned for the HITL integration. When implemented, it will pause execution and route the decision to a human via Telegram or other messaging channels. See the [roadmap](roadmap.md).

---

## Plugin Lifecycle

openclaw loads the plugin by importing `dist/index.js`. The module export must conform to the openclaw plugin interface, which consists of:

- A `capabilities` array declaring what the plugin provides
- Hook handler functions for lifecycle events
- `activate()` and `deactivate()` methods for startup and shutdown

### activate()

On activation the plugin:

1. Constructs both the ABAC `PolicyEngine` and Cedar-style `PolicyEngine`
2. Loads the default rules into the Cedar engine
3. Starts the file watcher via `startRulesWatcher()`, receiving a `WatcherHandle`
4. Wraps the Cedar engine in a mutable `engineRef: { current: Engine }` container

The `engineRef` container is the key to hot reload: hook handlers dereference `.current` at call time, so the watcher can atomically swap in a new engine without touching the hooks.

### deactivate()

On deactivation the plugin calls `watcherHandle.stop()` to shut down the chokidar watcher. The watcher is created with `persistent: false`, so it does not keep the Node process alive independently.

---

## Two-Engine Design

### Why two engines?

The plugin exposes two distinct evaluation models because they serve different use cases:

| | ABAC Engine | Cedar-Style Engine |
|---|---|---|
| **Semantics** | Priority-ordered, allow/deny | Forbid-wins, permit/forbid |
| **Rule format** | TypeBox-validated schema | Plain TypeScript objects |
| **Conditions** | Structured field/operator/value | Arbitrary functions |
| **Rate limiting** | Not supported | Built-in sliding window |
| **Use case** | Attribute-based access control | Lifecycle hook gating |

The **ABAC engine** is designed for policy-as-data: rules are structured JSON, validated by TypeBox, and can be stored, queried, and audited systematically. It supports complex attribute matching with dot-notation field paths and eight comparison operators.

The **Cedar-style engine** is designed for lifecycle hooks: it needs to answer permit/forbid quickly, support runtime conditions and rate limits, and use the Cedar semantics where an explicit forbid always wins. It is named "Cedar-style" because it follows the same deny-overrides principle as AWS Cedar, though it is a custom implementation.

### Cedar semantics: forbid wins

In the Cedar engine, evaluation short-circuits on the first matching `forbid` rule without checking rate limits. Only after all `forbid` rules are checked without a match are `permit` rules evaluated. If a `permit` rule is matched and it has a `rateLimit`, the rate limit is applied — if exceeded, the result is converted to `forbid`.

This means:
- `forbid` rules are absolute; they cannot be overridden by any `permit` rule
- Rate limits only reduce the scope of `permit`; they can never make a `forbid` into a `permit`

### Configurable default effect

If no rule matches a request, the Cedar engine returns the configured `defaultEffect`:

- `'permit'` (default) --- implicit allow. No matching rule = allowed. This is the safe choice for OpenClaw plugin environments where blocking unknown tools would break the agent.
- `'forbid'` --- implicit deny, Cedar-standard. No matching rule = denied. Use for locked-down production deployments.

The default is set via the `PolicyEngine` constructor: `new PolicyEngine({ defaultEffect: 'permit' })`.

The ABAC engine uses a separate configurable `defaultEffect` per policy.

---

## Hot Reload Architecture

Editing `src/policy/rules.ts` triggers a live engine swap without restarting the gateway. This works through three mechanisms working together:

### 1. Mutable engine reference

```typescript
const cedarEngineRef: { current: PolicyEngine } = {
  current: new PolicyEngine()
};
```

Hook handlers dereference `.current` on every invocation:

```typescript
hooks.before_tool_call = async (event) => {
  const result = cedarEngineRef.current.evaluate(...);
  // ...
};
```

Swapping `cedarEngineRef.current` atomically updates all three hooks simultaneously.

### 2. ESM cache busting

Node.js caches ESM modules by URL. To force a fresh import, a timestamp query parameter is appended to the file URL:

```typescript
const url = new URL(`./policy/rules.js?t=${Date.now()}`, import.meta.url).href;
const { default: rules } = await import(url);
```

Each unique URL is treated as a separate cache entry, guaranteeing a fresh module evaluation.

### 3. Debounced file watcher

The chokidar watcher fires on every file system event. A 300 ms debounce coalesces rapid saves into a single reload:

```typescript
let debounceTimer: NodeJS.Timeout | undefined;

watcher.on("change", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    // reload
  }, 300);
});
```

### Error isolation

If the reload throws (syntax error, invalid export, etc.), the catch block logs the error and returns early without touching `cedarEngineRef.current`. The previous engine remains active until a successful reload.

---

## Rate Limiting Design

Rate limits are implemented as sliding windows stored in memory.

### Data structure

```
Map<Rule, Map<string, number[]>>
      │              │       └─ array of call timestamps (ms)
      │              └─ key: "${agentId}:${resourceName}"
      └─ rule reference (identity, not id)
```

Each rule carries its own per-caller timestamp array. This allows different rules for the same resource to have independent rate limit counters.

### Sliding window algorithm

On each `evaluate()` call for a permit rule with `rateLimit`:

1. Look up the timestamp array for `(rule, agentId:resourceName)`
2. Filter out entries older than `Date.now() - windowSeconds * 1000`
3. If `filteredEntries.length >= maxCalls`: return `forbid` (rate limit exceeded), do not record
4. Otherwise: push `Date.now()`, write back, return `permit` with current count

### Cleanup

Expired entries are only removed during evaluation of a specific rule/caller pair, or when `cleanup()` is called. This is a deliberate trade-off: per-evaluation cleanup keeps hot paths fast, while the explicit `cleanup()` sweeps the entire map.

The optional `cleanupIntervalMs` constructor parameter enables a background timer that calls `cleanup()` on an interval.

---

## Human-in-the-Loop Architecture

> **Status: framework built, integration pending.** See [roadmap](roadmap.md).

The HITL system will add a third decision outcome alongside `permit` and `forbid`: **`ask-user`**. When an action matches a HITL policy, execution will pause and the decision will be routed to a human via a messaging channel (Telegram, Slack, etc.).

### Components

```
src/hitl/
  types.ts      — TypeBox schemas: HitlPolicy, HitlApprovalConfig, HitlPolicyConfig
  matcher.ts    — Dot-notation wildcard matching + checkAction()
  parser.ts     — YAML/JSON policy file reader with validation
  watcher.ts    — Hot-reload watcher for HITL policy files
  index.ts      — Barrel exports
```

### Evaluation flow

1. `checkAction(config, action)` iterates over policies in declaration order
2. For each policy, each pattern in `actions` is tested via `matchesActionPattern()`
3. First match wins — returns `{ requiresApproval: true, matchedPolicy }`
4. No match — returns `{ requiresApproval: false }`

### Approval routing

When `requiresApproval` is true, the action enters the approval flow:

1. An approval request is sent to the configured channel (e.g. Telegram bot)
2. The request includes: action name, arguments, agent context, timestamp
3. The system waits for a response up to `timeout` seconds
4. Outcomes:
   - **Approved** — action proceeds to the policy engine for further evaluation
   - **Rejected** — action is blocked, agent receives a rejection reason
   - **Timeout** — `fallback` applies: either `deny` (block) or `auto-approve` (proceed)

### Relationship to the policy engine

HITL approval does not bypass the policy engine. A human-approved action still passes through Cedar rules, rate limits, and forbid checks. The two layers are complementary:

- HITL gates on **intent** ("should this action happen at all?")
- Policy engine gates on **capability** ("is this action within allowed bounds?")

### Hot reload

The HITL policy file has its own watcher (`startHitlPolicyWatcher`), separate from the rules watcher. It follows the same pattern: debounced file watching, atomic swap on success, previous config preserved on failure.

---

## Gateway Hooks Reference

OpenAuthority implements three OpenClaw gateway hooks. Currently only `before_tool_call` is registered and active:

| Hook | Can block? | Status | Purpose in OpenAuthority |
|---|---|---|---|
| `before_tool_call` | Yes | **Active** | Primary enforcement hook. Evaluates Cedar rules, JSON rules, and ABAC policies. Returns `block: true` to deny execution. |
| `before_prompt_build` | No (observe/mutate) | **Implemented, disabled** | Prompt injection detection (10 regex patterns). Disabled pending false-positive tuning. |
| `before_model_resolve` | No (observe/mutate) | **Implemented, disabled** | Model routing. Disabled because OpenClaw does not yet pass the model name in the event payload. |

### Hook registration

Hooks are registered via `ctx.on()` inside the plugin initialisation function:

```typescript
export default function openauthorityPlugin(ctx) {
  ctx.on('before_tool_call', async (toolCall) => {
    const decision = await policyEngine.evaluate(toolCall);
    if (decision.outcome === 'forbid') {
      return { block: true, reason: decision.reason };
    }
    return { block: false };
  });

  ctx.on('before_prompt_build', async (promptCtx) => {
    // Prompt injection detection + context injection
  });

  ctx.on('before_model_resolve', async (modelCtx) => {
    // Model override logic
  });
}
```

### Critical constraint

`before_tool_call` is the **only** plugin hook that can block execution. `before_prompt_build` and `before_model_resolve` are observation/mutation hooks only. This means all policy enforcement — Cedar rules, HITL checks, rate limits — must route through `before_tool_call`.

---

## Prompt Injection Detection

The `before_prompt_build` hook checks prompt text against 8 regex patterns before policy evaluation:

```
/ignore\s+(previous|prior|all)\s+instructions/i
/disregard\s+(previous|prior|all|the)/i
/forget\s+(previous|prior|all|the|your)/i
/DAN\s+mode/i
/jailbreak/i
/bypass\s+(safety|restrictions|guidelines|policies)/i
/override\s+(system\s+)?prompt/i
/you\s+are\s+now\s+.*(different|new|another)\s+AI/i
```

If any pattern matches, the hook blocks the prompt and returns a rejection reason without performing policy evaluation. This provides a hard-coded safety layer independent of the configurable rule set.

---

## UI Dashboard Architecture

The dashboard is a thin Express server with a React SPA client.

### Server (`ui/server.ts`)

- Single Express app with CORS for the Vite dev server origin
- Routes mounted under `/api/`
- Static files served from `client/dist/`
- SPA fallback: any `404` that is not an API route serves `index.html`

### Rules persistence (`ui/routes/rules.ts`)

Rules are persisted to a JSON file on every create, update, and delete. Reads load the full file into memory. There is no database; the file is the source of truth. The directory is created recursively on first write.

### Audit log (`ui/routes/audit.ts`)

Two complementary data sources:

1. **JSONL file** — Historical entries, streamed line by line on read to avoid loading the full file into memory
2. **In-memory ring buffer** — Recent entries (max 1000), combined with file entries on `GET /api/audit`

Live streaming uses SSE. The server maintains a `Set<Response>` of connected clients. On `POST /api/audit`, the entry is pushed to the ring buffer and broadcast to all clients via `res.write()`.

A mock data generator fires every 3 seconds when at least one SSE client is connected, enabling UI development without a live engine.

### Client (`ui/client/src/`)

Single-page React application built with Vite. Navigation via React Router v6. Pages:

- **Home** — Welcome and overview
- **Authorities** — Rule management (RulesTable + RuleEditor views)
- **Audit Log** — Paginated log with live SSE feed
- **Coverage Map** — Matrix visualization of rule coverage by resource and effect
- **Settings** — Configuration options

Component CSS files are co-located with their view file in `ui/client/src/views/`.

---

## Design Decisions

### Why not a database?

The plugin is designed to be installed as a standalone openclaw plugin, not as a service requiring infrastructure. A JSON file for rules and a JSONL file for audit logs eliminates operational dependencies and keeps the plugin self-contained.

For production deployments with high audit log volume, the `AUDIT_LOG_FILE` path can point to a log-rotated file managed externally.

### Why ESM?

The plugin uses Node ESM (`"type": "module"`, `"module": "NodeNext"`) to match the openclaw plugin host environment and to take advantage of native top-level async. The ESM cache-busting approach for hot reload depends on ESM semantics.

### Why chokidar?

chokidar provides reliable cross-platform file watching with efficient event batching. It is widely used in the Node ecosystem and supports the `persistent: false` option needed for clean plugin shutdown.

### Why TypeBox for the ABAC engine?

TypeBox generates both runtime validators and TypeScript types from a single schema definition, eliminating the risk of type drift between the validator and the TypeScript interface. It produces JSON Schema–compatible schemas, making them useful for documentation and external tooling.

### Forbid-wins vs. permit-wins

The Cedar-style engine uses forbid-wins (deny-overrides) semantics rather than permit-wins. This is a security-conservative choice: an incorrectly written permit rule cannot accidentally override a security restriction. Administrators must explicitly remove `forbid` rules to expand access, rather than relying on rule ordering or priority to prevent conflicts.

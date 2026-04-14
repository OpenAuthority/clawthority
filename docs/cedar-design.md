# Cedar Policy Engine Design

This document consolidates all architectural decisions for the Cedar WASM policy engine integration in OpenAuthority. It is the authoritative reference for the entity model, priority tier system, attribute hydration, rate limit handling, hot-reload behavior, and migration from legacy regex/JS conditions.

---

## Table of Contents

1. [Entity Model and Schema](#1-entity-model-and-schema)
2. [Priority Tier Mapping](#2-priority-tier-mapping)
3. [Attribute Hydration Strategy](#3-attribute-hydration-strategy)
4. [Rate Limit Handling](#4-rate-limit-handling)
5. [Hot-Reload Design](#5-hot-reload-design)
6. [Migration from Regex/JS Conditions](#6-migration-from-regexjs-conditions)
7. [Key Design Decisions](#7-key-design-decisions)

---

## 1. Entity Model and Schema

### Namespace

All Cedar types live under the `OpenAuthority` namespace. Policies reference entities as `OpenAuthority::Agent`, `OpenAuthority::Resource`, and `OpenAuthority::Action::RequestAccess`.

### Entity Types

#### Principal — `OpenAuthority::Agent`

| Attribute | Cedar Type | Required | Description |
|---|---|---|---|
| `agentId` | String | Yes | Primary identity; used for audit trails and per-agent policy conditions |
| `channel` | String | Yes | Execution channel (e.g. `default`, `webchat`, `api`); used to scope permit/forbid rules by delivery path |
| `verified` | Boolean | No | `true` when the agent identity was verified against an `AgentIdentityRegistry`; absent when unverified |
| `userId` | String | No | Optional user association; present only when the request is tied to a human user session |
| `sessionId` | String | No | Session binding; present only when session-scoped capability evaluation is required |

Required attributes (`agentId`, `channel`) are always present in the entity store. Optional attributes are omitted from the entity record entirely when their source value is `undefined` or `null`. Cedar policies that depend on optional attributes must guard with the `has` operator (e.g. `principal has verified && principal.verified == true`).

#### Resource — `OpenAuthority::Resource`

| Attribute | Cedar Type | Required | Description |
|---|---|---|---|
| `actionClass` | String | No | Semantic action class (e.g. `filesystem.read`, `payment.initiate`); present when Stage 2 dispatches via `evaluateByActionClass()` |

The resource entity UID encodes the Cedar resource type derived from the action class prefix (see [Priority Tier Mapping](#2-priority-tier-mapping)). The `actionClass` attribute carries the full dot-separated class for fine-grained policy conditions.

#### Action — `OpenAuthority::Action::RequestAccess`

Single action type for all evaluations. OpenAuthority does not distinguish Cedar actions by tool name or action class; the resource entity carries the semantic differentiation.

### Schema File

The schema is defined at `src/policy/cedar/schema.cedarschema.json`. It is loaded by `CedarEngine` at initialization time and passed to `cedar.isAuthorized()` on every call for strict schema validation.

---

## 2. Priority Tier Mapping

### Tier Semantics

Rules are organized into numeric tiers that convey risk level and default behavior. The tier number is recorded in the Cedar policy annotation `@tier` but does not affect Cedar's own permit/forbid semantics — those are determined solely by the `permit`/`forbid` effect keyword.

| Tier | Effect | Intended Use | Example Action Classes |
|---|---|---|---|
| 10 | `permit` | Low-risk, unconditional permits; no HITL required | `filesystem.read`, `filesystem.list`, `browser.navigate`, `memory.read` |
| 50 | `permit` | Conditional permits; require attribute checks (e.g. `verified`, `channel`) | `web.fetch` with channel restriction |
| 100 | `forbid` | Hard denies; defense-in-depth blocks that override any permit at the same request | `payment.transfer`, `credential.access`, `system.execute` |

Tier numbers are for human organization only. Within a given Cedar authorization request, Cedar's `forbid`-wins semantics apply: a `forbid` effect from any policy always overrides all `permit` effects, regardless of tier number.

### Policy Annotations

Each Cedar policy carries the following annotations for observability and audit:

| Annotation | Type | Description |
|---|---|---|
| `@id` | String | Unique rule identifier (e.g. `"10-filesystem-read"`); propagated into decision `reason` |
| `@tier` | String | Numeric tier as a string (e.g. `"10"`, `"100"`); used for coverage map grouping |
| `@reason` | String | Human-readable explanation emitted in logs and dashboard tooltips |

### Action Class to Cedar Resource Type Mapping

Stage 2 maps the normalized `action_class` prefix to a Cedar resource type (the UID type component) before constructing the entity store:

| Action Class Prefix | Cedar Resource Type |
|---|---|
| `communication.*` | `channel` |
| `command.*` | `command` |
| `prompt.*` | `prompt` |
| `model.*` | `model` |
| (all others) | `tool` |

The resource UID is `OpenAuthority::Resource::"<resource-type>"`. The `actionClass` attribute on the resource entity carries the full class for per-action policy conditions.

---

## 3. Attribute Hydration Strategy

### Two-Phase Construction

Entity attributes are populated in two phases before each `cedar.isAuthorized()` call. There are no asynchronous lookups; all data must be available in `RuleContext` at evaluation time.

**Phase 1 — Principal construction** (`buildEntities(context)`):

1. Read `agentId` and `channel` from `RuleContext` — always included.
2. For each optional field (`verified`, `userId`, `sessionId`): include in the entity record only when the value is not `undefined` and not `null`.
3. Return the `Agent` entity.

**Phase 2 — Resource construction** (`buildResourceEntity(actionClass)`):

1. Called only when `evaluateByActionClass()` is invoked with a non-empty action class.
2. Derive the resource type from the action class prefix (see mapping table above).
3. Set `actionClass` attribute to the full dot-separated class string.
4. Return the `Resource` entity; append to entity array alongside the Agent.

### Absent-Attribute Handling

Optional attributes that are absent from the entity record are treated as not present by Cedar. Policies access them only via `has` guards:

```cedar
// Correct: guard with has before accessing optional attribute
when { principal has verified && principal.verified == true }

// Incorrect: accessing without guard causes Cedar evaluation error
when { principal.verified == true }
```

### No Dynamic Hydration

There is no mid-evaluation attribute fetch. The entity store is fully constructed before `isAuthorized()` is called and is immutable for the duration of that call. If a policy requires data not available at call time (e.g. external identity verification), the data must be pre-fetched and injected into `RuleContext` before evaluation begins.

### Context Field

The Cedar `context` field (the request-level map) is always passed as an empty object `{}`. All authorization-relevant data flows through the entity store, not the context map. This keeps context empty and policies focused on entity attributes.

---

## 4. Rate Limit Handling

### Scope

Rate limits are a Stage 2 concern. They apply only to `permit` rules — `forbid` rules have no rate limit concept. A rate limit can reduce a `permit` to an effective deny; it cannot override a `forbid`.

### Configuration

Rate limits are defined per-rule in `data/rules.json` as a `rateLimit` object alongside the rule definition:

```json
{
  "rateLimit": {
    "maxCalls": 10,
    "windowSeconds": 60
  }
}
```

The display format for rate limits in the dashboard UI is `{maxCalls} / {windowSeconds}s` (e.g. `10 / 60s`).

### Sliding Window Algorithm

On each `evaluate()` call for a permit rule that carries a `rateLimit`:

1. Look up the timestamp array for the composite key `"${agentId}:${resourceName}"`.
2. Drop timestamps older than `Date.now() - windowSeconds * 1000`.
3. If the remaining count is `>= maxCalls`: return `forbid` with reason `rate_limit_exceeded`.
4. Otherwise: append `Date.now()` to the array and return `permit`.

The window is per-rule and per-caller (identity + resource name combination), not global.

### State Persistence

Rate limit state is in-memory only. It resets on:

- Plugin deactivation.
- Hot-reload (engine swap): the new engine instance starts with empty rate limit state.
- Process restart.

There is no persistence to disk or external store in the current design.

### Enforcement Position in Pipeline

Rate limit enforcement happens inside Stage 2 (`CedarEngine.evaluate()`), after Cedar's permit/forbid decision and before the result is returned to the pipeline. If Cedar returns `permit` and the rate limit is exceeded, Stage 2 returns `forbid: rate_limit_exceeded` to the pipeline. The pipeline never sees the Cedar `permit` in that case.

### Dashboard Integration

- CoverageMap cells for rules carrying `rateLimit` display a `⏱` badge (`.coverage-cell-rl-badge`).
- Tooltip lines show `⏱ {maxCalls} calls / {windowSeconds}s` per rule via `.coverage-tooltip-rate-limit`.
- The CoverageMap legend always includes a "⏱ Rate limited" entry.
- Rate limit exceeded decisions are tracked as `'rate-limited'` state in the coverage map.

---

## 5. Hot-Reload Design

### Mutable Engine Reference

The active engine is held in a mutable reference object:

```typescript
const engineRef: { current: PolicyEngine } = { current: initialEngine };
```

Hook handlers dereference `.current` at call time, not at registration time. Swapping `engineRef.current` is the atomic operation that makes a new engine active for all subsequent requests.

### File Watcher Lifecycle

The rules watcher is managed by `startRulesWatcher(engineRef, debounceMs, coverageMap)` in `src/watcher.ts`.

| Phase | Trigger | Action |
|---|---|---|
| Plugin activation (Cedar mode) | `activate()` called | `startRulesWatcher()` begins watching `data/rules.json` |
| Initial load | Immediately at activation | If `hasValidJsonRules()` is true, create and initialize a `CedarEngine` |
| File change | chokidar `change` event | Start (or restart) debounce timer |
| Debounce expiry (300 ms default) | Timer fires | Validate rules file; if valid, create new `CedarEngine` and swap into ref |
| Coverage reset | After each successful swap | `coverageMap?.reset()` clears stale entries |
| Plugin deactivation | `deactivate()` called | `watcher.stop()` clears debounce timer and closes chokidar |

The watcher is started **only in Cedar mode** (`OPENAUTHORITY_ENGINE=cedar`). The TypeScript engine does not use the rules watcher.

### Reload Flow Detail

1. File change detected on `data/rules.json`.
2. Debounce timer set; any pending timer is cleared (coalesces rapid saves).
3. After 300 ms, `reloadJsonRules()` runs:
   a. Validate that the file exists and parses as a non-empty JSON array.
   b. If validation fails: log error, keep existing engine active, abort reload.
   c. If validation passes: construct a new `CedarEngine` instance.
4. Swap: `engineRef.current = newEngine`.
5. Call `newEngine.init()` asynchronously to load Cedar WASM.
6. Reset coverage map.

### Initialization Window

After the reference swap, there is a brief window while `newEngine.init()` is in progress. During this window, `evaluate()` calls on the new engine return `forbid` (the `defaultEffect` when Cedar is not yet initialized). This is a deliberate fail-closed behavior — no calls are permitted through an uninitialized engine.

### In-Flight Request Safety

The reference swap is a single assignment (`engineRef.current = newEngine`). Requests that dereferenced `.current` before the swap continue using the old engine to completion. Requests that dereference after the swap use the new engine. There is no locking or two-phase commit; the swap is atomic at the JavaScript single-threaded event loop level.

### Error Isolation

If the new engine's `init()` fails (e.g. WASM load error), the failure is logged but the swap has already occurred. The new engine remains in the ref but returns `forbid` for all requests until resolved. To recover, a subsequent file change triggers another reload attempt.

---

## 6. Migration from Regex/JS Conditions

### What Was Removed

Prior to v0.2.0 (commit `46e50d9`), the TypeScript engine (`src/policy/ts-engine.ts`) supported:

- `Rule.condition?: (context: RuleContext) => boolean` — arbitrary JavaScript function bodies evaluated at runtime.
- Regex pattern matching on tool names directly in rule definitions.

Both were removed when Cedar WASM became the sole engine. JavaScript function conditions cannot cross the WASM boundary, and arbitrary code in rule files is a security liability.

### Cedar Equivalents

#### Exact-match conditions

Legacy JS condition that checks a single attribute value maps directly to a Cedar `when` clause:

| Legacy | Cedar Equivalent |
|---|---|
| `condition: (ctx) => ctx.agentId === 'admin'` | `when { principal.agentId == "admin" }` |
| `condition: (ctx) => ctx.channel === 'admin-channel'` | `when { principal.channel == "admin-channel" }` |
| `condition: (ctx) => ctx.verified === true` | `when { principal has verified && principal.verified == true }` |

#### Regex patterns on tool names

Tool name matching was handled by the action registry alias system, not by Cedar policies. Map regex patterns to explicit alias entries in `src/enforcement/normalize.ts` (the action registry). Cedar policies then match on the resulting `actionClass`.

| Legacy | Migration |
|---|---|
| `match: /^read_.*/ → filesystem.read` | Add `read_*` tool aliases to `filesystem.read` entry in the action registry |
| `match: /^write_.*/ → filesystem.write` | Add `write_*` tool aliases to `filesystem.write` entry in the action registry |

#### Compound boolean logic

Conditions with `&&` or `||` over multiple context fields map to Cedar `when`/`unless` clauses:

| Legacy | Cedar Equivalent |
|---|---|
| `(ctx) => ctx.verified && ctx.channel === 'api'` | `when { principal has verified && principal.verified == true && principal.channel == "api" }` |
| `(ctx) => ctx.channel === 'a' \|\| ctx.channel === 'b'` | Two separate policies at the same tier (one per channel), or a Cedar `||` expression |

#### Conditions that cannot be expressed in Cedar

Some legacy conditions used context fields not represented in the Cedar entity model (e.g. `metadata` sub-keys). The migration path for these is:

1. Promote the required data to a named attribute in `RuleContext` and add it to the Cedar schema.
2. Populate the attribute during entity construction in `buildEntities()`.
3. Write the Cedar `when` clause against the new attribute.

Alternatively, move the logic to Stage 1 (capability gate) if the condition is about token validity rather than policy semantics.

### No Regex Support in Cedar Policies

Cedar's built-in string operations do not include regex pattern matching. If substring or prefix matching is required, Cedar supports `like` with glob patterns (e.g. `"filesystem.*"`) and the `contains` / `startsWith` / `endsWith` extension functions. Full regex is not available in Cedar WASM 4.x and must not be assumed.

### TypeScript Engine Status

The TypeScript engine (`TsEngine`) remains in the codebase as a lightweight development shim (`defaultEffect: 'permit'`, no WASM). It is not a migration target — it is a convenience for running tests without Cedar. All production policy logic lives in Cedar policy files.

---

## 7. Key Design Decisions

### Single action type

All evaluations use `OpenAuthority::Action::RequestAccess`. Differentiation by action type is carried in the resource entity (`actionClass` attribute and resource UID type), not in the Cedar action. This simplifies the schema and avoids combinatorial explosion of Cedar action types.

### Fail-closed defaults

Every error boundary in the Cedar path returns `forbid`:

| Condition | Result |
|---|---|
| Cedar WASM not yet initialized | `forbid` (defaultEffect) |
| Entity construction exception | `forbid` |
| Cedar evaluation exception | `forbid: stage2_error` |
| Rules file invalid at hot-reload | Keep existing engine; no swap |
| Unknown tool name | `forbid` (unknown_sensitive_action, critical risk) |

### Forbid wins

Cedar's `forbid`-wins semantics are not configurable and align with the OpenAuthority security model: an explicit `forbid` policy is never overridden by any `permit` policy in the same request. Adding a new `permit` policy cannot accidentally unlock access that a `forbid` policy guards.

### No context-field usage

The Cedar request `context` map is always empty. Entity attributes are the sole carrier of authorization-relevant data. This prevents policy authors from accidentally relying on context fields that may not be consistently populated and keeps the schema as the single source of truth for what data is available.

### Synchronous evaluation, async initialization

Cedar WASM evaluation (`isAuthorized`) is synchronous after initialization. The `init()` call is async (loads the WASM binary). This design keeps hook handler latency predictable (no async waterfall per request) while allowing the heavyweight WASM load to happen once at startup.

### Coverage map reset on hot-reload

The coverage map is cleared on every successful engine swap. This prevents the dashboard from displaying stale permit/forbid status from the previous policy set. Coverage re-accumulates as the new policies are exercised.

### Rate limit state lost on hot-reload

Because rate limit state is owned by the engine instance, swapping the engine resets all sliding-window counters. This is an accepted trade-off: rule changes are relatively infrequent, and the simplicity of per-instance state outweighs the edge case of counters resetting during a reload.

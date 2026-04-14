# Policy API Reference

This document describes the Cedar policy format used by OpenAuthority (v0.2+), the JSON rules bundle format, and the programmatic TypeScript API exposed by the plugin.

> **Note:** The REST dashboard API (`GET/POST /api/rules`, `GET /api/audit`) described in earlier versions has been removed. Policy authoring now happens through Cedar policy files (`.cedar`) and the JSON rules bundle.

---

## Table of Contents

1. [Cedar Policy Files](#1-cedar-policy-files)
2. [JSON Rules Bundle](#2-json-rules-bundle)
3. [TypeScript Evaluation API](#3-typescript-evaluation-api)
4. [Audit Log Format](#4-audit-log-format)
5. [Error Handling](#5-error-handling)

---

## 1. Cedar Policy Files

Cedar policies are stored as `.cedar` text files under `data/policies/`. The Cedar WASM engine evaluates these files as a single policy set for every authorization request.

### File Layout

```
data/policies/
  tier10-permits.cedar    ← Tier 10: unconditional permits (low-risk)
  tier100-forbids.cedar   ← Tier 100: hard deny rules (defence-in-depth)
  hitl-permits.cedar      ← Optional: conditional permits (tier 50)
```

### Cedar Policy Structure

Each Cedar policy in the set follows this form:

```cedar
@id("10-filesystem-read")
@tier("10")
@reason("Filesystem read operations are permitted for all agents")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "filesystem.read" };
```

#### Required Annotations

| Annotation | Type | Description |
|---|---|---|
| `@id` | String | Unique rule identifier (e.g. `"10-filesystem-read"`). Propagated into the decision `reason` field for audit. |
| `@tier` | String | Numeric tier as a string — `"10"`, `"50"`, or `"100"`. Used for coverage map grouping. |
| `@reason` | String | Human-readable explanation emitted in logs and dashboard tooltips. |

#### Effect Keywords

| Keyword | Meaning |
|---|---|
| `permit` | Grants access when the `when` condition matches. |
| `forbid` | Denies access unconditionally when the `when` condition matches. A `forbid` overrides any `permit` for the same request. |

#### The `when` Clause

The `when` clause must always guard optional attributes with `has` before accessing them:

```cedar
// Correct: guard optional attribute
when { principal has verified && principal.verified == true }

// Incorrect: accessing without guard causes a Cedar evaluation error
when { principal.verified == true }
```

### Entity Model

All Cedar policies operate on three entity types in the `OpenAuthority` namespace:

#### Principal — `OpenAuthority::Agent`

| Attribute | Cedar Type | Required | Description |
|---|---|---|---|
| `agentId` | String | Yes | Agent identity used in audit trails |
| `channel` | String | Yes | Execution channel (e.g. `default`, `admin`, `ci`) |
| `verified` | Boolean | No | Present when identity was verified against `AgentIdentityRegistry` |
| `userId` | String | No | Present when the request is tied to a human user session |
| `sessionId` | String | No | Present when session-scoped capability evaluation is required |

#### Resource — `OpenAuthority::Resource`

| Attribute | Cedar Type | Required | Description |
|---|---|---|---|
| `actionClass` | String | No | Semantic action class (e.g. `filesystem.read`). Present in all Stage 2 evaluations. |

The resource entity UID is `OpenAuthority::Resource::"<resourceType>:<resourceName>"` where `resourceType` is derived from the `action_class` prefix:

| Action Class Prefix | Resource Type Token |
|---|---|
| `filesystem.*` | `file` |
| `communication.*` | `external` |
| `payment.*` | `payment` |
| `system.*` | `system` |
| `credential.*` | `credential` |
| `browser.*` | `web` |
| `memory.*` | `memory` |
| *(all others)* | `unknown` |

#### Action — `OpenAuthority::Action`

Single action type: `OpenAuthority::Action::"RequestAccess"`. All evaluations use this action. Resource differentiation is carried by the `actionClass` attribute on the resource entity.

### Tier Semantics

| Tier | Effect | Intended Use |
|---|---|---|
| 10 | `permit` | Unconditional, low-risk permits. No HITL required. Examples: `filesystem.read`, `browser.navigate`. |
| 50 | `permit` | Conditional permits with attribute checks (e.g. `verified`, `channel`). |
| 100 | `forbid` | Hard denies. Defence-in-depth blocks that override any permit. Examples: `payment.transfer`, `system.execute`. |

Tier numbers are annotations only. Cedar's `forbid`-wins semantics apply regardless of tier: an explicit `forbid` always overrides all `permit` effects for the same request.

### Example — Tier 10 Permit

```cedar
@id("10-filesystem-read")
@tier("10")
@reason("Filesystem read operations are permitted for all agents")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "filesystem.read" };
```

### Example — Tier 100 Forbid

```cedar
@id("100-payment-transfer")
@tier("100")
@reason("Payment transfers require human-in-the-loop approval")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "payment.transfer" };
```

### Example — Tier 50 Conditional Permit

```cedar
@id("50-web-fetch-verified")
@tier("50")
@reason("Web fetch permitted for verified agents on the api channel")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when {
  resource has actionClass &&
  resource.actionClass == "web.fetch" &&
  principal has verified &&
  principal.verified == true &&
  principal.channel == "api"
};
```

---

## 2. JSON Rules Bundle

The JSON rules bundle (`data/bundles/active/bundle.json`) defines which action classes are permitted or forbidden. These rules are compiled into Cedar policies at engine initialization time.

### Bundle Schema

```json
{
  "version": 1,
  "rules": [
    {
      "effect": "permit",
      "action_class": "filesystem.read",
      "reason": "Filesystem reads are permitted for all agents",
      "tags": ["filesystem", "read-only"]
    },
    {
      "effect": "forbid",
      "action_class": "payment.transfer",
      "reason": "Payment transfers require human-in-the-loop approval",
      "tags": ["payment", "hitl"],
      "rateLimit": null
    }
  ],
  "checksum": "<SHA-256 of JSON.stringify(rules)>"
}
```

### Rule Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `effect` | `"permit"` \| `"forbid"` | Yes | Rule effect. `forbid` wins over `permit` when both match. |
| `action_class` | `string` | Yes | Canonical action class (e.g. `filesystem.read`, `payment.transfer`). Must match the registry. |
| `reason` | `string` | No | Human-readable description. Shown in audit logs. |
| `tags` | `string[]` | No | Category labels for filtering. |
| `rateLimit` | `object` \| `null` | No | Sliding-window rate limit (applies to `permit` rules only). |

> **Removed fields (v0.2):** `resource`, `match`, `condition`. These were part of the TypeScript policy engine and are no longer supported. Use `action_class` for all rule targeting; write Cedar `when` clauses for conditional logic.

### `rateLimit` Object

| Field | Type | Required | Description |
|---|---|---|---|
| `maxCalls` | `integer` (≥1) | Yes | Maximum calls allowed within the window. |
| `windowSeconds` | `integer` (≥1) | Yes | Duration of the sliding window in seconds. |

Rate limit display format in the dashboard: `{maxCalls} / {windowSeconds}s` (e.g. `10 / 60s`).

### Bundle Validation

The bundle adapter validates:

1. `version` is a positive integer and greater than the current active version (monotonic).
2. `rules` is a non-empty array.
3. `checksum` matches `SHA-256(JSON.stringify(rules))`.
4. Each rule has a valid `effect` and non-empty `action_class`.

Invalid bundles are rejected; the previous bundle remains active.

---

## 3. TypeScript Evaluation API

### `CedarEngine`

The primary evaluation class, exported from `src/policy/cedar-engine.ts`.

```typescript
import { CedarEngine } from './policy/cedar-engine.js';

const engine = new CedarEngine({ defaultEffect: 'forbid' });
await engine.init();              // load Cedar WASM (~2.6 MB, one-time)
engine.policies = policyText;     // set Cedar policy set text

// Evaluate by resource type and name:
const decision = engine.evaluate('file', 'read_file', {
  agentId: 'agent-1',
  channel: 'default',
});

// Evaluate by action class (preferred for Stage 2):
const decision2 = engine.evaluateByActionClass('filesystem.read', 'read_file', {
  agentId: 'agent-1',
  channel: 'default',
});
```

#### `CedarEngineOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `defaultEffect` | `'permit'` \| `'forbid'` | `'forbid'` | Effect returned before `init()` completes. Use `'forbid'` in production (fail-closed); `'permit'` in tests. |

#### `evaluate(resource, resourceName, context, actionClass?)`

| Parameter | Type | Description |
|---|---|---|
| `resource` | `Resource` | Cedar resource type token (`'file'`, `'external'`, etc.) |
| `resourceName` | `string` | Specific resource being accessed |
| `context` | `RuleContext` | Evaluation context with `agentId`, `channel`, optional `verified`/`userId`/`sessionId` |
| `actionClass` | `string` (optional) | When provided, populates `resource.actionClass` in the entity store |

**Returns** `EvaluationDecision`:

```typescript
interface EvaluationDecision {
  effect: 'permit' | 'forbid';
  reason?: string;      // policy @id(s) that matched, joined with '; '
}
```

#### `evaluateByActionClass(actionClass, resourceName, context)`

Maps the `action_class` prefix to a Cedar resource type, then delegates to `evaluate()`. Preferred entry point for Stage 2 dispatch.

### `RuleContext`

```typescript
interface RuleContext {
  agentId: string;          // Required: agent identity
  channel: string;          // Required: execution channel
  verified?: boolean;       // Optional: identity verification status
  userId?: string;          // Optional: associated user ID
  sessionId?: string;       // Optional: session binding
}
```

---

## 4. Audit Log Format

The audit log is a newline-delimited JSON (JSONL) file. Each line is one policy decision or HITL event.

Path: controlled by the `AUDIT_LOG_FILE` environment variable (default: `data/audit.jsonl`).

### Policy Decision Entry

```jsonl
{"timestamp":"2026-04-15T10:30:00.000Z","action_class":"filesystem.read","target":"/tmp/foo","decision":"permit","deny_reason":null,"latency_ms":1,"context_hash":"abc123...","trace_id":"...","session_id":"...","stage":"stage2"}
```

| Field | Type | Description |
|---|---|---|
| `timestamp` | ISO 8601 string | When the decision was made |
| `action_class` | string | Canonical action class (e.g. `filesystem.read`) |
| `target` | string | Resource target from the tool call |
| `decision` | `"permit"` \| `"forbid"` | Authorization outcome |
| `deny_reason` | string \| null | Reason code when `decision` is `forbid` |
| `latency_ms` | number | Pipeline evaluation latency |
| `context_hash` | string | SHA-256 of `action_class|target|summary` |
| `trace_id` | string | Distributed trace identifier |
| `session_id` | string | Session the decision applies to |
| `stage` | string | Pipeline stage that produced the decision (`stage1`, `stage2`, `hitl`) |

### HITL Decision Entry

```jsonl
{"ts":"2026-04-15T10:30:01.000Z","type":"hitl","decision":"approved","token":"abc12345","toolName":"write_file","agentId":"agent-1","channel":"default","policyName":"destructive-actions","timeoutSeconds":120}
```

| Field | Type | Description |
|---|---|---|
| `ts` | ISO 8601 string | When the decision was recorded |
| `type` | `"hitl"` | Identifies HITL entries |
| `decision` | string | `approved`, `denied`, `expired`, `fallback-deny`, `fallback-auto-approve`, `telegram-unreachable`, `slack-unreachable` |
| `token` | string | 8-character approval token |
| `toolName` | string | Tool that triggered the HITL check |
| `agentId` | string | Requesting agent |
| `channel` | string | Agent's channel context |
| `policyName` | string | HITL policy that matched |
| `timeoutSeconds` | number | Configured timeout |

---

## 5. Error Handling

### Cedar Evaluation Errors

Cedar evaluation errors produce a `forbid` decision with reason `stage2_error`. The engine never surfaces a `permit` when an exception occurs.

| Condition | Decision | Reason |
|---|---|---|
| WASM not yet initialized | `forbid` | `cedar_not_initialized` |
| Entity construction exception | `forbid` | (exception logged) |
| Cedar evaluation exception | `forbid` | `stage2_error` |

### Bundle Validation Errors

| Condition | Behaviour |
|---|---|
| `version` not monotonically increasing | Bundle rejected; previous bundle active |
| `checksum` mismatch | Bundle rejected; previous bundle active |
| Invalid JSON | Bundle rejected; previous bundle active |
| Missing required fields | Bundle rejected; previous bundle active |

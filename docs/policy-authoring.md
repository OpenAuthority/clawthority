# Policy Authoring Guide

This guide covers how to write Cedar policies for OpenAuthority. It explains the entity model, tier system, policy file structure, and how to migrate from the legacy TypeScript engine.

> **Scope:** This guide covers OpenAuthority-specific Cedar usage. For a complete Cedar language reference, see the [Cedar policy language documentation](https://docs.cedarpolicy.com).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Entity Model](#2-entity-model)
3. [Policy File Structure](#3-policy-file-structure)
4. [Tier System](#4-tier-system)
5. [Writing Permit Rules](#5-writing-permit-rules)
6. [Writing Forbid Rules](#6-writing-forbid-rules)
7. [Conditional Policies (Tier 50)](#7-conditional-policies-tier-50)
8. [Rate Limits](#8-rate-limits)
9. [Action Class Reference](#9-action-class-reference)
10. [Migration from TypeScript Engine](#10-migration-from-typescript-engine)
11. [Authoring Checklist](#11-authoring-checklist)

---

## 1. Overview

OpenAuthority uses Cedar WASM (`@cedar-policy/cedar-wasm@4.9.1`) to evaluate authorization decisions. Policies are written in the Cedar policy language and stored in `.cedar` files under `data/policies/`.

Every tool call an agent makes is normalized to a canonical `action_class` (e.g. `filesystem.read`, `payment.transfer`) and then evaluated against the Cedar policy set. The Cedar engine returns either `permit` or `forbid`, with **forbid always winning** over permit when both apply to the same request.

```
Agent tool call
      │
      ▼
normalize_action() → action_class (e.g. "filesystem.read")
      │
      ▼
CedarEngine.evaluateByActionClass()
      │
      ├── Cedar forbid rule matches → forbid (regardless of permits)
      ├── Cedar permit rule matches → permit
      └── No permit rule matches  → forbid (default-deny)
```

---

## 2. Entity Model

Cedar policies reason about three entity types in the `OpenAuthority` namespace:

### Principal — `OpenAuthority::Agent`

The agent making the request. Always populated from `RuleContext`.

| Attribute | Cedar Type | Always Present | Description |
|---|---|---|---|
| `agentId` | String | Yes | Agent identity (e.g. `"agent-1"`) |
| `channel` | String | Yes | Execution channel (e.g. `"default"`, `"admin"`, `"ci"`) |
| `verified` | Boolean | No | `true` when identity verified against `AgentIdentityRegistry` |
| `userId` | String | No | Associated user session identity |
| `sessionId` | String | No | Session binding for session-scoped capability checks |

**Accessing optional attributes:** Always guard with `has` before accessing:

```cedar
// Correct
when { principal has verified && principal.verified == true }

// Wrong — causes evaluation error if verified is absent
when { principal.verified == true }
```

### Resource — `OpenAuthority::Resource`

The resource being accessed. The `actionClass` attribute carries the full semantic action class.

| Attribute | Cedar Type | Always Present | Description |
|---|---|---|---|
| `actionClass` | String | Yes (in Stage 2) | Semantic action class (e.g. `"filesystem.read"`) |

**Resource UID:** `OpenAuthority::Resource::"<resourceType>:<resourceName>"` where `resourceType` is derived from the `action_class` prefix:

| Action Class Prefix | Resource Type |
|---|---|
| `filesystem.*` | `file` |
| `communication.*` | `external` |
| `payment.*` | `payment` |
| `system.*` | `system` |
| `credential.*` | `credential` |
| `browser.*` | `web` |
| `memory.*` | `memory` |
| *(all others)* | `unknown` |

### Action — `OpenAuthority::Action`

Single action type for all evaluations:

```cedar
action == OpenAuthority::Action::"RequestAccess"
```

You never need to vary the action type. All differentiation is in the resource's `actionClass` attribute.

---

## 3. Policy File Structure

Cedar policy files live in `data/policies/`. The file name conveys the tier (by convention):

```
data/policies/
  tier10-permits.cedar    ← Tier 10: unconditional permits
  tier100-forbids.cedar   ← Tier 100: hard deny rules
  tier50-conditional.cedar ← Tier 50: conditional permits (create as needed)
```

Each policy in a file follows this structure:

```cedar
@id("unique-policy-id")
@tier("10")
@reason("Human-readable explanation")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "filesystem.read" };
```

**Required annotations:**

| Annotation | Format | Description |
|---|---|---|
| `@id` | `"<tier>-<action-class-slug>"` | Unique policy identifier. Propagated into decision `reason` for audit. |
| `@tier` | `"10"`, `"50"`, or `"100"` | Tier label for dashboard coverage grouping. |
| `@reason` | Free text | Human-readable explanation shown in audit logs. |

**Policy body:**

```cedar
<effect> (
  principal,                                  // always: any principal
  action == OpenAuthority::Action::"RequestAccess",  // always: single action type
  resource                                    // always: any resource
)
when { <condition> };
```

The `when` clause narrows which requests the policy applies to. Without a `when` clause, the policy applies to all requests — avoid this for `forbid` policies as it would block everything.

---

## 4. Tier System

Policies are organized into three tiers. The tier is a human convention (an annotation) — Cedar itself only cares about `permit` vs `forbid` effects.

| Tier | Effect | Purpose | Examples |
|---|---|---|---|
| 10 | `permit` | Unconditional low-risk permits. No conditions needed. | `filesystem.read`, `browser.navigate`, `memory.read` |
| 50 | `permit` | Conditional permits. Require attribute checks. | `web.fetch` for verified agents only |
| 100 | `forbid` | Hard denies. Defence-in-depth; overrides any permit. | `payment.transfer`, `system.execute`, `credential.access` |

**Forbid-wins rule:** A tier 100 `forbid` always overrides any tier 10 or tier 50 `permit` for the same request. There is no way to "un-block" something a `forbid` covers except by removing or narrowing the `forbid` policy.

---

## 5. Writing Permit Rules

### Unconditional permit (Tier 10)

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

### Permit for multiple action classes

Write one policy per action class. Do not combine action classes in a single `when` clause using `||` — it makes audit harder to trace.

```cedar
@id("10-filesystem-list")
@tier("10")
@reason("Filesystem list operations are permitted for all agents")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "filesystem.list" };
```

---

## 6. Writing Forbid Rules

### Unconditional forbid (Tier 100)

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

### Important: scoped `when` on all forbid rules

A `forbid` without a `when` clause blocks **all** requests, including those covered by a `permit`. Always add a `when { resource has actionClass && resource.actionClass == "..." }` clause to every `forbid` rule.

A broad `forbid` that overlaps with a narrow `permit` will suppress the `permit`. If you write a `forbid` for a sub-class of requests, scope the `when` clause precisely:

```cedar
// Bad: broad forbid overrides all permits
forbid (principal, action, resource);

// Good: scoped to a specific action class
forbid (principal, action, resource)
when { resource has actionClass && resource.actionClass == "payment.transfer" };
```

---

## 7. Conditional Policies (Tier 50)

Tier 50 policies add `when` conditions beyond the action class — typically checking principal attributes like `verified`, `channel`, or `userId`.

### Permit for verified agents only

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

### Permit for admin channel only

```cedar
@id("50-shell-exec-admin")
@tier("50")
@reason("Shell execution permitted on admin channel only")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when {
  resource has actionClass &&
  resource.actionClass == "shell.exec" &&
  principal.channel == "admin"
};
```

### Multiple channels (OR logic)

Write separate policies at the same tier — one per channel. This keeps each policy independently auditable:

```cedar
@id("50-shell-exec-admin")
@tier("50")
@reason("Shell execution permitted on admin channel")
permit (principal, action, resource)
when {
  resource has actionClass && resource.actionClass == "shell.exec" &&
  principal.channel == "admin"
};

@id("50-shell-exec-trusted")
@tier("50")
@reason("Shell execution permitted on trusted channel")
permit (principal, action, resource)
when {
  resource has actionClass && resource.actionClass == "shell.exec" &&
  principal.channel == "trusted"
};
```

### Conditional forbid with `unless`

Use `unless` for policies that permit most requests but block a specific sub-case:

```cedar
@id("50-filesystem-write-no-untrusted")
@tier("50")
@reason("Filesystem writes forbidden for untrusted channel agents")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when {
  resource has actionClass &&
  resource.actionClass == "filesystem.write" &&
  principal.channel == "untrusted"
};
```

---

## 8. Rate Limits

Rate limits are configured in the JSON rules bundle (`data/bundles/active/bundle.json`), not in Cedar files. They apply to `permit` outcomes only.

```json
{
  "effect": "permit",
  "action_class": "filesystem.write",
  "reason": "Filesystem writes permitted up to 20 per minute",
  "rateLimit": {
    "maxCalls": 20,
    "windowSeconds": 60
  }
}
```

Rate limit state is in-memory and resets on hot-reload or process restart. See the [Configuration Reference](configuration.md#rules-file) for the full schema.

---

## 9. Action Class Reference

The canonical action classes available for use in Cedar policies:

| Action Class | Default Risk | Resource Type |
|---|---|---|
| `filesystem.read` | low | `file` |
| `filesystem.list` | low | `file` |
| `filesystem.write` | medium | `file` |
| `filesystem.delete` | high | `file` |
| `browser.navigate` | low | `web` |
| `web.fetch` | medium | `web` |
| `web.post` | high | `web` |
| `communication.external.send` | high | `external` |
| `shell.exec` | high | `unknown` |
| `memory.read` | low | `memory` |
| `memory.write` | medium | `memory` |
| `payment.transfer` | critical | `payment` |
| `payment.initiate` | critical | `payment` |
| `credential.access` | critical | `credential` |
| `credential.write` | critical | `credential` |
| `system.execute` | critical | `system` |
| `account.permission.change` | critical | `unknown` |
| `unknown_sensitive_action` | critical | `unknown` |

For the full table including aliases, see [Action Registry](action-registry.md).

---

## 10. Migration from TypeScript Engine

This section covers how to translate legacy TypeScript engine rules to Cedar.

### Legacy priority 10 → Cedar tier 10 permit

**Before (JSON rule):**
```json
{ "effect": "permit", "action_class": "filesystem.read", "priority": 10 }
```

**After (Cedar policy):**
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

### Legacy priority 100 → Cedar tier 100 forbid

**Before (JSON rule):**
```json
{ "effect": "forbid", "action_class": "system.execute", "priority": 100 }
```

**After (Cedar policy):**
```cedar
@id("100-system-execute")
@tier("100")
@reason("System execution is unconditionally forbidden")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "system.execute" };
```

### Legacy priority 90 (HITL gate) → `hitl-policy.yaml` only

Priority 90 rules were used to gate actions behind human-in-the-loop approval. **There is no Cedar equivalent for "pending approval" state.**

Migrate priority 90 rules as two separate concerns:

1. Do **not** add a Cedar `forbid` for the action — let Cedar default-deny handle it (no matching `permit` → deny) or add a `permit` if the action should be allowed after approval.
2. Add the action pattern to `hitl-policy.yaml` so the HITL system requests approval before the tool executes.

**Before (JSON rule):**
```json
{ "effect": "forbid", "action_class": "communication.external.send", "priority": 90 }
```

**After (`hitl-policy.yaml`):**
```yaml
version: "1"
policies:
  - name: external-communication
    description: Outbound communication requires explicit approval
    actions: ["communication.external.send"]
    approval:
      channel: telegram
      timeout: 120
      fallback: deny
```

No Cedar policy is needed for this case. Cedar's default-deny handles the "no approval yet" state; the HITL layer intercepts the request and blocks it with `pending_hitl_approval` until a human responds.

### Legacy `condition` JS function → Cedar `when` clause

**Before (JSON rule):**
```json
{
  "effect": "permit",
  "action_class": "filesystem.write",
  "condition": "ctx.channel === 'admin' && ctx.verified === true"
}
```

**After (Cedar policy):**
```cedar
@id("50-filesystem-write-admin")
@tier("50")
@reason("Filesystem writes permitted for verified admin agents")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when {
  resource has actionClass &&
  resource.actionClass == "filesystem.write" &&
  principal.channel == "admin" &&
  principal has verified &&
  principal.verified == true
};
```

### Legacy `match`/`resource` field-based rules → action class

**Before (JSON rule):**
```json
{ "effect": "forbid", "resource": "tool", "match": "write_file" }
```

**After:** Map the tool name to its canonical action class via the action registry, then write a Cedar policy for that class:

```cedar
@id("100-filesystem-write")
@tier("100")
@reason("Filesystem writes are forbidden for untrusted sources")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when {
  resource has actionClass &&
  resource.actionClass == "filesystem.write" &&
  principal.channel == "untrusted"
};
```

For broad tool-name alias coverage, add aliases to the action registry (`src/enforcement/normalize.ts`) so new tool names resolve to the correct `action_class`.

### Unsupported: regex patterns

Cedar does not support regex pattern matching. Use `glob` patterns (`like`) or Cedar's string functions (`startsWith`, `endsWith`, `contains`) for partial matching. For tool-name-based routing, extend the action registry with explicit aliases instead of using regex in policy conditions.

---

## 11. Authoring Checklist

Before deploying a new Cedar policy file:

- [ ] Every `forbid` policy has a scoped `when { resource has actionClass && resource.actionClass == "..." }` clause.
- [ ] Every optional attribute access (`verified`, `userId`, `sessionId`) is guarded with `principal has <attr>` or `resource has <attr>`.
- [ ] Overlapping `forbid` and `permit` policies for the same action class have non-conflicting `when` clauses.
- [ ] Every policy has `@id`, `@tier`, and `@reason` annotations.
- [ ] The `@id` value is unique across all policies in the set.
- [ ] Priority 90 (HITL) actions are in `hitl-policy.yaml`, not in Cedar `forbid` rules.
- [ ] No broad `forbid (principal, action, resource)` without a `when` clause that scopes it.

# @openclaw/action-registry — Versioning Policy

This document defines the semantic versioning policy for the `@openclaw/action-registry` package.

## Overview

`@openclaw/action-registry` follows [Semantic Versioning 2.0.0](https://semver.org/). Because this package is the single source of truth for the action class taxonomy consumed by policy engines, normalizers, and HITL enforcement logic, version bumps have well-defined meanings tied to the impact on downstream consumers.

```
MAJOR.MINOR.PATCH
  │      │     └─ Documentation-only changes
  │      └─────── New action classes added
  └────────────── Breaking taxonomy changes
```

---

## MAJOR — Breaking changes

Increment the major version when a change **removes, renames, or repurposes** an existing action class in a way that is not backwards-compatible with existing policy configurations.

### What counts as a breaking change

| Change | Example |
|---|---|
| Remove an action class | Deleting `vcs.remote` from `ActionClass` and `REGISTRY` |
| Rename an action class string | Changing `'filesystem.delete'` → `'filesystem.destroy'` |
| Repurpose an action class | Reassigning `shell.exec` to cover only sandboxed execution while making unsandboxed execution a new class |
| Remove an `ActionClass` constant key | Deleting `ActionClass.ShellExec` from the exported object |
| Narrow the scope of an existing class | Splitting `web.fetch` into `web.fetch.get` and `web.fetch.stream`, removing the original |
| Change `default_risk` upward by ≥2 levels | `low` → `high` or `medium` → `critical` |
| Remove an exported type or interface | Deleting `IntentGroup` or `ActionRegistryEntry` |

### Example — removing an action class (2.0.0)

Before (`1.x`):
```typescript
export const ActionClass = {
  // ...
  BrowserScrape: 'browser.scrape',
  // ...
} as const;
```

After (`2.0.0`):
```typescript
export const ActionClass = {
  // 'browser.scrape' removed — covered by WebFetch
  // ...
} as const;
```

**Downstream impact:** Any Cedar policy or normalizer rule that references `browser.scrape` will stop matching. Policy authors must update their rules before upgrading.

### Migration process for breaking changes

1. **Pre-release notice** — Publish a `2.0.0-rc.N` pre-release and open a migration issue in the repository linking to this document.
2. **Migration guide** — Include a `MIGRATION.md` section (or append to this file under `## Migration guides`) that lists every removed/renamed class and its replacement.
3. **Deprecation window** — Where operationally feasible, publish a `1.x` patch that marks affected classes as deprecated via JSDoc `@deprecated` before the major release.
4. **Consumers to update** — `normalize.ts`, Cedar policy files, any downstream sidecar or plugin that hard-codes action class strings must be audited and updated.

---

## MINOR — Additive changes

Increment the minor version when a change **adds** one or more new action classes without altering any existing ones.

### What counts as a minor change

| Change | Example |
|---|---|
| Add a new action class | Adding `ai.inference` to `ActionClass` and `REGISTRY` |
| Add aliases to an existing class | Appending `'git_stash'` to `VcsWrite.aliases` |
| Add a new `IntentGroup` value | Adding `'ai_inference'` to the `IntentGroup` union |
| Add a new optional field to `ActionRegistryEntry` | Adding `severity_note?: string` |
| Add a new exported utility type | Adding `export type RiskLevelMap = Record<ActionClassValue, RiskLevel>` |

Existing policy rules continue to work without modification; the new class simply has no effect until consumers opt in.

### Example — adding an action class (1.1.0)

```typescript
// Before: ActionClass has 32 entries (v1.0.0)
// After:  ActionClass has 33 entries (v1.1.0)

export const ActionClass = {
  // ... existing entries unchanged ...
  AiInference: 'ai.inference',   // ← new in v1.1.0
  UnknownSensitiveAction: 'unknown_sensitive_action',  // always last
} as const;
```

> **Note:** `unknown_sensitive_action` must always remain the final entry in `ActionClass` and the final row in `REGISTRY` — it is the fail-closed catch-all. Renumbering that entry's position does not constitute a breaking change as long as its `action_class` string is unchanged.

---

## PATCH — Non-functional changes

Increment the patch version for changes that do not affect the runtime behavior of any exported value.

### What counts as a patch change

| Change | Example |
|---|---|
| Documentation corrections | Fixing a typo in a JSDoc comment or this file |
| Alias spelling fix (no removal) | Correcting `'git-statuss'` → `'git-status'` in `aliases` (additive) |
| Minor `default_risk` adjustment (one level, same tier) | `low` → `medium` for a non-critical read class, where downstream policy is unaffected |
| README or VERSIONING.md edits | Adding usage examples, clarifying migration steps |
| Build configuration changes | Updating `tsconfig.json` target, bumping `typescript` dev-dep |

### Example — documentation-only patch (1.0.1)

```diff
- * Lowercase tool name aliases that map to this action class.
+ * Lowercase tool name aliases that map to this action class.
+ * Matching is case-insensitive at normalizer call sites.
```

No exported value changes; only the JSDoc comment is updated.

---

## Change-control reminder

The action taxonomy is frozen at v1. Any addition, removal, rename, or risk-level change also requires an approved RFC. A version bump alone is not sufficient authorization — the `ReleaseValidator` V-13 check gates releases on the freeze status recorded in `docs/action-taxonomy.md`.

---

## Migration guides

### v1.x → v2.x

_No v2 release has been made yet. This section will be populated when a breaking change is planned._

---

## Quick reference

| Scenario | Version bump |
|---|---|
| Remove or rename an action class | **MAJOR** |
| Repurpose an existing action class | **MAJOR** |
| Add a new action class | **MINOR** |
| Add aliases to an existing class | **MINOR** |
| Fix documentation / comments | **PATCH** |
| Build / tooling changes only | **PATCH** |

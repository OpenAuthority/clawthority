# Phase 4 Cleanup Plan

Removes ABAC remnants left behind when T24 deleted `src/engine.ts`, `src/rules.ts`,
`ui/`, `control-plane-api/`, and `data/rules.json`.

---

## Deletion Targets

| Path | Type | Reason |
|------|------|--------|
| `src/engine.test.ts` | file | Tests deleted modules (`engine.ts`, `rules.ts`); replaced by `src/audit.test.ts` for `JsonlAuditLogger` |
| `src/dashboard/` | directory | Stub directory never implemented; dashboard deferred to future phase |
| `data/builtin-rules.json` | file | UI snapshot written by removed `writeBuiltinRulesSnapshot`; no consumer exists |

---

## Modification Targets

Five existing files modified in T48 (this phase) to remove dependencies before
deletions can safely occur.

| File | Change |
|------|--------|
| `src/types.ts` | Remove ABAC TypeBox schemas (`PolicyEffect`, `PolicyCondition`, `PolicyRule`, `Policy`, `EvaluationContext`, `EvaluationResult` and their `Static<>` type aliases). Keep v0.1 semantic types. |
| `src/audit.ts` | Remove `AuditLogger`, `AuditEntry`, `AuditHandler`, `consoleAuditHandler`. Keep `JsonlAuditLogger`, `PolicyDecisionEntry`, `HitlDecisionEntry`, `JsonlAuditLoggerOptions`. |
| `src/index.ts` | Remove ABAC type re-exports, `AuditLogger`/`consoleAuditHandler` import and singleton, `writeBuiltinRulesSnapshot` function and all call sites. |
| `src/engine.test.ts` | Strip to `JsonlAuditLogger` tests only; remove all `evaluateRule`, `sortRulesByPriority`, `PolicyEngine`, `AuditLogger`, `consoleAuditHandler` test sections. |
| `docs/phase4-cleanup.md` | Create this plan document (convention: phase cleanup plans live here). |

---

## Dependency Map

```
src/types.ts (ABAC section)
  └── imported by: src/audit.ts (TPolicy, TEvaluationContext, TEvaluationResult)
      └── imported by: src/index.ts (AuditLogger, consoleAuditHandler)
          └── used by: src/engine.test.ts (AuditLogger, AuditEntry, AuditHandler)

data/builtin-rules.json
  └── written by: src/index.ts (writeBuiltinRulesSnapshot)
```

---

## Migration Path

1. **T48 (this task)** — Modify 5 files to remove dependencies.
2. **T47 (next task)** — Delete `src/engine.test.ts`, `src/dashboard/`, `data/builtin-rules.json`.

`JsonlAuditLogger` tests remain in `src/engine.test.ts` until T47; T47 should
migrate them to a dedicated `src/audit.test.ts`.

---

## Rollback Plan

All changes are reversible via `git revert`. No data migration required.
`data/builtin-rules.json` was auto-generated at startup; removing
`writeBuiltinRulesSnapshot` from `src/index.ts` means it will not be regenerated,
but no runtime code reads from it.

---

## Impact Assessment

- **Public API**: `AuditLogger`, `consoleAuditHandler`, `AuditEntry`, `AuditHandler`,
  and the six ABAC TypeBox types (`TPolicyEffect`, `TPolicyCondition`, `TPolicyRule`,
  `TPolicy`, `TEvaluationContext`, `TEvaluationResult`) are removed from the public
  index exports. Downstream consumers using these must migrate.
- **`JsonlAuditLogger`** remains exported — no breaking change for HITL audit logging.
- **Dashboard**: The stub `src/dashboard/` directory and `createDashboardServer` are
  removed; no production code called them.
- **Test coverage**: `evaluateRule`, `sortRulesByPriority`, `PolicyEngine` tests are
  removed; those modules (`engine.ts`, `rules.ts`) were already deleted in T24.

---

## Task Breakdown

| Task | Description | Status |
|------|-------------|--------|
| T48 | Modify 5 files (this doc) | Done |
| T49 | Delete `src/engine.test.ts`, `src/dashboard/`, `data/builtin-rules.json`; migrate JsonlAuditLogger tests to `src/audit.test.ts` | Done |

---

## Prerequisite Checks

- [x] `src/types.ts` ABAC section removed
- [x] `src/audit.ts` AuditLogger section removed
- [x] `src/index.ts` ABAC re-exports and `writeBuiltinRulesSnapshot` removed
- [x] `src/engine.test.ts` stripped to `JsonlAuditLogger` tests only
- [x] `src/engine.test.ts` deleted (T49)
- [x] `src/dashboard/` deleted (T49)
- [x] `data/builtin-rules.json` deleted (T49)

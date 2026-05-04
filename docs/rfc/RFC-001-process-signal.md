# RFC-001: Action class `process.signal`

**Status:** implemented
**Filed:** 2026-04-29
**Resolved:** 2026-04-29 (implemented in v1.3.2 — `kill_process` and `pkill_pattern` typed tools bind to this class)
**Requestor:** @paolo
**SLA deadline:** 2026-05-13 (14 days from filing)

## Proposed Change

Formalise the `process.signal` action class introduced in the v1.3.1 registry into the frozen taxonomy via the RFC governance process. The class already ships in `packages/action-registry/src/index.ts` and is listed in `docs/action-taxonomy.md` (frozen v2, entry #25), but no RFC has been filed against it. This RFC closes that governance gap and explicitly authorises the v1.3.2 typed-tool wrappers (`kill_process`, `pkill_pattern`) to bind to it.

## Motivation

v1.3.1 added breadth coverage for ~50 commands across the 16-category exec audit, including signal-delivery commands (`kill`, `pkill`, `killall`). These were previously normalised to `unknown_sensitive_action`, which:

- Forces every signal-delivery call through the `critical` HITL path, even though signal delivery is more accurately `high` (irreversible at the process level, but bounded — does not directly affect financial, security, or system-wide state).
- Prevents policy authors from writing rules that target signal delivery specifically. `forbid: { action_class: 'process.signal' }` is more precise than `forbid: { tool_name: 'kill' }` (catches `pkill`, `killall`, future aliases) and more permissive than `forbid: { action_class: 'unknown_sensitive_action' }` (which would also block legitimately unknown tools).
- Produces audit entries that fail to differentiate signal delivery from other "unknown" critical actions.

Naming choice: `process.signal` (not `process.kill`) because the class covers any signal — `HUP`, `USR1`, `USR2`, `INT` — not only termination. Resolves §14 open question 1 of the v1.3.2 plan.

## Impact

**Affected components:**

- `packages/action-registry/src/index.ts` — entry already registered; no code change required.
- `docs/action-taxonomy.md` — entry already present in the frozen v2 table; no change required.
- `docs/action-registry.md` — already references the class.
- v1.3.2 typed-tool work (W4) — `kill_process` and `pkill_pattern` manifests will declare `action_class: 'process.signal'`.

**Policy authors:** Existing rules targeting `unknown_sensitive_action` no longer match `kill` / `pkill` / `killall` calls. Operators relying on the catch-all to forbid these must add an explicit `forbid` rule against `process.signal`. Migration note will ship in the v1.3.2 CHANGELOG.

**Tool authors:** May now declare `action_class: 'process.signal'` on signal-delivery tool manifests instead of falling through to the sentinel.

## Proposed Action Class / Taxonomy Entry

| Field | Value |
|---|---|
| `action_class` | `process.signal` |
| `namespace` | `process` |
| `default_risk` | `high` |
| `default_hitl_mode` | `per_request` |
| `intent_group` | — (none) |
| `aliases` | `kill`, `pkill`, `killall` |

Risk rationale: signal delivery is irreversible at the process level (a killed process loses in-memory state) but is bounded — it does not cross the host boundary, does not move data, and does not modify persistent storage directly. `high` matches the existing rubric for irreversible-but-bounded actions (cf. `filesystem.delete`).

HITL rationale: every invocation should require fresh approval because the target `pid` or `pattern` is the security-relevant field; session-scope approval would let an agent escalate from a benign target to a critical one (e.g. PID 1).

## Alternatives Considered

1. **Leave under `unknown_sensitive_action`.** Rejected — see Motivation. Forces all signal delivery through `critical` HITL and prevents policy targeting.
2. **Class name `process.kill`.** Rejected — the class covers `HUP`, `USR1`, `USR2`, `INT`, not just terminate signals. `signal` is the accurate name.
3. **Split into `process.signal.terminate` (KILL/TERM) and `process.signal.notify` (HUP/USR*/INT).** Rejected for v1.3.1 — adds complexity for an immaterial risk delta. The typed-tool `signal` enum gives policy authors a way to target specific signals via parameter-level reclassification without proliferating action classes.

## Open Questions

None remaining for this RFC. Signal-specific reclassification (e.g., treating `KILL` as `critical` while `HUP` stays `high`) is handled via the typed-tool parameter schema in v1.3.2 W4, not via additional action classes.

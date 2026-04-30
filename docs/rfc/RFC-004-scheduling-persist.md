# RFC-004: Action class `scheduling.persist`

**Status:** implemented
**Filed:** 2026-04-29
**Resolved:** 2026-04-29 (implemented in v1.3.2 — `crontab_list`, `crontab_install_from_file`, `crontab_remove` typed tools bind to this class)
**Requestor:** @paolo
**SLA deadline:** 2026-05-13 (14 days from filing)

## Proposed Change

Formalise the `scheduling.persist` action class introduced in the v1.3.1 registry into the frozen taxonomy via the RFC governance process. The class already ships in `packages/action-registry/src/index.ts` and is listed in `docs/action-taxonomy.md` (frozen v2, entry #31), but no RFC has been filed against it. This RFC closes that governance gap and explicitly authorises the v1.3.2 typed-tool wrappers (`crontab_list`, `crontab_install_from_file`, `crontab_remove`) to bind to it.

## Motivation

Persistent unattended job scheduling — `crontab`, `at`, `batch` — installs work that runs **after the agent session ends**, outside the HITL approval scope. This is qualitatively different from in-session command execution and warrants a distinct action class:

- An approved `bash systemctl restart nginx` runs once. An approved `crontab` installation can re-run that command every minute, indefinitely, with no further approval gate.
- Audit reconstruction requires distinguishing "agent installed a recurring job" from "agent ran a one-shot command."
- Policy authors frequently want to permit one-shot administration but forbid persistent scheduling — the two are operationally distinct and should be policy-distinguishable.

The naming `scheduling.persist` (not `scheduling.cron` or `scheduling.install`) emphasises the persistent property: the risk is not the scheduler vendor but the fact that the work outlives the approving session.

## Impact

**Affected components:**

- `packages/action-registry/src/index.ts` — entry already registered; no code change required.
- `docs/action-taxonomy.md` — entry already present in the frozen v2 table; no change required.
- `docs/action-registry.md` — already references the class.
- v1.3.2 typed-tool work (W7) — `crontab_list`, `crontab_install_from_file`, `crontab_remove` manifests will declare `action_class: 'scheduling.persist'`. Note: `crontab_list` is read-only and may be reclassified to `system.read` at the typed-tool level via parameter-level reclassification rules.

**Policy authors:** Operators who currently rely on `unknown_sensitive_action` to gate scheduling must add an explicit forbid against `scheduling.persist`. Migration note will ship in the v1.3.2 CHANGELOG.

## Proposed Action Class / Taxonomy Entry

| Field | Value |
|---|---|
| `action_class` | `scheduling.persist` |
| `namespace` | `scheduling` |
| `default_risk` | `high` |
| `default_hitl_mode` | `per_request` |
| `intent_group` | — (none) |
| `aliases` | `crontab`, `at`, `batch`, `atq`, `atrm` |

Risk rationale: persistent scheduling installs work that bypasses the HITL approval scope of the installing session. `high` matches the rubric "externally visible actions outside session scope". `critical` was considered and rejected because the actual blast radius is bounded by what the scheduled command can do — and the scheduled command itself goes through HITL when the scheduler invokes it (assuming the scheduler invokes it as the same identity).

HITL rationale: per-request because the schedule expression and target command are the security-relevant fields. Session-scope approval would let an agent install jobs at multiple times under one approval, defeating the purpose of the gate.

## Alternatives Considered

1. **Place under `system.service`.** Rejected — `systemd` units and `cron` jobs share the persistence property but differ in operator mental model. Operators reason about "service management" and "scheduled jobs" separately; conflating them produces unwieldy policy rules.
2. **Split into `scheduling.persist.cron` and `scheduling.persist.at`.** Rejected — vendor-specific splitting adds class proliferation for no policy benefit. Aliases handle the vendor distinction.
3. **Reuse `code.execute` with parameter-level reclassification.** Rejected — the persistence property is a first-class risk dimension and deserves a first-class action class.

## Open Questions

1. Should `systemd-timer` units (a modern alternative to `cron`) be added as an alias here, or routed through `system.service` since they are managed via `systemctl`? Provisional answer: route through `system.service` (consistent with how the unit is administered) and let parameter-level reclassification flag timer units specifically if the pattern emerges. Revisit in a follow-up RFC if operator data shows confusion.

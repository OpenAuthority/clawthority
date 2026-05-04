# RFC-002: Action class `permissions.modify`

**Status:** implemented
**Filed:** 2026-04-29
**Resolved:** 2026-04-29 (implemented in v1.3.2 — `chmod_path` and `chown_path` typed tools bind to this class)
**Requestor:** @paolo
**SLA deadline:** 2026-05-13 (14 days from filing)

## Proposed Change

Formalise the `permissions.modify` action class introduced in the v1.3.1 registry into the frozen taxonomy via the RFC governance process. The class already ships in `packages/action-registry/src/index.ts` and is listed in `docs/action-taxonomy.md` (frozen v2, entry #23), but no RFC has been filed against it. This RFC closes that governance gap and explicitly authorises the v1.3.2 typed-tool wrappers (`chmod_path`, `chown_path`) to bind to it.

## Motivation

File-mode and ownership changes were previously routed through `unknown_sensitive_action`, which conflates them with privilege elevation (`sudo`, `su`, `passwd`). The two operate at different risk tiers and different recovery profiles:

- `chmod` / `chown` — modifies discretionary access controls on specific paths. Reversible if the previous mode is known. Bounded blast radius (the path tree).
- `sudo` / `su` / `passwd` — escalates the calling identity. Effects propagate beyond the call site (a `sudo` once granted enables anything the elevated user could do). Conceptually critical and modelled separately as `permissions.elevate` (RFC out of scope here).

Splitting them lets policy authors distinguish:

- "Allow chmod on `./build/` but forbid chmod on `/etc/`" (file-grained `permissions.modify`)
- "Block `sudo` outright" (blanket `permissions.elevate` forbid)

Without distinct classes, the second policy must be expressed as a tool-name forbid against every elevation alias, which is brittle.

## Impact

**Affected components:**

- `packages/action-registry/src/index.ts` — entry already registered; no code change required.
- `docs/action-taxonomy.md` — entry already present in the frozen v2 table; no change required.
- `docs/action-registry.md` — already references the class.
- v1.3.2 typed-tool work (W3) — `chmod_path` and `chown_path` manifests will declare `action_class: 'permissions.modify'`.

**Policy authors:** Operators who previously wrote `forbid: { action_class: 'unknown_sensitive_action' }` to block `chmod`/`chown` must now write a class-specific forbid. Migration note will ship in the v1.3.2 CHANGELOG.

**Tool authors:** May declare `action_class: 'permissions.modify'` on file-mode/ownership tools.

## Proposed Action Class / Taxonomy Entry

| Field | Value |
|---|---|
| `action_class` | `permissions.modify` |
| `namespace` | `permissions` |
| `default_risk` | `high` |
| `default_hitl_mode` | `per_request` |
| `intent_group` | — (none) |
| `aliases` | `chmod`, `chown`, `chgrp`, `umask` |

Risk rationale: a `chmod 777` on the wrong tree (or `chmod -R` on `/`) materially weakens the host's security posture and is impractical to reverse without a backup of prior modes. `high` matches the rubric "irreversible or externally visible actions". It is **not** `critical` because the blast radius is bounded by the path argument and does not by itself confer financial or system-wide impact.

HITL rationale: per-request because the `path` and `mode` arguments are the security-relevant fields. Session-scope approval would let an agent move from a safe path to `/etc/shadow` under one approval.

## Alternatives Considered

1. **Single `permissions` class for both modify and elevate.** Rejected — see Motivation. The risk profile and recovery profile differ materially.
2. **Place under `filesystem.write` with parameter-level reclassification.** Rejected — `chmod` does not write file *contents*; routing through `filesystem.write` would conflate two semantically distinct actions and confuse audit reconstruction.
3. **Split further into `permissions.modify.mode` (chmod) and `permissions.modify.owner` (chown).** Rejected — adds class proliferation for no policy-targeting benefit. The typed-tool schema distinguishes them at the manifest level.

## Open Questions

None remaining for this RFC. Recursive flag handling and path validation are typed-tool concerns covered by v1.3.2 W3.

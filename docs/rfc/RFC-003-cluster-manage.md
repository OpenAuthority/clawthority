# RFC-003: Cluster namespace — split `cluster.manage` into `cluster.read` / `cluster.write`

**Status:** implemented
**Filed:** 2026-04-29
**Resolved:** 2026-04-29 (implemented in v1.3.2 — taxonomy bumped v2 → v3; `kubectl_get` binds to `cluster.read`; `kubectl_apply` / `kubectl_delete` / `kubectl_rollout` / `docker_push` and the bare `kubectl` alias bind to `cluster.write`)
**Requestor:** @paolo
**SLA deadline:** 2026-05-13 (14 days from filing)

## Proposed Change

Two changes bundled in a single RFC because they affect the same namespace and the v1.3.2 typed tools depend on the second:

1. **Retroactive (governance gap):** Formalise the `cluster.manage` action class introduced in the v1.3.1 registry. The class already ships in `packages/action-registry/src/index.ts` and is listed in `docs/action-taxonomy.md` (frozen v2, entry #30) but no RFC was filed against it.
2. **Forward-looking (taxonomy edit):** **Replace** `cluster.manage` with two distinct classes — `cluster.read` (low / per_request) and `cluster.write` (high / per_request) — under the same `cluster` namespace. The replacement bumps the frozen taxonomy from v2 to v3.

The v1.3.2 typed tools bind as follows: `kubectl_get` → `cluster.read`; `kubectl_apply`, `kubectl_delete`, `kubectl_rollout`, `docker_push` → `cluster.write`.

## Motivation

Kubernetes-style cluster management commands (`kubectl`, and to a lesser extent `docker push` against shared registries) were previously routed through `unknown_sensitive_action`. This:

- Forces read-only `kubectl get` calls through `critical` HITL — operationally prohibitive in research / debugging workflows.
- Conflates writes (`apply`, `delete`, `rollout restart`) with reads in the audit trail.
- Prevents policy rules like "permit cluster reads, forbid cluster writes."

A dedicated namespace + class lets operators write coarse-grained cluster policies and gives the v1.3.2 typed tools a stable target.

## Motivation

`cluster.manage` was introduced in v1.3.1 as a single class covering every `kubectl` subcommand. Operator data and the v1.3.2 typed-tool design surfaced a fatigue/precision problem:

- `kubectl get` is the dominant operator volume — research, debugging, status checks. Forcing `high / per_request` HITL on every read produces severe approval fatigue and trains operators to rubber-stamp.
- `kubectl apply` / `kubectl delete` / `kubectl rollout` are write operations with workload-scale blast radius. Their risk profile materially exceeds reads; conflating them under one class denies policy authors a clean read-vs-write target.
- The taxonomy elsewhere already establishes the read/write split (`filesystem.read` vs `filesystem.write`, `vcs.read` vs `vcs.write`, `credential.read` vs `credential.write`). Cluster operations should follow the same convention.

The v1.3.2 typed-tool work makes this split low-risk: `kubectl_get` is its own typed tool with a structured manifest, so binding it to `cluster.read` is a one-line manifest change rather than a per-call reclassification rule.

## Impact

**Affected components:**

- `packages/action-registry/src/index.ts` — replace the single `cluster.manage` entry with two entries (`cluster.read`, `cluster.write`). Update the `ActionClass` enum (remove `ClusterManage`, add `ClusterRead` and `ClusterWrite`).
- `docs/action-taxonomy.md` — remove the `cluster.manage` row, add `cluster.read` and `cluster.write` rows; bump the version header `frozen v2` → `frozen v3`; update the namespace table.
- `docs/action-registry.md` — update references from `cluster.manage` to the two split classes.
- v1.3.2 typed-tool work (W5, W6) — `kubectl_get` declares `cluster.read`; `kubectl_apply`, `kubectl_delete`, `kubectl_rollout`, `docker_push` declare `cluster.write`.

**Policy authors:** Operators with rules targeting `cluster.manage` see them become inert (no matching action_class) after upgrade. They must rewrite as either `cluster.write` (the equivalent for the original "block kubectl writes" intent) or both `cluster.read` and `cluster.write` for parity. Migration note ships in the v1.3.2 CHANGELOG.

**Existing alias mapping:** the bare `kubectl` alias is **kept** but moved from the (now-removed) `cluster.manage` to `cluster.write`. Free-form `bash kubectl ...` calls are therefore classified as `cluster.write` (the destructive class) regardless of subcommand — a conservative-by-default fallback. The typed tools (W5) provide the precision: `kubectl_get` declares `cluster.read` directly. Operators who want to permit `kubectl get` via free-form bash without permitting writes should adopt the typed `kubectl_get` tool; bare-shell `kubectl get` remains gated as `cluster.write`.

## Proposed Action Class / Taxonomy Entries

### `cluster.read`

| Field | Value |
|---|---|
| `action_class` | `cluster.read` |
| `namespace` | `cluster` |
| `default_risk` | `low` |
| `default_hitl_mode` | `per_request` |
| `intent_group` | — (none) |
| `aliases` | — (none — only the typed `kubectl_get` tool) |

Risk rationale: cluster reads disclose workload state to the calling identity but do not change cluster state. `low` reflects observational impact. HITL is kept at `per_request` because `kubectl get secrets` is a credential exfiltration vector — the parameter-level reclassification path in `cluster.read` tools will route secret-bearing reads through `credential.read` instead, but the default class HITL must remain per-request to gate the unhandled cases.

### `cluster.write`

| Field | Value |
|---|---|
| `action_class` | `cluster.write` |
| `namespace` | `cluster` |
| `default_risk` | `high` |
| `default_hitl_mode` | `per_request` |
| `intent_group` | — (none) |
| `aliases` | `kubectl` |

Risk rationale: cluster writes are workload-scale destructive on misuse. `kubectl delete` in the wrong namespace destroys production workloads; `kubectl apply` of a malformed manifest can pin a service in a crash loop. `high` (not `critical`) because the blast radius is bounded by the cluster context and the per-resource RBAC of the calling identity.

HITL rationale: per-request because the `resource` / `name` / `namespace` arguments determine the actual blast radius.

## Alternatives Considered

1. **Keep `cluster.manage` as the single class.** Rejected — operator HITL fatigue on read paths trains rubber-stamping, which materially weakens the gate for write paths. The v1.3.2 typed-tool work makes the split cheap.
2. **Three-way split (`cluster.read` / `cluster.write` / `cluster.exec`).** Rejected for v1.3.2 — `kubectl exec` / `proxy` / `port-forward` are explicitly out of scope per the v1.3.2 release plan §2.2. A future RFC may add `cluster.exec` if those tools land.
3. **Single `cluster.kubectl` class.** Rejected — the namespace should be vendor-neutral. Future support for `helm`, `nomad`, `docker swarm` should sit alongside `kubectl` under the same `cluster.*` namespace.
4. **Reuse `code.execute`.** Rejected — `kubectl` is not local code execution; the audit semantics differ materially.

## Open Questions

1. Should `docker push` (image distribution to a shared registry) live under `cluster.write` or under a new `registry.publish` class? Provisional answer: `cluster.write` is acceptable for v1.3.2 because the operator-relevant risk (pushing an unintended image to a shared registry) overlaps with the cluster-write risk model. A future RFC may split if `registry.*` operations grow beyond a single command.
2. Should the bare `kubectl` alias map to `cluster.read` or `cluster.write`? Resolved: map to `cluster.write`. Free-form `bash kubectl ...` cannot be parsed for read-vs-write at the alias level (the registry sees only the binary name, not the subcommand), so the safer default is to assume write — over-gating reads is recoverable, under-gating writes is not. The typed tools restore precision: `kubectl_get` declares `cluster.read` at the manifest level.

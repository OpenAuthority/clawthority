# RFC Index — OpenClaw Taxonomy Governance

This document is the centralized index for all taxonomy RFCs. It tracks status, links to RFC documents, and describes the RFC lifecycle and submission process.

---

## RFC Numbering System

RFCs are assigned sequential three-digit numbers prefixed with `RFC-`:

```
RFC-001, RFC-002, RFC-003, ...
```

Numbers are assigned at submission time in filing order. Numbers are never reused. The `docs/rfc/` directory holds one file per RFC named `RFC-NNN-short-title.md` (e.g. `RFC-001-browser-navigate.md`).

---

## RFC Index

| RFC | Title | Status | Filed | Resolved |
|-----|-------|--------|-------|----------|
| [RFC-001](RFC-001-process-signal.md) | Action class `process.signal` | implemented | 2026-04-29 | 2026-04-29 (v1.3.2) |
| [RFC-002](RFC-002-permissions-modify.md) | Action class `permissions.modify` | implemented | 2026-04-29 | 2026-04-29 (v1.3.2) |
| [RFC-003](RFC-003-cluster-manage.md) | Cluster namespace — split `cluster.manage` into `cluster.read` / `cluster.write` | implemented | 2026-04-29 | 2026-04-29 (v1.3.2) |
| [RFC-004](RFC-004-scheduling-persist.md) | Action class `scheduling.persist` | implemented | 2026-04-29 | 2026-04-29 (v1.3.2) |

> **Pending RFC:** `browser.navigate` action class (deferred from v1 taxonomy design review, Thread 5). File when a concrete browser navigation tool implementation exists in a shipped skill. See `docs/action-taxonomy.md` §Design Review Record, Thread 5.
>
> **Outstanding governance gap:** v1.3.1 added six additional action classes that are present in the frozen v3 taxonomy without RFCs filed (`system.service`, `permissions.elevate`, `network.diagnose`, `network.scan`, `network.transfer`, `network.shell`). The four RFCs above cover the classes directly targeted by v1.3.2 typed tools; the remaining six should be backfilled in a follow-up cleanup pass.

---

## Lifecycle States

RFCs move through the following states. States match the `RFCStatus` type in `src/validation/rfc-processor.ts`.

| State | Meaning |
|-------|---------|
| `open` | Filed and awaiting review assignment |
| `in_review` | Under active review by governance track maintainers |
| `approved` | Approved; implementation may proceed |
| `rejected` | Rejected; the proposed change will not be made |
| `implemented` | Approved RFC fully implemented and merged |

**Terminal states:** `approved`, `rejected`, `implemented`. An RFC in a terminal state is never reopened — file a new RFC instead.

**SLA:** All open RFCs carry a 14-calendar-day resolution SLA from the filing date. SLA tracking is automated via `RFCProcessor` (G-01).

---

## What Requires an RFC

An RFC is required before any of the following changes to the taxonomy:

- Adding a new action class or namespace
- Removing an existing action class
- Renaming an action class or namespace
- Changing the `default_risk` of any action class
- Changing the `default_hitl_mode` of any action class
- Adding, removing, or reassigning an intent group
- Changing the `unknown_sensitive_action` sentinel behavior

Changes that do **not** require an RFC:

- Adding or removing tool name aliases for an existing action class

---

## Submission Process

1. **Open a governance track issue** describing the proposed change, the motivation, and the impact on existing policy rules and tool manifests.
2. **Create an RFC document** at `docs/rfc/RFC-NNN-short-title.md` using the template below. Assign the next available number.
3. **File the RFC** via `RFCProcessor.file()` or by opening a PR that adds the RFC document. The filing date starts the 14-day SLA clock.
4. **Notify maintainers** by linking the RFC document in the governance track issue.

### RFC Document Template

```markdown
# RFC-NNN: <Title>

**Status:** open
**Filed:** YYYY-MM-DD
**Requestor:** @handle
**SLA deadline:** YYYY-MM-DD (14 days from filing)

## Proposed Change

<!-- Describe what you want to add, remove, or modify in the taxonomy. -->

## Motivation

<!-- Why is this change needed? What problem does it solve? -->

## Impact

<!-- Which existing policy rules, tool manifests, or HITL configurations are affected? -->

## Proposed Action Class / Taxonomy Entry

<!-- If adding a new class: proposed name, namespace, default_risk, default_hitl_mode, intent_group (if any), and suggested aliases. -->

## Alternatives Considered

<!-- What other approaches were considered and why were they rejected? -->

## Open Questions

<!-- List unresolved questions for reviewers. -->
```

---

## Review Process

1. **Maintainer assignment:** A governance track maintainer is assigned as reviewer within 2 business days of filing.
2. **Review period:** The reviewer evaluates the proposal against the taxonomy design principles (see `docs/action-taxonomy.md`). Feedback is recorded in the governance track issue or PR comments.
3. **Decision:** The reviewer records a decision (`approved` or `rejected`) with rationale. All participants are notified.
4. **Implementation (if approved):**
   - Update `docs/action-taxonomy.md` (frozen table, namespaces, intent groups) and `packages/action-registry/src/index.ts` in the **same PR**.
   - Bump the taxonomy version header in `docs/action-taxonomy.md` (e.g., `frozen v1` → `frozen v2`).
   - Update the RFC document status to `implemented` after the PR merges.
   - Update this index with the resolution date.

---

## Maintenance

This index is updated manually when RFCs are filed or resolved. Add a row to the RFC Index table and update the `Status` and `Resolved` columns as the RFC progresses. Consider automating status sync with `RFCProcessor.listAll()` in a future tooling pass.

---

## Related Documents

- `docs/action-taxonomy.md` — Frozen v1 taxonomy and change control policy
- `docs/action-registry.md` — Alias tables, reclassification rules, and policy authoring guide
- `src/validation/rfc-processor.ts` — Automated RFC lifecycle management (G-01)

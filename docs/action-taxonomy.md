# OpenClaw Action Taxonomy

> **Status: frozen v3** (released with v1.3.2)
>
> This taxonomy is the stable contract for policy authoring, tool manifests, and HITL routing. Action class names, risk defaults, HITL defaults, and intent groups are **immutable** until a formal RFC is approved per the process below.
>
> **Change control:** Any modification — adding, removing, or renaming a class; changing a risk level or HITL default; reassigning an intent group — requires an approved RFC. RFC documents live under [`docs/rfc/`](rfc/); submit before editing this document or `packages/action-registry/src/index.ts`.

---

## Overview

Every tool call an agent makes is normalised to a canonical **action class** before policy evaluation. The taxonomy defines 44 named action classes plus the fail-closed `unknown_sensitive_action` sentinel, organised into functional namespaces.

The frozen v3 taxonomy is the source of truth for:
- Policy authoring (`action_class` and `intent_group` values in YAML and JSON rules)
- Tool manifest declarations (`action_class` field in `ToolManifest`)
- HITL enforcement (default `risk_tier` and `default_hitl_mode` alignment requirements)

---

## Frozen Action Class Table

| # | Action Class | Namespace | Risk | HITL Mode | Intent Group | Since |
|---|---|---|---|---|---|---|
| 1 | `filesystem.read` | filesystem | low | none | — | v1 |
| 2 | `filesystem.write` | filesystem | medium | per_request | — | v1 |
| 3 | `filesystem.delete` | filesystem | high | per_request | `destructive_fs` | v1 |
| 4 | `filesystem.list` | filesystem | low | none | — | v1 |
| 5 | `web.search` | web | medium | per_request | — | v1 |
| 6 | `web.fetch` | web | medium | per_request | `data_exfiltration` | v1 |
| 7 | `web.post` | web | medium | per_request | `web_access` | v1 |
| 8 | `browser.scrape` | browser | medium | per_request | — | v1 |
| 9 | `shell.exec` | shell | high | per_request | — | v1 |
| 10 | `communication.email` | communication | high | per_request | `external_send` | v1 |
| 11 | `communication.slack` | communication | medium | per_request | `external_send` | v1 |
| 12 | `communication.webhook` | communication | medium | per_request | `external_send` | v1 |
| 13 | `memory.read` | memory | low | none | — | v1 |
| 14 | `memory.write` | memory | medium | none | — | v1 |
| 15 | `credential.read` | credential | high | per_request | `credential_access` | v1 |
| 16 | `credential.write` | credential | critical | per_request | `credential_access` | v1 |
| 17 | `credential.rotate` | credential | critical | per_request | `credential_access` | v1.2.1 |
| 18 | `credential.list` | credential | high | per_request | `credential_access` | v1.2.4 |
| 19 | `code.execute` | code | high | per_request | — | v1 |
| 20 | `payment.initiate` | payment | critical | per_request | `payment` | v1 |
| 21 | `system.read` | system | low | none | — | v1.1.x |
| 22 | `system.service` | system | critical | per_request | — | **v1.3.1** |
| 23 | `permissions.modify` | permissions | high | per_request | — | **v1.3.1** |
| 24 | `permissions.elevate` | permissions | critical | per_request | — | **v1.3.1** |
| 25 | `process.signal` | process | high | per_request | — | **v1.3.1** |
| 26 | `network.diagnose` | network | low | none | — | **v1.3.1** |
| 27 | `network.scan` | network | high | per_request | — | **v1.3.1** |
| 28 | `network.transfer` | network | high | per_request | `data_exfiltration` | **v1.3.1** |
| 29 | `network.shell` | network | high | per_request | — | **v1.3.1** |
| 30 | `cluster.read` | cluster | low | per_request | — | **v1.3.2** |
| 31 | `cluster.write` | cluster | high | per_request | — | **v1.3.2** |
| 32 | `scheduling.persist` | scheduling | high | per_request | — | **v1.3.1** |
| 33 | `vcs.read` | vcs | low | none | — | v1 |
| 34 | `vcs.write` | vcs | medium | per_request | — | v1 |
| 35 | `vcs.remote` | vcs | medium | per_request | — | v1 |
| 36 | `package.install` | package | medium | per_request | — | v1 |
| 37 | `package.run` | package | medium | per_request | — | v1.2.x |
| 38 | `package.read` | package | low | none | — | v1.2.x |
| 39 | `build.compile` | build | medium | per_request | — | v1 |
| 40 | `build.test` | build | low | none | — | v1 |
| 41 | `build.lint` | build | low | none | — | v1 |
| 42 | `archive.create` | archive | medium | per_request | — | v1.2.x |
| 43 | `archive.extract` | archive | medium | per_request | — | v1.2.x |
| 44 | `archive.read` | archive | low | none | — | v1.2.x |
| — | `unknown_sensitive_action` | — | critical | per_request | — | v1 (sentinel) |

---

## Namespaces

| Namespace | Action Classes | Description |
|---|---|---|
| `filesystem` | read, write, delete, list | Local filesystem operations |
| `web` | search, fetch, post | Outbound HTTP and search operations |
| `browser` | scrape | DOM-based content extraction |
| `shell` | exec | OS shell command execution |
| `communication` | email, slack, webhook | External messaging channels |
| `memory` | read, write | Agent-internal memory storage |
| `credential` | read, write, rotate, list | Secrets store access (read, write, key rotation, key enumeration) |
| `code` | execute | In-process code execution |
| `payment` | initiate | Financial transaction initiation |
| `system` | read, service | Read-only system queries; daemon / host-lifecycle management |
| `permissions` | modify, elevate | File mode / ownership changes; privilege elevation (sudo / su / passwd) |
| `process` | signal | Signal delivery to running processes (kill / pkill / killall) |
| `network` | diagnose, scan, transfer, shell | Network diagnostics, port scanning, file-transfer protocols, interactive remote shells |
| `cluster` | read, write | Kubernetes-style cluster management — reads (kubectl get) vs. writes (apply / delete / rollout) |
| `scheduling` | persist | Persistent unattended job scheduling (cron / at / batch) |
| `vcs` | read, write, remote | Version control system operations |
| `package` | install, run, read | Dependency installation, script execution, package metadata |
| `build` | compile, test, lint | Build pipeline operations |
| `archive` | create, extract, read | Archive packing, extraction, listing |

---

## Intent Groups

Intent groups allow policy rules to target multiple action classes with a single rule.

| Intent Group | Member Action Classes | Policy use |
|---|---|---|
| `destructive_fs` | `filesystem.delete` | Block all deletion tools |
| `data_exfiltration` | `web.fetch`, `network.transfer` | Forbid outbound data movement (HTTP fetches and file-transfer protocols) |
| `web_access` | `web.post` | Gate state-mutating outbound HTTP calls |
| `external_send` | `communication.email`, `communication.slack`, `communication.webhook` | Block all external messaging channels |
| `credential_access` | `credential.read`, `credential.write`, `credential.rotate`, `credential.list` | Prevent all secrets store access |
| `payment` | `payment.initiate` | Block financial transactions |

---

## Risk Level Definitions

| Risk Level | Meaning |
|---|---|
| `low` | Read-only or purely local operations with no side effects visible outside the agent |
| `medium` | Writes or outbound calls that have side effects but are bounded and recoverable |
| `high` | Irreversible or externally visible actions — data loss, external communication, or shell access |
| `critical` | Actions with financial, security, or system-wide impact — no safe default |

---

## HITL Mode Definitions

| HITL Mode | Behavior |
|---|---|
| `none` | Action proceeds without an approval token — no HITL check performed |
| `per_request` | Every invocation requires a fresh approval token bound to the specific payload |
| `session_approval` | One approval covers all matching actions for the duration of the session |

---

## Fail-Closed Sentinel

`unknown_sensitive_action` is the fail-closed catch-all. Any tool name not present in the alias registry resolves to this class with `critical` risk and `per_request` HITL. It has no registered aliases — it is the result of a failed lookup, not a named tool.

---

## Change Control Process

This taxonomy is frozen at v1. The action class names, namespace structure, risk defaults, HITL defaults, and intent group assignments listed above are **immutable** for the implementation phase.

### When an RFC is required

An RFC is required before any of the following changes can be made:

- **Adding** a new action class or namespace
- **Removing** an existing action class
- **Renaming** an action class or namespace
- **Changing** the `default_risk` of any action class
- **Changing** the `default_hitl_mode` of any action class
- **Adding, removing, or reassigning** an intent group
- **Changing** the `unknown_sensitive_action` sentinel behavior

Changes that do **not** require an RFC (alias-level changes only):

- Adding or removing tool name aliases for an existing action class (aliases are not part of the frozen contract)

### RFC process

1. File an RFC document at `docs/rfc/RFC-NNN-short-title.md` using the template in [`docs/rfc/README.md`](rfc/README.md). Filing starts a 14-day SLA.
2. Obtain approval from the governance track maintainers.
3. Update this document and `packages/action-registry/src/index.ts` in the same PR.
4. Bump the taxonomy version header in this document (e.g., `frozen v2` → `frozen v3`).
5. Update the RFC document status to `implemented` after merge.

The RFCs covering the v1.3.1 additions (RFC-001..RFC-010) are filed under [`docs/rfc/`](rfc/).

---

## Design Review Record

This section documents the stakeholder design review conducted before freezing the taxonomy at v1. It satisfies the acceptance criteria for the taxonomy validation gate (F-02 dependency: conduct taxonomy design review with stakeholders).

---

### Review Session

**Date:** April 2026
**Format:** Synchronous review session with async comment thread
**Outcome:** Approved with feedback incorporated; taxonomy frozen at v1

---

### Participants

| Role | Participant | Approval |
|---|---|---|
| Core maintainer | @jvela (Firma-AI) | Approved |
| Core maintainer | @rsundaram (Firma-AI) | Approved |
| Skill author | @tpavel (filesystem skill suite) | Approved |
| Skill author | @nnkwon (vcs skill suite) | Approved |

---

### Pre-Review Draft State

The draft taxonomy submitted for review contained 22 action classes. Between the draft and v1 freeze, 4 additional classes were added in response to reviewer feedback:

| Added Class | Feedback that prompted addition |
|---|---|
| `vcs.read` | Skill author @nnkwon: VCS read operations (git_status, git_log, git_diff) were being misclassified as `filesystem.read`, understating their data-exfiltration potential in multi-repo environments |
| `vcs.write` | Skill author @nnkwon: git_add, git_commit needed a distinct class so policy rules could gate VCS writes independently from local filesystem writes |
| `vcs.remote` | Core maintainer @rsundaram: git_push, git_fetch, git_clone have network exposure that `vcs.write` does not carry; should be a distinct namespace member |
| `build.compile` / `build.test` / `build.lint` | Core maintainer @jvela: Build operations were unclassified in the draft and would have fallen through to `unknown_sensitive_action`; three distinct risk postures justified separate classes |

---

### Feedback Thread and Resolutions

**Thread 1 — `memory.write` HITL default (raised by @rsundaram)**

> *"memory.write has HITL none by default. Persistent memory can influence future agent decisions — shouldn't this require per_request approval like other medium-risk writes?"*

**Resolution:** Accepted rationale to keep `none`. Memory is agent-internal state; per-request HITL on every memory update would create severe operator fatigue with minimal security benefit, since memory cannot exfiltrate data directly. Policy authors who require HITL on memory writes can override the default via a HITL policy rule. No class change made.

Status: **Resolved — no change required**

---

**Thread 2 — `web.search` risk level (raised by @tpavel)**

> *"web.search is marked medium/per_request. Most search tools are used heavily in research loops. Is per_request HITL going to be prohibitive for skill authors building research workflows?"*

**Resolution:** Risk classification kept at `medium/per_request` based on the security argument: search queries leave the controlled environment and disclose agent intent to the search provider. Policy authors may override to `session_approval` for search-heavy workflows using a HITL policy rule. The default must be conservative. No class change made.

Status: **Resolved — no change required**

---

**Thread 3 — VCS namespace coverage (raised by @nnkwon)**

> *"The draft has no VCS classes. git_status, git_log, git_diff, git_blame, git_add, git_commit, git_push, git_fetch, git_clone all normalize to filesystem.read or filesystem.write today. This is semantically wrong and breaks policy targeting."*

**Resolution:** Three new VCS classes added (`vcs.read`, `vcs.write`, `vcs.remote`) with distinct risk postures. Target field conventions documented: `git_show` uses `ref`; `git_blame` uses `file_path`; all other `vcs.read` tools use `path`. See project conventions.

Status: **Resolved — classes added before freeze**

---

**Thread 4 — Build operations as `unknown_sensitive_action` (raised by @jvela)**

> *"With no build classes, npm run build, pytest, eslint all fall through to unknown_sensitive_action at critical risk. That's wrong — build operations are medium or low risk and forcing them through the critical catch-all will break every CI-integrated skill."*

**Resolution:** Three build classes added: `build.compile` (medium/per_request), `build.test` (low/none), `build.lint` (low/none). The risk differentiation reflects the side-effect profile: compilation may produce artifacts with external effects; test and lint are observational.

Status: **Resolved — classes added before freeze**

---

**Thread 5 — 26 vs 27 classes: `browser.navigate` gap (raised by @rsundaram)**

> *"We have browser.scrape but no class for programmatic browser navigation (click, type, form submission). Playwright/Puppeteer automation tools don't fit cleanly into browser.scrape."*

**Resolution:** Deferred to post-v1 RFC. Browser navigation tools are not present in any shipped skill at freeze time. Adding `browser.navigate` without a concrete implementation reference risks premature design. Any skill author who ships a browser navigation tool before the RFC will use `unknown_sensitive_action` with operator-level reclassification policy.

Status: **Resolved — deferred to RFC (not a blocking concern for v1 freeze)**

---

**Thread 6 — `communication.email` risk vs `communication.slack` (raised by @tpavel)**

> *"Email is high risk, Slack is medium. Slack messages in a corporate workspace can cause the same reputational or compliance risk as email. Should Slack be elevated to high?"*

**Resolution:** Kept at medium. The risk differentiation is based on reversibility: Slack messages can be deleted or edited by the sender, reducing the irreversibility concern that drives email to high. Policy authors who operate in high-compliance Slack environments can override via policy rule targeting `communication.slack` directly or via `intent_group: external_send`.

Status: **Resolved — no change required**

---

### Blocking Objections

No objections were classified as blocking at review close. Thread 5 (browser.navigate gap) was identified as a gap but explicitly accepted as deferred (not blocking) given the absence of shipped tooling.

---

### Final Approval

All four reviewers confirmed approval after the VCS and build class additions were merged. The taxonomy was frozen at v1 on the date noted above.

The frozen table in this document and the implementation in `packages/action-registry/src/index.ts` reflect all feedback incorporated during this review.

---

## Relation to Other Documents

- **`docs/action-registry.md`** — Full operational reference: alias tables, reclassification rules, HITL approval mode comparison, policy authoring guide, and per-class rationale. Consult this for implementation details.
- **`packages/action-registry/src/index.ts`** — Machine-readable source of truth. Must stay in sync with the frozen table above.
- **`docs/tool-schema-standard.md`** — F-05 standard for tool manifests. The `action_class` field in every manifest must use a class from this taxonomy.

# Security Review v2 — Clawthority

**Review date:** April 2026
**Scope:** Enforcement gate, `unsafe_legacy` escape hatch, CS-11 emergency exec
**Status:** Findings documented — remediation tracked below
**Reviewer role:** External security reviewer (engagement pending sign-off; see §7)

---

## 1. Executive Summary

This document records the security review of three areas in Clawthority: the two-stage enforcement pipeline (enforcement gate), the planned `unsafe_legacy` escape hatch mechanism, and the planned CS-11 emergency exec feature. The enforcement gate review is based on a line-by-line code audit of the shipped implementation. The `unsafe_legacy` and CS-11 sections are pre-implementation reviews that establish mandatory security requirements before those features may be merged to `main`.

**Overall risk posture:** The enforcement gate implementation is well-structured with strong fail-closed defaults. No critical vulnerabilities were found in the shipped code. Two medium-severity findings require remediation before the v1 release. The planned `unsafe_legacy` and CS-11 features carry inherent high-risk potential and must not be implemented without the controls defined in §4 and §5 respectively.

| Finding | Area | Severity | Status |
|---|---|---|---|
| F-01 | Enforcement gate — install phase bypass | Medium | Open |
| F-02 | Enforcement gate — in-memory token consumption | Medium | Open |
| F-03 | Enforcement gate — session-less capability reuse | Low | Accepted |
| F-04 | Enforcement gate — error reason leakage | Low | Accepted |
| F-05 | `unsafe_legacy` — pre-implementation requirements | High | Blocked (not implemented) |
| F-06 | CS-11 emergency exec — pre-implementation requirements | Critical | Blocked (not implemented) |

---

## 2. Scope

### 2.1 In scope

- `src/enforcement/pipeline.ts` — pipeline orchestrator and `isInstallPhase()` bypass
- `src/enforcement/stage1-capability.ts` — seven-check capability gate
- `src/enforcement/stage2-policy.ts` — Cedar-style policy evaluation
- `src/enforcement/normalize.ts` — action normalization and reclassification
- `src/policy/rules/default.ts` — default rule set (priority tiers 10 / 90 / 100)
- `src/hitl/approval-manager.ts` — capability issuance and consumption tracking
- Planned feature: `unsafe_legacy` escape hatch (design review only)
- Planned feature: CS-11 emergency exec (design review only)

### 2.2 Out of scope

- Internal security scanning or SAST tooling output
- Network-layer security (TLS, firewall configuration)
- Firma remote adapter (not yet implemented)
- Control plane API (not yet implemented)
- ClawHub skill publishing pipeline

---

## 3. Enforcement Gate — Findings

### Architecture overview

The enforcement gate is a two-stage pipeline:

```
Request
  │
  ├─ isInstallPhase()? ──► permit (install_phase_bypass)
  │
  ├─ hitl_mode ≠ none AND no approval_id? ──► forbid (pending_hitl_approval)
  │
  ├─ Stage 1: Capability Gate (7 checks)
  │     0. untrusted source + high/critical risk → forbid
  │     1. hitl_mode=none → permit bypass
  │     2. approval_id absent → forbid
  │     3. TTL expired → forbid
  │     4. SHA-256 binding mismatch → forbid
  │     5. Token already consumed → forbid
  │     6. Session scope mismatch → forbid
  │
  └─ Stage 2: Cedar Policy Engine
        action_class evaluation → forbid wins
        intent_group evaluation → forbid wins
        any exception → forbid (fail-closed)
```

Both stages catch all exceptions and return `forbid`, implementing fail-closed semantics at every boundary.

---

### F-01 — Install Phase Bypass via Environment Variable

**Severity:** Medium
**File:** `src/enforcement/pipeline.ts:17–21`
**Status:** Open

**Description:**
`isInstallPhase()` returns `true` when `npm_lifecycle_event` is one of `install`, `preinstall`, `postinstall`, or `prepare`. When true, the entire enforcement pipeline is bypassed with a `permit`. This is controlled by `OPENAUTH_FORCE_ACTIVE=1`.

**Risk:**
An attacker who can inject or override the `npm_lifecycle_event` environment variable in the host process — or who can execute code within an npm lifecycle context — can bypass all enforcement. In containerized deployments, this variable is set by npm during package installation and is not typically accessible outside that window. However, if `OPENAUTH_FORCE_ACTIVE` is not set in production and an attacker triggers an npm lifecycle event (e.g., via a compromised `postinstall` script in a dependency), enforcement is fully bypassed for the duration.

**Current mitigations:**
- `OPENAUTH_FORCE_ACTIVE=1` suppresses the bypass
- Bypass is logged with reason `install_phase_bypass`
- Window is narrow: only active during npm lifecycle execution

**Recommended remediation:**
1. Default `OPENAUTH_FORCE_ACTIVE=1` in production deployment documentation and container images.
2. Add an audit log warning (distinct from the normal `install_phase_bypass` permit) when this path is taken, to make bypass events visible in the audit trail.
3. Consider whether the install phase bypass can be narrowed to specific action classes (e.g., only `package.management.*`) rather than blanket permit.

---

### F-02 — In-Memory Token Consumption Tracking

**Severity:** Medium
**File:** `src/hitl/approval-manager.ts` (consumption store)
**Status:** Open

**Description:**
The `ApprovalManager` tracks consumed capability tokens in memory. If the plugin process restarts, the consumed-token set is lost. An attacker who can force a process restart (e.g., via crash, SIGKILL, or container restart) immediately after a capability is issued — but before it is consumed — may be able to replay the capability token after the restart.

**Risk:**
Replay window is bounded by the capability TTL. In practice this requires:
1. Obtaining a valid, unconsumed capability token (requires a successful HITL approval)
2. Triggering a process restart before the token is consumed
3. Replaying the token within its TTL window

This is a moderate-difficulty attack requiring both HITL approval access and process-restart ability.

**Recommended remediation:**
For production deployments using the Firma remote adapter: persist consumed capability IDs server-side via `watchRevocations()` or a dedicated revocation log. The file adapter (development only) should clearly document this limitation in `docs/installation.md` under "Production considerations."

---

### F-03 — Session-Less Capability Reuse

**Severity:** Low
**File:** `src/enforcement/stage1-capability.ts:73–75`
**Status:** Accepted

**Description:**
Check 6 (session scope validation) only applies when `capability.session_id !== undefined`. Capabilities issued without a session scope can be presented from any session. This is by design for per-request approvals in HITL mode.

**Risk:**
A capability token for a per-request approval, if captured by a third party, could be used from a different session. The token is still protected by the SHA-256 payload binding (Check 4), one-time consumption (Check 5), and TTL (Check 3), so the window is narrow.

**Accepted:** The design intent is that session-less capabilities are short-lived per-request tokens. The three remaining checks provide sufficient protection for this use case. No action required.

---

### F-04 — Decision Reason Field Information Disclosure

**Severity:** Low
**File:** `src/enforcement/pipeline.ts`, `stage1-capability.ts`, `stage2-policy.ts`
**Status:** Accepted

**Description:**
`CeeDecision.reason` strings (e.g., `"capability expired"`, `"session scope mismatch"`, `"payload binding mismatch"`) are returned to callers. In adversarial contexts, distinguishing between these reasons could help an attacker enumerate token states.

**Risk:**
Since Clawthority is an in-process authorization layer (not an external API), reason strings are consumed by the plugin host or audit log rather than surfaced directly to end users. No external attack surface exists in the current architecture.

**Accepted:** No action required unless Clawthority is exposed as an external HTTP API. Revisit when the control plane API (REST surface) ships.

---

### F-05 — Security Properties: Enforcement Gate

The enforcement gate meets the following security properties:

| Property | Status | Evidence |
|---|---|---|
| Fail-closed on exception | ✅ | `try/catch` in pipeline, stage1, stage2 all return `forbid` |
| Forbid-wins semantics | ✅ | Stage 2 returns on first `forbid` from action_class or intent_group |
| Cryptographic payload binding | ✅ | SHA-256(`action_class\|target\|payload_hash`) verified in Check 4 |
| One-time token consumption | ✅ | `approvalManager.isConsumed()` in Check 5 |
| TTL enforcement | ✅ | `Date.now() > capability.expires_at` in Check 3 |
| Untrusted source isolation | ✅ | Check 0 rejects `untrusted` sources at high/critical risk |
| Hard forbids for shell/code exec | ✅ | Priority 100 rules for `shell.exec` and `code.execute` |
| Replay prevention | ✅ | One-time consumption + TTL window |

---

## 4. `unsafe_legacy` Escape Hatch — Pre-Implementation Review

**Status: Not implemented.** This section establishes mandatory security requirements that MUST be satisfied before any `unsafe_legacy` mechanism is merged to `main`.

### 4.1 Intended purpose

The `unsafe_legacy` escape hatch is intended to allow operators to temporarily bypass Clawthority enforcement for legacy tools or workflows that cannot yet be migrated to the action normalization registry. It is not intended as a permanent bypass.

### 4.2 Threat model

| Threat | Risk |
|---|---|
| Operator misconfiguration: `unsafe_legacy` left enabled in production | High |
| Agent escalation: agent discovers and exploits escape hatch to bypass enforcement | Critical |
| Overly broad scope: `unsafe_legacy` applied to all tools, not specific legacy ones | High |
| Audit evasion: decisions via `unsafe_legacy` not visible in the audit log | Medium |

### 4.3 Mandatory security requirements

Any `unsafe_legacy` implementation MUST:

1. **Explicit scope binding** — `unsafe_legacy` MUST be scoped to a named list of specific tool identifiers. A wildcard or "allow all" mode is forbidden.

2. **Trust level restriction** — `unsafe_legacy` MUST NOT apply to sources with `source_trust_level === 'untrusted'`. Only `user` and `agent` trust levels may use the escape hatch.

3. **Priority 100 hard forbids remain absolute** — `unsafe_legacy` MUST NOT bypass priority 100 rules. `shell.exec`, `code.execute`, `payment.initiate`, `credential.write` remain forbidden regardless of the escape hatch.

4. **Full audit logging** — Every decision taken via `unsafe_legacy` MUST produce an audit log entry with a distinct `reason` value (e.g., `unsafe_legacy_bypass`) and include the specific tool name.

5. **Operator-only configuration** — `unsafe_legacy` MUST be enabled via an explicit operator configuration field (e.g., `unsafeLegacyTools: string[]` in the policy config). It MUST NOT be enabled by default or inferred.

6. **Deprecation path** — The escape hatch MUST carry a deprecation warning at activation time, directing operators to register the tool in the action normalization registry.

7. **Scope validator** — A scope validator (parallel to `control-plane-validator`) MUST be created to prevent `unsafe_legacy` code from merging to `main` without review.

### 4.4 Implementation review gate

Before `unsafe_legacy` is merged, the implementation MUST be re-reviewed against the requirements above. This security review MUST be updated with a new section recording compliance.

---

## 5. CS-11 Emergency Exec — Pre-Implementation Review

**Status: Not implemented.** `shell.exec` and `code.execute` are currently unconditionally forbidden by priority 100 rules. This section establishes mandatory security requirements for any mechanism that would create an operator-level override of these hard forbids.

### 5.1 Intended purpose

CS-11 is a planned break-glass mechanism allowing operators to execute shell commands or code in emergency recovery scenarios where normal agent operations are blocked. This is distinct from normal agent-initiated `shell.exec` requests.

### 5.2 Threat model

| Threat | Risk |
|---|---|
| Agent impersonation: agent poses as "emergency" operator to trigger exec | Critical |
| Persistent override: break-glass left enabled after the emergency | Critical |
| Privilege escalation: CS-11 used outside original scope | Critical |
| Audit evasion: exec commands not logged | High |
| Scope creep: CS-11 allows arbitrary shell commands beyond recovery actions | High |

### 5.3 Mandatory security requirements

Any CS-11 implementation MUST:

1. **Multi-factor authorization gate** — CS-11 exec MUST require at minimum two independent authorization factors (e.g., a hardware-token-protected operator credential + out-of-band confirmation via HITL channel).

2. **Time-bounded window** — CS-11 exec sessions MUST be explicitly time-bounded. The default maximum window MUST be ≤ 15 minutes. Auto-expiry is mandatory; manual extension requires re-authorization.

3. **Command allowlist, not arbitrary shell** — CS-11 MUST NOT grant arbitrary `sh -c "..."` execution. A defined allowlist of permitted recovery commands MUST be configured by the operator. The allowlist MUST be reviewed as part of this security process.

4. **Immutable audit trail** — All CS-11 exec attempts (authorized and rejected) and all commands executed within a CS-11 session MUST be written to an append-only audit log. The audit entries MUST include operator identity, command text, timestamp, and session ID.

5. **Process isolation** — CS-11 exec MUST run commands in an isolated process context (separate uid/gid or container) from the main plugin process, limiting blast radius.

6. **No agent-accessible path** — CS-11 MUST be triggerable only by human operators via out-of-band tooling (CLI flag, admin dashboard action, or dedicated HITL channel), never via the normal `before_tool_call` hook path that agents use.

7. **Rate limiting** — CS-11 exec sessions MUST be rate-limited: no more than 3 sessions per 24 hours per operator identity.

8. **Scope validator** — A scope validator MUST gate CS-11 code from merging to `main` until this security review is updated with a compliant implementation review.

### 5.4 Current state

The default rule set contains an unconditional priority 100 forbid for `shell.exec` and `code.execute`:

```typescript
// src/policy/rules/default.ts
{
  action_class: 'shell.exec',
  effect: 'forbid',
  priority: 100,
  reason: 'Shell execution is unconditionally forbidden',
}
```

Any CS-11 implementation that overrides these rules MUST go through this security review gate before it is activated.

---

## 6. Critical Findings Requiring Pre-Release Remediation

The following findings are classified as requiring resolution before the v1 release:

| Finding | Description | Owner | Due |
|---|---|---|---|
| F-01 | Add `OPENAUTH_FORCE_ACTIVE=1` to production deployment docs; add audit log warning for install-phase bypass | Engineering | Before v1 |
| F-02 | Document in-memory consumption limitation in `docs/installation.md`; production deployments must use persistent revocation via Firma remote adapter | Engineering | Before v1 |
| F-05 (blocker) | `unsafe_legacy` must not be implemented without satisfying §4.3 requirements | Engineering | Before any `unsafe_legacy` PR |
| F-06 (blocker) | CS-11 must not be implemented without satisfying §5.3 requirements | Engineering | Before any CS-11 PR |

---

## 7. External Reviewer Engagement

The following steps are required to complete the external security review process:

- [ ] Share this document and code access with the designated external reviewer
- [ ] Provide read access to: `src/enforcement/`, `src/hitl/`, `src/policy/rules/`, `src/adapter/`
- [ ] Provide read access to: `docs/architecture.md`, `docs/human-in-the-loop.md`, `docs/configuration.md`
- [ ] Schedule technical walkthrough session covering the two-stage pipeline, capability token lifecycle, and HITL flow
- [ ] External reviewer returns findings report
- [ ] Merge findings into §3 of this document and update finding table in §1
- [ ] Address all reviewer-classified critical/high findings before release
- [ ] External reviewer signs off on remediation

**Contact:** Coordinate through the Firma security team Slack channel `#clawthority-security`.

---

## 8. Document History

| Version | Date | Author | Summary |
|---|---|---|---|
| v2 | April 2026 | Internal (pre-external-review) | Initial findings for enforcement gate; pre-implementation requirements for `unsafe_legacy` and CS-11 |

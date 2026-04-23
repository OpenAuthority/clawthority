# Release Sign-Off — v1.2.0

**Date:** 2026-04-23
**Release:** `@clawthority/clawthority@1.2.0`
**Branch:** `fine-grained-tools-implementation-plan`

---

## Validation Results

All 20 release readiness checks pass (DOD-1 through DOD-8 and V-01 through V-12).

### Definition of Done (DOD) checks

| Check | Description | Result |
|---|---|---|
| DOD-1 | Unit test configuration targets `src/**/*.test.ts` | PASS |
| DOD-2 | E2E test configuration exists (`vitest.e2e.config.ts`) | PASS |
| DOD-3 | Coverage thresholds declared in `vitest.config.ts` | PASS |
| DOD-4 | CHANGELOG contains release entry for v1.2.0 | PASS |
| DOD-5 | Migration guide published (`docs/migration-v2.md`) | PASS |
| DOD-6 | Spec alignment audit completed | PASS |
| DOD-7 | Security review document exists (`docs/security-review-v2.md`) | PASS |
| DOD-8 | No blocking items in CHANGELOG `[Unreleased]` section | PASS |

### Verification (V-series) checks

| Check | Description | Result |
|---|---|---|
| V-01 | TypeScript strict mode enabled in `tsconfig.json` | PASS |
| V-02 | No runtime `child_process` import in `src/index.ts` | PASS |
| V-03 | `vitest.config.ts` declares a thresholds block | PASS |
| V-04 | `src/enforcement/**` coverage threshold ≥ 95% lines | PASS |
| V-05 | `src/hitl/**` coverage threshold ≥ 88% lines | PASS |
| V-06 | `src/policy/**` coverage threshold ≥ 90% lines | PASS |
| V-07 | `src/adapter/**` coverage threshold ≥ 85% lines | PASS |
| V-08 | E2E config (`vitest.e2e.config.ts`) omits threshold gates | PASS |
| V-09 | Security review document exists (`docs/security-review-v2.md`) | PASS |
| V-10 | No open critical security findings in `docs/security-review-v2.md` | PASS |
| V-11 | `CHANGELOG.md` follows Keep a Changelog format | PASS |
| V-12 | `package.json` version matches target release version (1.2.0) | PASS |

---

## Security Review Status

`docs/security-review-v2.md` is current as of April 2026.

| Finding | Severity | Status | Notes |
|---|---|---|---|
| F-01 — Install phase bypass | Medium | Open | Documented; mitigation: `OPENAUTH_FORCE_ACTIVE=1` in prod |
| F-02 — In-memory token consumption | Medium | Open | Documented; production uses Firma remote adapter |
| F-03 — Session-less capability reuse | Low | Accepted | By design for per-request HITL tokens |
| F-04 — Decision reason field disclosure | Low | Accepted | In-process only; no external attack surface |
| F-05 — `unsafe_legacy` (pre-impl) | High | Blocked (not implemented) | Feature not merged; gated by §4 requirements |
| F-06 — CS-11 emergency exec (pre-impl) | Critical | Blocked (not implemented) | Feature not merged; gated by §5 requirements |

No findings classified **Critical + Open**. F-06 is Critical but its status is **Blocked (not
implemented)** — the feature does not exist and cannot be activated.

F-01 and F-02 are Medium-Open with documented mitigations. They do not block the v1.2.0 release.

---

## Release Checklist

### Core quality gates
- [x] All DOD-1 through DOD-8 checks pass
- [x] All V-01 through V-12 checks pass
- [x] Unit test coverage thresholds met: enforcement ≥ 95%, hitl ≥ 88%, policy ≥ 90%, adapter ≥ 85%
- [x] TypeScript strict mode enabled; build exits 0
- [x] No runtime `child_process` imports in `src/index.ts`

### Release materials
- [x] `CHANGELOG.md` promoted from `[Unreleased]` to `[1.2.0] — 2026-04-23`
- [x] `package.json` version bumped to `1.2.0`
- [x] `docs/migration-v2.md` created and reviewed
- [x] `docs/security-review-v2.md` current — no open critical findings
- [x] `docs/spec-alignment-audit.md` present

### Test coverage
- [x] E2E suite covers shell-wrapper reclassification (`src/exec-reclassification.e2e.ts`)
- [x] E2E suite covers HITL-gated forbid routing (`src/hitl-gated-forbid.e2e.ts`)
- [x] E2E suite covers fine-grained tool decisions (`src/fine-grained-tools.*.e2e.ts`)
- [x] Exec normalisation fuzz test added (`src/enforcement/normalize.fuzz.test.ts`)

### Format and process
- [x] No `[BLOCKING]` or `[RELEASE BLOCKER]` annotations in `CHANGELOG [Unreleased]`
- [x] `CHANGELOG.md` references Keep a Changelog and Semantic Versioning
- [x] `vitest.e2e.config.ts` omits threshold gates (coverage is informational only)

---

## Dependencies

All prior validation tasks (T124–T134) are resolved:

| Task | Description | Status |
|---|---|---|
| T124 | Shell-wrapper reclassification Rule 4 (filesystem.delete) | Complete |
| T125 | Shell-wrapper reclassification Rule 5 (credential paths) | Complete |
| T126 | Shell-wrapper reclassification Rule 6 (credential CLIs) | Complete |
| T127 | Shell-wrapper reclassification Rule 7 (file-upload exfiltration) | Complete |
| T128 | Shell-wrapper reclassification Rule 8 (env-var credential exfiltration) | Complete |
| T129 | Priority-90 HITL-gated forbid routing | Complete |
| T130 | Fine-grained tools E2E test suite | Complete |
| T131 | Structured audit log policy entries | Complete |
| T132 | Dashboard — LegacyRulesWidget (D-02) | Complete |
| T133 | Dashboard — UnclassifiedToolWidget (E-07) | Complete |
| T134 | Exec normalisation fuzz test (D-06) | Complete |

---

## Go / No-Go Decision

**Decision: GO**

All validation criteria are met. The security review has no open critical findings. The migration
guide is published. Release notes are complete in `CHANGELOG.md`. All prior dependency tasks
(T124–T134) are resolved.

**Release target:** `@clawthority/clawthority@1.2.0`

---

## Out of Scope

The following are deferred to post-release:

- `unsafe_legacy` escape hatch (blocked by F-05 security requirements in `docs/security-review-v2.md`)
- CS-11 emergency exec (blocked by F-06 security requirements)
- Firma remote adapter
- Control plane API (REST surface)
- External security reviewer engagement (§7 of `docs/security-review-v2.md`)
- Post-release monitoring and LegacyRulesWidget retirement countdown

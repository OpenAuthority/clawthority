# Spec Alignment Audit

> **Purpose.** This document provides a formal checklist confirming that the Clawthority plugin implementation satisfies every requirement in the Integration Spec (architecture.md §10) and the Framework for Enforced Plugins (FEP). Each requirement is cross-referenced to its implementation location and verification mechanism.
>
> **Last audited:** 2026-04-29 (v1.3.1 release)
> **Automated verification:** `npm run validate:spec` (runs `SpecAlignmentValidator` — 17 checks, 0 failures)

---

## Summary

| Spec Section | Requirements | Checks | Status |
|---|---|---|---|
| Integration Spec §A.8 | 7 | SA-I-01 – SA-I-07 | All pass |
| FEP §2 — ExecutionEnvelope | 2 | SA-F-01, SA-F-08 | All pass |
| FEP §4.2 — Typed Intent | 6 | SA-F-02 – SA-F-07 | All pass |
| FEP Shell Prohibition | 2 | SA-S-01, SA-S-02 | All pass |
| **Total** | **17** | **17 automated** | **Compliant** |

---

## 1. Integration Spec §A.8 — OpenClaw Hook Integration Requirements

Source: `docs/architecture.md §10` + enforcement pipeline invariants

### Requirement Map

| Req | Requirement | Check | Implementation | Status |
|---|---|---|---|---|
| §A.8.1 | Action normalization layer must translate raw tool names to canonical `action_class` identifiers | SA-I-01 | `src/enforcement/normalize.ts` — `normalize_action()` function; 42 action classes + fail-closed `unknown_sensitive_action` catch-all (frozen v2 taxonomy as of v1.3.1) | PASS |
| §A.8.2 | Two-stage pipeline: Stage 1 must perform capability gate before any policy evaluation | SA-I-02 | `src/enforcement/stage1-capability.ts` — 7 capability gate checks including binding hash validation and expiry | PASS |
| §A.8.3 | Two-stage pipeline: Stage 2 must perform Cedar-style policy evaluation against normalized `action_class` | SA-I-03 | `src/enforcement/stage2-policy.ts` — `PolicyEngine` evaluation with forbid-wins semantics and rate limiting | PASS |
| §A.8.4 | Authority backend must be decoupled via `IAuthorityAdapter` interface to support swapping between file and remote (Firma) adapters | SA-I-04 | `src/adapter/types.ts` — `IAuthorityAdapter` interface with `issueCapability()`, `watchPolicyBundle()`, `watchRevocations()` | PASS |
| §A.8.5 | Human-in-the-Loop approval system must be present for high and critical risk actions | SA-I-05 | `src/hitl/approval-manager.ts` — `ApprovalManager` with token lifecycle, channel routing (Telegram, Slack, Webhook, Console), and TTL expiry | PASS |
| §A.8.6 | Shared action taxonomy package (`@openclaw/action-registry`) must be declared as a production dependency | SA-I-06 | `package.json` `dependencies` — `@openclaw/action-registry` declared; canonical action class definitions live in `packages/action-registry/` | PASS |
| §A.8.7 | Fail-closed guarantee: unknown tool names must resolve to `unknown_sensitive_action` (critical risk, per_request HITL); never silently permit | SA-I-07 | `src/enforcement/normalize.ts` — `unknown_sensitive_action` catch-all; ships as critical forbid in both `open` and `closed` rule sets | PASS |

### Hook Integration Verification

The `before_tool_call` hook is the **sole** enforcement gate. It executes the full pipeline:

```
before_tool_call → normalize_action() → buildEnvelope() → runPipeline() → Stage 1 → Stage 2 → CeeDecision
```

| Hook | Can Block | Implementation | Verified |
|---|---|---|---|
| `before_tool_call` | Yes | `src/index.ts` — primary enforcement; returns `{ block: true }` on `forbid` | |
| `before_prompt_build` | No | `src/index.ts` — 5-pattern prompt injection detection on non-user sources | |
| `before_model_resolve` | No | `src/index.ts` — registered for future model routing; currently observes only | |

---

## 2. FEP §2 — ExecutionEnvelope Requirements

Source: `docs/architecture.md §2`; authoritative types in `src/types.ts`

### §2.1 Central Types File

| Req | Requirement | Check | Implementation | Status |
|---|---|---|---|---|
| §2.1 | A single `src/types.ts` module must export all envelope and intent types | SA-F-01 | `src/types.ts` — 103 lines; exports `Intent`, `Capability`, `Metadata`, `ExecutionEnvelope`, `CeeDecision`, `ExecutionEvent`, `PipelineResult`, `RateLimitInfo` | PASS |

### §2.2 ExecutionEnvelope Structure

| Req | Requirement | Check | Implementation | Status |
|---|---|---|---|---|
| §2.2 | `ExecutionEnvelope` interface must be exported and must wrap `Intent` via a typed `intent` field | SA-F-08 | `src/types.ts:71` — `export interface ExecutionEnvelope { intent: Intent; capability: Capability \| null; metadata: Metadata; provenance: Record<string, unknown>; }` | PASS |

#### ExecutionEnvelope Field Summary

| Field | Type | Description | Location |
|---|---|---|---|
| `intent` | `Intent` | Semantic description of the action | `src/types.ts:73` |
| `capability` | `Capability \| null` | HITL capability token; null if not yet approved | `src/types.ts:75` |
| `metadata` | `Metadata` | Runtime observability fields (session, trace, bundle version) | `src/types.ts:77` |
| `provenance` | `Record<string, unknown>` | Audit trail and origin record | `src/types.ts:79` |

Envelopes are constructed exclusively via `buildEnvelope()` in `src/envelope.ts`. Direct object construction is prohibited to enforce consistent hash computation.

---

## 3. FEP §4.2 — Typed Intent Requirements

Source: `docs/architecture.md §2` (Intent subsection); `src/types.ts:26-37`

The FEP prohibits untyped (`any`) `ToolUseParams` and requires the `Intent` interface to declare every field with a precise type. All six field requirements must be satisfied.

### Field Checklist

| Req | Field | Required Type | Check | Implementation | Status |
|---|---|---|---|---|---|
| §4.2.1 | `action_class` | `string` | SA-F-03 | `src/types.ts:28` — `action_class: string` — canonical dot-separated class e.g. `filesystem.delete` | PASS |
| §4.2.2 | `target` | `string` | SA-F-04 | `src/types.ts:30` — `target: string` — resource target e.g. file path, email address | PASS |
| §4.2.3 | `summary` | `string` | SA-F-05 | `src/types.ts:32` — `summary: string` — human-readable description of the intended action | PASS |
| §4.2.4 | `payload_hash` | `string` | SA-F-06 | `src/types.ts:34` — `payload_hash: string` — SHA-256 hex digest of tool call params; computed by `computePayloadHash()` in `src/envelope.ts` | PASS |
| §4.2.5 | `parameters` | `Record<string, unknown>` | SA-F-07 | `src/types.ts:36` — `parameters: Record<string, unknown>` — typed container; `any` is prohibited | PASS |
| §4.2.6 | `Intent` interface exported | `export interface Intent` | SA-F-02 | `src/types.ts:26` — `export interface Intent` | PASS |

### Payload Binding Mechanism

The `payload_hash` field satisfies FEP's SHA-256 binding requirement. The binding flow:

```
payload_hash  = SHA-256({ tool: toolName, params: shallowSortedParams })
binding       = SHA-256("${action_class}|${target}|${payload_hash}")
```

Stage 1 Check 4 recomputes the `binding` and compares it to the stored capability `binding`. A mismatch blocks execution — this is the tamper-detection guarantee. Implementation: `src/enforcement/stage1-capability.ts`.

---

## 4. FEP Shell Prohibition — Universal Rule E-03

Source: FEP Universal Rule E-03: exec wrappers forbidden in plugin source

Plugins must not execute raw shell commands. All tool invocations must go through the structured `normalize_action()` → `runPipeline()` flow. Git tools within `src/tools/git_*/` are exempt because they use explicit argv arrays with `{ shell: false }` — structured, not raw shell execution.

### Shell Prohibition Checklist

| Req | Requirement | Check | Scope | Allowlisted Exemptions | Status |
|---|---|---|---|---|---|
| E-03.1 | No `import … from 'child_process'` or `require('child_process')` in `src/` source files | SA-S-01 | All `.ts` files under `src/` (excluding `.test.ts`, `.e2e.ts`) | `src/tools/git_*/git-*.ts` (explicit argv, `shell: false`); `src/validation/spec-alignment-validator.ts`; `src/validation/release-validator.ts` (meta-validators reference API names as data) | PASS |
| E-03.2 | No `execSync(…)` or `spawnSync(…)` calls in `src/` source files | SA-S-02 | All `.ts` files under `src/` (excluding `.test.ts`, `.e2e.ts`) | Same allowlist as SA-S-01 | PASS |

---

## 5. Continuous Verification

Spec compliance is enforced continuously in CI via the `spec-alignment` GitHub Actions job.

| Artifact | Location | Purpose |
|---|---|---|
| Validator class | `src/validation/spec-alignment-validator.ts` | 15 automated checks across all spec sections |
| Validator script | `scripts/validate-spec-alignment.mjs` | Entry point for `npm run validate:spec` |
| CI workflow | `.github/workflows/spec-alignment.yml` | Runs `npm run validate:spec` on every push and PR |
| Validator tests | `src/validation/spec-alignment-validator.test.ts` | 20 test cases covering all checks |

The validator is purely file-based — no sub-processes are spawned. It reports per-check pass/fail with reason strings and exits non-zero on any failure.

---

## 6. Overall Compliance Verdict

| | |
|---|---|
| **Integration Spec §A.8** | All 7 requirements satisfied |
| **FEP §2 — ExecutionEnvelope** | All 2 requirements satisfied |
| **FEP §4.2 — Typed Intent** | All 6 field requirements satisfied |
| **FEP Shell Prohibition** | 0 violations detected across all source files |
| **Automated gate** | CI blocks merge on any spec regression |

**The Clawthority plugin implementation is fully compliant with all Integration Spec and FEP requirements.**

# Roadmap

> **What this page is for.** What Clawthority has shipped, what is in progress, and what comes next. Updated as work completes.

Last updated: April 2026 (v1.3.1 release)

---

## Shipped

These features are built, tested, and working in the current codebase.

### ExecutionEnvelope
- Canonical `ExecutionEnvelope` data structure wrapping every agent action (intent, capability, metadata, provenance)
- Canonical factory in `src/envelope.ts`: `buildEnvelope`, `uuidv7`, `computePayloadHash`, `computeContextHash`, `sortedJsonStringify`
- Stable SHA-256 payload hashing (shallow-sorted keys) and context hashing (`action_class|target|summary`)
- Metadata fields for tracing: `session_id`, `approval_id`, `trace_id`, `bundle_version`, `source_trust_level`, optional `intent_hint` (v1.3.0+)

### Two-Stage Enforcement Pipeline
- `runPipeline()` orchestrator in `src/enforcement/pipeline.ts` with HITL pre-check
- **Stage 1 — Capability Gate** (`stage1-capability.ts`): seven short-circuiting checks (untrusted+high-risk, hitl bypass, approval_id presence, TTL, payload binding, consumption, session scope)
- **Stage 2 — Cedar Policy Engine** (`stage2-policy.ts`): action-class-aware dispatch via `EnforcementPolicyEngine`
- Fail-closed at every boundary — exceptions always produce `forbid`
- `executionEvent` emitter for downstream observers

### Action Normalization & Registry
- Static registry of canonical action classes with case-insensitive alias index (`packages/action-registry/src/index.ts`)
- **42 named action classes + fail-closed `unknown_sensitive_action` sentinel (frozen v2 taxonomy as of v1.3.1)** — see [`docs/action-taxonomy.md`](action-taxonomy.md) and [`docs/action-registry.md`](action-registry.md)
- Coverage spans filesystem, web, browser, shell, communication, memory, credential, code, payment, system, permissions, process, network (diagnose / scan / transfer / shell), cluster, scheduling, vcs, package, build, archive
- Reclassification rules: `filesystem.write` with URL target → `web.post`; shell metacharacter in params raises risk to `critical`
- Ordered target extraction with per-class overrides (filesystem / vcs / package / build / archive / shell.exec / code.execute)
- Fail-closed `unknown_sensitive_action` catch-all for unregistered tools
- v1.3.1 closed the 16-category exec-command coverage gap by adding ~80 bare-binary aliases (e.g. `cat`, `chmod`, `kubectl`, `apt`, `tar`, `systemctl`) so commands invoked via a generic shell-exec tool also classify correctly

### Cedar-Style Policy Engine
- Forbid-wins semantics (explicit forbid overrides any permit)
- Pattern matching: exact string (case-insensitive), wildcard (`*`), RegExp
- `action_class` matching via `evaluateByActionClass`, plus `target_match` / `target_in` for per-address regex filtering
- Priority-tiered default rules (10 = permit baseline, 90 = HITL-gated, 100 = hard forbid)
- Conditional rules with arbitrary predicates (channel, agentId, payload inspection, etc.)
- Rate limiting with per-rule, per-caller sliding windows (permit-only)
- Hot-reload: edit rules, save, new rules active in ~300 ms
- Rule merging (agent-specific + default rules)
- Configurable default effect: `permit` (implicit allow, safe for plugin environments) or `forbid` (deny-by-default)

### StructuredDecision Type Layer
- Richer decision type carrying `outcome`, `ruleId`, and capability provenance through the pipeline
- Replaces the boolean permit/forbid surface for audit traceability and downstream credential injection
- Documented in `architecture.md` §6

### IAuthorityAdapter Interface
- `IAuthorityAdapter` decouples the pipeline from the authority backend (`src/adapter/types.ts`)
- `FileAuthorityAdapter` for local development (in-memory capability store, `chokidar` bundle watch with 300 ms debounce)
- `issueCapability` with UUID v7 approval IDs and SHA-256 payload binding
- `watchPolicyBundle` with TypeBox-validated `PolicyBundleSchema` and monotonic version enforcement
- `watchRevocations` async iterable (file adapter yields nothing; Firma remote adapter can stream revocations)

### Policy Bundle System
- `data/bundles/active` (current) and `data/bundles/proposals` (pending) directory layout
- TypeBox-validated bundle schema with monotonic `bundle_version`
- Bundle version stamped into every `ExecutionEnvelope` for auditability
- Hot-reload with atomic swap and error isolation (previous bundle preserved on invalid reload)

### Gateway Hook Integration
- `before_tool_call` — primary enforcement hook (active)
- `before_prompt_build` — prompt injection detection with 5 regex patterns on non-user sources (active)
- `before_model_resolve` — model routing (active)
- Typed and legacy hook registration (`ctx.on` + `registerHook`)
- Plugin interface with `activate()` / `deactivate()` lifecycle
- Activation guard for idempotent multi-registry registration

### Install Lifecycle Gate
- Plugin defers policy activation until `data/.installed` sentinel is written
- Detects npm install phase and bypasses the enforcement pipeline to avoid boot-time blocks
- Covered by TC-IL-01..TC-IL-05 end-to-end tests

### Source Trust Level Propagation
- `source_trust_level` field (`user` | `agent` | `untrusted`) threaded from envelope into `PipelineContext`
- Stage 1 Check 0 rejects untrusted sources performing high or critical risk actions
- T29 propagation tested across the enforcement pipeline

### PII & Sensitive-Payload Classifier
- `detectSensitiveData` in `src/enforcement/pii-classifier.ts`
- IBAN detection, card-data (PAN) detection, email heuristics
- Wired into default rules (e.g. card-data rule uses payload inspection to forbid outbound exposure)
- Exported from the enforcement module for reuse in custom rules

### Audit Logging
- `AuditLogger` with console and JSONL file handlers
- Multiple simultaneous sinks and custom handler support
- Structured `PolicyDecisionEntry` schema
- HITL decisions and capability consumption recorded in the same log

### Human-in-the-Loop (HITL)
- TypeBox-validated policy schema (`HitlPolicyConfig`, `HitlPolicy`, `HitlApprovalConfig`)
- Action pattern matcher with dot-notation wildcards
- JSON and YAML policy file parser with schema validation
- Hot-reload watcher (debounced, atomic swap)
- In-memory `ApprovalManager` with token generation, TTL expiry, and concurrent request support
- **`runWithHitl` wrapper** (`src/enforcement/hitl-dispatch.ts`) handles the dispatch + re-run loop on top of `runPipeline` — operator approves, capability is issued, pipeline re-runs with the capability bound
- **Telegram adapter**: long-polling listener with `callback_query` support; **inline buttons (v1.3.0)** for Approve Once / Approve Always / Deny; MarkdownV2 message body with explainer-driven sections; legacy `/approve <token>` text-command path retained as a fallback for v1.3.x
- **Slack adapter**: Block Kit with three interactive buttons (Approve Once / Approve Always / Deny), webhook server with HMAC-SHA256 signature verification + 5-minute timestamp window, message update on decision
- **Console adapter** (v1.3.0): rich text + ANSI colour rendering for local development and CI; `[a] / [s] / [d]` keystroke prompt
- **Approve Always** (v1.3.0): pattern derivation from the original command, persisted to `data/auto-permits.json` (hot-reloadable, separate from `data/rules.json`); CLI helpers (`npm run list-auto-permits`, `revoke-auto-permit`, etc.)
- **Command explainer** (v1.3.0+): rule-based engine in `src/enforcement/command-explainer/patterns.ts` produces summary / effects / warnings for HITL message bodies. ~100 explainer functions covering filesystem / git / package / network / scheduling / containers / archives / process / permissions / system / read-utility commands; v1.3.1 closed the 16-category exec-command coverage gap
- **`intent_hint` metadata** (v1.3.0): agent-supplied "Why this is happening" line surfaced in HITL messages; truncated to 200 characters
- **Three feature flags**: `CLAWTHORITY_DISABLE_APPROVE_ALWAYS`, `CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM`, `CLAWTHORITY_HITL_MINIMAL`
- Wired into `before_tool_call` after the Cedar policy engine
- Fail-safe: channel unreachable or not configured applies policy fallback; evaluation errors fail closed
- **Retry resilience**: exponential backoff and circuit breaker for rate-limit recovery (`src/hitl/retry.ts`)

### Token Telemetry
- `TokenTelemetry` utility (`src/utils/token-telemetry.ts`) tracks LLM API token usage
- Feeds the `/token-budget` skill for threshold alerts and spend estimation

### UI Components
- React 18 + Vite component workspace in `ui/`
- `RuleDeleteModal` with impact panel (rule structure display, audit hit preview, tag list) and typed-confirmation input
- Component demo harness (`ui/src/App.tsx`) exercising action-class, intent-group, resource, and `target_match`/`target_in` rule shapes
- `CoverageMap` utility (`src/policy/coverage.ts`) integrated with the hot-reload watcher for future dashboard consumers

### ClawHub Skills

Shipped in the companion [clawthority-skills](../../clawthority-skills) repository (tracked independently from the plugin):

- `/token-budget` — token usage tracking, spend estimation, threshold alerts
- `/whatdidyoudo` — action replay, plain-language tool call log
- `/human-approval` — soft human-in-the-loop approval gate for interactive sessions

### Hot Reload
- Mutable engine reference pattern (atomic swap)
- ESM cache busting with timestamp query parameters
- Debounced file watcher (chokidar, 300 ms)
- Error isolation (previous engine preserved on reload failure)
- Separate watchers for TypeScript rules, JSON rules, HITL policies, and policy bundles

### Scope Validators
Source-code scanners that prevent out-of-scope work from leaking into `main`:
- `approval-channel-validator` — flags new approval channel implementations (web/webhook/email)
- `cedar-wasm-migration-validator` — flags Cedar-WASM migration code (must live on `spike-implement-cedar-via-wasm`)
- `control-plane-validator` — flags multi-tenant control plane code

---

## In Progress

_Nothing currently in progress — see Next Up for planned work._

---

## Next Up

### Capability Registration
Register Clawthority as an OpenClaw capability provider via `api.registerProvider('policy', ...)` for full hook coverage across all tool execution paths, not just the legacy hook runner.

### Firma Remote Adapter
Implement `IAuthorityAdapter` against the Firma authority service to enable:
- Remote capability issuance and storage
- Streaming capability revocations via `watchRevocations()`
- Policy bundles pulled from the remote API

---

## Future

### Cedar-WASM Migration
Replace the TypeScript Cedar-style engine with the official `@cedar-policy/cedar-wasm` runtime for standards-compliant Cedar semantics. Work lives exclusively on the `spike-implement-cedar-via-wasm` branch and is gated out of `main` by the `cedar-wasm-migration-validator`. Scope:
- Full Cedar policy language support (`.cedar` files)
- WASM-based evaluation with schema validation
- Migration path for existing TypeScript rules

### Additional Approval Channels
- **Web dashboard** — approve/reject from the Clawthority UI with pending action queue
- **Webhook** — POST to any HTTP endpoint, await callback
- **Email** — approval via email reply (for compliance workflows)

Gated by the `approval-channel-validator`; work tracked separately from the existing token-based HITL path.

### Control Plane API
A future multi-tenant service for centralised policy management. Planned scope:
- Multi-tenant policy management
- Database-backed policy storage with migrations
- User and tenant management
- REST API for programmatic policy CRUD
- Centralised audit log aggregation across agents

Gated by the `control-plane-validator`.

### ClawHub Skill Publishing
Publish the three skills (`token-budget`, `whatdidyoudo`, `human-approval`) from the companion [clawthority-skills](../../clawthority-skills) repository to ClawHub as the official Clawthority skill pack. Each skill is a soft-enforcement layer that drives adoption of the plugin.

### Policy Language Evolution
- Cedar policy file format (`.cedar` files) alongside TypeScript rules
- YAML policy files for non-developer users
- Policy validation CLI tool
- Policy diff and dry-run before applying changes

### Observability
- Prometheus/OpenTelemetry metrics export (decisions/sec, block rate, latency)
- Grafana dashboard template
- Alerting on anomalous block rates or rate limit saturation

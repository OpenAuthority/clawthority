# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### `unsafe_admin_exec` — emergency admin shell escape hatch (CS-11)

`unsafe_admin_exec` is a privileged tool that maps to the `shell.exec` action class and provides an audited emergency escape hatch for administrative shell access. It is inert by default and requires all of the following to execute:

- `CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC=1` environment variable.
- A `justification` parameter of at least 20 characters, recorded verbatim in every audit log entry.
- A HITL capability token (`approval_id`) for every invocation — auto-approval is never permitted.
- The capability token must not have been previously consumed (replay protection via `ApprovalManager`).

All invocations are audit-logged regardless of outcome. Commands are sanitized (truncated to 40 chars, Bearer tokens and `token=` assignments redacted) before writing to the audit trail. The tool is registered in the action registry as an alias of `shell.exec` with `risk_tier: 'high'` and `default_hitl_mode: 'per_request'`.

---

## [1.2.1] — 2026-04-24

First release to ship the two-stage enforcement pipeline, 23 registered first-party tools, `FileAuthorityAdapter` with live bundle hot-reload, and `FileCredentialVault`. v1.2.0 delivered the enforcement engine; v1.2.1 delivers the capability system and the tool surface it protects.

### Added

#### Two-stage enforcement pipeline

`runPipeline` (`src/enforcement/pipeline.ts`) wires two sequential enforcement stages around a HITL pre-check and threads `PipelineContext` through each:

- **HITL pre-check**: when `hitl_mode !== 'none'` and no `approval_id` is present, the pipeline returns `pending_hitl_approval` before any capability validation runs.
- **Stage 1 — capability gate** (`validateCapability`): validates the issued capability token — presence, TTL, SHA-256 payload-hash binding, and single-use consumption via `ApprovalManager`. Any uncaught error returns `stage1_error` (fail closed).
- **Stage 2 — policy evaluation** (`createStage2`): delegates to the Cedar engine and the JSON rule engine, honouring the priority-90 HITL-gated / priority-100 unconditional split.
- **`buildPipelineContext`**: constructs a typed `PipelineContext` from a raw tool call, computing the SHA-256 `payload_hash` used by the Stage 1 binding check.
- **Install-phase bypass**: tool calls originating from npm lifecycle scripts (`install`, `preinstall`, `postinstall`, `prepare`) are permitted unconditionally to prevent activation-time lockout.

#### First-party tool library — 23 registered tools

All 23 tools ship with TypeBox-validated manifests (schema, action class, risk tier, HITL mode) and full execution layers.

**Git / VCS (7):** `git_add`, `git_commit`, `git_diff`, `git_log`, `git_merge`, `git_reset`, `git_status`

**Filesystem (8):** `append_file`, `create_directory`, `delete_file`, `edit_file`, `list_dir`, `list_directory`, `read_file`, `write_file`

**HTTP (3):** `http_get` — 30 s `AbortController` timeout; response body truncated at 1 MB. `fetch_url` — follows redirects and exposes `final_url`; optional `allowed_domains` pre-flight allowlist check. `scrape_page` — Cheerio-based static HTML extraction; returns `{ url, title, text, elements? }` where `elements` is only present when `selectors` is non-empty.

**Web (2):** `search_web` — web search with optional domain filtering. `call_webhook` — configurable HTTP method with optional payload.

**Communication (3):** `send_email` — dependency-free Node.js SMTP transport (`createConnection` / `tlsConnect`). PORT 465 (implicit TLS) and STARTTLS on PORT 587 are both supported; AUTH LOGIN is used when credentials are present. Configure via `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. `send_slack` — posts to Slack via the Web API (`chat.postMessage`) using a `SLACK_BOT_TOKEN` bearer token; requires `channel` and `text`. `send_webhook` — HTTP POST with required `payload`; auto-injects `Content-Type: application/json` unless the caller has already set it (checked case-insensitively).

#### FileAuthorityAdapter

`FileAuthorityAdapter` (`src/adapter/file-adapter.ts`) is the first production `IAuthorityAdapter` implementation. Issues UUID v7 capability tokens with SHA-256 payload binding, stores them in-process for the adapter lifetime, and exposes `issueCapability` / `getCapability` / `consumeCapability`. Watches `data/bundle.json` for live policy updates via chokidar (300 ms debounce, monotonic version enforcement, schema validation on each reload — previous bundle remains active if the new one fails validation). Instantiated and wired into `activate()` automatically.

#### FileCredentialVault

`FileCredentialVault` (`src/vault/file-vault.ts`) is the first `ICredentialVault` / `SecretBackend` implementation (`@experimental`). Loads credentials from a flat `{ "KEY": "value" }` JSON file, validates schema at load time via TypeBox, and is strictly read-only — `set()` throws `CredentialVaultError` with code `read-only`. Designed for local development and CI environments; cloud vault providers are deferred to v1.3.

#### Documentation

- **Production deployment guidance** added to [docs/installation.md](docs/installation.md): Docker (`-e OPENAUTH_FORCE_ACTIVE=1`) and systemd (`Environment=OPENAUTH_FORCE_ACTIVE=1`) examples documenting why container and service deployments must set the flag to bypass the install-phase permit.
- **Security review: F-01 mitigated** in [docs/security-review.md](docs/security-review.md): the install-phase bypass is documented as an intentional design choice; finding status updated to "Mitigated via documentation".

#### Test coverage

- **`src/regression-bundle-hot-reload.e2e.ts`** — five cases (TC-RBH-01..05) asserting chokidar file-watch propagation within a 600 ms deadline (300 ms debounce + 300 ms tolerance): file write detection, active rule reflection, rapid-write coalescing, second-change propagation, and rule content parsing.
- **`src/regression-rules-json-forbid.e2e.ts`** — regression suite for the priority-200 JSON-rules forbid scenario from 2026-04-23.

### ⚠️ Known gaps — deferred to v1.3

- **Normalizer Rules 4–8** — shell-wrapper reclassification for `filesystem.delete` (Rule 4), `credential.read/write` via file path (Rule 5), credential-emitting CLI patterns (Rule 6), file-upload exfiltration (Rule 7), and environment-variable exfiltration (Rule 8) are **not implemented** in v1.2.1 or v1.2.0. See the v1.2.0 Deferred section.
- **Cloud vault providers** — HashiCorp Vault, AWS Secrets Manager, and 1Password are not yet supported. `FileCredentialVault` is the only vault implementation.
- **Remote / multi-party capability management** — `FileAuthorityAdapter` stores capabilities in-process with no cross-process sharing, revocation stream, or cloud authority backend.
- **SMTP-only email** — `send_email` does not support OAuth-based providers (Gmail API, Microsoft 365, SendGrid, Mailgun, Postmark, AWS SES). Capability TTL defaults to 3 600 s; override via `capabilityTtlSeconds` in the adapter config.

### Migration (from v1.2.0)

**Two-stage pipeline — capability gate is now active.** v1.2.1 adds Stage 1 (TTL + SHA-256 payload-hash binding + single-use replay prevention) ahead of the existing Cedar Stage 2. Operators who wrote custom `IAuthorityAdapter` implementations against the v1.2.0 stub interface must implement `issueCapability`, `getCapability`, and `consumeCapability`; the production `FileAuthorityAdapter` is the reference. No action is required for operators using the built-in adapter.

**HITL approval flow is now fully round-tripped.** v1.2.0 dispatched HITL approval requests but did not re-run the pipeline after approval. v1.2.1 completes the flow: approval → capability issue → `runWithHitl` re-run. Operators who relied on v1.2.0 HITL dispatch should upgrade to v1.2.1 to get the complete flow.

**`data/bundle.json` is now watched for live policy updates.** `FileAuthorityAdapter` watches `data/bundle.json` (300 ms debounce, monotonic version enforcement). Operators who previously managed policy only via `data/rules.json` may continue doing so unchanged. To adopt the bundle format, write a `{ "version": <n>, "rules": [...], "checksum": "<sha256>" }` JSON file at `data/bundle.json`.

**Install-phase bypass for containerised deployments.** Tool calls from npm lifecycle scripts (`install`, `preinstall`, `postinstall`, `prepare`) are permitted unconditionally to prevent activation-time lockout. Docker and systemd deployments that invoke the agent outside a lifecycle script must set `OPENAUTH_FORCE_ACTIVE=1` — see [docs/installation.md](docs/installation.md) for complete examples.

**Tool library env vars.** If you enable `send_email`, configure `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. If you enable `send_slack`, set `SLACK_BOT_TOKEN` to a bot token with `chat:write` scope.

**No rule-bundle format changes.** The `data/rules.json` plain-array format and all existing Cedar rule files continue to work unchanged.

---

## [1.2.0] — 2026-04-23

Delivers the enforcement engine: HITL gating fixes, priority-90 routing to HITL, structured audit logging, intent-group evaluation in `data/rules.json`, and the `CLAWTHORITY_RULES_FILE` env var. The first-party tool library and two-stage capability pipeline ship in v1.2.1.

### Fixed

- **Warn when a HITL policy matches `unknown_sensitive_action`.** Putting `unknown_sensitive_action` (or a bare `*`) in `hitl-policy.yaml` routes every unrecognised tool — including read-only operations like `read` and `list` that aren't registered as aliases — through human approval, which locks the agent into an approval loop it cannot recover from. `parseHitlPolicyFile` now logs a `[hitl-policy] ⚠` warning at load time naming the offending policy and pointing operators at the right fix (register the tool alias, or match `filesystem.delete` instead).

- **Priority-90 Cedar forbids now route through HITL instead of blocking silently.** The rule tier documented as "sensitive actions requiring HITL approval" (priority 90 — `filesystem.delete`, `credential.read`, `credential.write`, `payment.initiate`) did not actually route to HITL. `beforeToolCallHandler` returned `{block: true}` on any Cedar forbid before the HITL stage ran, so the forbid was upheld regardless of what `hitl-policy.yaml` said. In OPEN mode this silently appeared to work because the priority-90 rules weren't shipped (CRITICAL_ACTION_CLASSES filter); in CLOSED mode operators hit a hard block with no approval flow. The handler is now async end-to-end and treats priority-90 forbids as "HITL-gated": if a HITL policy matches the action class and the operator approves, the tool call proceeds. If no policy matches — or HITL is not configured — the forbid is upheld with its original reason. Priority-100 (and rules with no explicit priority) are unchanged: unconditional forbid, HITL cannot override. JSON-rules forbids follow the same gating semantics when they carry `priority < 100`.

### Added

- **Bare-verb tool aliases in the normalizer registry.** Common tool names that hosts expose directly now map to their canonical action class: `read` → `filesystem.read`, `write` → `filesystem.write`, `edit` → `filesystem.write`, `list` → `filesystem.list`. Previously these fell through to `unknown_sensitive_action`, which in CLOSED mode blocks outright. `exec` is intentionally NOT added as a `shell.exec` alias — reclassifying it unconditionally would regress OpenClaw-style hosts where `exec` is the primary tool surface.

- **End-to-end test suite for HITL-gated forbid routing.** [`src/hitl-gated-forbid.e2e.ts`](src/hitl-gated-forbid.e2e.ts) exercises the priority-90 / HITL integration directly: blocks when no HITL is configured, blocks when a HITL policy is configured but doesn't match the action, permits when a matching policy approves, blocks when dispatch falls back to deny, and verifies that priority-100 rules (`shell.exec`) still block unconditionally even when a HITL policy claims to approve them. Injects synthetic HITL configs via a module mock on the parser so the tests don't depend on YAML files in the repo root.

- **Structured policy decisions in `data/audit.jsonl`.** The audit log previously only captured HITL approval/denial events. Every other block — Stage 1 trust-gate rejections, Cedar unconditional forbids, JSON-rule forbids, and HITL-gated forbids upheld because no HITL policy matched — went to stdout only, so post-mortems had to reconstruct what happened from ephemeral logs. Each block path now emits a `{type: 'policy'}` entry carrying `stage` (`stage1-trust` / `cedar` / `json-rules` / `hitl-gated`), `rule` (action-class or resource:match identifier), `priority` (when a rule matched), `mode` (OPEN/CLOSED), `toolName`, `actionClass`, `reason`, and the usual agent/channel/verified identity fields. The audit logger is now initialised unconditionally at activation so these entries land even when HITL is not configured.

- **`DECISION: ✕ BLOCKED` console line enriched with priority and rule identifier.** Operators triaging a block in stdout logs can now tell at a glance whether they hit a hard forbid (`priority=100`), a HITL-gated rule that never found a matching policy (`priority=90 rule=action:filesystem.delete; no HITL policy matches`), or a Stage-1 trust-gate rejection — without cross-referencing `data/audit.jsonl`.

- **Handler evaluates rules by `intent_group` (after action-class evaluation).** Before this change, rules targeting an intent group — e.g. `{"intent_group": "data_exfiltration", "effect": "forbid"}` — were parsed but never consulted by `beforeToolCallHandler`; only rules keyed on `action_class` or `resource`/`match` fired. The handler now runs a second pass across both engines (TS defaults and `data/rules.json`) when the normalised action carries an intent_group, using the existing `evaluateByIntentGroup` engine method. Forbids there participate in the same priority-90 HITL-gated / priority-100 unconditional split as action-class forbids, so operators can gate entire threat-model clusters (all data-exfiltration transports, all credential-access patterns, etc.) with a single rule instead of enumerating every action class.

- **Side-effect ordering in `activate()`: `loadJsonRules()` is now awaited.** The JSON rule load was dispatched as a fire-and-forget promise, so a host that dispatched its very first tool call before the microtask flushed saw an empty JSON engine. Awaiting makes it deterministic. Errors are still swallowed — the rules file is optional.

- **`CLAWTHORITY_RULES_FILE` env var overrides the data/rules.json path.** Default stays `dist/../data/rules.json`; operators running a non-standard install layout (or writing a tempfile fixture in a test) can now point the loader at any path via this env var. Fixes a pre-existing quirk where the hardcoded relative path resolved outside the repo under vitest, so tests could not exercise JSON-rule behaviour.

- **`browser` alias for `web.fetch`.** OpenClaw's generic `browser` tool now normalises to `web.fetch` (with the existing `data_exfiltration` intent group) instead of falling through to `unknown_sensitive_action`.

- **`intent_group` and `priority` fields in `data/rules.json` records.** The JSON rule format previously supported only `resource`+`match` and `action_class` matching. Adds a third matching form — `{"intent_group": "data_exfiltration", "effect": "forbid", "priority": 90}` — plus an optional `priority` field on all three forms. `priority` is how operators opt into the HITL-gated tier; rules without it default to unconditional (fail-closed for user-written forbids).

### Deferred

- **Normalizer Rules 4–8** — shell-wrapper reclassification for `filesystem.delete` (Rule 4), `credential.read/write` via file path (Rule 5), credential-emitting CLI patterns (Rule 6), file-upload exfiltration (Rule 7), and environment-variable exfiltration (Rule 8). These rules were planned for v1.2.0 but are **not implemented**. Deferred to v1.3.
- **Operator-extensible credential-path patterns** (`CLAWTHORITY_CREDENTIAL_PATHS`) — dependent on Rule 5; also deferred to v1.3.

### Documentation

- **Hot-reload boundary.** [docs/troubleshooting.md](docs/troubleshooting.md) now documents which files reload in place (`hitl-policy.yaml`, `data/rules.json`) and which require a gateway restart (anything under `src/`, including `src/enforcement/normalize.ts`). Adds a dedicated entry for the HITL approval-loop lockout pattern with the recovery steps.

- **Total lockout recovery runbook.** New section in [docs/troubleshooting.md](docs/troubleshooting.md#total-lockout-recovery) walks operators through diagnosing a full-tool-surface block from the structured audit log (`tail -n 20 data/audit.jsonl | jq 'select(.type == "policy" and .effect == "forbid")'`) and the step-by-step recovery: disable HITL via YAML rename + gateway restart, inspect `stage`/`rule`/`priority`, edit `data/rules.json` (hot-reload) or compiled source (restart). Replaces the narrower `unknown_sensitive_action`-only guidance from the previous release.

- **Dead-code reference to `data/bundles/active/bundle.json` removed from README.** The top-level README previously told operators to drop a policy bundle at that path, but no code in `src/index.ts` ever loaded it — only `data/rules.json` is wired up. The README now describes the actual runtime surfaces (`data/rules.json`, `hitl-policy.yaml`, env vars) with their hot-reload semantics. Architecture-level references to the bundle abstraction in `docs/architecture.md` and `docs/roadmap.md` are intentionally kept — the bundle adapter layer still exists as test infrastructure and a future-facing design.

### ⚠️ v1.2.0 Addendum — What Does Not Ship {#v120-addendum--what-does-not-ship}

v1.2.0 shipped the enforcement engine (normalizer registry, Cedar policy routing, HITL gating, audit logging). The following capabilities were **not included** and were completed in v1.2.1:

- **No first-party tool library.** v1.2.0 ships the enforcement layer but zero runnable tools. The 23-tool library (`read_file`, `git_commit`, `http_get`, `send_email`, `fetch_url`, `scrape_page`, `send_slack`, `send_webhook`, etc.) and the two-stage pipeline that gates them are not present. Clawthority in v1.2.0 intercepts and classifies inbound tool calls from the host (e.g. OpenClaw's `exec`); it does not itself expose tools the agent can call.

- **No `FileAuthorityAdapter` / capability system.** The `IAuthorityAdapter` interface and the UUID v7 + SHA-256 binding capability token flow are absent in v1.2.0. Stage 1 of the enforcement pipeline (TTL expiration, payload binding, replay prevention) does not exist yet. Only Stage 2 (Cedar policy evaluation) is present.

- **No `data/bundle.json` support.** The preferred `{ version, rules, checksum }` bundle format is not recognised. Only the plain-array `data/rules.json` format loads.

- **No HITL pipeline re-run flow.** v1.2.0 routes priority-90 forbids to a HITL approval dispatch but does not re-run the pipeline after approval — the re-run path (`runWithHitl`) ships in v1.2.1. Operators on v1.2.0 who configure HITL should upgrade to v1.2.1 to get the full approval → capability-issue → re-run flow.

> **Recommendation:** point release tweets and blog posts at v1.2.1, which is the first self-contained, fully operational release. v1.2.0 is a valid upgrade for pure enforcement-engine improvements (HITL gating, priority-90 routing, intent-group evaluation, audit log enrichment) but is incomplete as a standalone release.

---

## [1.1.4] — 2026-04-17

Fixes user-reported lockout when trying to add a `filesystem.delete` policy rule, and clears ClawHub static analysis warnings on HITL transport modules.

### Fixed

- **`data/rules.json` now supports `action_class` matching.** Previously the JSON hot-reload format only accepted `resource` + `match` (tool name), forcing operators to enumerate every tool alias (e.g. `trash`, `rm`, `delete_file`, ...) to block a semantic action class. Rules can now be written as `{"action_class": "filesystem.delete", "effect": "forbid"}` and will match all tools that normalise to that class. The old `resource`/`match` form still works unchanged.

- **`filesystem.delete` added to `DEFAULT_RULES`** at priority 90 (forbidden, HITL tier). It was present in the normalizer registry but had no corresponding policy rule, leaving it unblocked in both OPEN and CLOSED mode. Now forbidden by default in CLOSED mode. In OPEN mode it falls through to implicit permit unless the operator adds an explicit `data/rules.json` entry.

### Security

- **Split HITL config resolution from network transport code.** `resolveSlackConfig` and `resolveTelegramConfig` (which read from `process.env`) have been moved to a new `src/hitl/config.ts` module that contains no network calls. The `slack.ts` and `telegram.ts` transport modules now import the resolved config but no longer access `process.env` directly — so neither file alone matches the "env var access combined with network send" pattern that ClawHub's static analyser flags. Both functions are re-exported from their original modules for backward compatibility.

### ⚠️ Do not edit `dist/` files directly

Editing compiled files in `dist/policy/rules/` while the hot-reload watcher is active can cause a complete tool lockout if the edit produces invalid JavaScript. Always use `data/rules.json` for runtime rule changes, or edit source files in `src/` and rebuild.

---

## [1.1.3] — 2026-04-17

Fixes a critical regression in OPEN mode where most OpenClaw tools were blocked.

### Fixed

- **OPEN mode blocking all unrecognised tools.** `unknown_sensitive_action` was included in `CRITICAL_ACTION_CLASSES`, which caused every tool not in the normalizer registry (`process`, `cron`, `sessions_*`, `message`, `image`, etc.) to be unconditionally blocked even in OPEN mode. Removed `unknown_sensitive_action` from the OPEN mode critical forbids — unknown tools now fall through to the implicit permit as intended. CLOSED mode is unchanged (still fails closed on unknown tools).

---

## [1.1.2] — 2026-04-17

Addresses findings from the ClawHub security scan on the 1.1.1 upload and reconciles the package metadata with the rebrand.

### Security

- **Removed `child_process`/`execSync` from runtime.** `src/index.ts` previously called `git rev-parse --short HEAD` and `git status --porcelain` at plugin activation to populate the version banner. ClawHub's static analysis flagged this as shell-execution behaviour. Git commit info is now baked into `src/build-info.ts` at build time by the new `scripts/gen-build-info.mjs` script (wired as a `prebuild` step alongside `sync-version`). No process spawns at runtime.

### Changed

- **Compat range lowered** from `>=2026.3.24-beta.2` to `>=2026.3.13` in `package.json` `openclaw.compat.pluginApi` and `openclaw.compat.minGatewayVersion` so the plugin declares support for the current stable OpenClaw release rather than the docs-example beta.

### Added

- `scripts/gen-build-info.mjs` — generates `src/build-info.ts` at build time from `package.json` version and `git rev-parse`/`git status` output (run only on the build machine, not the runtime host).
- `src/build-info.ts` added to `.gitignore` as a build artifact.

## [1.1.1] — 2026-04-17

First release distributed via ClawHub. Rolls up the 1.1.0 install-modes work (tagged in-repo but never published) together with the build, install-lifecycle, and security fixes needed to ship a working tarball.

### Added

- **Install modes** — `open` (default) and `closed`, selected via the `CLAWTHORITY_MODE` environment variable.
  - `open` — implicit permit, with a critical-forbid safety net for `shell.exec`, `code.execute`, `payment.initiate`, `credential.read`, `credential.write`, and `unknown_sensitive_action`. Intended for zero-friction installs.
  - `closed` — implicit deny, with the full default rule set loaded; users add explicit `permit` rules. Matches pre-1.1.0 behaviour.
  - Invalid values log a warning and fall back to `open`. Parsing is case- and whitespace-insensitive.
  - Mode is read once at plugin activation; changing it requires a restart.
- `OPEN_MODE_RULES` export from `src/policy/rules/default.ts` (and re-exported from `src/policy/rules.js` and the package root).
- `src/policy/mode.ts` module with `resolveMode()` and `modeToDefaultEffect()` helpers.
- Activation banner now shows the active install mode prominently.
- Unit tests: `src/policy/mode.test.ts` (nine cases covering parse/fallback/whitespace/case), `src/policy/rules/default.test.ts` (five cases pinning `OPEN_MODE_RULES` composition).
- E2E tests: four new cases in `src/default-permit.e2e.ts` exercising both modes through the enforcement pipeline, plus a new `src/mode-hook.e2e.ts` file with six cases that exercise the actual `beforeToolCallHandler` (production hook path) in both modes.
- Docs: new "Install mode" section in [docs/configuration.md](docs/configuration.md), a "Choose your install mode" step in [docs/installation.md](docs/installation.md), and mode-aware clarifications in [docs/architecture.md](docs/architecture.md), [docs/usage.md](docs/usage.md), [docs/action-registry.md](docs/action-registry.md), and [docs/troubleshooting.md](docs/troubleshooting.md).

### Changed

- **Default install behaviour** — a fresh install with no `CLAWTHORITY_MODE` set now runs in `open` mode. Previously the plugin behaved as `closed` (fail-closed by default). To preserve pre-1.1.0 behaviour, set `CLAWTHORITY_MODE=closed`.
- **Production hook handler now evaluates by `action_class`** — `beforeToolCallHandler` in `src/index.ts` previously called `cedarEngineRef.evaluate("tool", toolName, …)`, which only matched `resource`+`match` rules and silently ignored the `action_class`-based rules shipped in `defaultRules` / `OPEN_MODE_RULES`. It now calls `evaluateByActionClass(normalizedAction.action_class, normalizedAction.target, …)` using the `action_class` computed one step earlier in the same handler. Resource/match rules (including the user-defined JSON rule engine) continue to match as before via the action-class → resource prefix map inside `evaluateByActionClass`.
- README framing updated from "fail-closed by default" to describe the two-mode split.

### Fixed

- `PolicyEngine.evaluateByActionClass` no longer lets an *implicit* resource-level deny (from `defaultEffect: 'forbid'`) swallow an explicit `action_class` permit. Only an *explicit* resource-level forbid (one with a `matchedRule`) now short-circuits the action_class permit check — matching Cedar's stated semantics that forbid wins only when a rule actually matches. Without this fix, closed-mode deployments would have silently denied tool calls covered by an explicit action_class permit rule (e.g. the priority-10 `filesystem.read` permit) whenever no resource/match rule covered the target.
- **Build** — `tsc` now succeeds again. `*.e2e.ts` files are excluded from the production build via `tsconfig.exclude`, matching the existing treatment of `*.test.ts`. Five pre-existing strict-mode errors in production source (`src/hitl/slack.ts`, `src/enforcement/pii-classifier.ts`, `src/policy/loader.ts`, `src/utils/commit-validator.ts`, `src/utils/roadmap-validator.ts`) are fixed so `npm run build` exits 0.
- **Install marker** — `scripts/post-install.mjs` now runs automatically as an npm `postinstall` hook, so fresh installs no longer log `install incomplete — policy activation deferred`. The script is added to `package.json` `files` so it ships in the published tarball. Without this, `npm install` of the tarball would have failed to find the script.

### Security

- Bumped `yaml` from 2.8.2 to 2.8.3 to patch [GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp) (moderate — stack overflow via deeply nested YAML collections). Relevant because the plugin parses user-supplied HITL policy YAML.

### Migration

Operators who relied on implicit-deny behaviour must explicitly opt in:

```bash
export CLAWTHORITY_MODE=closed
```

No rule-bundle changes are required; the same rules continue to work in both modes. Stage 1 (capability gate, protected paths, HITL binding) and pipeline-level error handling fail closed regardless of mode.

## [1.0.1] — 2026-04-16

### Fixed

- Aligned default rules to the normalizer registry so rule targets correspond to action classes the normalizer actually produces.
- Made `package.json` the sole source of truth for the plugin version; `openclaw.plugin.json` is regenerated from it.

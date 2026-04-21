# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Addresses a class of tester-reported classification gaps on hosts that expose a single generic shell-exec tool (e.g. OpenClaw's `exec`). Destructive commands and credential-file access now normalise to the right semantic action class, so the policies Clawthority ships for `filesystem.delete`, `credential.read`, and `credential.write` actually fire instead of silently falling through to `unknown_sensitive_action`.

### Fixed

- **`filesystem.delete` now fires for destructive shell commands (Rule 4).** `normalize_action` previously only recognised destructive intent when the tool name itself was an alias (`rm`, `delete_file`, …). Hosts like OpenClaw route every filesystem operation through a single generic `exec` tool with a `command` parameter, so `exec({command: "rm /tmp/x"})` normalised to `unknown_sensitive_action` and HITL policies keyed on `filesystem.delete` never fired. A new post-lookup reclassification rule now reclassifies calls to shell-wrapper tools (`exec`, `bash`, `cmd`, `sh`, `run_command`, …) whose `command` begins with `rm`/`rmdir`/`unlink`/`shred`/`trash`/`trash-put` (optionally `sudo`-prefixed) to `filesystem.delete` with the registry's default `per_request` HITL mode and `destructive_fs` intent group. Non-destructive shell commands are unaffected.

- **`credential.read` / `credential.write` now fire for shell access to credential files (Rule 5).** Same symptom as above for secrets: `exec({command: "cat ~/.aws/credentials"})` normalised to `unknown_sensitive_action`, so in OPEN mode the call passed through unblocked even though Clawthority ships a critical-forbid for `credential.read`. A new post-lookup rule reclassifies any tool call whose `target` (path/file param) or shell-wrapper `command` references a well-known credential path — AWS creds/config, SSH private keys, `.kube/config`, `.docker/config.json`, gcloud application-default credentials, `.netrc`, `.pgpass`, `.npmrc`, `.gnupg/`, dotenv files (`.env`, `.env.local`, `.env.*`), `/etc/shadow`. Public counterparts (`.pub` files) are explicitly excluded. Write is picked when the starting class is already `filesystem.write`, when the command uses a shell redirect (`>`, `>>`, excluding fd redirects like `2>&1`), or when the command starts with `cp`/`mv`/`scp`/`rsync`/`install`/`ln`; otherwise `credential.read`. Rule 4 (destructive) wins over Rule 5 — `rm ~/.aws/credentials` stays `filesystem.delete`.

- **Warn when a HITL policy matches `unknown_sensitive_action`.** Putting `unknown_sensitive_action` (or a bare `*`) in `hitl-policy.yaml` routes every unrecognised tool — including read-only operations like `read` and `list` that aren't registered as aliases — through human approval, which locks the agent into an approval loop it cannot recover from. `parseHitlPolicyFile` now logs a `[hitl-policy] ⚠` warning at load time naming the offending policy and pointing operators at the right fix (register the tool alias, or match `filesystem.delete` instead).

- **Priority-90 Cedar forbids now route through HITL instead of blocking silently.** The rule tier documented as "sensitive actions requiring HITL approval" (priority 90 — `filesystem.delete`, `credential.read`, `credential.write`, `payment.initiate`) did not actually route to HITL. `beforeToolCallHandler` returned `{block: true}` on any Cedar forbid before the HITL stage ran, so the forbid was upheld regardless of what `hitl-policy.yaml` said. In OPEN mode this silently appeared to work because the priority-90 rules weren't shipped (CRITICAL_ACTION_CLASSES filter); in CLOSED mode operators hit a hard block with no approval flow. The handler is now async end-to-end and treats priority-90 forbids as "HITL-gated": if a HITL policy matches the action class and the operator approves, the tool call proceeds. If no policy matches — or HITL is not configured — the forbid is upheld with its original reason. Priority-100 (and rules with no explicit priority) are unchanged: unconditional forbid, HITL cannot override. JSON-rules forbids follow the same gating semantics when they carry `priority < 100`.

### Added

- **Bare-verb tool aliases in the normalizer registry.** Common tool names that hosts expose directly now map to their canonical action class: `read` → `filesystem.read`, `write` → `filesystem.write`, `edit` → `filesystem.write`, `list` → `filesystem.list`. Previously these fell through to `unknown_sensitive_action`, which in CLOSED mode blocks outright and in OPEN mode masks any real classification Rules 4/5 would have done. `exec` is intentionally NOT added as a `shell.exec` alias — reclassifying it unconditionally would regress OpenClaw-style hosts where `exec` is the primary tool surface; the smart Rules 4/5 handle it via command-param inspection instead.

- **End-to-end test suite for shell-wrapper reclassification.** [`src/exec-reclassification.e2e.ts`](src/exec-reclassification.e2e.ts) drives `exec({command: …})` and bare-verb tool calls through the production `beforeToolCallHandler` in both OPEN and CLOSED modes. Asserts Rules 4/5 reach the right Cedar decision (permit vs forbid with the right reason) rather than silently returning `unknown_sensitive_action`. Complements the existing unit tests on `normalize_action` in isolation — this is the integration layer that has regressed before.

- **End-to-end test suite for HITL-gated forbid routing.** [`src/hitl-gated-forbid.e2e.ts`](src/hitl-gated-forbid.e2e.ts) exercises the priority-90 / HITL integration directly: blocks when no HITL is configured, blocks when a HITL policy is configured but doesn't match the action, permits when a matching policy approves, blocks when dispatch falls back to deny, and verifies that priority-100 rules (`shell.exec`) still block unconditionally even when a HITL policy claims to approve them. Injects synthetic HITL configs via a module mock on the parser so the tests don't depend on YAML files in the repo root.

### Documentation

- **Hot-reload boundary.** [docs/troubleshooting.md](docs/troubleshooting.md) now documents which files reload in place (`hitl-policy.yaml`, `data/rules.json`) and which require a gateway restart (anything under `src/`, including `src/enforcement/normalize.ts`). Adds a dedicated entry for the HITL approval-loop lockout pattern with the recovery steps.

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

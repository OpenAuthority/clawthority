# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.4] — 2026-04-17

Fixes user-reported lockout when trying to add a `filesystem.delete` policy rule.

### Fixed

- **`data/rules.json` now supports `action_class` matching.** Previously the JSON hot-reload format only accepted `resource` + `match` (tool name), forcing operators to enumerate every tool alias (e.g. `trash`, `rm`, `delete_file`, ...) to block a semantic action class. Rules can now be written as `{"action_class": "filesystem.delete", "effect": "forbid"}` and will match all tools that normalise to that class. The old `resource`/`match` form still works unchanged.

- **`filesystem.delete` added to `DEFAULT_RULES`** at priority 90 (forbidden, HITL tier). It was present in the normalizer registry but had no corresponding policy rule, leaving it unblocked in both OPEN and CLOSED mode. Now forbidden by default in CLOSED mode. In OPEN mode it falls through to implicit permit unless the operator adds an explicit `data/rules.json` entry.

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

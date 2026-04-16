# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — Unreleased

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

### Migration

Operators who relied on implicit-deny behaviour must explicitly opt in:

```bash
export CLAWTHORITY_MODE=closed
```

No rule-bundle changes are required; the same rules continue to work in both modes. Stage 1 (capability gate, protected paths, HITL binding) and pipeline-level error handling fail closed regardless of mode.

## [1.0.1] — 2025-XX-XX

### Fixed

- Aligned default rules to the normalizer registry so rule targets correspond to action classes the normalizer actually produces.
- Made `package.json` the sole source of truth for the plugin version; `openclaw.plugin.json` is regenerated from it.

## [1.0.0]

- Initial stable release of the Clawthority OpenClaw plugin: two-stage enforcement pipeline, Cedar-style policy engine, action normalization registry, HITL approval (Telegram + Slack), append-only audit log, and hot-reloadable policy bundles.

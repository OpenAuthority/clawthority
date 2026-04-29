# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.2] — 2026-04-29

Typed-tool depth release: closes the per-tool injection-surface gap that v1.3.1's breadth pass left open. v1.3.1 added registry aliases (Layer 1) and explainer patterns (Layer 2) so policy and HITL could *target* high-risk commands; v1.3.2 adds typed-tool wrappers (Layer 3) so agents that opt in get a structured execution path with no shell interpretation. Defense-in-depth on top of v1.3.1, not a replacement — the existing `bash`/`exec` path still works, the typed tools are additional.

### Added

#### 13 typed-tool wrappers for high-risk admin commands

Each wrapper invokes a single fixed external binary via `spawnSync` with an explicit argv array and `{ shell: false }`. Pre-flight validators reject shell metacharacters at the parameter level so a malicious value can never reach the binary, even in the absence of a shell.

| Tool | Action class | Notes |
|---|---|---|
| `systemctl_unit_action` | `system.service` | `unit` regex `^[a-zA-Z0-9._@-]+$`; `action` enum start/stop/restart/reload/enable/disable/mask/unmask/status/is-active/is-enabled |
| `reboot` | `system.service` | mandatory `confirm: true` structural barrier |
| `shutdown` | `system.service` | modes poweroff/reboot/cancel; tight schedule regex (`now`, `+<minutes>`, `HH:MM`); cancel forbids time |
| `chmod_path` | `permissions.modify` | numeric or symbolic mode; recursive flag |
| `chown_path` | `permissions.modify` | POSIX-portable user/group; numeric uid/gid; recursive flag |
| `kill_process` | `process.signal` | curated signal allowlist; default TERM (KILL must be explicit) |
| `pkill_pattern` | `process.signal` | curated regex metachars permitted; shell injection rejected |
| `kubectl_get` | `cluster.read` | only kubectl_* tool on the read class |
| `kubectl_apply` | `cluster.write` | manifest_path + optional namespace + dry_run |
| `kubectl_delete` | `cluster.write` | resource AND name required (no bulk-delete escape hatch) |
| `kubectl_rollout` | `cluster.write` | actions: status / restart / undo |
| `docker_push` | `cluster.write` | optional registry prefix; `--all-tags` mutually exclusive with tagged ref |
| `crontab_list` | `scheduling.persist` | read-only `crontab -l` |
| `crontab_install_from_file` | `scheduling.persist` | mandatory `replace_confirm: true`; replaces user's entire crontab |
| `crontab_remove` | `scheduling.persist` | `crontab -r [-u user]` |

(Total 15 tools across the 13 binaries — `kubectl_*` is four tools.)

Notably **not** wrapped: `crontab -e` (interactive editor — out of scope; use `unsafe_admin_exec`), `kubectl exec` / `kubectl port-forward` (long-running streams — deferred to v1.4), and any `permissions.elevate` binary (`sudo` / `su` / `passwd` / `doas`) — see below.

#### Default-forbid rule on `permissions.elevate`

`data/rules.json` ships a new forbid rule at priority 92 against `permissions.elevate`. v1.3.1 added the action class; v1.3.2 makes the block-by-default posture concrete. Operators who need privilege elevation either lower the rule's priority for their environment or use `unsafe_admin_exec` under the documented escape-hatch protocol. This resolves the open question §14.4 of the v1.3.2 release plan.

### Changed

#### `cluster.manage` split into `cluster.read` and `cluster.write` — taxonomy bumped v2 → v3

The single `cluster.manage` class added in v1.3.1 conflated read-heavy operator volume (`kubectl get`) with workload-scale destructive writes (`kubectl apply` / `delete` / `rollout`), producing HITL fatigue on reads and training rubber-stamping that weakened the gate for writes. RFC-003 splits the class:

- **`cluster.read`** (low / per_request) — bound by `kubectl_get` only. No bare-binary alias.
- **`cluster.write`** (high / per_request) — bound by `kubectl_apply` / `kubectl_delete` / `kubectl_rollout` / `docker_push` and the bare `kubectl` alias.

The bare `kubectl` alias maps to `cluster.write` because free-form `bash kubectl ...` cannot be parsed for read-vs-write at the alias level — the safer default is to assume write. The typed `kubectl_get` tool restores read precision.

**Migration:** Operators with rules targeting `cluster.manage` see them become inert. Rewrite as `cluster.write` for the equivalent "block kubectl writes" intent, or both classes for parity with the prior behaviour.

### Governance

- RFC-001..RFC-004 filed retroactively against the action classes the v1.3.2 typed tools bind to: `process.signal`, `permissions.modify`, `cluster.manage` → `cluster.read`/`cluster.write` split, `scheduling.persist`. Closes the v1.3.1 governance gap for these classes. Six other v1.3.1-era classes (`system.service`, `permissions.elevate`, `network.*`) remain pending RFC backfill — see [docs/rfc/README.md](docs/rfc/README.md).
- `docs/action-taxonomy.md` and `docs/action-registry.md` updated for the cluster split (v3 taxonomy header, renumbered table, namespace description).
- `SpecAlignmentValidator.CHILD_PROCESS_ALLOWLIST` extended for the 13 v1.3.2 typed-tool directories so each tool's `spawnSync(binary, argv, { shell: false })` call passes SA-S-01 / SA-S-02.

### Tests

- ~290 new unit tests across the 13 typed-tool directories (validators + manifest sanity + spawn integration where safe).
- 5 new E2E suites — `tools-systemctl.e2e.ts`, `tools-reboot-shutdown.e2e.ts`, `tools-permissions.e2e.ts`, `tools-process-signal.e2e.ts`, `tools-kubectl.e2e.ts` — exercising HITL → approve → permit → typed-tool pre-flight for each tool.

## [1.3.1] — 2026-04-29

Coverage release: closes the classification gap for the 16-category exec command audit. Every common shell command an agent can invoke now has either a registry alias (Layer 1) so policies and HITL gates can target it specifically, or an explainer pattern (Layer 2) so HITL approval messages explain what's about to run in plain English — and almost all have both.

The release is purely additive on top of v1.3.0's HITL UX engine. No new operator-facing UI; no new feature flags; no new env vars. The two-stage pipeline, capability binding, Cedar semantics, and audit log shape are unchanged.

### Added

#### 10 new action classes covering host operations, network operations, and access control

| Action class | Risk / HITL | Aliases |
|---|---|---|
| `system.service` | critical / per_request | `systemctl`, `service`, `init`, `reboot`, `shutdown`, `virsh` |
| `permissions.modify` | high / per_request | `chmod`, `chown`, `chgrp`, `umask` |
| `permissions.elevate` | critical / per_request | `sudo`, `su`, `doas`, `passwd` |
| `process.signal` | high / per_request | `kill`, `pkill`, `killall` |
| `network.diagnose` | low / none | `ping`, `traceroute`, `nslookup`, `dig`, `netstat`, `ss` |
| `network.scan` | high / per_request | `nmap` |
| `network.transfer` | high / per_request (`intent_group: data_exfiltration`) | `rsync`, `scp`, `sftp` |
| `network.shell` | high / per_request | `ssh`, `mosh`, `telnet` |
| `cluster.manage` | high / per_request | `kubectl` |
| `scheduling.persist` | high / per_request | `crontab`, `at`, `batch`, `atq`, `atrm` |

`network.transfer` joins `web.fetch` and `web.post` under the `data_exfiltration` intent group so a single rule can target the entire data-leaving-the-host cluster. `permissions.elevate` is documented in [docs/release-plans/v1.3.2.md](docs/release-plans/v1.3.2.md) §2.2 as a target for default-forbid policy in v1.3.2 — v1.3.1 only classifies; the policy default ships next.

#### Bare-binary aliases on existing classes

The original action registry mostly used tool-name forms (`read_file`, `git_log`, `npm_install`). v1.3.1 adds the bare-binary equivalents so commands invoked through a generic `bash`/`exec` tool also classify correctly:

- `filesystem.read`: `cat`, `head`, `tail`, `less`, `more`, `diff`, `find`, `locate`
- `filesystem.list`: `tree` (`ls` was already aliased)
- `filesystem.write`: `tee`, `touch`, `install`
- `system.read`: `ps`, `top`, `htop`, `df`, `du`, `free`, `hostname`, `uptime`, `lsof`, `id`, `whoami`, `echo`, `printf`
- `archive.create`: `tar`, `zip`, `xz`, `7z`
- `archive.extract`: `unxz`
- `package.install`: `apt`, `apt-get`, `yum`, `dnf`, `dpkg`, `snap`, `brew`, `pacman`
- `code.execute`: `docker` (the bare binary; `docker_run` was already aliased)

#### Command explainer patterns — ~50 new functions

Every alias added in this release has a matching explainer entry that produces a human-readable summary, structured effects, and warnings for the HITL message body. Highlights:

- **Service / power**: `systemctl` dispatches by subcommand (`start`/`stop`/`restart`/`reload`/`enable`/`disable`/`mask`/`unmask`/`daemon-reload`/`status`/`reboot`/`poweroff`/`halt`/`kexec`/`suspend`/`hibernate`); `shutdown -r` vs `-h` vs `-c`; `init 0`/`init 6`/`init 1`/`init S` runlevel awareness.
- **Permissions**: `chmod` / `chown` recursive + system-path warnings; `sudo -u` / `su -c` / `passwd <user>` target detection.
- **Process signals**: signal-flag parsing handles bundled forms (`-9`, `-KILL`, `-s KILL`, `--signal=KILL`); PID 1 + broadcast `-1` warnings; SIGHUP recognised as a config reload.
- **Network**: `dig`/`nslookup` flag internal-name leakage when querying `*.corp`/`*.internal`/RFC1918 against an external resolver; `nmap` always-on IDS / AUP warnings plus per-flag warnings for `-sS` / `-sU` / `-O` / `-A` / `--script`.
- **Transfers**: `rsync` / `scp` / `sftp` flag remote endpoints (`user@host:path`, `host:path`, `rsync://`, `sftp://`); direction-aware "uploading" vs "pulling" warnings.
- **Cluster**: `kubectl apply` / `delete` / `get` / `describe` / `logs` / `exec` (incl. `-it` interactive warning) / `port-forward` (long-running tunnel warning) / `rollout` / `scale`. Namespace flag (`-n` / `--namespace=`) propagates into every applicable summary.
- **Scheduling**: `crontab -r` destructive-removal warning; `crontab <file>` install-replaces-everything warning; `at`/`atrm` job-cancellation persistence warning.
- **Archives**: `tar` mode-flag dispatch (short bundles `czf`/`xzf`/`tf`, dashed `-czf`, long-form `--create`/`--extract`/`--list`); `unzip` / `tar -x` / `7z x` always-on path-traversal + decompression-bomb warnings.
- **Read utilities**: `tail -f` / `top` / `htop` / `less` / `more` long-running interactive warnings; `find -delete` / `find -exec` flag warnings; `mv` to `/dev/null` / `/dev/zero` / `/tmp/trash/...` / `~/.Trash/...` flagged as effective deletion.
- **Sessions**: `mosh` long-running session warning; `telnet` plaintext-credential warning.

#### Docker subcommand coverage

Extended `dockerExplain` dispatch to cover `docker push` (image-upload warning — secrets baked into the image become visible to anyone with registry read access; `--all-tags` warning) and `docker ps` (running vs `-a` all containers, read-only).

### Tests

~1,200 new unit tests across [src/enforcement/normalize.test.ts](src/enforcement/normalize.test.ts) and [src/enforcement/command-explainer/patterns.test.ts](src/enforcement/command-explainer/patterns.test.ts) (TC-CE-100 through TC-CE-291). The test count grew from 4070 in v1.3.0 to **4661**, all passing alongside the existing 470 E2E and 17/17 spec-alignment checks.

### Documentation

- `docs/action-taxonomy.md` — bumped from `frozen v1` to `frozen v2` with the 10 new action classes and the `network.shell` and `data_exfiltration`-bridging intent groups.
- `docs/release-plans/v1.3.2.md` — typed-tool depth plan for the high-risk classes from this release (filed earlier; v1.3.2 is the next release).
- 10 retroactive RFCs filed under `docs/rfc/` (RFC-001..RFC-010, all `status: implemented`) covering each new action class per the taxonomy governance process.

### Migration (from v1.3.0)

**Operator policies that targeted `unknown_sensitive_action` to catch unrecognised commands now match fewer commands.** v1.3.1 adds direct classifications for ~80 commands that previously fell through to the catch-all. If you wrote a rule like:

```json
{ "action_class": "unknown_sensitive_action", "effect": "forbid" }
```

…to gate `apt` / `ps` / `docker` / `systemctl` / etc., those calls now route to their specific action classes (`package.install` / `system.read` / `code.execute` / `system.service`). Replace the catch-all rule with explicit targets:

```json
{ "action_class": "system.service", "effect": "forbid" }
{ "action_class": "permissions.elevate", "effect": "forbid" }
```

**HITL approval volume may increase for some workflows.** Commands that previously fell through to OPEN-mode implicit-permit now classify into HITL-gated tiers — `apt install` → `package.install` (per_request), `kubectl apply` → `cluster.manage` (per_request), `systemctl restart nginx` → `system.service` (per_request). Operators who rely on these in automation should configure permit policies for the relevant agents/channels.

**No env-var changes; no rule-file format changes; no policy-bundle format changes.** The two-stage pipeline, capability binding semantics, Cedar forbid-wins, priority tiers (90 = HITL-gated, 100 = unconditional), hot-reload, and audit log shape are all identical to v1.3.0.

**Rollback.** Revert the v1.3.1 PR; v1.3.0 keeps every command that was working in v1.3.0 working — the v1.3.1 work is purely additive.

### Known gaps — deferred to v1.3.2 / v1.4

- **Typed-tool wrappers** for the high-risk classes from this release (`system.service`, `permissions.modify`, `process.signal`, `cluster.manage`, `scheduling.persist`) — v1.3.2 (see release plan).
- **Default-forbid policy** on `permissions.elevate` (sudo / su / passwd) — v1.3.2.
- **`nohup`, `vagrant`, `aws s3 cp`** — deliberately not classified. nohup is a long-running-process detachment primitive; vagrant is low-volume; aws is a heterogeneous CLI that needs its own classification pass. All three remain `unknown_sensitive_action`.
- **Long-running / streaming commands** (`kubectl exec -it`, `kubectl port-forward`, `tail -f`, `tee` to a long stream) — explainer warns about long-running semantics but the enforcement model still treats them as one-shot. Proper streaming support is the v1.4 RFC topic.

---

## [1.3.0] — 2026-04-28

Headline release: **HITL becomes the primary control surface, not the failure mode.** Operators approve or deny tool calls with a single button tap on Telegram (no more `/approve <token>` typing); recurring commands can be saved as auto-permits with one click; approval messages are written for humans, not for compilers.

### Added

#### Telegram inline buttons for HITL approvals (W1)

`sendApprovalRequest` now sends a MarkdownV2-formatted message with an `inline_keyboard` carrying three buttons — `Approve once`, `Approve always`, `Deny` — instead of asking the operator to type `/approve <token>`. `callback_data` uses a `<verb>:<token>` form (`approve_once:<uuidv7>`, `approve_always:<uuidv7>`, `deny:<uuidv7>`) which fits the 64-byte Telegram limit.

`TelegramListener` was extended to dispatch `callback_query` updates alongside the existing long-poll loop. Each click triggers `answerCallbackQuery` (acknowledgement + replay-protected "Already decided" toast on second tap) and `editMessageText` to replace the buttons with a confirmation footer. The legacy `/approve <token>` text command is kept for one release with a deprecation hint per use; remove planned for v1.4.

#### Approve Always — session-scoped auto-permits (W2)

Tapping derives a permit pattern from the current command and offers it back to the operator in a confirmation message (`Pattern: docker run * ubuntu *` with `[Save] [Cancel]` buttons; auto-confirm available via `CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM=1`). On Save, the rule is appended to `data/auto-permits.json` (`{ version, rules, checksum, generated, created_by, created_at, derived_from }`), hot-reloaded via chokidar, and merged into the JSON rules engine. Future matching calls bypass HITL entirely with a `stage: 'auto-permit'` permit decision.

Pattern derivation (`src/auto-permits/pattern-derivation.ts`) uses two methods:
- **`tool` method:** registered tool name → pattern is the tool name itself.
- **`default` method:** for `unknown_sensitive_action` / `shell.exec`, tokenises the command, drops flags, retains binary + first positional argument as `binary * positional *`.

Refusal cases (fall back to Approve Once):
- Shell metacharacters (`;`, `|`, `&&`, `>`, `<`, backticks, `$`) — derivation is unsafe.
- Patterns longer than 200 chars after derivation.
- Patterns deriving to bare wildcards or empty strings.

#### CLI helpers for auto-permit management (W2)

- `npm run list-auto-permits` — pretty-prints all rules with origin metadata.
- `npm run show-auto-permit <pattern>` — full rule detail by pattern or index.
- `npm run validate-auto-permits` — validates schema + checksum integrity.
- `npm run test-auto-permit <command>` — dry-run match without executing.
- `npm run remove-auto-permit <index>` — removes by index, bumps version.
- `npm run revoke-auto-permit <pattern>` — revoke by pattern.

#### Command explainer — plain-language HITL message bodies (W3)

`src/enforcement/command-explainer/patterns.ts` ships 21 rule entries returning a `CommandExplanation { summary, effects[], warnings[], inferred_action_class }`. Coverage:
- Containers: `docker run`, `docker build`, `docker exec` (detectors for `-v /:/host`, `--privileged`, `bash -c`, AWS credential mounts).
- Package managers: `npm install`, `npm run`, `npm test`, `pip install`, `pytest`.
- Build systems: `make`, `cargo build/test`, `go build`.
- Linters/formatters: `eslint`, `prettier`.
- VCS: `git commit`, `git push`, `git pull`.
- Network/filesystem: `curl`, `wget`, `rm`, `cp`, `mv`, `cat`, `find`, `grep`.
- Catch-all: "Runs a shell command" with the raw command in `effects[0]`.

The explainer is **metadata-only** — it never touches `src/policy/`. Output flows into HITL message bodies and audit log entries (`inferredActionClass` field).

#### Rich HITL message templates on all three channels (W4)

Telegram (MarkdownV2), Slack (Block Kit), and console fallback (`src/hitl/console.ts`) now render the same semantic content:
- Agent / Tool / Risk / Expires-in header.
- "What will run" — raw command, truncated at 500 chars with elision hint pointing at `data/audit.jsonl`.
- "What this does" — explainer effects (omitted when empty).
- "Warnings" — explainer warnings prefixed with (omitted when empty).
- "Why this is happening" — agent-supplied intent (omitted when empty).
- Inline keyboard / Block Kit buttons (Once / Always / Deny).

#### `intent_hint` metadata for agent-supplied rationale (W5)

`beforeToolCallHandler` reads `ctx.metadata.intent_hint` (string, max 500 chars input, truncated to 199 + ellipsis at render time) and pipes it through `dispatchHitlChannel` to all three channel adapters. Opt-in for the agent — when absent, the "Why this is happening" section is omitted entirely.

#### Recommended-default bootstrap — CLOSED + HITL preset (W6)

`scripts/post-install.mjs` now writes a starter `data/rules.json` (only when absent) with `{ effect: 'forbid', action_class: 'unknown_sensitive_action', priority: 90, reason: 'Unknown tools require human approval' }` plus a baseline `hitl-policy.yaml` with an `unknown-tools-gate` policy. README quickstart leads with CLOSED+HITL as the recommended setup; OPEN is documented as the "I know what I'm doing" mode.

When the plugin activates in OPEN mode and finds no permit/HITL coverage on `unknown_sensitive_action`, it logs an info-level recommendation pointing at the bootstrap docs.

#### Top-6 typed tools — `npm_install`, `npm_run`, `pip_install`, `pytest`, `docker_run`, `make_run` (W7)

Six high-volume tools now ship as first-class typed tools instead of going through `unknown_sensitive_action`/`shell.exec`. Each provides:
- TypeBox-validated manifest with action_class (`package.install`, `package.run`, `build.test`).
- `spawnSync` with explicit argv (no shell interpretation; allowlisted in spec-alignment).
- Per-tool error types and exit-code propagation.
- Full unit test coverage.

Reduces HITL volume on the most common cases by 5–10× (per pre-release tester audit). Remaining cases route through the new HITL UX.

#### Feature flags — graceful degradation (§16 rollback layer)

- `CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1` — hides the button on all channels and refuses new auto-permit creation. Existing rules still match.
- `CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM=1` — skip the Save/Cancel confirmation step.
- `CLAWTHORITY_HITL_MINIMAL=1` — falls back to the v1.2.x message body (raw command only, no effects/warnings/intent-hint sections). Buttons + Approve Always continue to work.

#### Test coverage

- **`src/hitl-telegram-buttons.e2e.ts`** (TC-TG-BTN-01..09) — full Telegram button workflow including Approve Always confirmation flow and `editMessageText` after each decision.
- **`src/approve-always.e2e.ts`** (TC-AA-E2E-01..06) — end-to-end Approve Always: HITL → button tap → pattern derivation → file persist → next matching call bypasses HITL.
- **`src/hitl/command-explainer-audit-integration.test.ts`** (TC-CEA-01..06) — explainer output reaches the audit log without bleeding into enforcement.
- **`src/recommended-defaults.e2e.ts`** (TC-RD-01..06) — fresh install produces a HITL prompt on first `exec` call (not silent permit, not silent block).
- New `src/regression-hitl-comprehensive.e2e.ts` covering all three button outcomes per channel.

### Migration (from v1.2.x)

**Telegram approval is now button-driven.** The legacy `/approve <token>` and `/deny <token>` text commands continue to work for v1.3.x with a deprecation hint logged on each use. Operators should migrate to the inline buttons; text-command support is scheduled for removal in v1.4.0. No action required for the migration itself — buttons are shown automatically.

**`data/auto-permits.json` is a new optional file.** When operators tap Approve Always, derived patterns are appended here. The file is human-readable and managed via `npm run list-auto-permits` / `npm run revoke-auto-permit`. Operators who prefer the v1.2.x flow (no auto-permits) can set `CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1` — the button is hidden on all channels.

**Fresh installs now bootstrap with CLOSED + HITL.** `scripts/post-install.mjs` writes a starter `data/rules.json` and `hitl-policy.yaml` only when those files are absent. Upgraders from v1.2.x are unaffected — existing config is never overwritten. To opt in to the new bootstrap on an existing install, delete the two files and run `npm run plugin:install`.

**Six new tools take precedence over `exec`.** If your agent calls `npm install`, `npm run`, `pip install`, `pytest`, `docker run`, or `make`, those calls now classify as `package.install` / `package.run` / `build.test` instead of `shell.exec` and are gated by their own action-class rules. Operators with custom forbids on `shell.exec` should add equivalent forbids on the new action classes if the same restriction is intended.

**`ctx.metadata.intent_hint` is opt-in for agents.** Existing agents that don't supply a hint see no behavioural change — the "Why this is happening" section simply doesn't render.

**Rollback escape hatches.** All v1.3.0 UX changes are individually disablable via env var: `CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1`, `CLAWTHORITY_HITL_MINIMAL=1`, or revert to v1.2.4. The two-stage pipeline, capability gate, and HITL routing semantics are unchanged from v1.2.4.

### Known gaps — deferred to v1.3.1 / v1.4

- **Auto-permit TTL / auto-expiry.** Persisted permits live until manually removed. Auto-expiry is v1.4.
- **Multi-operator quorum.** One operator's button click decides. n-of-m voting is out of scope.
- **Web/dashboard approval UI.** Buttons live in Telegram and Slack only.
- **Pattern editor UI.** v1.3.0 derives one default pattern per command and shows it for confirmation. Letting operators edit the pattern interactively is v1.4.
- **Top-6 only.** The remaining ~6 high-volume tools land in v1.3.1 once HITL volume after this UX ships is measured.
- **Normalizer Rules 4–8** (carried over from v1.2.x) — still not implemented; the explainer covers the same ground for human reviewers but does not enforce.

---

## [1.2.4] — 2026-04-24

Final v1.2.x maintenance release. Adds the secrets-tool surface (`read_secret`, `write_secret`, `store_secret`, `list_secrets`, `rotate_secret`), HTTP write verbs (`http_put`, `http_post`, `http_patch`, `http_delete`), the audited `webhook` retry tool, the `unsafe_admin_exec` escape hatch, the `EnvCredentialVault` provider, and `send_notification`.

### Added

#### `send_notification` — generic notification tool (HC-11)

`send_notification` sends a notification message to a communication platform via webhook and maps to the `communication.webhook` action class (`risk_tier: 'medium'`, `default_hitl_mode: 'per_request'`). The `platform` parameter selects a formatting adapter that shapes the JSON payload for the target service.

Key behaviours:

- Accepts `platform` (required — `'slack' | 'discord' | 'teams' | 'generic'`), `message` (required), and `url` (required — webhook endpoint).
- Platform adapters format the payload: Slack uses `{ text }`, Discord uses `{ content }`, Teams uses `{ text }`, and generic uses `{ message }`.
- Validates the platform value at runtime and throws `SendNotificationError` with `code: 'unsupported-platform'` for unrecognised values.
- Delegates HTTP delivery to `sendWebhook`; propagates `invalid-url`, `network-error`, and `timeout` errors as `SendNotificationError` with matching codes.
- A non-2xx HTTP response from the webhook endpoint throws `SendNotificationError` with `code: 'delivery-error'`.
- Returns `{ delivered: true, status_code }` on successful delivery (2xx response).
- `send_notification` is registered as an alias for the `communication.webhook` action class in the action registry.

Gate order: platform validation → URL scheme validation (via `sendWebhook`) → HITL token check (pipeline) → network request → 2xx check → return.

#### `EnvCredentialVault` — environment variable credential provider (T75)

`EnvCredentialVault` (`src/vault/env-vault.ts`) is the second `ICredentialVault` / `SecretBackend` implementation, complementing `FileCredentialVault` for the v1.2.1 env + file only approach. It reads secrets directly from `process.env` with no async loading step — values are resolved at call time so late-injected env vars are always visible.

Key behaviours:

- Implements both `ICredentialVault` (`get` / `has` / `keys`) and `SecretBackend` (`get` / `has` / `set`), making it a drop-in replacement wherever either interface is expected.
- `set(key, value)` writes to `process.env[key]`; changes are immediately visible to subsequent calls on any env-backed instance in the same process.
- `keys()` returns a snapshot of all currently-set environment variable names via `Object.keys(process.env)`.
- A pre-constructed `envVault` singleton is exported for use by credential tools that resolve to the `env` store.
- `@experimental` — same stability guarantee as `FileCredentialVault`; avoid hard dependencies outside the W2 workstream.

#### `store_secret` — file vault credential storage tool (T160)

`store_secret` saves a secret value to a file-based credential store and maps to the `credential.write` action class (`risk_tier: 'critical'`, `default_hitl_mode: 'per_request'`). The file vault is the only supported provider because env is read-only by nature. Accepts `key` (required), `value` (required), and `path` (optional — path to the JSON credentials file; created if absent).

Security invariants:

- The supplied value is **never** written to the audit log — only key name, backend identifier, and value length appear in log entries.
- An absent or empty allowlist causes all key access to be denied (fail-closed; controlled by `CLAWTHORITY_SECRET_ALLOWLIST` env var or the `allowlist` option).
- The HITL capability token is consumed **before** the write so it cannot be replayed even if the process is killed immediately after the operation.
- Only the file vault provider is supported; callers that omit both `path` and an injected backend receive a `write-error` before any gate check.
- Backends are injected via options, enabling tests to supply lightweight in-memory stubs (`MemorySecretBackend`) without file I/O.

Gate order: backend resolution → allowlist check → HITL token presence → replay protection → consume token → write → return.

#### `WritableFileSecretBackend` — writable file-based secret backend (T160)

`WritableFileSecretBackend` (`src/tools/secrets/secret-backend.ts`) is a file-based `SecretBackend` that persists secrets to a local JSON credentials file. Unlike `FileCredentialVault` (read-only), it supports `set()` by writing the entire updated credentials map back to disk via `writeFileSync` after each mutation. Use `WritableFileSecretBackend.load(path)` to construct from an existing file (empty backend is returned when the file is absent). Validation ensures the file contains a flat string-to-string record before loading.

#### `list_secrets` — credential enumeration tool (T89)

`list_secrets` enumerates the names of secrets present in a configured backend store and maps to the `credential.list` action class (`risk_tier: 'high'`, `default_hitl_mode: 'per_request'`). Only key names are returned — values are never retrieved or exposed. Supported built-in backends: `env` (checks `process.env`) and any injected `SecretBackend`.

Security invariants:

- Secret values are **never** retrieved or written to the audit log — only key names and counts appear in log entries.
- Only keys that appear in **both** the allowlist and the backend are returned. Keys absent from either are silently excluded.
- An absent or empty allowlist results in an empty key list (fail-closed; controlled by `CLAWTHORITY_SECRET_ALLOWLIST` env var or the `allowlist` option).
- The HITL capability token is consumed **before** enumeration begins so it cannot be replayed even if the process is killed during listing.
- Backends are injected via options, enabling tests to supply lightweight in-memory stubs (`MemorySecretBackend`) without touching `process.env` or external services.

Gate order: HITL token presence → replay protection → enumerate (allowlist ∩ backend) → return.

#### `credential.list` action class registration (T89)

`credential.list` is now registered in `@openclaw/action-registry` with `default_risk: 'high'` and `default_hitl_mode: 'per_request'`, under the `credential_access` intent group. Aliases: `list_secrets`, `list_credentials`, `list_credential_keys`.

#### `read_secret` and `write_secret` manifest registration (T75)

`readSecretManifest` (`credential.read`, `risk_tier: 'high'`, `default_hitl_mode: 'per_request'`) and `writeSecretManifest` (`credential.write`, `risk_tier: 'critical'`, `default_hitl_mode: 'per_request'`) are now included in `FIRST_PARTY_MANIFESTS` and validated at activation time alongside the other registered first-party tools.

#### `http_delete` — HTTP DELETE request tool (HC-04)

`http_delete` sends an HTTP DELETE request to a URL and maps to the `web.post` action class (`risk_tier: 'medium'`, `default_hitl_mode: 'per_request'`). DELETE is grouped with other state-mutating HTTP verbs under `web.post`.

Key behaviours:

- Accepts `url` (required) and `headers` (optional key-value pairs). DELETE requests carry no body.
- Validates that the URL uses the `http://` or `https://` scheme before making any network request; throws `HttpDeleteError` with `code: 'invalid-url'` otherwise.
- Returns `{ status_code, body }` — HTTP error responses (4xx, 5xx) are returned without throwing, since those represent a definitive server answer.
- Throws `HttpDeleteError` (typed `code`: `invalid-url` | `network-error` | `timeout`) on transport failures; the 30 s timeout maps to `code: 'timeout'`.

Gate order: URL scheme validation → HITL token check (pipeline) → network request → return.

#### `http_put` — HTTP PUT request tool (T78)

`http_put` sends an HTTP PUT request to a URL with an optional request body and maps to the `web.post` action class (`risk_tier: 'medium'`, `default_hitl_mode: 'per_request'`). PUT is treated the same as POST because it replaces remote state.

Key behaviours:

- Accepts `url` (required), `body` (optional string — serialise JSON before passing), and `headers` (optional key-value pairs).
- Validates that the URL uses the `http://` or `https://` scheme before making any network request; throws `HttpPutError` with `code: 'invalid-url'` otherwise.
- Returns `{ status_code, body }` — HTTP error responses (4xx, 5xx) are returned without throwing, since those represent a definitive server answer.
- Throws `HttpPutError` (typed `code`: `invalid-url` | `network-error` | `timeout`) on transport failures; the 30 s timeout maps to `code: 'timeout'`.

Gate order: URL scheme validation → HITL token check (pipeline) → network request → return.

#### `http_patch` — HTTP PATCH request tool (HC-05)

`http_patch` sends an HTTP PATCH request to a URL with an optional partial-update body and maps to the `web.post` action class (`risk_tier: 'medium'`, `default_hitl_mode: 'per_request'`). PATCH is treated the same as POST and PUT because it modifies remote state.

Key behaviours:

- Accepts `url` (required), `body` (optional string — serialise JSON before passing), and `headers` (optional key-value pairs).
- Validates that the URL uses the `http://` or `https://` scheme before making any network request; throws `HttpPatchError` with `code: 'invalid-url'` otherwise.
- Returns `{ status_code, body }` — HTTP error responses (4xx, 5xx) are returned without throwing, since those represent a definitive server answer.
- Throws `HttpPatchError` (typed `code`: `invalid-url` | `network-error` | `timeout`) on transport failures; the 30 s timeout maps to `code: 'timeout'`.

Gate order: URL scheme validation → HITL token check (pipeline) → network request → return.

#### `http_post` — HTTP POST request tool (T79)

`http_post` sends an HTTP POST request to a URL with an optional request body and maps to the `web.post` action class (`risk_tier: 'medium'`, `default_hitl_mode: 'per_request'`). POST is the canonical state-mutating HTTP verb; it triggers side effects and resource creation on external services.

Key behaviours:

- Accepts `url` (required), `body` (optional string — serialise JSON before passing), and `headers` (optional key-value pairs).
- Supports `application/json` and `application/x-www-form-urlencoded` bodies. `multipart/*` content types are rejected before any network request with `HttpPostError` code `invalid-content-type` (file uploads are out of scope).
- Validates that the URL uses the `http://` or `https://` scheme before making any network request; throws `HttpPostError` with `code: 'invalid-url'` otherwise.
- Returns `{ status_code, body, content_type? }` — HTTP error responses (4xx, 5xx) are returned without throwing, since those represent a definitive server answer. `content_type` is included when the response carries a `Content-Type` header.
- Throws `HttpPostError` (typed `code`: `invalid-url` | `invalid-content-type` | `network-error` | `timeout`) on validation or transport failures; the 30 s timeout maps to `code: 'timeout'`.

Gate order: URL scheme validation → content-type validation → HITL token check (pipeline) → network request → return.

#### `read_secret` — credential read tool (T75)

`read_secret` retrieves a secret value from a configured backend store and maps to the `credential.read` action class (`risk_tier: 'high'`, `default_hitl_mode: 'per_request'`). Supported built-in backends: `env` (reads from `process.env`) and `file` (delegates to `FileCredentialVault`).

Security invariants:

- The retrieved value is **never** written to the audit log — only the key name, store identifier, and value length appear in log entries.
- An absent or empty allowlist causes all key access to be denied (controlled by `CLAWTHORITY_SECRET_ALLOWLIST` env var or the `allowlist` option). Fail-closed by default.
- The HITL capability token is consumed **before** the value is returned so it cannot be replayed even if the process is killed during the read.
- Backends are injected via options, enabling tests to supply lightweight in-memory stubs (`MemorySecretBackend`) without touching `process.env` or external services.

Gate order: allowlist check → HITL token presence → replay protection → backend read → return.

#### `rotate_secret` — credential rotation tool (CS-03)

`rotate_secret` generates a cryptographically-random 256-bit hex value for an existing secret and writes it to the configured backend store atomically. It maps to the `credential.rotate` action class (`risk_tier: 'critical'`, `default_hitl_mode: 'per_request'`).

Security invariants:

- The generated value is **never** written to the audit log — only the key name, store identifier, and value length appear in log entries.
- An absent or empty allowlist causes all key access to be denied (controlled by `CLAWTHORITY_SECRET_ALLOWLIST` env var or the `allowlist` option).
- The key must already exist in the store — rotation does not create new keys (`key-not-found` error).
- The HITL capability token is consumed **before** the write so it cannot be replayed even if the process is killed during the operation.

Gate order: allowlist check → HITL token presence → replay protection → key existence check → generate + consume token → write.

#### `webhook` — audited webhook delivery tool (HC-08)

`webhook` posts a JSON payload to a webhook URL via HTTP POST and maps to the `communication.webhook` action class (`risk_tier: 'medium'`, `default_hitl_mode: 'per_request'`). Unlike `send_webhook`, it includes automatic retry logic for transient failures.

Key behaviours:

- Accepts `url` (required) and `payload` (required) parameters; optional `headers` and `max_retries` (default: 3).
- Automatically sets `Content-Type: application/json` unless the caller supplies a `Content-Type` header (checked case-insensitively).
- Retries on `network-error` and `timeout` only — HTTP error responses (4xx, 5xx) are returned immediately without retrying, since those represent a definitive server response.
- Exponential backoff between retries: 500 ms × 2^(attempt−1).
- Returns `{ status_code, response_body, content_type?, attempts }` — `attempts` records the total number of requests made, providing an audit trail of retry activity.
- Throws `WebhookError` (typed `code`: `invalid-url` | `network-error` | `timeout`) only when all attempts are exhausted or the URL scheme is invalid.

Security invariants:

- URL scheme validation rejects anything that is not `http://` or `https://` at call time, before any retry loop runs.
- The `attempts` field in the result is always present and audited, giving operators visibility into retry activity.

Gate order: URL scheme validation → HITL token check (pipeline) → retry loop (network-error / timeout) → return.

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
- **`src/regression-rules-json-forbid.e2e.ts`** — five cases (TC-RRF-01..05) covering the 2026-04-23 regression where a `tool:read → forbid` rule at priority 200 defined via `CLAWTHORITY_RULES_FILE` (resource/match form) was not blocking in OPEN mode and not emitting a structured audit entry: OPEN-mode block by priority-200 `tool:read_file` forbid (TC-RRF-01), audit entry with `stage=json-rules` and `priority=200` (TC-RRF-02), priority ordering confirming the json-rules forbid wins over the implicit Cedar permit (TC-RRF-03), unconditional block with no HITL policy configured confirming priority ≥ 100 is not HITL-gatable (TC-RRF-04), and CLOSED-mode block (TC-RRF-05).

### Known gaps — deferred to v1.3

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

- **Warn when a HITL policy matches `unknown_sensitive_action`.** Putting `unknown_sensitive_action` (or a bare `*`) in `hitl-policy.yaml` routes every unrecognised tool — including read-only operations like `read` and `list` that aren't registered as aliases — through human approval, which locks the agent into an approval loop it cannot recover from. `parseHitlPolicyFile` now logs a `[hitl-policy] ` warning at load time naming the offending policy and pointing operators at the right fix (register the tool alias, or match `filesystem.delete` instead).

- **Priority-90 Cedar forbids now route through HITL instead of blocking silently.** The rule tier documented as "sensitive actions requiring HITL approval" (priority 90 — `filesystem.delete`, `credential.read`, `credential.write`, `payment.initiate`) did not actually route to HITL. `beforeToolCallHandler` returned `{block: true}` on any Cedar forbid before the HITL stage ran, so the forbid was upheld regardless of what `hitl-policy.yaml` said. In OPEN mode this silently appeared to work because the priority-90 rules weren't shipped (CRITICAL_ACTION_CLASSES filter); in CLOSED mode operators hit a hard block with no approval flow. The handler is now async end-to-end and treats priority-90 forbids as "HITL-gated": if a HITL policy matches the action class and the operator approves, the tool call proceeds. If no policy matches — or HITL is not configured — the forbid is upheld with its original reason. Priority-100 (and rules with no explicit priority) are unchanged: unconditional forbid, HITL cannot override. JSON-rules forbids follow the same gating semantics when they carry `priority < 100`.

### Added

- **Bare-verb tool aliases in the normalizer registry.** Common tool names that hosts expose directly now map to their canonical action class: `read` → `filesystem.read`, `write` → `filesystem.write`, `edit` → `filesystem.write`, `list` → `filesystem.list`. Previously these fell through to `unknown_sensitive_action`, which in CLOSED mode blocks outright. `exec` is intentionally NOT added as a `shell.exec` alias — reclassifying it unconditionally would regress OpenClaw-style hosts where `exec` is the primary tool surface.

- **End-to-end test suite for HITL-gated forbid routing.** [`src/hitl-gated-forbid.e2e.ts`](src/hitl-gated-forbid.e2e.ts) exercises the priority-90 / HITL integration directly: blocks when no HITL is configured, blocks when a HITL policy is configured but doesn't match the action, permits when a matching policy approves, blocks when dispatch falls back to deny, and verifies that priority-100 rules (`shell.exec`) still block unconditionally even when a HITL policy claims to approve them. Injects synthetic HITL configs via a module mock on the parser so the tests don't depend on YAML files in the repo root.

- **Structured policy decisions in `data/audit.jsonl`.** The audit log previously only captured HITL approval/denial events. Every other block — Stage 1 trust-gate rejections, Cedar unconditional forbids, JSON-rule forbids, and HITL-gated forbids upheld because no HITL policy matched — went to stdout only, so post-mortems had to reconstruct what happened from ephemeral logs. Each block path now emits a `{type: 'policy'}` entry carrying `stage` (`stage1-trust` / `cedar` / `json-rules` / `hitl-gated`), `rule` (action-class or resource:match identifier), `priority` (when a rule matched), `mode` (OPEN/CLOSED), `toolName`, `actionClass`, `reason`, and the usual agent/channel/verified identity fields. The audit logger is now initialised unconditionally at activation so these entries land even when HITL is not configured.

- **`DECISION: BLOCKED` console line enriched with priority and rule identifier.** Operators triaging a block in stdout logs can now tell at a glance whether they hit a hard forbid (`priority=100`), a HITL-gated rule that never found a matching policy (`priority=90 rule=action:filesystem.delete; no HITL policy matches`), or a Stage-1 trust-gate rejection — without cross-referencing `data/audit.jsonl`.

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

### v1.2.0 Addendum — What Does Not Ship {#v120-addendum--what-does-not-ship}

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

### Do not edit `dist/` files directly

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

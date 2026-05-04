# Action Registry and Classification System

> **What this page is for.** Complete reference for every canonical action class recognised by Clawthority — what it covers, its default risk posture, and when human approval is required. Policy authors should write rules against these classes rather than tool names.

Source of truth: [`packages/action-registry/src/index.ts`](../packages/action-registry/src/index.ts) (the registry itself) and [`src/enforcement/normalize.ts`](../src/enforcement/normalize.ts) (the lookup + reclassification pipeline).

This page reflects **frozen v2** of the taxonomy (released with v1.3.1). For the change-control process and the canonical class table, see [docs/action-taxonomy.md](action-taxonomy.md).

---

## Overview

Every tool call an agent makes is normalised to a canonical **action class** before policy evaluation. The normalisation step:

1. Looks up the tool name (case-insensitive) against the registry alias index.
2. Extracts the target resource from tool parameters.
3. Applies post-lookup reclassification rules that can change the action class or raise the risk level.
4. Returns a `NormalizedAction` with a stable `action_class`, effective `risk`, `hitl_mode`, `target`, and (where applicable) `intent_group`.

Unknown tool names are **not rejected at lookup time** — they resolve to `unknown_sensitive_action` with critical risk and mandatory per-request HITL. This fail-closed design ensures novel tools cannot bypass enforcement by having an unregistered name. The `unknown_sensitive_action` forbid ships in both install modes (`open` and `closed`); see [configuration.md — Install mode](configuration.md#install-mode).

The registry recognises both **tool-name** aliases (e.g. `read_file`, `git_log`, `npm_install` — the form a host uses when exposing a typed first-party tool) and **bare-binary** aliases (e.g. `cat`, `chmod`, `kubectl`, `apt` — the form an agent uses when calling a generic shell-exec tool with the binary name as the first argument). v1.3.1 added bare-binary coverage for ~80 commands across the 16 categories of the exec-command audit.

---

## Complete Action Registry

42 named action classes plus the `unknown_sensitive_action` fail-closed sentinel.

| # | Action Class | Risk | HITL Mode | Intent Group | Since |
|---|---|---|---|---|---|
| 1 | `filesystem.read` | low | none | — | v1 |
| 2 | `filesystem.write` | medium | per_request | — | v1 |
| 3 | `filesystem.delete` | high | per_request | `destructive_fs` | v1 |
| 4 | `filesystem.list` | low | none | — | v1 |
| 5 | `web.search` | medium | per_request | — | v1 |
| 6 | `web.fetch` | medium | per_request | `data_exfiltration` | v1 |
| 7 | `browser.scrape` | medium | per_request | — | v1 |
| 8 | `web.post` | medium | per_request | `web_access` | v1 |
| 9 | `shell.exec` | high | per_request | — | v1 |
| 10 | `communication.email` | high | per_request | `external_send` | v1 |
| 11 | `communication.slack` | medium | per_request | `external_send` | v1 |
| 12 | `communication.webhook` | medium | per_request | `external_send` | v1 |
| 13 | `memory.read` | low | none | — | v1 |
| 14 | `memory.write` | medium | none | — | v1 |
| 15 | `credential.read` | high | per_request | `credential_access` | v1 |
| 16 | `credential.write` | critical | per_request | `credential_access` | v1 |
| 17 | `credential.rotate` | critical | per_request | `credential_access` | v1.2.1 |
| 18 | `credential.list` | high | per_request | `credential_access` | v1.2.4 |
| 19 | `code.execute` | high | per_request | — | v1 |
| 20 | `payment.initiate` | critical | per_request | `payment` | v1 |
| 21 | `system.read` | low | none | — | v1.1.x |
| 22 | `system.service` | critical | per_request | — | **v1.3.1** |
| 23 | `permissions.modify` | high | per_request | — | **v1.3.1** |
| 24 | `permissions.elevate` | critical | per_request | — | **v1.3.1** |
| 25 | `process.signal` | high | per_request | — | **v1.3.1** |
| 26 | `network.diagnose` | low | none | — | **v1.3.1** |
| 27 | `network.scan` | high | per_request | — | **v1.3.1** |
| 28 | `network.transfer` | high | per_request | `data_exfiltration` | **v1.3.1** |
| 29 | `network.shell` | high | per_request | — | **v1.3.1** |
| 30 | `cluster.read` | low | per_request | — | **v1.3.2** |
| 31 | `cluster.write` | high | per_request | — | **v1.3.2** |
| 32 | `scheduling.persist` | high | per_request | — | **v1.3.1** |
| 33 | `vcs.read` | low | none | — | v1 |
| 34 | `vcs.write` | medium | per_request | — | v1 |
| 35 | `vcs.remote` | medium | per_request | — | v1 |
| 36 | `package.install` | medium | per_request | — | v1 |
| 37 | `package.run` | medium | per_request | — | v1.2.x |
| 38 | `package.read` | low | none | — | v1.2.x |
| 39 | `build.compile` | medium | per_request | — | v1 |
| 40 | `build.test` | low | none | — | v1 |
| 41 | `build.lint` | low | none | — | v1 |
| 42 | `archive.create` | medium | per_request | — | v1.2.x |
| 43 | `archive.extract` | medium | per_request | — | v1.2.x |
| 44 | `archive.read` | low | none | — | v1.2.x |
| — | `unknown_sensitive_action` | critical | per_request | — | v1 (sentinel) |

---

## Risk Level Definitions

Risk levels determine how seriously the enforcement pipeline treats a given action class. They influence HITL requirements, policy default priorities, and whether untrusted-source requests are blocked outright.

| Risk Level | Meaning | Examples |
|---|---|---|
| `low` | Read-only or purely local operations with no side effects visible outside the agent. | Reading a file, listing a directory, fetching a URL, reading memory, querying system stats. |
| `medium` | Writes or outbound calls that have side effects but are bounded and recoverable. | Writing a file, posting to a URL, sending a Slack message, installing a package. |
| `high` | Irreversible or externally visible actions. Data loss, privilege change, external communication, or remote-host access. | Deleting a file, sending email, reading secrets, killing processes, scanning networks, transferring files off-host. |
| `critical` | Actions with financial, security, or system-wide impact. No safe default. | Writing credentials, initiating payments, executing arbitrary code, daemon/host lifecycle (reboot), privilege elevation (sudo), unknown tools. |

### Rationale by tier

**Low (read-only / observational)** — `filesystem.read`, `filesystem.list`, `memory.read`, `system.read`, `network.diagnose`, `vcs.read`, `package.read`, `build.test`, `build.lint`, `archive.read`. These observe state without modifying it. Worst case is information disclosure to the agent. No external side effects.

**Medium (recoverable writes)** — `filesystem.write`, `web.search`, `web.fetch`, `web.post`, `browser.scrape`, `communication.slack`, `communication.webhook`, `memory.write`, `vcs.write`, `vcs.remote`, `package.install`, `package.run`, `build.compile`, `archive.create`, `archive.extract`. These produce side effects (modifying files, calling endpoints, posting messages, installing dependencies) but blast radius is bounded and the operation is generally reversible. Memory writes are medium because memory is agent-internal state with no direct external footprint. Web fetch / scrape are medium (not low) because they can retrieve sensitive resources, exfiltrate data via URL parameters, or be weaponised for SSRF.

**High (irreversible / externally visible)** — `filesystem.delete`, `shell.exec`, `communication.email`, `credential.read`, `credential.list`, `code.execute`, `permissions.modify`, `process.signal`, `network.scan`, `network.transfer`, `network.shell`, `cluster.write`, `scheduling.persist`. Each carries meaningful irreversibility or external exposure:
- `filesystem.delete` destroys data with no undo path.
- `shell.exec` and `code.execute` grant arbitrary OS / runtime access.
- `communication.email` sends content to external parties who may act before correction is possible.
- `credential.read` / `credential.list` expose secret material.
- `permissions.modify` (chmod/chown/umask) changes access boundaries; recoverable but easy to lock yourself out.
- `process.signal` (kill) terminates processes; recoverable by restart but disruptive.
- `network.scan` (nmap) actively probes remote hosts and may trigger IDS / violate AUP.
- `network.transfer` (rsync/scp/sftp) moves data off-host — `data_exfiltration` intent group.
- `network.shell` (ssh/mosh/telnet) opens a remote shell — lateral movement to a different host.
- `cluster.write` (kubectl apply/delete/rollout, docker push) modifies cluster state. Reads (`kubectl get`) live under `cluster.read` (low) because they only disclose state.
- `scheduling.persist` (crontab/at) creates work that runs unattended.

**Critical (system-wide impact)** — `credential.write`, `credential.rotate`, `payment.initiate`, `system.service`, `permissions.elevate`, `unknown_sensitive_action`. These carry the highest stakes:
- `credential.write` / `credential.rotate` can permanently compromise a service.
- `payment.initiate` triggers real financial transactions.
- `system.service` (systemctl/reboot/shutdown/init/virsh) can take a host or daemon offline, often non-recoverably mid-flight.
- `permissions.elevate` (sudo/su/passwd/doas) is privilege escalation; once root, blast radius is unbounded.
- `unknown_sensitive_action` is the fail-closed bucket. By treating the unknown as critical, the system prevents novel tools from evading policy by being unregistered.

---

## HITL Mode Reference

The `default_hitl_mode` field on each registry entry specifies what human-approval behaviour applies by default when no HITL policy rule overrides it.

| HITL Mode | Behavior | Typical use |
|---|---|---|
| `none` | Action proceeds without requiring an approval token. No HITL check is performed. | Low-risk reads where operator review adds no value. |
| `per_request` | Every invocation requires a fresh approval token bound to the specific payload. | High-impact or irreversible actions where each instance must be individually approved. |
| `session_approval` | One approval covers all matching actions for the duration of the session. | Repetitive medium-risk operations where per-request fatigue would prevent useful work. |

### Approval Mode Comparison

| | `none` | `per_request` | `session_approval` |
|---|---|---|---|
| **Token format** | N/A | UUID v7, one per call | UUID v7, shared for session |
| **Approvals per session** | 0 | One per invocation | One per session |
| **Audit granularity** | Action class only | Individual tool call + payload hash | Session boundary only |
| **Operator fatigue** | None | High for frequent actions | Low |
| **Replay attack surface** | None | Minimal — payload hash binding per token | Elevated — token covers all session calls |

Operators can also persist auto-permits to `data/auto-permits.json` via the v1.3.0 "Approve Always" flow — see [docs/human-in-the-loop.md](human-in-the-loop.md) and [docs/configuration.md](configuration.md#auto-permits).

> **Note:** Pending approvals are in-memory only and do not survive plugin restarts. Consumed tokens also reset on restart. Operators must re-approve any pending actions after a restart. File-based auto-permits in `data/auto-permits.json` do persist across restarts.

---

## Reclassification Rules

After the initial registry lookup, `normalize_action` applies two post-lookup reclassification rules. These rules can change the resolved `action_class` or raise the effective `risk`, overriding the registry defaults.

### Rule 1 — `filesystem.write` with URL target → `web.post`

**Trigger:** The tool name resolves to `filesystem.write` AND the `path`, `file`, `url`, `destination`, or `to` parameter starts with `http://` or `https://`.

**Effect:** The action class is changed to `web.post` and the risk is raised to medium (matching `web.post` defaults). The HITL mode remains `per_request`.

**Rationale:** Some tools accept either a local file path or a URL as a write destination. Writing to a URL is semantically an outbound HTTP POST, not a local file operation. Treating it as `filesystem.write` would understate the external side effects and could bypass web-specific policy rules.

```typescript
normalize_action('write_file', { path: 'https://api.example.com/data', body: '...' })
// → { action_class: 'web.post', risk: 'medium', hitl_mode: 'per_request', ... }
```

### Rule 2 — Shell metacharacters in any parameter → risk raised to `critical`

**Trigger:** Any string-valued parameter contains one or more shell metacharacters: `` ; | & > < ` $ ( ) { } [ ] \ ``

**Effect:** The effective `risk` is raised to `critical` regardless of the base risk from the registry. The action class and HITL mode are unchanged.

**Rationale:** Shell metacharacters in tool parameters are a strong signal of command injection. An agent asked to "read `/etc/passwd`" should not be able to chain `; rm -rf /` by embedding metacharacters in the path parameter. Raising risk to critical ensures these calls hit the highest enforcement tier even if the base action class (e.g., `filesystem.read`) would otherwise be low risk.

```typescript
normalize_action('read_file', { path: '/etc/passwd; cat /etc/shadow' })
// → { action_class: 'filesystem.read', risk: 'critical', hitl_mode: 'none', ... }
//   (risk overridden to 'critical' due to metacharacter detection)
```

> **Note:** Rule 2 raises risk but does not change the HITL mode. A `filesystem.read` call with shell metacharacters resolves to `critical` risk but its default HITL mode remains `none`. Policy rules that match `risk: critical` can enforce HITL or outright denial regardless of the default mode.

---

## Per-Class Detail

Per-class sections list the registered aliases as they exist in the v1.3.1 registry, grouped by family (tool-name forms vs bare-binary forms).

### Filesystem family

#### `filesystem.read` — low / none

Reads file content or searches the filesystem without modifying it. Includes existence checks.

**Tool-name aliases:** `read`, `read_file`, `readfile`, `read_files`, `read_files_batch`, `cat_file`, `view_file`, `open_file`, `get_file_contents`, `find_files`, `find_file`, `search_files`, `grep_files`, `grep_file`, `grep`, `search_in_files`, `check_exists`, `exists`, `file_exists`, `path_exists`

**Bare-binary aliases (v1.3.1):** `cat`, `head`, `tail`, `less`, `more`, `diff`, `find`, `locate`

#### `filesystem.write` — medium / per_request

Creates or modifies files. Subject to [Rule 1](#rule-1--filesystemwrite-with-url-target--webpost) when the target is a URL.

**Tool-name aliases:** `write`, `edit`, `apply_patch`, `write_file`, `writefile`, `create_file`, `save_file`, `update_file`, `edit_file`, `patch_file`, `make_dir`, `mkdir`, `create_dir`, `create_directory`, `copy_file`, `copy`, `cp`, `duplicate_file`, `copy_file_to`, `move_file`, `mv`, `move`, `rename_file`, `rename`

**Bare-binary aliases (v1.3.1):** `tee`, `touch`, `install` (the BSD/GNU file-installer; not the package-manager `install_package`)

#### `filesystem.delete` — high / per_request — intent group: `destructive_fs`

Permanently removes files or directories. All aliases carry the `destructive_fs` intent group, enabling a single intent-group forbid rule to block every deletion alias.

**Aliases:** `delete_file`, `deletefile`, `remove_file`, `rm_file`, `unlink_file`, `rm`, `rm_rf`, `unlink`, `delete`, `remove`, `move_to_trash`, `trash`, `shred`, `rmdir`, `format`, `empty_trash`, `purge`

#### `filesystem.list` — low / none

Lists directory contents without modifying anything.

**Aliases:** `list`, `list_files`, `listfiles`, `list_directory`, `list_dir`, `read_directory`, `ls`, `tree`

---

### Web family

#### `web.search` — medium / per_request

Performs a web search via a search engine API. Medium risk because queries leave the controlled environment and disclose intent to the search provider.

**Aliases:** `web_search`, `x_search`, `google_search`, `bing_search`, `duckduckgo_search`, `ddg_search`, `search_web`, `web_research`, `news_search`

#### `web.fetch` — medium / per_request — intent group: `data_exfiltration`

HTTP GET / HEAD / OPTIONS to a URL. Classified as `data_exfiltration` because fetch operations can retrieve sensitive resources from internal addresses (SSRF), exfiltrate data to attacker-controlled endpoints, or probe internal services.

**Tool-name aliases:** `fetch`, `browser`, `http_get`, `web_fetch`, `get_url`, `fetch_url`, `http_request`, `download_url`, `http_head`, `head_url`, `http_options`

**Bare-binary aliases:** `curl`, `wget`

#### `browser.scrape` — medium / per_request

Extracts structured content from a web page by parsing the DOM.

**Aliases:** `scrape_page`, `extract_page`, `read_url`

#### `web.post` — medium / per_request — intent group: `web_access`

State-mutating outbound HTTP (POST / PUT / PATCH / DELETE). Also the reclassification target for `filesystem.write` calls whose destination is a URL.

**Aliases:** `http_post`, `post_url`, `web_post`, `post_request`, `submit_form`, `http_put`, `put_url`, `web_put`, `put_request`, `http_patch`, `patch_url`, `web_patch`, `patch_request`, `http_delete`, `delete_url`, `web_delete`, `delete_request`

---

### Shell + code

#### `shell.exec` — high / per_request

Arbitrary shell command execution. One of the most powerful and dangerous classes.

**Aliases:** `bash`, `shell_exec`, `run_command`, `execute_command`, `run_terminal_cmd`, `terminal_exec`, `cmd`, `unsafe_admin_exec`

#### `code.execute` — high / per_request

Arbitrary code execution within an interpreter (Python, JS, etc.) or a containerised runtime.

**Tool-name aliases:** `code_execution`, `run_code`, `execute_code`, `eval_code`, `python`, `javascript`, `node_exec`, `code_runner`, `docker_run`, `docker_exec`

**Bare-binary aliases (v1.3.1):** `docker` — the bare binary inherits this tier because the worst-case subcommand (`docker run`) is arbitrary code execution. Read-only subcommands like `docker ps` get the same conservative tier; the explainer dispatches per-subcommand for HITL message detail.

---

### Communication

#### `communication.email` — high / per_request — intent group: `external_send`

Sends an email message to an external recipient. High risk: messages leave the controlled environment immediately, recipients may act before correction, and email is a common vector for social engineering.

**Aliases:** `send_email`, `email_send`, `send_mail`, `compose_email`, `email`

#### `communication.slack` — medium / per_request — intent group: `external_send`

Posts to a Slack channel or user. Medium risk: messages can be deleted or edited, unlike email.

**Aliases:** `send_slack`, `slack_message`, `slack_send`, `post_slack`, `post_message`

#### `communication.webhook` — medium / per_request — intent group: `external_send`

Sends an HTTP payload to an external webhook endpoint.

**Aliases:** `message`, `call_webhook`, `webhook`, `trigger_webhook`, `post_webhook`, `send_notification`

---

### Memory

#### `memory.read` — low / none

Reads from agent-internal memory storage.

**Aliases:** `memory_get`, `memory_search`, `read_memory`, `get_memory`, `recall`, `retrieve_memory`

#### `memory.write` — medium / none

Writes to agent-internal memory. HITL is `none` by default because operator review of every memory update would create severe fatigue with minimal security benefit; memory cannot exfiltrate data directly.

**Aliases:** `memory_set`, `write_memory`, `set_memory`, `store_memory`, `save_memory`, `remember`

---

### Credentials — intent group: `credential_access`

All four credential classes share the `credential_access` intent group, enabling a single rule to gate every secrets operation.

#### `credential.read` — high / per_request

Reads a secret from a secrets store. Once exposed, it cannot be un-exposed.

**Aliases:** `read_secret`, `get_secret`, `get_credential`, `retrieve_secret`, `read_credential`

#### `credential.write` — critical / per_request

Creates or replaces a secret in a store. Critical because a malicious or erroneous write can permanently compromise a service.

**Aliases:** `write_secret`, `set_secret`, `set_credential`, `store_secret`, `create_secret`

#### `credential.rotate` — critical / per_request *(since v1.2.1)*

Rotates a secret (typically generates a new value and updates the store). Distinct from `credential.write` because the new value is not externally supplied.

**Aliases:** `rotate_secret`, `rotate_credential`

#### `credential.list` — high / per_request *(since v1.2.4)*

Enumerates the keys in a credential store. High risk because key names are themselves sensitive (they reveal infrastructure topology).

**Aliases:** `list_secrets`, `list_credentials`, `list_credential_keys`

---

### Payment

#### `payment.initiate` — critical / per_request — intent group: `payment`

Initiates a financial transaction via a payment processor.

**Aliases:** `pay`, `payment`, `initiate_payment`, `create_payment`, `charge`, `stripe_payment`

---

### System & host management

#### `system.read` — low / none *(since v1.1.x)*

Read-only system / process / environment queries. Same blast radius as `filesystem.read` for system state.

**Tool-name aliases:** `session_status`, `sessions_list`, `sessions_history`, `sessions_spawn`, `sessions_send`, `sessions_yield`, `subagents`, `agents_list`, `nodes`, `image`, `cron`, `gateway`, `get_system_info`, `system_info`, `get_env_var`, `get_env`, `read_env`, `env_var`, `get_hostname`, `get_platform`, `get_arch`, `get_os_info`

**Bare-binary aliases (v1.3.1):** `uname`, `ps`, `top`, `htop`, `df`, `du`, `free`, `hostname`, `uptime`, `lsof`, `id`, `whoami`, `echo`, `printf`

> **`echo`/`printf` rationale:** classified as `system.read` (low / none) so they don't HITL-prompt for every invocation. Side-effecting shell redirection (`echo > file`) happens at a level we cannot observe regardless of classification; no posture change there.

#### `system.service` — critical / per_request *(v1.3.1)*

Daemon / host-lifecycle management. Critical because a wrong approval can take a host offline non-recoverably.

**Aliases:** `systemctl`, `service`, `init`, `reboot`, `shutdown`, `virsh` (libvirt VM lifecycle inherits the same tier — virsh manages another resource other workloads depend on)

---

### Permissions & access control *(v1.3.1)*

#### `permissions.modify` — high / per_request

File mode / ownership changes. High risk: recoverable (you can chmod back), but a wrong change can lock out files or expose secrets.

**Aliases:** `chmod`, `chown`, `chgrp`, `umask`

#### `permissions.elevate` — critical / per_request

Privilege elevation. Critical: once root, blast radius is unbounded. Per [docs/release-plans/v1.3.2.md](release-plans/v1.3.2.md) §2.2, this class is targeted for a default-forbid policy rule in v1.3.2 — operators who legitimately need privilege elevation use `unsafe_admin_exec`.

**Aliases:** `sudo`, `su`, `doas`, `passwd`

---

### Process management *(v1.3.1)*

#### `process.signal` — high / per_request

Sends signals to running processes. Recoverable (restart the killed process), so high not critical. The explainer warns about uncatchable signals (KILL/SEGV), PID 1 (init crash), and broadcast targets (`-1`).

**Aliases:** `kill`, `pkill`, `killall`

> **Deferred:** `nohup` is intentionally not classified — it is a long-running detachment primitive that fits the v1.4 streams design, not the synchronous-call enforcement model.

---

### Network *(family expanded in v1.3.1)*

#### `network.diagnose` — low / none *(v1.3.1)*

Read-only network diagnostics — same tier as `filesystem.read`. Operators can elevate via policy if their environment is sensitive (e.g. corporate networks where `dig @8.8.8.8 internal-server.corp` constitutes infrastructure leakage; the explainer flags that case).

**Aliases:** `ping`, `traceroute`, `nslookup`, `dig`, `netstat`, `ss`

#### `network.scan` — high / per_request *(v1.3.1)*

Active network probing. High risk: many networks treat port scans as hostile, may trigger IDS, may violate AUP.

**Aliases:** `nmap`

#### `network.transfer` — high / per_request — intent group: `data_exfiltration` *(v1.3.1)*

File-transfer protocols. The `data_exfiltration` intent group joins this with `web.fetch` so a single rule can target the entire data-leaving-the-host cluster.

**Aliases:** `rsync`, `scp`, `sftp`

#### `network.shell` — high / per_request *(v1.3.1)*

Interactive remote shell access. Distinct from `code.execute` (local) and `network.transfer` (file-only over network); same risk tier but different blast-radius semantic (lateral movement to a remote host).

**Aliases:** `ssh`, `mosh`, `telnet` (telnet's plaintext-credential warning fires unconditionally in the explainer)

> **Deferred:** `aws s3 cp` / `gcloud` / heterogeneous cloud CLIs need their own classification pass — they're multi-mode binaries where one subcommand is a transfer (`aws s3 cp`) and another is read-only (`aws ec2 describe-instances`). Currently fall through to `unknown_sensitive_action`.

---

### Cluster management *(v1.3.1, split in v1.3.2)*

`cluster.manage` was introduced in v1.3.1 as a single class and **split in v1.3.2** into `cluster.read` and `cluster.write` per [RFC-003](rfc/RFC-003-cluster-manage.md). Read-vs-write was the dominant operator-fatigue dimension and follows the precedent of `filesystem.read` / `filesystem.write` and `vcs.read` / `vcs.write`.

#### `cluster.read` — low / per_request

Cluster reads disclose workload state without modifying it. Bound to the typed `kubectl_get` tool. No bare-binary alias — free-form `bash kubectl get ...` cannot be parsed for read-vs-write at the alias level and routes to `cluster.write` (the conservative default).

**Aliases:** — (none — only the typed `kubectl_get` tool)

#### `cluster.write` — high / per_request

Cluster writes modify cluster state. Bound to the typed `kubectl_apply`, `kubectl_delete`, `kubectl_rollout` (W5) and `docker_push` (W6) tools, plus the bare `kubectl` alias as a conservative fallback for free-form shell calls.

The explainer dispatches by subcommand (`apply` / `delete` / `get` / `describe` / `logs` / `exec` / `port-forward` / `rollout` / `scale`); the namespace flag (`-n` / `--namespace=`) propagates into every applicable summary. `kubectl exec -it` and `port-forward` carry additional warnings about interactive / long-running sessions (they fit the v1.4 streams design more than the synchronous model).

**Aliases:** `kubectl`

> **Deferred:** `vagrant` is low-volume dev-environment tooling; falls through to `unknown_sensitive_action` until audit data shows it's worth classifying.

---

### Scheduling *(v1.3.1)*

#### `scheduling.persist` — high / per_request

Persistent unattended job scheduling. Per [docs/release-plans/v1.3.2.md](release-plans/v1.3.2.md) §9, the typed-tool wrapper deliberately omits interactive `crontab -e` mode — install-from-file is the supported persistence path; operators needing inline edit use `unsafe_admin_exec`.

**Aliases:** `crontab`, `at`, `batch`, `atq`, `atrm`

---

### Version control

#### `vcs.read` — low / none

Read-only VCS queries (status, log, diff, blame).

**Aliases:** `git_status`, `git-status`, `git.status`, `show_status`, `git_log`, `git-log`, `git.log`, `log_commits`, `view_history`, `git_diff`, `git-diff`, `git.diff`, `view_diff`, `show_diff`

#### `vcs.write` — medium / per_request

Local VCS writes (commit, add, branch, checkout, reset).

**Aliases:** `git_commit`, `git-commit`, `git.commit`, `commit_changes`, `git_add`, `git-add`, `git.add`, `stage_file`, `stage_files`, `git_merge`, `git-merge`, `git.merge`, `merge_branch`, `git_checkout`, `git-checkout`, `git.checkout`, `checkout_branch`, `switch_branch`, `git_branch`, `git-branch`, `git.branch`, `create_branch`, `git_reset`, `git-reset`, `git.reset`, `reset_head`, `undo_commit`

#### `vcs.remote` — medium / per_request

Remote VCS operations with network exposure (clone, push, pull, fetch).

**Aliases:** `git_clone`, `git-clone`, `git.clone`, `clone_repo`, `git_push`, `git-push`, `git.push`, `push_commits`, `git_pull`, `git-pull`, `git.pull`, `pull_changes`, `git_fetch`, `git-fetch`, `git.fetch`, `fetch_remote`

> The bare `git` binary is not in any alias list. The `gitExplain` dispatch in the explainer covers all subcommands when an agent calls `bash` with a `git ...` command, so the rich HITL message body still applies; classification falls through to `unknown_sensitive_action` for the bare-binary path.

---

### Package & build

#### `package.install` — medium / per_request

Dependency / system-package installation.

**Tool-name aliases:** `install_package`, `npm_install`, `pip_install`, `pip3_install`, `yarn_add`, `apt_install`, `brew_install`, `add_package`

**Bare-binary aliases (v1.3.1):** `apt`, `apt-get`, `yum`, `dnf`, `dpkg`, `snap`, `brew`, `pacman`

> Bare-binary distro managers are multi-subcommand (`install` / `remove` / `update` / `upgrade`). All inherit the install tier. Read-only subcommands like `apt update` (metadata refresh) are slightly conservative under this tier; operators can override via policy.

#### `package.run` — medium / per_request *(since v1.2.x)*

Script execution via package managers.

**Aliases:** `npm_run_script`, `npm_run`, `yarn_run`, `pnpm_run`, `run_script`, `make_run`

#### `package.read` — low / none *(since v1.2.x)*

Read-only package metadata queries.

**Aliases:** `pip_list`, `pip3_list`, `pip_freeze`, `npm_list`, `list_packages`

#### `build.compile` — medium / per_request

Build / compilation.

**Aliases:** `run_compiler`, `compile`, `build`, `npm_run_build`, `make`, `tsc`, `javac`, `gcc`, `cargo_build`, `go_build`, `mvn_compile`, `gradle_build`

#### `build.test` — low / none

Test execution.

**Aliases:** `run_tests`, `run_test`, `npm_test`, `npm_run_test`, `yarn_test`, `pytest`, `jest`, `vitest`, `mocha`, `go_test`, `cargo_test`, `mvn_test`, `gradle_test`

#### `build.lint` — low / none

Linting / formatting / type-checking.

**Aliases:** `run_linter`, `run_formatter`, `run_typecheck`, `eslint`, `prettier`, `pylint`, `flake8`, `mypy`, `cargo_clippy`, `golangci_lint`, `rubocop`

---

### Archives *(since v1.2.x; bare-binary expansion in v1.3.1)*

#### `archive.create` — medium / per_request

Archive packing / compression.

**Tool-name aliases:** `archive_create`, `create_archive`, `tar_create`, `tar_czf`, `tar_compress`, `zip_create`, `create_zip`, `compress`, `compress_files`, `gzip`, `bzip2`, `zstd_compress`

**Bare-binary aliases (v1.3.1):** `tar`, `zip`, `xz`, `7z` — multi-mode binaries inherit this tier; the explainer dispatches on the mode flag (`tar c` / `tar x` / `tar t`) for HITL message detail.

> **Security note:** Archive creation tools that accept a glob source pattern can inadvertently capture credential files (`.env`, `~/.ssh/id_rsa`, etc.). Policy rules should inspect the `target` (output path) and source parameters for sensitive path patterns.

#### `archive.extract` — medium / per_request

Archive unpacking.

**Tool-name aliases:** `archive_extract`, `extract_archive`, `unarchive`, `tar_extract`, `tar_xzf`, `tar_decompress`, `unzip`, `gunzip`, `bunzip2`, `decompress`, `extract_files`, `zstd_decompress`

**Bare-binary aliases (v1.3.1):** `unxz`

> **Security note:** Path traversal ("zip slip") is the primary risk. The v1.3.1 explainer warns about path-traversal and decompression bombs on every `tar -x` / `unzip` / `7z x` invocation. Policy rules should validate that the `destination` parameter is an absolute path inside a designated staging area.

#### `archive.read` — low / none

Lists archive contents (table of contents) without extracting.

**Aliases:** `archive_list`, `archive_read`, `list_archive`, `read_archive`, `tar_list`, `tar_tf`, `zip_list`, `list_zip`, `inspect_archive`, `peek_archive`

---

### Fail-closed sentinel

#### `unknown_sensitive_action` — critical / per_request

The fail-closed catch-all for any tool name not registered in the alias index. No aliases — it is the result of a failed lookup, not a named tool.

This class exists to make the registry fail-closed: a tool without registration gets the most restrictive treatment available. Operators who legitimately need a novel tool to have lower risk must add it to the registry or create a reclassification policy rule.

> **Policy note:** `unknown_sensitive_action` also triggers a special check in the enforcement pipeline: any call from an untrusted source that resolves to `high` or `critical` risk is rejected before reaching HITL or Stage 2. Untrusted agents cannot issue unknown tool calls at all.

---

## Target Extraction

The `target` field in a `NormalizedAction` identifies the resource the action operates on. It is extracted by inspecting tool parameters in priority order. When an action class has a per-class override list, the generic list is not consulted.

### Generic fallback (used when no per-class override exists)

| Priority | Parameter key |
|---|---|
| 1 | `file_path` |
| 2 | `path` |
| 3 | `file` |
| 4 | `repo_url` |
| 5 | `package_name` |
| 6 | `url` |
| 7 | `destination` |
| 8 | `to` |
| 9 | `recipient` |
| 10 | `email` |

### Per-class overrides

| Action Class | Key priority (first non-empty wins) |
|---|---|
| `filesystem.read` | `file_path` → `path` → `file` |
| `filesystem.write` | `file_path` → `path` → `file` → `destination` → `url` → `to` → `recipient` → `email` |
| `filesystem.delete` | `file_path` → `path` → `file` |
| `filesystem.list` | `file_path` → `path` → `file` |
| `system.read` | `variable_name` → `name` → `key` |
| `vcs.read` | `path` → `file_path` → `branch` → `ref` → `revision` |
| `vcs.write` | `path` → `file_path` → `working_dir` |
| `vcs.remote` | `repo_url` → `url` → `remote_url` → `remote` |
| `package.install` | `package_name` → `package` → `name` |
| `package.run` | `script` → `script_name` → `name` → `package_name` |
| `package.read` | `package_name` → `package` → `name` |
| `build.compile` | `target` → `path` → `file_path` → `working_dir` |
| `build.test` | `target` → `path` → `working_dir` |
| `build.lint` | `target` → `path` → `file_path` → `working_dir` |
| `archive.create` | `output_path` → `destination` → `archive_path` → `path` → `file_path` |
| `archive.extract` | `destination` → `output_dir` → `archive_path` → `path` → `file_path` |
| `archive.read` | `archive_path` → `path` → `file_path` |
| `shell.exec` | `command` → `cmd` → `script` |
| `code.execute` | `code` → `script` → `command` |

The target is embedded in the HITL approval token binding via `SHA-256(action_class | target | payload_hash)`. An approval issued for `filesystem.delete` on `/tmp/scratch.txt` cannot be replayed against `/home/user/.ssh/id_rsa`.

> **Action classes added in v1.3.1 / v1.3.2** (`system.service`, `permissions.*`, `process.signal`, `network.*`, `cluster.read`, `cluster.write`, `scheduling.persist`) currently use the generic fallback for target extraction. Future passes may add per-class overrides as concrete typed-tool wrappers ship.

---

## Policy Authoring Guide

### Matching by action class

```yaml
- effect: forbid
  action_class: "shell.exec"
  condition: { sourceTrustLevel: untrusted }
  reason: "Untrusted agents may not execute shell commands"

- effect: permit
  action_class: "web.search"
  reason: "Web search is permitted for research agents"
```

### Blocking outbound data flow via intent group

`web.fetch` and `network.transfer` both belong to the `data_exfiltration` intent group. A single rule blocks all members:

```yaml
- effect: forbid
  intent_group: "data_exfiltration"
  reason: "Outbound data movement (HTTP fetch and file transfer) is not permitted"
```

### Targeting privilege elevation

`permissions.elevate` (sudo / su / passwd / doas) is a single-class group. v1.3.2 plans to ship a default-forbid rule on this class; until then, operators should add their own:

```yaml
- effect: forbid
  action_class: "permissions.elevate"
  reason: "Privilege elevation requires explicit operator approval out of band"
  priority: 100
```

### Matching the fail-closed bucket

```yaml
- effect: forbid
  action_class: "unknown_sensitive_action"
  reason: "Unregistered tools are not permitted"
  priority: 100
```

### Risk-tier conditions

```yaml
- effect: forbid
  condition: { risk: critical, channel: production }
  reason: "Critical-risk actions are forbidden in production channel"
```

### Overriding HITL mode in policy

```yaml
# hitl-policy.yaml
policies:
  - name: session-delete-logs
    actions:
      - "filesystem.delete"
    target_pattern: "^/var/log/"
    approval:
      mode: session_approval
      channel: telegram
      timeout: 60
```

---

## Quick Reference

### Action classes that never require HITL by default

| Action Class | Risk |
|---|---|
| `filesystem.read` | low |
| `filesystem.list` | low |
| `memory.read` | low |
| `memory.write` | medium |
| `system.read` | low |
| `network.diagnose` | low |
| `vcs.read` | low |
| `package.read` | low |
| `build.test` | low |
| `build.lint` | low |
| `archive.read` | low |

### Action classes always requiring per-request HITL by default

| Action Class | Risk | Intent Group |
|---|---|---|
| `filesystem.write` | medium | — |
| `filesystem.delete` | high | `destructive_fs` |
| `web.search` | medium | — |
| `web.fetch` | medium | `data_exfiltration` |
| `browser.scrape` | medium | — |
| `web.post` | medium | `web_access` |
| `shell.exec` | high | — |
| `communication.email` | high | `external_send` |
| `communication.slack` | medium | `external_send` |
| `communication.webhook` | medium | `external_send` |
| `credential.read` | high | `credential_access` |
| `credential.write` | critical | `credential_access` |
| `credential.rotate` | critical | `credential_access` |
| `credential.list` | high | `credential_access` |
| `code.execute` | high | — |
| `payment.initiate` | critical | `payment` |
| `system.service` | critical | — |
| `permissions.modify` | high | — |
| `permissions.elevate` | critical | — |
| `process.signal` | high | — |
| `network.scan` | high | — |
| `network.transfer` | high | `data_exfiltration` |
| `network.shell` | high | — |
| `cluster.read` | low | — |
| `cluster.write` | high | — |
| `scheduling.persist` | high | — |
| `vcs.write` | medium | — |
| `vcs.remote` | medium | — |
| `package.install` | medium | — |
| `package.run` | medium | — |
| `build.compile` | medium | — |
| `archive.create` | medium | — |
| `archive.extract` | medium | — |
| `unknown_sensitive_action` | critical | — |

### Intent group summary

| Intent Group | Member Action Classes | Policy use |
|---|---|---|
| `destructive_fs` | `filesystem.delete` | Block all deletion tools |
| `data_exfiltration` | `web.fetch`, `network.transfer` | Forbid outbound data movement (HTTP and file transfer) |
| `web_access` | `web.post` | Gate state-mutating outbound HTTP |
| `external_send` | `communication.email`, `communication.slack`, `communication.webhook` | Block all external messaging channels |
| `credential_access` | `credential.read`, `credential.write`, `credential.rotate`, `credential.list` | Prevent all secrets-store access |
| `payment` | `payment.initiate` | Block financial transactions |

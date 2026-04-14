# Action Registry and Classification System

Complete reference for the 17 canonical action classes recognized by OpenAuthority. Policy authors use this document to understand what each action class covers, its default risk posture, and when human approval is required.

Source of truth: [`src/enforcement/normalize.ts`](../src/enforcement/normalize.ts)

---

## Overview

Every tool call an agent makes is normalized to a canonical **action class** before policy evaluation. The normalization step:

1. Looks up the tool name (case-insensitive) against the registry alias index.
2. Extracts the target resource from tool parameters.
3. Applies post-lookup reclassification rules that can change the action class or raise the risk level.
4. Returns a `NormalizedAction` with a stable `action_class`, effective `risk`, `hitl_mode`, and `target`.

Unknown tool names are **not rejected at lookup time** — they resolve to `unknown_sensitive_action` with critical risk and mandatory per-request HITL. This fail-closed design ensures novel tools cannot bypass enforcement by having an unregistered name.

---

## Complete Action Registry

The table below lists all 17 canonical action classes with their default risk level, default HITL mode, and the tool aliases that map to each class.

| # | Action Class | Risk | HITL Mode | Registered Aliases |
|---|---|---|---|---|
| 1 | `filesystem.read` | low | none | `read_file`, `readfile`, `read_files`, `cat_file`, `view_file`, `open_file`, `get_file_contents` |
| 2 | `filesystem.write` | medium | per_request | `write_file`, `writefile`, `create_file`, `save_file`, `update_file`, `edit_file`, `patch_file` |
| 3 | `filesystem.delete` | high | per_request | `delete_file`, `deletefile`, `remove_file`, `rm_file`, `unlink_file` |
| 4 | `filesystem.list` | low | none | `list_files`, `listfiles`, `list_directory`, `list_dir`, `read_directory`, `ls` |
| 5 | `web.fetch` | low | none | `fetch`, `http_get`, `web_fetch`, `get_url`, `fetch_url`, `http_request` |
| 6 | `web.post` | medium | per_request | `http_post`, `post_url`, `web_post`, `post_request`, `submit_form` |
| 7 | `shell.exec` | high | per_request | `bash`, `shell_exec`, `run_command`, `execute_command`, `run_terminal_cmd`, `terminal_exec`, `cmd` |
| 8 | `communication.email` | high | per_request | `send_email`, `email_send`, `send_mail`, `compose_email`, `email` |
| 9 | `communication.slack` | medium | per_request | `send_slack`, `slack_message`, `slack_send`, `post_slack` |
| 10 | `communication.webhook` | medium | per_request | `call_webhook`, `webhook`, `trigger_webhook`, `post_webhook` |
| 11 | `memory.read` | low | none | `memory_get`, `read_memory`, `get_memory`, `recall`, `retrieve_memory` |
| 12 | `memory.write` | medium | none | `memory_set`, `write_memory`, `set_memory`, `store_memory`, `save_memory`, `remember` |
| 13 | `credential.read` | high | per_request | `read_secret`, `get_secret`, `get_credential`, `retrieve_secret`, `read_credential` |
| 14 | `credential.write` | critical | per_request | `write_secret`, `set_secret`, `set_credential`, `store_secret`, `create_secret` |
| 15 | `code.execute` | high | per_request | `run_code`, `execute_code`, `eval_code`, `python`, `javascript`, `node_exec`, `code_runner` |
| 16 | `payment.initiate` | critical | per_request | `pay`, `payment`, `initiate_payment`, `create_payment`, `charge`, `stripe_payment` |
| 17 | `unknown_sensitive_action` | critical | per_request | *(none — fail-closed catch-all)* |

---

## Risk Level Definitions

Risk levels determine how seriously the enforcement pipeline treats a given action class. They influence HITL requirements, policy default priorities, and whether untrusted-source requests are blocked outright.

| Risk Level | Meaning | Examples |
|---|---|---|
| `low` | Read-only or purely local operations with no side effects visible outside the agent. | Reading a file, listing a directory, fetching a URL, reading memory. |
| `medium` | Writes or outbound calls that have side effects but are bounded and recoverable. | Writing a file, posting to a URL, sending a Slack message, writing to memory. |
| `high` | Irreversible or externally visible actions. Data loss, external communication, or shell access. | Deleting a file, running a shell command, sending email, reading secrets. |
| `critical` | Actions with financial, security, or system-wide impact. No safe default. | Writing credentials, initiating payments, executing arbitrary code, unknown tools. |

### Rationale by Action Class

**`filesystem.read` / `filesystem.list` / `web.fetch` / `memory.read` → low**
These classes observe state without modifying it. The worst-case outcome is information disclosure to the agent, which is bounded by the data the agent already has access to. No external side effects are produced.

**`filesystem.write` / `web.post` / `communication.slack` / `communication.webhook` / `memory.write` → medium**
These classes produce side effects (modifying files, calling external endpoints, posting messages) but are generally reversible or have bounded blast radius. A misrouted Slack message or an overwritten file can be corrected. Memory writes are medium rather than high because memory is agent-internal state with no direct external footprint.

**`filesystem.delete` / `shell.exec` / `communication.email` / `credential.read` / `code.execute` → high**
These classes carry meaningful irreversibility or external exposure:
- `filesystem.delete` destroys data with no undo path.
- `shell.exec` grants arbitrary OS access; a single command can affect anything the agent's process can reach.
- `communication.email` sends content to external parties who may act on it before any correction is possible.
- `credential.read` exposes secret material that may be transmitted or stored by the agent.
- `code.execute` runs arbitrary interpreted code inside a runtime, which can exfiltrate data, make network calls, or modify the environment.

**`credential.write` / `payment.initiate` / `unknown_sensitive_action` → critical**
These classes carry the highest stakes:
- `credential.write` can permanently compromise a system by replacing secrets or injecting attacker-controlled values.
- `payment.initiate` triggers real financial transactions; charges cannot always be reversed.
- `unknown_sensitive_action` is the fail-closed bucket for any tool name not in the registry. By treating the unknown as critical, the system prevents novel tools from evading policy by being unregistered.

---

## HITL Mode Reference

The `default_hitl_mode` field on each registry entry specifies what human-approval behavior applies by default when no HITL policy rule overrides it.

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

> **Note:** Pending approvals are in-memory only and do not survive plugin restarts. Consumed tokens also reset on restart. Operators must re-approve any pending actions after a restart.

---

## Reclassification Rules

After the initial registry lookup, `normalize_action` applies two post-lookup reclassification rules. These rules can change the resolved `action_class` or raise the effective `risk`, overriding the registry defaults.

### Rule 1 — `filesystem.write` with URL target → `web.post`

**Trigger:** The tool name resolves to `filesystem.write` AND the `path`, `file`, `url`, `destination`, or `to` parameter starts with `http://` or `https://`.

**Effect:** The action class is changed to `web.post` and the risk is raised to medium (matching `web.post` defaults). The HITL mode remains `per_request`.

**Rationale:** Some tools accept either a local file path or a URL as a write destination. Writing to a URL is semantically an outbound HTTP POST, not a local file operation. Treating it as `filesystem.write` would understate the external side effects and could bypass web-specific policy rules.

**Example:**

```typescript
normalize_action('write_file', { path: 'https://api.example.com/data', body: '...' })
// → { action_class: 'web.post', risk: 'medium', hitl_mode: 'per_request', ... }
```

### Rule 2 — Shell metacharacters in any parameter → risk raised to `critical`

**Trigger:** Any string-valued parameter contains one or more shell metacharacters: `` ; | & > < ` $ ( ) { } [ ] \ ``

**Effect:** The effective `risk` is raised to `critical` regardless of the base risk from the registry. The action class and HITL mode are unchanged.

**Rationale:** Shell metacharacters in tool parameters are a strong signal of command injection. An agent asked to "read `/etc/passwd`" should not be able to chain `; rm -rf /` by embedding metacharacters in the path parameter. Raising risk to critical ensures these calls hit the highest enforcement tier even if the base action class (e.g., `filesystem.read`) would otherwise be low risk.

**Example:**

```typescript
normalize_action('read_file', { path: '/etc/passwd; cat /etc/shadow' })
// → { action_class: 'filesystem.read', risk: 'critical', hitl_mode: 'none', ... }
//   (risk overridden to 'critical' due to metacharacter detection)
```

> **Note:** Rule 2 raises risk but does not change the HITL mode. A `filesystem.read` call with shell metacharacters resolves to `critical` risk but its default HITL mode remains `none`. Policy rules that match `risk: critical` can enforce HITL or outright denial regardless of the default mode.

---

## Per-Class Detail

### 1. `filesystem.read`

**Risk:** low | **HITL:** none

Reads the content of one or more files from the local filesystem without modifying them. The target is extracted from the `path` or `file` parameter.

| Alias | Typical tool |
|---|---|
| `read_file` | Claude Code built-in Read tool |
| `readfile`, `read_files` | Variant spellings |
| `cat_file`, `view_file` | Unix-inspired tool names |
| `open_file` | GUI-style tool names |
| `get_file_contents` | Verbose descriptive variant |

---

### 2. `filesystem.write`

**Risk:** medium | **HITL:** per_request

Creates or overwrites a file on the local filesystem. Subject to [Rule 1](#rule-1--filesystemwrite-with-url-target--webpost) if the target is a URL.

| Alias | Typical tool |
|---|---|
| `write_file`, `writefile` | Direct write |
| `create_file` | New file creation |
| `save_file` | Save-as semantics |
| `update_file`, `edit_file`, `patch_file` | Modification variants |

---

### 3. `filesystem.delete`

**Risk:** high | **HITL:** per_request

Permanently removes a file or directory. Irreversible without a backup; warrants per-request human approval.

| Alias | Typical tool |
|---|---|
| `delete_file`, `deletefile` | Explicit delete |
| `remove_file`, `rm_file` | Unix-style remove |
| `unlink_file` | POSIX unlink semantics |

---

### 4. `filesystem.list`

**Risk:** low | **HITL:** none

Lists the contents of a directory without modifying anything. Analogous to `filesystem.read` for directories.

| Alias | Typical tool |
|---|---|
| `list_files`, `listfiles` | File listing |
| `list_directory`, `list_dir`, `read_directory` | Directory-centric names |
| `ls` | Unix shorthand |

---

### 5. `web.fetch`

**Risk:** low | **HITL:** none

Performs an HTTP GET or equivalent read-only request to a URL. No side effects on the server are expected.

| Alias | Typical tool |
|---|---|
| `fetch` | Generic fetch |
| `http_get` | Explicit HTTP method |
| `web_fetch`, `get_url`, `fetch_url` | URL-centric variants |
| `http_request` | Neutral HTTP client |

---

### 6. `web.post`

**Risk:** medium | **HITL:** per_request

Sends data to an external URL via HTTP POST or equivalent. Also the reclassified target for `filesystem.write` calls whose destination is a URL.

| Alias | Typical tool |
|---|---|
| `http_post` | Explicit HTTP method |
| `post_url`, `web_post`, `post_request` | URL post variants |
| `submit_form` | Form-submission semantic |

---

### 7. `shell.exec`

**Risk:** high | **HITL:** per_request

Executes an arbitrary shell command in the agent's operating environment. One of the most powerful and dangerous action classes; a single command can affect any resource accessible to the process.

| Alias | Typical tool |
|---|---|
| `bash` | Bash execution |
| `shell_exec`, `run_command`, `execute_command` | Generic shell execution |
| `run_terminal_cmd`, `terminal_exec` | Terminal-framing variants |
| `cmd` | Windows Command Prompt shorthand |

---

### 8. `communication.email`

**Risk:** high | **HITL:** per_request

Sends an email message to an external recipient. High risk because: the message leaves the controlled environment immediately, the recipient may act on its contents before correction, and email is a common vector for social engineering.

| Alias | Typical tool |
|---|---|
| `send_email`, `email_send` | Direct send |
| `send_mail` | SMTP-style naming |
| `compose_email` | Composition-centric variant |
| `email` | Short-form alias |

---

### 9. `communication.slack`

**Risk:** medium | **HITL:** per_request

Posts a message to a Slack channel or user. Medium risk because messages are internal to a workspace and can be deleted or edited, unlike email.

| Alias | Typical tool |
|---|---|
| `send_slack` | Direct send |
| `slack_message`, `slack_send` | Slack-specific variants |
| `post_slack` | Post-centric naming |

---

### 10. `communication.webhook`

**Risk:** medium | **HITL:** per_request

Sends an HTTP payload to an external webhook endpoint. Medium risk: the payload is bounded and the endpoint is typically known, but the action has external side effects outside the agent's control.

| Alias | Typical tool |
|---|---|
| `call_webhook`, `webhook` | Direct invocation |
| `trigger_webhook` | Event-trigger framing |
| `post_webhook` | HTTP-centric naming |

---

### 11. `memory.read`

**Risk:** low | **HITL:** none

Reads from agent-internal memory storage. No external side effects; analogous to `filesystem.read` for in-process state.

| Alias | Typical tool |
|---|---|
| `memory_get`, `get_memory` | Key-value read |
| `read_memory` | Storage-centric naming |
| `recall`, `retrieve_memory` | Semantic/cognitive framing |

---

### 12. `memory.write`

**Risk:** medium | **HITL:** none

Writes to agent-internal memory storage. Medium risk because persistent memory can influence future agent decisions, but the blast radius is limited to the agent's own session state. No HITL by default because operator review of every memory update would create severe fatigue with minimal security benefit.

| Alias | Typical tool |
|---|---|
| `memory_set`, `set_memory` | Key-value write |
| `write_memory`, `store_memory`, `save_memory` | Storage-centric variants |
| `remember` | Cognitive-framing alias |

---

### 13. `credential.read`

**Risk:** high | **HITL:** per_request

Reads a secret, API key, or credential from a secrets store. The credential value may be retained in agent context or transmitted — once exposed, it cannot be un-exposed.

| Alias | Typical tool |
|---|---|
| `read_secret`, `get_secret` | Generic secret access |
| `get_credential`, `read_credential` | Credential-centric variants |
| `retrieve_secret` | Retrieval framing |

---

### 14. `credential.write`

**Risk:** critical | **HITL:** per_request

Creates, updates, or replaces a credential in a secrets store. Critical risk because a malicious or erroneous write can permanently compromise a service by replacing a legitimate secret with an attacker-controlled value.

| Alias | Typical tool |
|---|---|
| `write_secret`, `set_secret` | Generic write |
| `set_credential`, `store_secret` | Credential/storage variants |
| `create_secret` | Creation framing |

---

### 15. `code.execute`

**Risk:** high | **HITL:** per_request

Runs arbitrary code within an interpreter (Python, JavaScript, etc.). Similar to `shell.exec` in power, but scoped to a runtime rather than the OS shell. The interpreter can still make network calls, read files, and exfiltrate data.

| Alias | Typical tool |
|---|---|
| `run_code`, `execute_code` | Generic execution |
| `eval_code` | Eval-semantic framing |
| `python`, `javascript` | Language-specific runners |
| `node_exec`, `code_runner` | Runtime-centric variants |

---

### 16. `payment.initiate`

**Risk:** critical | **HITL:** per_request

Initiates a financial transaction via a payment processor. Critical risk because charges may be irreversible, involve real money, and have legal and contractual implications.

| Alias | Typical tool |
|---|---|
| `pay`, `payment` | Short-form invocations |
| `initiate_payment`, `create_payment` | Explicit initiation framing |
| `charge` | Charge-centric alias |
| `stripe_payment` | Provider-specific alias |

---

### 17. `unknown_sensitive_action`

**Risk:** critical | **HITL:** per_request

The fail-closed catch-all for any tool name not registered in the alias index. No aliases are defined for this class — it is the result of a failed lookup, not a named tool.

This class exists to make the registry fail-closed: a tool without a registration gets the most restrictive treatment available. Operators who legitimately need a novel tool to have lower risk must add it to the registry or create a reclassification policy rule.

> **Policy note:** `unknown_sensitive_action` also triggers a special check in the enforcement pipeline: any call from an untrusted source that resolves to `high` or `critical` risk is rejected before reaching HITL or Stage 2. This means untrusted agents cannot issue unknown tool calls at all.

---

## Target Extraction

The `target` field in a `NormalizedAction` identifies the resource the action operates on. It is extracted by inspecting tool parameters in the following priority order:

| Priority | Parameter key | Typical usage |
|---|---|---|
| 1 | `path` | Local filesystem path |
| 2 | `file` | File name or path |
| 3 | `url` | HTTP URL |
| 4 | `destination` | Output location |
| 5 | `to` | Recipient or endpoint |
| 6 | `recipient` | Email/message recipient |
| 7 | `email` | Email address |

The first non-empty string value found is used as the target. If no recognized parameter contains a non-empty string, the target is the empty string `""`.

The target is embedded in the HITL approval token binding via `SHA-256(action_class|target|payload_hash)`. This means an approval issued for `filesystem.delete` on `/tmp/scratch.txt` cannot be replayed against `/home/user/.ssh/id_rsa`.

---

## Policy Authoring Guide

### Matching by action class

Use `action_class` in policy rules to match the normalized class string:

```yaml
# Deny all shell execution for untrusted agents
- effect: forbid
  action_class: "shell.exec"
  condition: { sourceTrustLevel: untrusted }
  reason: "Untrusted agents may not execute shell commands"
```

### Matching the fail-closed bucket

To treat all unknown tools as a hard deny (rather than HITL):

```yaml
- effect: forbid
  action_class: "unknown_sensitive_action"
  reason: "Unregistered tools are not permitted"
  priority: 100
```

### Using risk level in conditions

Risk level is available in rule context as `risk`. Rules can match based on effective risk after reclassification:

```yaml
- effect: forbid
  condition: { risk: critical, channel: production }
  reason: "Critical-risk actions are forbidden in production channel"
```

### Overriding HITL mode in policy

The default HITL mode from the registry can be overridden by a HITL policy rule that matches the action. For example, to require session-level approval (instead of per-request) for `filesystem.delete` on a specific path pattern:

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

### Actions that never require HITL by default

| Action Class | Risk |
|---|---|
| `filesystem.read` | low |
| `filesystem.list` | low |
| `web.fetch` | low |
| `memory.read` | low |
| `memory.write` | medium |

### Actions always requiring per-request HITL by default

| Action Class | Risk |
|---|---|
| `filesystem.write` | medium |
| `filesystem.delete` | high |
| `web.post` | medium |
| `shell.exec` | high |
| `communication.email` | high |
| `communication.slack` | medium |
| `communication.webhook` | medium |
| `credential.read` | high |
| `credential.write` | critical |
| `code.execute` | high |
| `payment.initiate` | critical |
| `unknown_sensitive_action` | critical |

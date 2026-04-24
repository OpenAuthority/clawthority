# Threat Model

## What Clawthority enforces

Clawthority intercepts tool calls at the `before_tool_call` hook in OpenClaw's
tool dispatcher. Every call that passes through the dispatcher — including all
OpenClaw built-in tools (`read`, `write`, `edit`, `exec`, `web_fetch`,
`web_search`, `message`, `apply_patch`, `code_execution`, and others) — is
evaluated against policy before execution.

If policy says **forbid**, the call is never placed. The audit log records
the block. The agent receives an error and cannot retry the same call without
a rule change or HITL approval.

## What Clawthority does NOT enforce

Clawthority enforces **in-band tool calls only** — calls that go through
OpenClaw's tool dispatcher. The following are **out of scope**:

| Execution path | Enforced? |
|---|---|
| Agent → tool dispatcher → `read` | ✅ Yes |
| Agent → tool dispatcher → `exec` | ✅ Yes |
| Agent → tool dispatcher → `web_fetch` | ✅ Yes |
| Skill (Node.js module) → `fs.readFileSync()` directly | ❌ No |
| Skill (Node.js module) → `child_process.exec()` directly | ❌ No |
| Skill (Node.js module) → `fetch()` directly | ❌ No |
| External process launched outside OpenClaw | ❌ No |

**Skills and workspace helpers** that call Node.js APIs directly (`fs`,
`child_process`, `net`, raw `fetch`) run inside the OpenClaw process but
outside the tool dispatcher. Clawthority cannot intercept these calls.

This is a boundary in the current OpenClaw plugin API, not a Clawthority bug.
A fix requires OpenClaw to route skill I/O through the tool dispatcher, or to
provide a lower-level interception hook. See the [upstream issue](https://github.com/openclaw/openclaw/issues) for progress.

## Practical implication

In **open mode** (default): built-in forbidden actions (`shell.exec`,
`code.execute`, `payment.initiate`, credentials) are blocked for all in-band
tool calls. A skill that calls `child_process` directly bypasses this.

In **closed mode** (`CLAWTHORITY_MODE=closed`): all in-band tool calls require
an explicit permit rule. Out-of-band calls are still not intercepted.

**Recommendation:** If your threat model requires preventing all shell or
filesystem access by the agent process, combine Clawthority with OS-level
sandboxing (macOS sandbox-exec, Linux seccomp/namespaces, Docker with a
restricted profile). Clawthority handles the in-band layer; the OS sandbox
handles the process layer.

## Closed mode

By default, Clawthority runs in **open mode**: implicit permit with a
critical-forbid safety net. This is the right default for most users — zero
friction, works out of the box.

For production or security-sensitive deployments, switch to **closed mode**:

```bash
export CLAWTHORITY_MODE=closed
openclaw gateway restart
```

In closed mode, every tool call is denied unless an explicit `permit` rule
matches. Start with this baseline `rules.json` and add what you need:

```json
[
  { "effect": "permit", "action_class": "filesystem.read" },
  { "effect": "permit", "action_class": "filesystem.list" },
  { "effect": "permit", "action_class": "memory.read" },
  { "effect": "permit", "action_class": "memory.write" },
  { "effect": "permit", "action_class": "web.search" },
  { "effect": "permit", "action_class": "web.fetch" }
]
```

Everything not listed — `filesystem.write`, `filesystem.delete`, `shell.exec`,
`code.execute`, `communication.*`, `payment.initiate`, credentials — is
implicitly denied.

> **Note:** Mode is read once at activation. Restart the gateway to apply a
> mode change.

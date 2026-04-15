# OpenAuthority

**A semantic authorization runtime for AI agents. Define what your agent can do, enforce it at the boundary, and keep a human in the loop for what matters.**

OpenAuthority is a policy engine plugin for [OpenClaw](https://github.com/openclaw/openclaw) that sits between your AI agent and every tool it calls. It evaluates rules before execution happens — not by asking the model to comply, but by intercepting the call at the code boundary. If policy says no, the call is never placed.

## What's new in v0.1

v0.1 is a ground-up restructure around a **two-stage enforcement pipeline** and a **canonical action registry**. It replaces the previous ABAC/JSON-rules engine and the UI/control-plane surface.

**Highlights**

- **Two-stage pipeline** — Stage 1 capability gate (approval binding, TTL, one-time consumption, session scope) + Stage 2 CEE (protected paths, trusted domains, policy engine).
- **Action normalization** — raw tool names are mapped to a canonical action registry (`filesystem.read`, `communication.external.send`, `payment.transfer`, …) with risk + default HITL mode. Unknown tools fail closed as `unknown_sensitive_action`.
- **SHA-256 payload-bound approvals** — an approval is cryptographically bound to `(action_class, target, payload_hash)`. Tampering with parameters after approval invalidates it.
- **IAuthorityAdapter** — policy bundles and capability issuance sit behind a swappable adapter (`FileAuthorityAdapter` ships by default).
- **Versioned policy bundles** — `data/bundles/active/bundle.json` with monotonic version + SHA-256 checksum, hot-reloaded within ~500ms.
- **Prompt-injection defense** — `before_prompt_build` hook blocks common injection patterns in non-user content.
- **Source trust propagation** — tool calls originating from `untrusted` content (web fetch, email, file read) are denied for high/critical-risk action classes, even with a valid approval.
- **HITL fully wired** — Telegram and Slack approval adapters, approval messages include action / target / summary / expiry / token.
- **Fail closed** — any error in the pipeline returns `deny`.

**Removed**

- Legacy ABAC/JSON rules engine (`src/engine.ts`, `src/rules.ts`, `data/rules.json`, `data/builtin-rules.json`)
- UI dashboard (`ui/`) and control-plane API (`control-plane-api/`)
- Raw tool-name matching in HITL (matching now happens on `action_class`)

## How it works

```
Agent picks a tool → OpenAuthority intercepts
      │
      │  normalize_action(toolName, params) → { action_class, target, payload_hash }
      │  buildEnvelope(...)                  → ExecutionEnvelope
      ▼
┌──────────────────────── Pipeline ────────────────────────┐
│  Stage 1: Capability Gate                                │
│    • low-risk bypass                                     │
│    • approval_required / TTL / payload binding           │
│    • one-time consumption, session scope                 │
│    • untrusted source + high risk → deny                 │
│                                                          │
│  Stage 2: Constraint Enforcement Engine                  │
│    • protected path check (~/.ssh, /etc/, .env, …)       │
│    • trusted domain check (communication.external.send)  │
│    • PolicyEngine.evaluateByActionClass(...)             │
│                                                          │
│  HITL: if required and no valid capability               │
│    → issue approval via Telegram / Slack                 │
│    → deny 'pending_hitl_approval'                        │
└──────────────────────────────────────────────────────────┘
      │
      ├── allow → tool executes
      └── deny  → tool call never placed; ExecutionEvent logged
```

Every decision emits an `ExecutionEvent` to the append-only JSONL audit log with `action_class`, `target`, `decision`, `deny_reason`, `latency_ms`, and `context_hash`.

## Action registry

Tool calls are normalized to a canonical action class before policy evaluation. Examples:

| action_class | risk | default HITL | sample aliases |
|---|---|---|---|
| `filesystem.read` | low | none | `read_file`, `ls`, `glob`, `cat` |
| `filesystem.write` | medium | session | `write_file`, `edit_file`, `str_replace` |
| `filesystem.delete` | high | approve_once | `rm`, `delete_file`, `unlink` |
| `communication.external.send` | high | approve_once | `send_email`, `gmail`, `mail` |
| `payment.transfer` | critical | approve_once | `wire_transfer`, `transfer_funds` |
| `system.execute` | high | approve_once | `exec`, `bash`, `run_command` |
| `credential.write` | critical | approve_once | `set_secret`, `keychain_set` |
| `unknown_sensitive_action` | critical | approve_once | *(fallback for unknown tools)* |

**Parameter reclassification** — a `filesystem.write` with a URL or email-shaped target is reclassified to `communication.external.send`; shell metacharacters in `system.execute` / `filesystem.write` params escalate risk to `critical`.

Full table in [docs/action-registry.md](docs/action-registry.md).

## Human-in-the-Loop

High-risk actions route to a human for approval via Telegram or Slack. Approvals are:

- **Payload-bound** — SHA-256 of `(action_class | target | payload_hash)` is stored with the approval and re-verified at consumption. Any parameter change invalidates the token.
- **One-time** (`approve_once`) or **session-scoped** (`session`) — session approvals are keyed on `${session_id}:${action_class}`.
- **TTL-limited** — default 120 seconds, configurable.
- **UUID v7** — time-sortable approval IDs.

Example approval message:

```
Action:  communication.external.send
Target:  user@partner.com
Summary: communication.external.send → user@partner.com
Expires: 2026-04-14T12:34:56Z
Token:   01f2e4b8-...
```

Details: [docs/human-in-the-loop.md](docs/human-in-the-loop.md).

## The Skill vs The Plugin

| | **The Skill** | **The Plugin** |
|---|---|---|
| **Lives in** | Context window (model sees it) | Execution path (between agent + tools) |
| **Enforces via** | Model reasoning — asks it to comply | Code boundary — before call is placed |
| **Can be bypassed?** | Yes — prompt injection, loop misfire | No — operates outside the model's loop |
| **Gives you** | Observability + soft stop | Hard enforcement + immutable audit log |

> *A skill asks the model to enforce. A plugin enforces regardless of what the model decides.*

## Quick start

### Install

```bash
git clone https://github.com/OpenAuthority/openauthority ~/.openclaw/plugins/openauthority
cd ~/.openclaw/plugins/openauthority
npm install && npm run build
```

Register in `~/.openclaw/config.json`:

```json
{ "plugins": ["openauthority"] }
```

### Configure

`openclaw.plugin.json` fields (all optional):

```json
{
  "bundlePath":   "data/bundles/active",
  "proposalPath": "data/bundles/proposals",
  "auditLogFile": "data/audit.jsonl",
  "cee": {
    "trustedDomains": ["company.com"],
    "protectedPaths": ["~/.ssh/", "~/.gnupg/", "/etc/", "~/.env", ".env", "~/.aws/"]
  },
  "hitl": {
    "telegram": { "botToken": "...", "chatId": "..." },
    "slack":    { "botToken": "xoxb-...", "channelId": "C0...", "signingSecret": "...", "interactionPort": 3201 }
  }
}
```

### Policy bundles

Rules live in `data/bundles/active/bundle.json`:

```json
{
  "version": 1,
  "rules": [
    { "effect": "permit", "action_class": "filesystem.read",  "priority": 10 },
    { "effect": "forbid", "action_class": "system.execute",   "priority": 100 },
    { "effect": "forbid", "action_class": "payment.transfer", "priority": 90 }
  ],
  "checksum": "<SHA-256 of JSON.stringify(rules)>"
}
```

The adapter watches the bundle directory, validates version monotonicity and checksum, and hot-reloads on change. In production, set the `active/` directory read-only for the OpenAuthority process user; only your deployment pipeline should have write access.

## Hooks

| Hook | Purpose |
|---|---|
| `before_tool_call` | Primary enforcement — normalize, run two-stage pipeline, emit audit event |
| `before_prompt_build` | Prompt-injection defense — blocks known injection patterns in non-user content |

## Project structure

```
src/
  index.ts                   — plugin entry, hook registration, wiring
  types.ts                   — ExecutionEnvelope, Intent, Capability, CeeDecision, …
  envelope.ts                — buildEnvelope, uuidv7, computePayloadHash, computeContextHash
  audit.ts                   — JsonlAuditLogger
  enforcement/
    pipeline.ts              — executePipeline orchestrator
    normalize.ts             — canonical action registry + normalizer
    stage1-capability.ts     — Stage 1 capability gate
    stage2-policy.ts         — Stage 2 CEE factory
  policy/
    engine.ts                — PolicyEngine + evaluateByActionClass
    bundle.ts                — validateBundle (schema, monotonicity, checksum)
    types.ts                 — Rule, Effect, RateLimit
    rules/default.ts         — default action-class rules
  adapter/
    types.ts                 — IAuthorityAdapter, ApprovalRequest, PolicyBundle
    file-adapter.ts          — FileAuthorityAdapter (watches bundles/active)
  hitl/
    approval-manager.ts      — payload-bound approvals, session + approve_once
    matcher.ts               — action_class dot-notation matching
    telegram.ts, slack.ts    — approval channel adapters
data/
  bundles/
    active/bundle.json       — active policy bundle
    proposals/               — staged bundle proposals
  audit.jsonl                — append-only execution-event log
docs/                        — architecture, action registry, HITL, configuration
```

## Development

```bash
npm install
npm run dev     # watch mode
npm run build   # production build
npm test        # vitest
```

## Documentation

| Guide | Description |
|---|---|
| [Architecture](docs/architecture.md) | ExecutionEnvelope, two-stage pipeline, adapter swap path |
| [Configuration](docs/configuration.md) | Full config schema with examples |
| [Action Registry](docs/action-registry.md) | All canonical action classes, aliases, risk, HITL modes |
| [Human-in-the-Loop](docs/human-in-the-loop.md) | Payload binding, session vs approve_once, message format |
| [Rule Deletion](docs/rule-deletion.md) | Step-by-step guide for removing rules from the active policy bundle |

## License

Apache-2.0

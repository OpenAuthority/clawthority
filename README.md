# OpenAuthority

**A semantic authorization runtime for AI agents. Define what your agent can do, enforce it at the boundary, and keep a human in the loop for what matters.**

OpenAuthority is a policy engine plugin for [OpenClaw](https://github.com/openclaw/openclaw) that sits between your AI agent and every tool it calls. It evaluates rules before execution happens — not by asking the model to comply, but by intercepting the call at the code boundary. If policy says no, the call is never placed.

## What's new in v0.2

v0.2 replaces the TypeScript policy engine with **Cedar WASM** as the sole authorization engine.

**Highlights**

- **Cedar WASM engine** — `@cedar-policy/cedar-wasm@4.9.1` evaluates all Stage 2 policy decisions. Policies are authored in `.cedar` files under `data/policies/`.
- **Forbid-wins semantics** — Cedar's built-in `forbid` overrides any `permit` for the same request; no escape hatches.
- **Tier system** — policies are organized into tier 10 (unconditional permits), tier 50 (conditional permits), and tier 100 (hard denies) using Cedar `@tier` annotations.
- **~2.6 MB WASM footprint** — the `/nodejs` CJS subpath is ~2.6 MB at runtime; total package on disk is ~12.2 MB. Loaded once at activation.
- **Entity model** — `OpenAuthority::Agent` (principal), `OpenAuthority::Resource` (resource with `actionClass` attribute), `OpenAuthority::Action::RequestAccess` (single action).

**Removed**

- TypeScript policy engine (`src/policy/ts-engine.ts`) — no longer used in production. Cedar WASM is the sole engine.
- `condition` field in rules (JS function bodies) — use Cedar `when` clauses in `.cedar` files instead.
- `match` / `resource` fields for tool-name pattern matching — use `action_class` in bundle rules and `resource.actionClass` in Cedar policies.

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

### Policy files

Cedar policies live in `data/policies/*.cedar`. Add or edit these files to define what agents can and cannot do:

```cedar
// data/policies/tier10-permits.cedar
@id("10-filesystem-read")
@tier("10")
@reason("Filesystem read operations are permitted for all agents")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "filesystem.read" };
```

```cedar
// data/policies/tier100-forbids.cedar
@id("100-payment-transfer")
@tier("100")
@reason("Payment transfers require human-in-the-loop approval")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "payment.transfer" };
```

### JSON rules bundle

The bundle at `data/bundles/active/bundle.json` provides a simpler JSON interface for action-class permit/forbid rules without Cedar syntax:

```json
{
  "version": 1,
  "rules": [
    { "effect": "permit", "action_class": "filesystem.read",  "reason": "Low-risk read" },
    { "effect": "forbid", "action_class": "system.execute",   "reason": "Hard deny" },
    { "effect": "forbid", "action_class": "payment.transfer", "reason": "Hard deny" }
  ],
  "checksum": "<SHA-256 of JSON.stringify(rules)>"
}
```

The adapter watches the bundle directory, validates version monotonicity and checksum, and hot-reloads on change. In production, set the `active/` directory read-only for the OpenAuthority process user; only your deployment pipeline should have write access.

See the [Policy Authoring Guide](docs/policy-authoring.md) for full `.cedar` syntax and the [Configuration Reference](docs/configuration.md) for the bundle schema.

## Hooks

| Hook | Purpose |
|---|---|
| `before_tool_call` | Primary enforcement — normalize, run two-stage pipeline, emit audit event |
| `before_prompt_build` | Prompt-injection defense — blocks known injection patterns in non-user content |

## Project structure

```
src/
  index.ts                   — plugin exports (Cedar engine, HITL, audit, …)
  types.ts                   — ExecutionEnvelope, Intent, Capability, CeeDecision, …
  envelope.ts                — buildEnvelope, uuidv7, computePayloadHash, computeContextHash
  audit.ts                   — JsonlAuditLogger
  enforcement/
    pipeline.ts              — executePipeline orchestrator
    normalize.ts             — canonical action registry + normalizer
    stage1-capability.ts     — Stage 1 capability gate
    stage2-policy.ts         — Stage 2 Cedar engine factory
    decision.ts              — StructuredDecision type layer
  policy/
    cedar-engine.ts          — CedarEngine (Cedar WASM evaluation)
    cedar-entities.ts        — Cedar entity hydration from RuleContext
    cedar/
      schema.cedarschema.json — Cedar entity schema (OpenAuthority namespace)
    bundle.ts                — validateBundle (schema, monotonicity, checksum)
    types.ts                 — Rule, Effect, RateLimit, EvaluationDecision
    coverage.ts              — CoverageMap (dashboard coverage tracking)
    loader.ts                — loadPolicyFile (JSON bundle reader)
  adapter/
    types.ts                 — IAuthorityAdapter, ApprovalRequest, PolicyBundle
    file-adapter.ts          — FileAuthorityAdapter (watches bundles/active)
  hitl/
    approval-manager.ts      — payload-bound approvals, session + approve_once
    matcher.ts               — action_class dot-notation matching
    telegram.ts, slack.ts    — approval channel adapters
  watcher.ts                 — hot-reload watcher for data/rules.json
data/
  policies/
    tier10-permits.cedar     — Cedar Tier 10: unconditional permit rules
    tier100-forbids.cedar    — Cedar Tier 100: hard deny rules
  bundles/
    active/bundle.json       — active JSON rules bundle (hot-reloaded)
    proposals/               — staged bundle proposals
  audit.jsonl                — append-only execution-event log
docs/                        — architecture, API, action registry, HITL, configuration
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
| [Architecture](docs/architecture.md) | ExecutionEnvelope, two-stage pipeline, Cedar engine, adapter swap path |
| [Policy Authoring](docs/policy-authoring.md) | Cedar `.cedar` syntax, entity model, tier system, migration guide |
| [API Reference](docs/api.md) | Cedar policy format, JSON bundle schema, TypeScript evaluation API |
| [Configuration](docs/configuration.md) | Full config schema with examples |
| [Cedar Design](docs/cedar-design.md) | Entity model, attribute hydration, hot-reload, migration from regex/JS |
| [Action Registry](docs/action-registry.md) | All canonical action classes, aliases, risk, HITL modes |
| [Human-in-the-Loop](docs/human-in-the-loop.md) | Payload binding, session vs approve_once, message format |

## License

Apache-2.0

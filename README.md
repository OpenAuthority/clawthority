# OpenAuthority

**A governance layer for AI agents. Define what your agent can do, enforce it at the boundary, and keep a human in the loop for what matters.**

OpenAuthority is a policy engine plugin for [OpenClaw](https://github.com/openclaw/openclaw) that sits between your AI agent and every tool it calls. It evaluates rules before execution happens --- not by asking the model to comply, but by intercepting the call at the code boundary. If the policy says no, the call is never placed.

## Why This Exists

AI agents are powerful. They're also unpredictable. A misconfigured cron job can burn through your API budget overnight. A third-party skill can silently read files outside its declared scope. An ambiguous instruction like "clean up this thread" can result in 340 deleted emails.

OpenAuthority gives you three things the agent runtime doesn't:

- **Hard enforcement** --- budget caps, capability gates, and tool restrictions that the model cannot bypass
- **Human-in-the-Loop (HITL)** --- route high-stakes actions to a human for approval via Telegram or other messaging channels before execution
- **Audit trail** --- every tool call logged at code level with exact arguments, timestamps, and policy decisions

## How It Works

```
Agent reasons → picks a tool → OpenAuthority intercepts
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
               Policy Engine    HITL Check       Audit Logger
               (permit/forbid)  (ask-user?)      (provenance log)
                    │                 │                 │
                    └─────────────────┼─────────────────┘
                                      │
                              allow ──┤── deny: call never placed
                                      │── ask-user: pause, route to
                                      │   human via Telegram/messaging
                                      ▼
                              Tool executes (or doesn't)
```

Every agent action flows through a pipeline:

1. **Normalise** --- the raw tool call is converted into a structured action request
2. **Evaluate** --- the Cedar-style policy engine checks rules (forbid-wins semantics)
3. **Gate** --- if `forbid`, the call is blocked; if `permit`, it proceeds. HITL `ask-user` routing is on the [roadmap](docs/roadmap.md).
4. **Audit** --- the decision is logged for provenance

## Human-in-the-Loop (HITL)

> **Status: framework built, integration pending.** The HITL policy schema, action pattern matcher, file parser, and hot-reload watcher are built and tested (48 test cases). The hook integration (wiring into `before_tool_call`) and the Telegram approval adapter are the next items on the [roadmap](docs/roadmap.md).

For irreversible or high-stakes actions, the HITL system will pause the agent and route the decision to a human for approval via Telegram or other messaging channels.

### How it will work

1. You declare which actions require approval in a policy file (YAML or JSON)
2. When the agent attempts a matching action, the plugin intercepts it
3. An approval request is sent to the configured channel (Telegram, Slack, or other messaging integration)
4. The agent waits for a response (approve/reject) or until timeout
5. On timeout, the configured fallback applies (`deny` or `auto-approve`)

### Example policy

```yaml
version: "1"
policies:
  - name: destructive-actions
    description: Require human approval for irreversible operations
    actions:
      - "email.delete"
      - "email.send"
      - "file.delete"
      - "*.deploy"
    approval:
      channel: telegram
      timeout: 120
      fallback: deny
    tags: [production, safety]

  - name: financial-actions
    actions:
      - "payment.*"
      - "invoice.send"
    approval:
      channel: telegram
      timeout: 300
      fallback: deny
    tags: [finance]
```

### Pattern matching

Actions use dot-notation with wildcards:

| Pattern | Matches | Does NOT match |
|---|---|---|
| `"email.delete"` | `email.delete` | `email.send`, `file.delete` |
| `"email.*"` | `email.delete`, `email.send` | `file.delete`, `email.draft.save` |
| `"*.delete"` | `email.delete`, `file.delete` | `email.send` |
| `"*"` | everything | --- |

Policies are evaluated in declaration order. First match wins.

For the full HITL reference, see [docs/human-in-the-loop.md](docs/human-in-the-loop.md).

## The Skill vs The Plugin

OpenAuthority ships as two components that serve different purposes:

| | **The Skill** | **The Plugin** |
|---|---|---|
| **Lives in** | Context window (model sees it) | Execution path (between agent + tools) |
| **Enforces via** | Model reasoning --- asks it to comply | Code boundary --- before call is placed |
| **Can be bypassed?** | Yes --- prompt injection, loop misfire | No --- operates outside the model's loop |
| **Gives you** | Observability + soft stop | Hard enforcement + immutable audit log |
| **Best for** | Day-one visibility, understanding your agent | Production, user-facing agents, anything irreversible |

**Start with the skill** to see what your agent is doing. **Graduate to the plugin** when you need enforcement that can't be talked past.

> *A skill asks the model to enforce. A plugin enforces regardless of what the model decides. This is not a marketing distinction --- it is an architectural one.*

## Quick Start

### Plugin installation

```bash
git clone https://github.com/Firma-AI/openauthority ~/.openclaw/plugins/openauthority
cd ~/.openclaw/plugins/openauthority
npm install && npm run build
```

Register in `~/.openclaw/config.json`:

```json
{
  "plugins": ["openauthority"]
}
```

### Define your policy

Create `data/rules.json` with your rules, or edit `src/policy/rules/default.ts` for TypeScript-based rules. The plugin hot-reloads on save --- no restart needed.

### HITL policy

Create a `hitl-policy.yaml` file:

```yaml
version: "1"
policies:
  - name: require-approval
    actions: ["email.delete", "file.delete", "*.deploy"]
    approval:
      channel: telegram
      timeout: 120
      fallback: deny
```

## Documentation

| Guide | Description |
|---|---|
| [Installation](docs/installation.md) | Step-by-step setup for the plugin and UI dashboard |
| [Configuration](docs/configuration.md) | All configuration options and schema reference |
| [Usage](docs/usage.md) | Common policy patterns and examples |
| [Human-in-the-Loop](docs/human-in-the-loop.md) | HITL approval flows, Telegram integration, and policy reference |
| [Architecture](docs/architecture.md) | Design overview, hooks pipeline, and key decisions |
| [API Reference](docs/api.md) | REST endpoints for the dashboard server |
| [Cedar Compilation](docs/cedar-compilation.md) | Cedar policy language compilation guide |
| [SecuritySPEC Schema](docs/securityspec-schema.md) | SecuritySPEC YAML schema reference |
| [Roadmap](docs/roadmap.md) | What's shipped, in progress, and planned next |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |
| [Contributing](docs/contributing.md) | Development setup and PR process |

## Architecture

### Two policy engines

| | ABAC Engine | Cedar-Style Engine |
|---|---|---|
| **Semantics** | Priority-ordered, allow/deny | Forbid-wins, permit/forbid |
| **Rule format** | TypeBox-validated JSON schema | Plain TypeScript objects |
| **Rate limiting** | Not supported | Built-in sliding window |
| **Use case** | Structured attribute-based access control | Lifecycle hook gating, tool/command/prompt/model restrictions |

### Gateway hooks

The plugin implements three OpenClaw gateway hooks. Currently only `before_tool_call` is active:

- **`before_tool_call`** (active) --- primary enforcement hook. Evaluates Cedar rules, JSON rules, and ABAC policies. Can block execution.
- **`before_prompt_build`** (implemented, disabled) --- prompt injection detection (10 regex patterns). Will be re-enabled after false-positive tuning.
- **`before_model_resolve`** (implemented, disabled) --- model routing. Waiting for OpenClaw to pass the model name in the event payload.

### Key design decisions

- **Forbid-wins semantics** --- a single `forbid` rule overrides any number of `permit` rules. Security-conservative by default.
- **Configurable default** --- no matching rule defaults to `permit` (implicit allow) so OpenClaw tools are never accidentally blocked. Can be set to `forbid` for locked-down deployments.
- **Hot reload** --- edit rules, save, new rules take effect in ~300ms. No restart.
- **Fail closed** --- if the engine errors during evaluation, the action is denied.

## Project Structure

```
src/
  index.ts          — Plugin entry point and OpenClaw integration
  engine.ts         — ABAC PolicyEngine (add/remove/evaluate policies)
  rules.ts          — Rule evaluation logic and condition operators
  types.ts          — TypeBox schemas and TypeScript types
  audit.ts          — AuditLogger and audit handlers
  watcher.ts        — Hot-reload file watcher for rules
  policy/
    engine.ts       — Cedar-style PolicyEngine (forbid-wins, rate limiting)
    types.ts        — Cedar types (Effect, Resource, Rule, RuleContext)
    rules/
      default.ts    — 24 default rules across 5 resource types
      support.ts    — Agent-specific rules
      index.ts      — Rule merging logic
  hitl/
    types.ts        — HITL policy schemas (TypeBox)
    matcher.ts      — Action pattern matching (dot-notation wildcards)
    parser.ts       — YAML/JSON policy file parsing and validation
    watcher.ts      — HITL policy hot-reload watcher
skills/
  budget/           — /budget skill for ClawHub (token tracking, spend alerts)
  whatdidyoudo/     — /whatdidyoudo skill for ClawHub (action replay log)
  approve/          — /approve skill for ClawHub (soft HITL approval gate)
ui/
  server.ts         — Express dashboard server
  routes/
    rules.ts        — Rules CRUD API
    audit.ts        — Audit log API and SSE streaming
  client/           — React 18 + Vite SPA
docs/               — Full documentation
```

## Development

```bash
npm install       # Install dependencies
npm run dev       # Watch mode (TypeScript recompilation on save)
npm run build     # Production build
npm test          # Run test suite (vitest)
npm run clean     # Remove dist/
```

## Roadmap

- **Telegram/messaging bot integration** --- live approval routing for HITL `ask-user` decisions, with approve/reject buttons and timeout handling
- **Structured Decision objects** --- enrich policy responses with `ruleId` for audit traceability and capability scaffolds for credential injection
- **Capability registration** --- register as an OpenClaw capability provider for full hook coverage across all tool execution paths
- **Control plane API** --- multi-tenant policy management with migration support
- **Web dashboard HITL view** --- approve/reject pending actions from the UI dashboard

## License

MIT

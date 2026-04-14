# Roadmap

This document tracks what OpenAuthority has shipped, what is in progress, and what comes next. It is updated as work is completed.

Last updated: March 2026

---

## Shipped

These features are built, tested, and working in the current codebase.

### Cedar-Style Policy Engine
- Forbid-wins semantics (explicit forbid overrides any permit)
- Pattern matching: exact string, wildcard (`*`), RegExp
- Conditional rules with arbitrary functions (channel, agentId, etc.)
- Rate limiting with per-rule, per-caller sliding windows
- Hot-reload: edit rules, save, new rules active in ~300ms
- 24 default rules across 5 resource types (tool, command, channel, prompt, model)
- Rule merging (agent-specific + default rules)

### ABAC Policy Engine
- TypeBox-validated structured policies
- 8 condition operators (eq, neq, in, nin, contains, startsWith, regex)
- Dot-notation field path traversal for nested context
- Priority-ordered rule evaluation
- Configurable default effect per policy

### Gateway Hook Integration
- `before_tool_call` — primary enforcement hook, registered and active
- `before_prompt_build` — prompt injection detection (10 regex patterns), implemented but currently disabled
- `before_model_resolve` — model routing, implemented but currently disabled (waiting for OpenClaw to pass model name in event payload)
- Plugin interface with `activate()` / `deactivate()` lifecycle
- Activation guard for idempotent multi-registry registration

### Audit Logging
- Console audit handler
- JSONL file audit handler
- Multiple simultaneous sinks
- Custom handler support
- PolicyDecisionEntry schema with structured fields

### Human-in-the-Loop (HITL)
- TypeBox-validated policy schema (HitlPolicyConfig, HitlPolicy, HitlApprovalConfig)
- Action pattern matcher with dot-notation wildcards
- JSON and YAML policy file parser with schema validation
- Hot-reload watcher for HITL policy files (debounced, atomic swap)
- In-memory approval manager with token generation, TTL expiry, and concurrent request support
- **Telegram adapter**: long-polling listener, approval request messages, `/approve` and `/deny` command parsing
- **Slack adapter**: Block Kit interactive buttons, interaction webhook server with signature verification, message update on decision
- Wired into `before_tool_call` as step 4 (after Cedar, JSON Cedar, and ABAC engines)
- HITL decisions logged to JSONL audit file
- Fail-safe: channel unreachable or not configured applies policy fallback; evaluation errors fail closed

### UI Dashboard
- Express server with REST API
- React 18 + Vite SPA
- Rules management (CRUD with persistence to JSON file)
- Audit log viewer with pagination
- Live audit streaming via SSE
- Policy coverage map visualization

### ClawHub Skills
- `/token-budget` — token usage tracking, spend estimation, threshold alerts
- `/whatdidyoudo` — action replay, plain-language tool call log
- `/human-approval` — soft human-in-the-loop approval gate for interactive sessions

### Hot Reload
- Mutable engine reference pattern (atomic swap)
- ESM cache busting with timestamp query parameters
- Debounced file watcher (chokidar, 300ms)
- Error isolation (previous engine preserved on reload failure)
- Separate watchers for TypeScript rules, JSON rules, and HITL policies

---

## In Progress

### Configurable Default Effect ✅
The Cedar engine now accepts a `defaultEffect` constructor option (`'permit' | 'forbid'`). The default is `'permit'` (implicit allow) to avoid accidentally blocking OpenClaw tool calls. Deployments that need strict deny-by-default can set `defaultEffect: 'forbid'`.

**Note:** With implicit permit, condition-gated permit rules (e.g. "git only on trusted channels") become no-ops when the condition fails — the request falls through to implicit permit. Explicit forbid rules (e.g. "block exec", "block rm") are unaffected and still enforce correctly. For condition-gated restrictions that must block, consider converting them to forbid rules with inverted conditions in a future pass.

---

## Next Up

### Structured Decision Object
Enrich the policy engine response beyond boolean permit/forbid:
```typescript
interface Decision {
  outcome: 'permit' | 'forbid' | 'ask-user'
  ruleId?: string           // for audit traceability
  capability?: {            // for credential injection
    id: string
    expiresAt: number
    scope: string[]
  }
}
```
This replaces the current `EvaluationDecision` with a richer type that carries provenance data through the pipeline.

### Re-enable `before_prompt_build` and `before_model_resolve`
Both hooks are implemented but disabled. Re-enable when:
- `before_prompt_build`: after verifying it doesn't cause false positives on normal prompts
- `before_model_resolve`: after OpenClaw passes the model name (not just prompt text) in the event payload

### Capability Registration
Register OpenAuthority as an OpenClaw capability provider via `api.registerProvider('policy', ...)` for full hook coverage across all tool execution paths, not just the legacy hook runner.

---

## Future

### Additional Approval Channels
- **Web dashboard** — approve/reject from the OpenAuthority UI with pending action queue
- **Webhook** — POST to any HTTP endpoint, await callback
- **Email** — approval via email reply (for compliance workflows)

### Control Plane API
A future multi-tenant service for centralised policy management. Planned scope:
- Multi-tenant policy management
- Database-backed policy storage with migrations
- User and tenant management
- REST API for programmatic policy CRUD
- Centralised audit log aggregation across agents

### ClawHub Skill Publishing
Publish the three skills (`token-budget`, `whatdidyoudo`, `human-approval`) to ClawHub as the official OpenAuthority skill pack. Each skill is a soft-enforcement layer that drives adoption of the plugin.

### Policy Language Evolution
- Cedar policy file format (`.cedar` files) alongside TypeScript rules
- YAML policy files for non-developer users
- Policy validation CLI tool
- Policy diff and dry-run before applying changes

### Observability
- Prometheus/OpenTelemetry metrics export (decisions/sec, block rate, latency)
- Grafana dashboard template
- Alerting on anomalous block rates or rate limit saturation

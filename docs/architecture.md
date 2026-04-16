# Architecture

> **What this page is for.** The design of the Clawthority policy engine plugin — data structures, enforcement pipeline stages, and how the adapter layer decouples the plugin from its authority backend.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [ExecutionEnvelope](#2-executionenvelope)
3. [Two-Stage Enforcement Pipeline](#3-two-stage-enforcement-pipeline)
4. [Action Normalization](#4-action-normalization)
5. [IAuthorityAdapter Interface](#5-iauthorityadapter-interface)
6. [StructuredDecision Type Layer](#6-structureddecision-type-layer)
7. [Hot Reload Architecture](#7-hot-reload-architecture)
8. [Rate Limiting Design](#8-rate-limiting-design)
9. [Limitations](#9-limitations)
10. [OpenClaw Hook Integration](#10-openclaw-hook-integration)
11. [Design Decisions](#11-design-decisions)
12. [Glossary](#12-glossary)

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          OpenClaw Gateway                            │
│                                                                      │
│  ┌──────────────┐  hook events  ┌──────────────────────────────────┐ │
│  │  Agent /     │ ────────────► │  Clawthority Plugin              │ │
│  │  Gateway     │ ◄──────────── │  (index.ts)                      │ │
│  └──────────────┘  permit /     └────────────────┬─────────────────┘ │
│                    forbid /                      │                   │
│                    ask-user                      │                   │
└──────────────────────────────────────────────────┼───────────────────┘
                                                   │
             ┌─────────────────────────────────────┼──────────────────┐
             │             Plugin Core             │                  │
             │                                     ▼                  │
             │  ┌─────────────────────────────────────────────────┐   │
             │  │           Enforcement Pipeline                  │   │
             │  │                                                 │   │
             │  │  normalize_action()   →  NormalizedAction       │   │
             │  │        │                                        │   │
             │  │        ▼                                        │   │
             │  │  runPipeline()  ──►  Stage 1 (capability gate)  │   │
             │  │                         │                       │   │
             │  │                         ▼                       │   │
             │  │                    Stage 2 (CEE)                │   │
             │  │                         │                       │   │
             │  │                         ▼                       │   │
             │  │                CeeDecision / StructuredDecision │   │
             │  └─────────────────────────────────────────────────┘   │
             │                                                        │
             │  ┌───────────────────┐   ┌───────────────────────┐     │
             │  │  IAuthorityAdapter│   │  HITL Approval System │     │
             │  │  (file / Firma)   │   │  (hitl/)              │     │
             │  └───────────────────┘   └────────────┬──────────┘     │
             │                                       │                │
             └───────────────────────────────────────┼────────────────┘
                                                     │
               ┌─────────────────────────┐  ┌────────▼──────────────┐
               │  Dashboard (Express +   │  │  Approval Channels    │
               │  React SPA)             │  │  (Telegram / Slack /  │
               └─────────────────────────┘  │   Webhook / Console)  │
                                            └───────────────────────┘
```

---

## 2. ExecutionEnvelope

The `ExecutionEnvelope` is the primary data structure that wraps a single agent action as it travels through the enforcement pipeline. Every tool call is represented as an envelope before any authorization decision is made.

### Structure

```typescript
interface ExecutionEnvelope {
  intent: Intent;           // What the agent intends to do
  capability: Capability | null; // Approved capability token (null if not yet approved)
  metadata: Metadata;       // Runtime metadata for tracing and auditing
  provenance: Record<string, unknown>; // Audit trail data
}
```

### Intent

The `Intent` captures the semantic description of the action, independent of the raw tool call:

```typescript
interface Intent {
  action_class: string;   // Canonical class, e.g. 'filesystem.delete'
  target: string;         // Resource target, e.g. '/etc/passwd'
  summary: string;        // Human-readable description
  payload_hash: string;   // SHA-256 hex digest of tool call parameters
  parameters: Record<string, unknown>; // Raw tool call parameters
}
```

### Capability

The `Capability` token is issued after HITL approval and binds an authorization to a specific action and session:

```typescript
interface Capability {
  approval_id: string;  // UUID v7 identifying the approval
  expires_at: string;   // ISO 8601 expiry timestamp
  session_scope: string; // Session the capability is bound to
  scope_meta: Record<string, unknown>; // Additional scope constraints
}
```

### Metadata

`Metadata` carries observability fields stamped at envelope construction time:

```typescript
interface Metadata {
  session_id: string;      // Unique session identifier
  approval_id: string;     // UUID v7 of the backing approval
  timestamp: string;       // ISO 8601 creation time
  bundle_version: number;  // Policy bundle version in effect
  trace_id: string;        // Distributed trace identifier
  source_trust_level: string; // 'user' | 'agent' | 'untrusted'
}
```

### Building an Envelope

Envelopes are constructed via `buildEnvelope()`, the canonical factory imported from `src/envelope.ts`:

```typescript
import { buildEnvelope, uuidv7, computePayloadHash } from './envelope.js';

const payloadHash = computePayloadHash('delete_file', { path: '/tmp/foo' });

const envelope = buildEnvelope(
  {
    action_class: 'filesystem.delete',
    target: '/tmp/foo',
    summary: 'Delete temporary file',
    payload_hash: payloadHash,
    parameters: { path: '/tmp/foo' },
  },
  null,               // no capability yet
  'agent',            // source_trust_level
  sessionId,
  '',                 // no approval_id yet
  bundleVersion,
  traceId,
);
```

> **Import rule:** Always import `buildEnvelope`, `uuidv7`, `computePayloadHash`, `computeContextHash`, and `sortedJsonStringify` from `envelope.js`. Never reach into `hitl/approval-manager.js` or `enforcement/pipeline.js` directly for these symbols.

### Payload Hashing

Two hash functions are used for binding and integrity:

**`computePayloadHash(toolName, params)`** — Stable SHA-256 over a tool call. Keys are shallow-sorted alphabetically. Nested objects are NOT recursively sorted; use `sortedJsonStringify` for deep determinism.

```
hash_input = JSON.stringify({ tool: toolName, params: sortedShallowParams })
payload_hash = SHA-256(hash_input)
```

**`computeContextHash(action_class, target, summary)`** — Binds an authorization decision to a specific execution context using the canonical pipe-separated format:

```
context_hash = SHA-256("filesystem.delete|/tmp/foo|Delete temporary file")
```

---

## 3. Two-Stage Enforcement Pipeline

Every agent action passes through a two-stage pipeline before execution is permitted. The pipeline is orchestrated by `runPipeline()` in `src/enforcement/pipeline.ts`.

### Pipeline Flow Diagram

```
Tool Call Event (OpenClaw hook)
        │
        ▼
 normalize_action(toolName, params)
        │
        ▼  NormalizedAction
        │  { action_class, risk, hitl_mode, target }
        │
        ▼
 HITL Pre-check
        │── hitl_mode !== 'none' AND no approval_id
        │       → forbid: 'pending_hitl_approval' (stage: 'hitl')
        │
        ▼ (approval_id present OR hitl_mode === 'none')
        │
 ┌──────┴───────────────────────────────────────────────┐
 │  Stage 1: Capability Gate (stage1-capability.ts)     │
 │                                                      │
 │  Check 0: untrusted source + high/critical risk      │
 │           → forbid: 'untrusted_source_high_risk'     │
 │                                                      │
 │  Check 1: hitl_mode === 'none'                       │
 │           → permit: bypass (low-risk path)           │
 │                                                      │
 │  Check 2: approval_id missing                        │
 │           → forbid: 'approval_id required'           │
 │                                                      │
 │  Check 3: capability TTL expired                     │
 │           → forbid: 'capability expired'             │
 │                                                      │
 │  Check 4: payload binding mismatch (SHA-256)         │
 │           → forbid: 'payload binding mismatch'       │
 │                                                      │
 │  Check 5: capability already consumed                │
 │           → forbid: 'capability already consumed'    │
 │                                                      │
 │  Check 6: session scope mismatch                     │
 │           → forbid: 'session scope mismatch'         │
 └──────────────────────────────────────────────────────┘
        │── forbid → return early, skip Stage 2
        │
        ▼ permit
 ┌──────┴────────────────────────────────────────────┐
 │  Stage 2: Cedar Engine Evaluation (stage2-policy) │
 │                                                   │
 │  EnforcementPolicyEngine.evaluateByActionClass()  │
 │                                                   │
 │  Map action_class prefix → Cedar Resource type:   │
 │    communication.* → channel                      │
 │    command.*       → command                      │
 │    prompt.*        → prompt                       │
 │    model.*         → model                        │
 │    (all others)    → tool                         │
 │                                                   │
 │  Cedar semantics: forbid wins over permit         │
 │  Rate limits applied to permit rules only         │
 └───────────────────────────────────────────────────┘
        │
        ▼ CeeDecision { effect, reason, stage }
        │
 emitter.emit('executionEvent', { decision, timestamp })
        │
        ▼ OrchestratorResult { decision, latency_ms }
```

### Pipeline Context

All stages share a `PipelineContext` threaded through the call chain:

```typescript
interface PipelineContext {
  action_class: string;    // Normalized action class
  target: string;          // Target resource
  payload_hash: string;    // SHA-256 of tool call params
  approval_id?: string;    // Present when HITL approval has been granted
  session_id?: string;     // Session identifier
  hitl_mode: HitlMode;     // 'none' | 'per_request' | 'session_approval'
  rule_context: RuleContext; // Cedar rule evaluation context
  sourceTrustLevel?: string; // 'user' | 'agent' | 'untrusted'
  risk?: RiskLevel;        // 'low' | 'medium' | 'high' | 'critical'
}
```

### Fail-Closed Guarantee

The pipeline is fail-closed at every boundary — independent of the install mode:

| Failure point | Result |
|---|---|
| Exception in Stage 1 | `forbid: 'stage1_error'` |
| Exception in Stage 2 | `forbid: 'stage2_error'` |
| Exception in orchestrator | `forbid: 'pipeline_error'` |

Exceptions never produce a `permit` decision.

The install mode (`open` / `closed`) only flips the **implicit** decision for requests with no matching rule and no pipeline error. Critical action classes (`shell.exec`, `code.execute`, `payment.initiate`, `credential.read`, `credential.write`, `unknown_sensitive_action`) are enforced in both modes via their own forbid rules — see [configuration.md — Install mode](configuration.md#install-mode).

### Stage 1 in Detail

Stage 1 is a pure capability gate implemented in `src/enforcement/stage1-capability.ts`. It validates the cryptographic binding between the issued capability and the current tool call. The seven checks run in order and short-circuit on the first failure.

The payload binding check (Check 4) recomputes:

```
expected_binding = SHA-256("${action_class}|${target}|${payload_hash}")
```

and compares it against the `binding` stored in the capability at issuance time. A mismatch means the tool call parameters have changed since approval was granted.

### Stage 2 in Detail

Stage 2 is backed by `EnforcementPolicyEngine`, which extends the Cedar-style `PolicyEngine` with action-class-aware dispatch. It is created via the factory in `src/enforcement/stage2-policy.ts`:

```typescript
import { createStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';

const engine = createEnforcementEngine(defaultRules);
const stage2 = createStage2(engine);

// Wire into the pipeline:
const result = await runPipeline(ctx, stage1, stage2, emitter);
```

---

## 4. Action Normalization

Before the pipeline runs, every raw tool name is normalized to a canonical action class via the registry in `src/enforcement/normalize.ts`.

### Normalization Flow

```
Raw tool name (e.g. "run_terminal_cmd")
        │
        ▼
getRegistryEntry(toolName)
        │── exact alias match (case-insensitive) → ActionRegistryEntry
        │── no match → UNKNOWN_ENTRY (unknown_sensitive_action)
        │
        ▼ ActionRegistryEntry
        │  { action_class, default_risk, default_hitl_mode, aliases[] }
        │
        ▼
Reclassification rules:
  Rule 1: filesystem.write + URL target → web.post
  Rule 2: any action + shell metachar in params → risk = 'critical'
        │
        ▼ NormalizedAction
        │  { action_class, risk, hitl_mode, target }
```

### normalize_action() Example

```typescript
import { normalize_action } from './enforcement/normalize.js';

// Standard alias resolution:
const result = normalize_action('run_terminal_cmd', { command: 'ls -la' });
// result:
// {
//   action_class: 'shell.exec',  // resolved via alias
//   risk: 'high',
//   hitl_mode: 'per_request',
//   target: '',
// }

// Reclassification — shell metacharacter detection:
const risky = normalize_action('write_file', { path: '/tmp/x', content: 'a; rm -rf /' });
// result:
// {
//   action_class: 'filesystem.write',
//   risk: 'critical',             // ← raised from 'medium' due to metachar
//   hitl_mode: 'per_request',
//   target: '/tmp/x',
// }

// Reclassification — filesystem.write with URL target:
const webPost = normalize_action('write_file', { path: 'https://api.example.com/data' });
// result:
// {
//   action_class: 'web.post',     // ← reclassified from filesystem.write
//   risk: 'medium',
//   hitl_mode: 'per_request',
//   target: 'https://api.example.com/data',
// }

// Unknown tool — fail-closed:
const unknown = normalize_action('my_custom_tool', { foo: 'bar' });
// result:
// {
//   action_class: 'unknown_sensitive_action',  // fail-closed catch-all
//   risk: 'critical',
//   hitl_mode: 'per_request',
//   target: '',
// }
```

### Registry Structure

The registry is a static array of 17 `ActionRegistryEntry` objects, built at module load time into an O(1) alias index:

```typescript
interface ActionRegistryEntry {
  readonly action_class: string;       // Canonical dot-separated class
  readonly default_risk: RiskLevel;    // 'low' | 'medium' | 'high' | 'critical'
  readonly default_hitl_mode: HitlModeNorm; // 'none' | 'per_request' | 'session_approval'
  readonly aliases: readonly string[]; // Lowercase tool name aliases
}
```

The canonical action classes (19 entries including the fail-closed catch-all) are documented in [action-registry.md](action-registry.md). `unknown_sensitive_action` has no aliases by design; unknown tool names fall through to it automatically.

### Target Extraction

The `target` field in `NormalizedAction` is extracted from tool parameters using an ordered key preference list:

```
path → file → url → destination → to → recipient → email
```

The first non-empty string value found is used as the target. This is used in payload binding and rule matching.

---

## 5. IAuthorityAdapter Interface

The `IAuthorityAdapter` interface (defined in `src/adapter/types.ts`) decouples the enforcement pipeline from the authority backend. The current implementation is a file-based adapter for development; a Firma remote adapter can be swapped in without changing any pipeline code.

### Interface Definition

```typescript
interface IAuthorityAdapter {
  /**
   * Issues a capability with UUID v7 approval_id and SHA-256 payload binding.
   * Capability is stored in the adapter's in-memory store.
   */
  issueCapability(opts: IssueCapabilityOpts): Promise<Capability>;

  /**
   * Begins watching the policy bundle file or remote source.
   * Calls onUpdate immediately with the initial bundle and on every valid change.
   * Returns a WatchHandle to stop the watcher.
   */
  watchPolicyBundle(onUpdate: (bundle: PolicyBundle) => void): Promise<WatchHandle>;

  /**
   * Returns an async iterable of revoked capability approval_ids.
   * File-based adapters yield nothing; remote adapters stream revocations.
   */
  watchRevocations(): AsyncIterable<string>;
}
```

### Capability Issuance Flow

```
caller → adapter.issueCapability({ action_class, target, payload_hash, session_id? })
              │
              ├─ generate approval_id = uuidv7()
              ├─ compute binding = SHA-256("${action_class}|${target}|${payload_hash}")
              ├─ compute expires_at = now + ttl_seconds * 1000
              └─ store in capabilities map → return Capability
```

### Policy Bundle Watching

```
adapter.watchPolicyBundle(onUpdate)
    │
    ├─ read + validate bundle at bundlePath
    ├─ check PolicyBundleSchema (TypeBox validation)
    ├─ enforce version monotonicity (new.version > current.version)
    ├─ call onUpdate(bundle) on success
    └─ chokidar watch with 300 ms debounce → reload on change
```

### Swapping to Firma

To replace the file adapter with the Firma remote authority:

1. Implement `IAuthorityAdapter` against the Firma API.
2. Pass the Firma adapter instance wherever `FileAuthorityAdapter` is currently instantiated.
3. The enforcement pipeline, Stage 1 capability checks, and HITL approval flow are all adapter-agnostic — no other changes required.

Key differences to expect in a Firma adapter:
- `watchRevocations()` yields revoked capability IDs streamed from the Firma service, enabling real-time capability revocation.
- `watchPolicyBundle()` pulls bundles from the remote API rather than a local file.
- The in-memory capability store may be replaced with a distributed cache.

### Capability Data Structure (Adapter Layer)

```typescript
interface Capability {             // src/adapter/types.ts
  approval_id: string;             // UUID v7 token
  binding: string;                 // SHA-256(action_class|target|payload_hash)
  action_class: string;
  target: string;
  session_id?: string;             // Present when session-scoped
  issued_at: number;               // Unix epoch ms
  expires_at: number;              // Unix epoch ms
}
```

Note: The adapter `Capability` type differs from the envelope `Capability` type in `src/types.ts`. The adapter type is the internal storage representation; the envelope type is the public-facing authorization token.

---

## 6. StructuredDecision Type Layer

`StructuredDecision` (in `src/enforcement/decision.ts`) is the enriched authorization decision type that wraps the raw `CeeDecision` with audit provenance data.

### Decision Types

```
CeeDecision               StructuredDecision
─────────────             ──────────────────────────────────
effect: 'permit'          outcome: 'permit' | 'forbid' | 'ask-user'
       | 'forbid'         reason: string
reason: string            ruleId?: string          ← for audit traceability
stage?: string            stage?: string
                          capability?: CapabilityInfo  ← only on permit
```

`CeeDecision` is the low-level type produced by stage functions. `StructuredDecision` is the high-level type exposed to callers outside the pipeline.

### Factory Functions

```typescript
// Convert a CeeDecision with optional audit enrichment:
const sd = fromCeeDecision(ceeDecision, ruleId?, capability?);

// Create an ask-user decision (HITL pending):
const sd = askUser('Awaiting human approval for filesystem.delete', ruleId?);

// Create a forbid decision (fail path):
const sd = forbidDecision('Policy violation', stage?);
```

### ask-user Outcome

The `ask-user` outcome is not produced by the Cedar engine or `CeeDecision`. It is produced exclusively by the HITL layer when an approval request has been submitted and the human decision is pending. Pipeline stages return `forbid` with reason `pending_hitl_approval`; callers that understand HITL semantics convert this to `ask-user` via `askUser()`.

---

## 7. Hot Reload Architecture

Policy rules update live without restarting the gateway.

### Mutable Engine Reference

```typescript
const engineRef: { current: PolicyEngine } = {
  current: new PolicyEngine()
};

// Hook handlers dereference .current at call time:
hooks.before_tool_call = async (event) => {
  const result = engineRef.current.evaluate(...);
};
// Swapping engineRef.current updates all hooks atomically.
```

### ESM Cache Busting

```typescript
const url = new URL(`./policy/rules.js?t=${Date.now()}`, import.meta.url).href;
const { default: rules } = await import(url);
```

Each unique URL is a separate ESM cache entry.

### Debounced File Watcher

The chokidar watcher fires on every file system event; a 300 ms debounce coalesces rapid saves into a single reload. Reload errors leave the previous engine active (error isolation).

---

## 8. Rate Limiting Design

Rate limits are implemented as per-rule, per-caller sliding windows in memory.

### Data Structure

```
Map<Rule, Map<string, number[]>>
      │              │       └─ array of call timestamps (ms)
      │              └─ key: "${agentId}:${resourceName}"
      └─ rule reference (identity, not id)
```

### Sliding Window Algorithm

On each `evaluate()` call for a permit rule with `rateLimit`:

1. Look up timestamps for `(rule, agentId:resourceName)`.
2. Filter out entries older than `Date.now() - windowSeconds * 1000`.
3. If `filteredEntries.length >= maxCalls`: return `forbid` (rate limit exceeded).
4. Otherwise: push `Date.now()` and return `permit`.

Rate limits only reduce the scope of `permit`; they can never override a `forbid` rule.

---

## 9. Limitations

### 9.1 What Is Enforced

Clawthority enforces the following:

- **Action-level authorization** — every tool call is classified and evaluated against Cedar rules before the tool executes.
- **Capability binding** — HITL approvals are cryptographically bound to the exact tool call parameters approved; a changed payload fails Stage 1.
- **Fail-closed defaults** — unknown tools, unexpected exceptions, and missing capabilities all produce `forbid` decisions.
- **Session scope** — capabilities issued for a specific session cannot be used in a different session.
- **Rate limiting** — permit rules can be rate-limited per caller; exceeded limits produce `forbid`.
- **Trust level gating** — `untrusted` sources are denied access to `high` and `critical` risk actions regardless of HITL approval.

### 9.2 What Is Not Enforced

The following are **not** enforced by Clawthority and must be addressed at other layers:

- **Tool output inspection** — Clawthority intercepts tool call *invocations*, not responses. If a permitted tool returns sensitive data, that data is not inspected.
- **Prompt content enforcement** — The `before_prompt_build` hook performs lightweight injection detection (regex patterns) but does not enforce semantic constraints on prompt content.
- **Cross-session capability reuse** — Capability tokens are stored in memory for the lifetime of the adapter instance. Restarting the process clears all issued capabilities; there is no persistent revocation log in the file adapter.
- **Multi-agent coordination** — When multiple agent instances share a session, capability consumption tracking is per-process. An approval consumed by one agent instance is not visible to another process.
- **Nested tool calls** — Tool calls made by tools (e.g. a code execution tool that itself invokes an HTTP request) are not intercepted; only the outermost tool call at the OpenClaw hook boundary is evaluated.
- **Cryptographic non-repudiation** — The audit log and provenance fields are append-only but not cryptographically signed. Log tampering is not detectable by Clawthority itself.
- **Policy correctness** — Clawthority enforces the configured policies faithfully but does not validate that the policies themselves are semantically correct or complete. A misconfigured `permit`-default engine will allow actions that were intended to be blocked.
- **Real-time revocation in the file adapter** — `FileAuthorityAdapter.watchRevocations()` yields nothing. Capabilities issued with the file adapter cannot be revoked until the process restarts.

---

## 10. OpenClaw Hook Integration

Clawthority integrates with OpenClaw via three hook points. Only `before_tool_call` can block execution.

### Hook Summary

| Hook | Can block? | Status | Purpose |
|---|---|---|---|
| `before_tool_call` | **Yes** | Active | Primary enforcement: normalizes the tool call, runs the two-stage pipeline, returns `block: true` on `forbid`. |
| `before_prompt_build` | No (observe/mutate) | Active | Regex-based prompt injection detection (5 patterns) on non-user message sources. |
| `before_model_resolve` | No (observe/mutate) | Active | Model routing hook registered for future use; OpenClaw does not yet pass the model name in the event payload, so this handler currently observes without routing. |

### before_tool_call Integration

```typescript
ctx.on('before_tool_call', async (toolCall) => {
  // 1. Normalize tool name → action class
  const normalized = normalize_action(toolCall.name, toolCall.parameters);

  // 2. Build pipeline context
  const ctx: PipelineContext = {
    action_class: normalized.action_class,
    target: normalized.target,
    payload_hash: computePayloadHash(toolCall.name, toolCall.parameters),
    hitl_mode: normalized.hitl_mode,
    risk: normalized.risk,
    approval_id: toolCall.metadata?.approval_id,
    session_id: toolCall.metadata?.session_id,
    rule_context: { agentId: toolCall.agentId, ... },
    sourceTrustLevel: toolCall.metadata?.source_trust_level ?? 'agent',
  };

  // 3. Run two-stage pipeline
  const { decision } = await runPipeline(ctx, stage1, stage2, emitter);

  // 4. Return enforcement decision to OpenClaw
  if (decision.effect === 'forbid') {
    return { block: true, reason: decision.reason };
  }
  return { block: false };
});
```

### Critical Constraint

`before_tool_call` is the **only** hook that can block execution. All enforcement — pipeline stages, HITL checks, rate limits, forbid rules — must route through this hook. Capabilities, audit events, and rate limit state that exist only in `before_prompt_build` or `before_model_resolve` will not affect whether a tool call executes.

### Prompt Injection Detection

The `before_prompt_build` hook checks non-user message text against 5 regex patterns grouped by injection category:

| # | Category | Pattern |
|---|---|---|
| 1 | Ignore instructions | `/ignore\s+(all\s+)?(previous\|prior\|above)\s+instructions?/i` |
| 2 | New instructions marker | `/\bnew\s+instructions?\s*:/i` |
| 3 | Forget commands | `/\bforget\s+(everything\|all\|your\s+(previous\s+)?(instructions?\|training\|context\|rules?\|guidelines?))/i` |
| 4 | Imperative override | `/\byou\s+(must\s+now\|are\s+now\s+required\s+to\|will\s+immediately)\s+/i` |
| 5 | Unrestricted acting | `/\b(act\|pretend\|respond\|behave)\s+(without\s+any?\s+restrictions?\|as\s+if\s+you\s+have\s+no\s+restrictions?)/i` |

Only non-user sources are scanned; prompts from `user` source pass through unchanged. A match blocks the prompt before any downstream policy evaluation — this is a hard-coded safety layer independent of the configurable rule set. Source of truth: [`src/index.ts`](../src/index.ts) (`INJECTION_PATTERNS`).

---

## 11. Design Decisions

### Why a two-stage pipeline?

Stage 1 (capability gate) and Stage 2 (policy evaluation) serve distinct purposes and have different dependency requirements:

- **Stage 1** validates cryptographic tokens and approval state. It requires an `ApprovalManager` and an in-memory capability store but does not need Cedar rules.
- **Stage 2** evaluates business logic rules. It requires a `PolicyEngine` with loaded rules but does not need token state.

Separating them makes each stage independently testable and lets operators swap implementations without touching the other stage.

### Why IAuthorityAdapter?

The adapter interface isolates the enforcement pipeline from the authority backend. The file adapter is suitable for local development; the Firma adapter (when implemented) provides remote policy distribution, real-time revocation streams, and distributed capability storage — all without changing the pipeline or Stage 1/Stage 2 implementations.

### Why fail-closed for unknown tools?

Any tool name that does not match a registry alias resolves to `unknown_sensitive_action` with `critical` risk and `per_request` HITL. This default prevents unknown tools from bypassing authorization by accident, and it applies in **both** `open` and `closed` install modes — the critical-forbid rule for `unknown_sensitive_action` ships in both rule sets. Operators must explicitly alias or register new tools to move them out of the critical-risk bucket.

### Why SHA-256 for payload binding?

The binding check in Stage 1 ensures that a capability issued for a specific tool call cannot be reused for a different one. Without payload binding, an approval for `delete_file({ path: '/tmp/foo' })` could theoretically be reused for `delete_file({ path: '/etc/passwd' })`. The SHA-256 binding prevents this by committing the capability to the exact parameter set at approval time.

### Why Cedar semantics (forbid wins)?

An explicit `forbid` rule cannot be accidentally overridden by a `permit` rule. Administrators must explicitly remove `forbid` rules to expand access. This is more predictable under adversarial rule injection scenarios than permit-wins (first-match) semantics.

### Why TypeBox?

TypeBox generates both runtime validators and TypeScript types from a single schema definition, eliminating type drift between the validator and the TypeScript interface. Schemas are JSON Schema–compatible, making them usable for documentation and external tooling (e.g. policy bundle validation before deployment).

### Why not a database?

The plugin is designed to be installed as a standalone OpenClaw plugin without infrastructure dependencies. JSON files for rules and JSONL for audit logs make the plugin self-contained. For high-volume production deployments, the audit log path can point to a log-rotated file managed externally.

---

## 12. Glossary

Authoritative definitions for terms used throughout this document and the codebase.

---

**action_class**
A dot-separated canonical identifier for an agent action (e.g., `filesystem.delete`, `shell.exec`, `web.post`). Produced by `normalize_action()` via the action registry. Unknown tool names resolve to the catch-all `unknown_sensitive_action`. See §4.

**Capability**
A cryptographic authorization token issued after a HITL approval. Binds the approval to the exact tool call parameters via SHA-256 and expires after a configured TTL. Stage 1 of the enforcement pipeline validates the capability before any Cedar rule evaluation occurs. See §2 and §5.

**CeeDecision**
The low-level decision type (`{ effect: 'permit' | 'forbid', reason, stage? }`) produced by pipeline stage functions. Not exposed outside the pipeline; callers receive a `StructuredDecision` instead. See §6.

**CEE (Cedar Engine Evaluation)**
Stage 2 of the enforcement pipeline. Evaluates Cedar-style authorization rules against the normalized `action_class`. Forbid wins over permit; rate limits apply only to permit rules. See §3.

**ExecutionEnvelope**
The primary data structure that wraps a single agent action as it travels through the enforcement pipeline. Contains `Intent`, `Capability`, `Metadata`, and `provenance`. Constructed via `buildEnvelope()` in `src/envelope.ts`. See §2.

**fail-closed**
The design principle that any error or critical-unknown state resolves to `forbid`. Exceptions in any pipeline stage return `forbid` in both install modes. Unknown tool names produce `unknown_sensitive_action`, which ships as a critical forbid in both the `open` and `closed` rule sets. See §3 and §11.

**install mode**
The plugin's top-level policy posture, read from the `CLAWTHORITY_MODE` env var at activation. `open` (default) = implicit permit with six critical forbids; `closed` = implicit deny, explicit permits required. Restart to change. See [configuration.md — Install mode](configuration.md#install-mode).

**FileAuthorityAdapter**
The file-based implementation of `IAuthorityAdapter` used during development. Reads policy bundles from a local JSON file and provides no real-time revocation streaming (`watchRevocations()` yields nothing). See §5.

**Firma**
A planned remote authority backend. When a Firma adapter is implemented, it replaces `FileAuthorityAdapter` to provide remote policy distribution, real-time capability revocation streams, and distributed capability storage — all without modifying the enforcement pipeline. See §5.

**HITL (Human-in-the-Loop)**
The approval mechanism that pauses execution of a high-risk tool call and routes a decision request to a human operator via an approval channel (Telegram, Slack, Webhook, or Console). The pipeline emits `forbid: pending_hitl_approval`; callers with HITL awareness convert this to `ask-user` and surface it to the operator. See §6 and §10.

**hot reload**
The capability to update policy rules while the gateway continues running without a restart. Achieved via a mutable `engineRef.current` swapped atomically on each successful reload, ESM cache busting (unique query-string URLs), and a 300 ms debounced chokidar file watcher. See §7.

**IAuthorityAdapter**
The interface (`src/adapter/types.ts`) that decouples the enforcement pipeline from the authority backend. Defines `issueCapability()`, `watchPolicyBundle()`, and `watchRevocations()`. The current implementation is `FileAuthorityAdapter`; Firma is the planned production implementation. See §5.

**Intent**
The semantic description of a tool call action embedded inside an `ExecutionEnvelope`. Contains `action_class`, `target`, `summary`, `payload_hash`, and the raw `parameters`. Captures what the agent intends to do, independent of the raw tool name. See §2.

**NormalizedAction**
The result of running a raw tool name through `normalize_action()`. Contains `{ action_class, risk, hitl_mode, target }`. Produced before the enforcement pipeline runs. See §4.

**Clawthority**
This plugin. A policy enforcement engine for OpenClaw that intercepts agent tool calls via hooks, classifies them, runs them through a two-stage authorization pipeline, and blocks execution on `forbid` decisions. The repository is `clawthority/clawthority`.

**OpenClaw**
The AI agent gateway and runtime that Clawthority is installed into as a plugin. OpenClaw fires hook events (`before_tool_call`, `before_prompt_build`, `before_model_resolve`) at defined points in the agent execution lifecycle. Only `before_tool_call` can block execution. See §10.

**payload binding**
The SHA-256 commitment that ties a `Capability` to the exact tool call parameters at approval time: `SHA-256("${action_class}|${target}|${payload_hash}")`. Stage 1 Check 4 recomputes this hash and compares it to the stored `binding`; a mismatch blocks execution. See §3.

**PipelineContext**
The shared context object threaded through all enforcement pipeline stages. Contains `action_class`, `target`, `payload_hash`, `hitl_mode`, `risk`, `approval_id`, `session_id`, `rule_context`, and `sourceTrustLevel`. See §3.

**PolicyBundle**
The versioned collection of Cedar-style authorization rules loaded by the adapter and evaluated by Stage 2. Version monotonicity is enforced on reload (new version must exceed the current version). See §5.

**StructuredDecision**
The high-level enriched authorization decision type exposed to callers outside the pipeline. Wraps `CeeDecision` with `outcome: 'permit' | 'forbid' | 'ask-user'`, an optional `ruleId` for audit traceability, and an optional `capability` on permit decisions. See §6.

**two-stage pipeline**
The enforcement pipeline consisting of Stage 1 (capability gate, `src/enforcement/stage1-capability.ts`) followed by Stage 2 (Cedar Engine Evaluation, `src/enforcement/stage2-policy.ts`). Stage 1 validates cryptographic tokens; Stage 2 evaluates policy rules. A `forbid` from Stage 1 short-circuits Stage 2. See §3.

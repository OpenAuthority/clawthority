// ─── Audit re-exports ─────────────────────────────────────────────────────────
export { JsonlAuditLogger } from "./audit.js";
export type {
  PolicyDecisionEntry,
  HitlDecisionEntry,
  JsonlAuditLoggerOptions,
} from "./audit.js";

// ─── Identity registry re-exports (V-03 v0.1 follow-up) ─────────────────────
export {
  AgentIdentityRegistry,
  defaultAgentIdentityRegistry,
} from "./identity.js";
export type { RegisteredAgent, IdentityVerificationResult } from "./identity.js";

// ─── Cedar-style engine re-exports ───────────────────────────────────────────
export { PolicyEngine as CedarPolicyEngine } from "./policy/engine.js";
export type { EvaluationDecision, EvaluationEffect } from "./policy/engine.js";
export type { Rule, RuleContext, Resource, Effect, RateLimit } from "./policy/types.js";
export { default as defaultRules, mergeRules } from "./policy/rules.js";

// ─── Phase 2: Coverage tracking re-exports ───────────────────────────────────
export { CoverageMap } from "./policy/coverage.js";
export type { CoverageCell, CoverageEntry, CoverageState } from "./policy/coverage.js";

// ─── Phase 3: Structured decision + envelope utilities ───────────────────────
export { fromCeeDecision, askUser, forbidDecision } from "./enforcement/decision.js";
export type { StructuredDecision, CapabilityInfo } from "./enforcement/decision.js";
export { createStage2, createEnforcementEngine } from "./enforcement/stage2-policy.js";
export { detectSensitiveData } from "./enforcement/pii-classifier.js";
export type { PiiCategory, PiiDetectionResult } from "./enforcement/pii-classifier.js";
export { buildEnvelope, uuidv7, computePayloadHash, computeContextHash, sortedJsonStringify } from "./envelope.js";

// ─── Utilities ───────────────────────────────────────────────────────────────
export { generateDeltaSummary } from "./utils/delta-summary.js";
export type { DeltaSummaryInput, ResidualRisk, ResidualRiskLevel } from "./utils/delta-summary.js";
export { validateCommitMessage } from "./utils/commit-validator.js";
export type {
  CommitType,
  CommitValidationField,
  CommitValidationError,
  CommitMessageParts,
  CommitValidationResult,
} from "./utils/commit-validator.js";
export { validateRoadmapUpdate } from "./utils/roadmap-validator.js";
export type { RoadmapValidationResult } from "./utils/roadmap-validator.js";

// ─── Token telemetry ──────────────────────────────────────────────────────────
export {
  MODEL_PRICING,
  DEFAULT_STATE_PATH,
  resolvePricing,
  calculateCost,
  todayUtc,
  TokenTelemetry,
} from "./utils/token-telemetry.js";
export type {
  TokenRecord,
  DailyEntry,
  BudgetState,
  ModelPricing,
  DailyUsageSummary,
  UsageReport,
} from "./utils/token-telemetry.js";

// ─── Budget tracker ───────────────────────────────────────────────────────────
export {
  PRICING as BUDGET_PRICING,
  resolvePricing as resolveBudgetPricing,
  estimateCost,
} from "./budget/pricing.js";
export type { ModelPricing as BudgetModelPricing } from "./budget/pricing.js";
export { BudgetTracker, createBudgetTracker } from "./budget/tracker.js";
export type { BudgetEntry, BudgetTrackerOptions } from "./budget/tracker.js";

// ─── Human-in-the-loop policy configuration ──────────────────────────────────
export {
  HitlFallbackSchema,
  HitlApprovalConfigSchema,
  HitlPolicySchema,
  HitlPolicyConfigSchema,
  TelegramConfigSchema,
  SlackConfigSchema,
  matchesActionPattern,
  checkAction,
  parseHitlPolicyFile,
  validateHitlPolicyConfig,
  HitlPolicyParseError,
  HitlPolicyValidationError,
  startHitlPolicyWatcher,
  ApprovalManager,
  generateToken,
  TelegramListener,
  sendApprovalRequest,
  sendConfirmation,
  resolveTelegramConfig,
  SlackInteractionServer,
  sendSlackApprovalRequest,
  sendSlackConfirmation,
  resolveSlackConfig,
  verifySlackSignature,
} from "./hitl/index.js";
export type {
  HitlFallback,
  HitlApprovalConfig,
  HitlPolicy,
  HitlPolicyConfig,
  TelegramConfig,
  SlackConfig,
  HitlCheckResult,
  HitlWatcherHandle,
  HitlDecision,
  CreateApprovalOpts,
  ApprovalRequestHandle,
  ResolvedTelegramConfig,
  SendApprovalOpts,
  TelegramCommand,
  ResolvedSlackConfig,
  SlackSendApprovalOpts,
  SlackSendApprovalResult,
  SlackActionCommand,
} from "./hitl/index.js";

// ─── Internal imports ─────────────────────────────────────────────────────────
import { JsonlAuditLogger } from "./audit.js";
import type { HitlDecisionEntry } from "./audit.js";
import { PolicyEngine as CedarPolicyEngine } from "./policy/engine.js";
import type { Rule, RuleContext } from "./policy/types.js";
import defaultRules from "./policy/rules.js";
import { startRulesWatcher, type WatcherHandle } from "./watcher.js";
import { CoverageMap } from "./policy/coverage.js";
import { checkAction } from "./hitl/matcher.js";
import { parseHitlPolicyFile } from "./hitl/parser.js";
import { startHitlPolicyWatcher, type HitlWatcherHandle } from "./hitl/watcher.js";
import type { HitlPolicyConfig } from "./hitl/types.js";
import { ApprovalManager } from "./hitl/approval-manager.js";
import { TelegramListener, sendApprovalRequest, sendConfirmation, resolveTelegramConfig } from "./hitl/telegram.js";
import { SlackInteractionServer, sendSlackApprovalRequest, sendSlackConfirmation, resolveSlackConfig } from "./hitl/slack.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalize_action, sortedJsonStringify } from "./enforcement/normalize.js";
import { buildEnvelope } from "./envelope.js";
import { defaultAgentIdentityRegistry } from "./identity.js";
import { BudgetTracker, createBudgetTracker } from "./budget/tracker.js";

/**
 * Resolved identity view used by audit and HITL call sites. Derived from
 * `AgentIdentityRegistry.verify()` plus the original claims. When `verified`
 * is false, `auditAgentId` / `auditChannel` carry an `unverified:` prefix so
 * forged claims stand out in logs and operator prompts.
 */
interface ResolvedIdentity {
  verified: boolean;
  agentId: string;
  channel: string;
  auditAgentId: string;
  auditChannel: string;
}

function resolveIdentity(agentId: string | undefined, channelId: string | undefined): ResolvedIdentity {
  const claimedAgent = agentId ?? 'unknown';
  const claimedChannel = channelId || 'default';
  const { verified } = defaultAgentIdentityRegistry.verify(claimedAgent, claimedChannel);
  return {
    verified,
    agentId: claimedAgent,
    channel: claimedChannel,
    auditAgentId: verified ? claimedAgent : `unverified:${claimedAgent}`,
    auditChannel: verified ? claimedChannel : `unverified:${claimedChannel}`,
  };
}

// ─── Hook types (matching OpenClaw's actual API) ─────────────────────────────

/** Shared context object passed as the 2nd argument to every hook. */
export interface HookContext {
  agentId?: string;
  channelId?: string;
}

// ── before_tool_call ──

/** Event payload for the before_tool_call hook. */
export interface BeforeToolCallEvent {
  /** The name of the tool about to be called. */
  toolName: string;
  /** The parameters that will be passed to the tool. */
  params?: unknown;
  /** Source of the tool call — 'user' | 'agent' | 'external' | string.
   *  Used to determine the source trust level for enforcement decisions. */
  source?: string;
}

/** Return value for before_tool_call — set block=true to prevent the call. */
export interface BeforeToolCallResult {
  block?: boolean;
  blockReason?: string;
}

export type BeforeToolCallHandler = (
  event: BeforeToolCallEvent,
  ctx: HookContext
) => BeforeToolCallResult | void | Promise<BeforeToolCallResult | void>;

// ── before_prompt_build ──

/** Event payload for the before_prompt_build hook. */
export interface BeforePromptBuildEvent {
  /** The prompt being built. */
  prompt: string;
  /** The messages that will be included in the prompt. */
  messages?: unknown[];
  /** Source of the prompt content — 'user' | 'agent' | 'external' | string */
  source?: string;
}

/** Return value for before_prompt_build — can prepend context, replace system prompt, or block. */
export interface BeforePromptBuildResult {
  prependContext?: string;
  systemPrompt?: string;
  block?: boolean;
  blockReason?: string;
}

export type BeforePromptBuildHandler = (
  event: BeforePromptBuildEvent,
  ctx: HookContext
) => BeforePromptBuildResult | void | Promise<BeforePromptBuildResult | void>;

// ── before_model_resolve ──

/** Event payload for the before_model_resolve hook. */
export interface BeforeModelResolveEvent {
  /** The prompt that triggered model resolution. */
  prompt: string;
}

/** Return value for before_model_resolve — can override model/provider. Cannot block. */
export interface BeforeModelResolveResult {
  modelOverride?: string;
  providerOverride?: string;
}

export type BeforeModelResolveHandler = (
  event: BeforeModelResolveEvent,
  ctx: HookContext
) => BeforeModelResolveResult | void | Promise<BeforeModelResolveResult | void>;

// ─── Plugin interfaces ────────────────────────────────────────────────────────

export interface OpenclawPlugin {
  name: string;
  version: string;
  activate(context: OpenclawPluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export interface OpenclawPluginContext {
  /** Register a handler for a lifecycle hook (legacy — pushes to registry.hooks only). */
  registerHook(hookName: "before_tool_call", handler: BeforeToolCallHandler, options?: { name?: string; description?: string }): void;
  registerHook(hookName: "before_prompt_build", handler: BeforePromptBuildHandler, options?: { name?: string; description?: string }): void;
  registerHook(hookName: "before_model_resolve", handler: BeforeModelResolveHandler, options?: { name?: string; description?: string }): void;
  /** Register a typed hook handler (pushes to registry.typedHooks — required for hook runner dispatch). */
  on(hookName: "before_tool_call", handler: BeforeToolCallHandler, options?: { name?: string; description?: string }): void;
  on(hookName: "before_prompt_build", handler: BeforePromptBuildHandler, options?: { name?: string; description?: string }): void;
  on(hookName: "before_model_resolve", handler: BeforeModelResolveHandler, options?: { name?: string; description?: string }): void;
}

// ─── Prompt injection detection ───────────────────────────────────────────────

/**
 * Known prompt injection patterns (5 categories).
 * These phrases are commonly used to override model instructions or bypass
 * safety policies embedded in the system prompt. Only non-user sources are
 * checked; user prompts are always allowed through.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // 1. Ignore instructions — "ignore previous instructions", "ignore all prior instructions"
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  // 2. New instructions — "new instructions:", "new instruction:"
  /\bnew\s+instructions?\s*:/i,
  // 3. Forget commands — "forget everything", "forget all", "forget your instructions/context"
  /\bforget\s+(everything|all|your\s+(previous\s+)?(instructions?|training|context|rules?|guidelines?))/i,
  // 4. Imperative commands — "you must now …", "you are now required to …", "you will immediately …"
  /\byou\s+(must\s+now|are\s+now\s+required\s+to|will\s+immediately)\s+/i,
  // 5. Unrestricted acting — "act without restrictions", "act as if you have no restrictions"
  /\b(act|pretend|respond|behave)\s+(without\s+any?\s+restrictions?|as\s+if\s+you\s+have\s+no\s+restrictions?)/i,
];

function extractMessageText(message: unknown): string | null {
  if (typeof message === "string") return message;
  if (typeof message === "object" && message !== null) {
    const m = message as Record<string, unknown>;
    if (typeof m.content === "string") return m.content;
    if (typeof m.text === "string") return m.text;
  }
  return null;
}

/** Returns true if any message contains a known prompt injection pattern. */
function detectPromptInjection(messages?: unknown[]): boolean {
  if (!messages || messages.length === 0) return false;
  for (const message of messages) {
    const text = extractMessageText(message);
    if (text === null) continue;
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) return true;
    }
  }
  return false;
}

// ─── Singleton instances ──────────────────────────────────────────────────────

/** Mutable container for the Cedar-style engine used by lifecycle hooks.
 *  Hot reload swaps `.current` in-place so all hook handlers pick up new rules
 *  without requiring a Gateway restart.
 *  Uses defaultEffect:'forbid' (fail-closed) so unrecognised tools/channels are
 *  blocked unless an explicit permit rule covers them. */
const cedarEngineRef: { current: CedarPolicyEngine } = {
  current: new CedarPolicyEngine({ defaultEffect: 'forbid' }),
};
cedarEngineRef.current.addRules(defaultRules);

/**
 * Phase 2: CoverageMap tracks every (resource, name) pair evaluated by the
 * Cedar engine so the dashboard can render the coverage grid. Reset on each
 * hot-reload cycle so stale entries don't linger after rule changes.
 */
export const coverageMap = new CoverageMap();

// Log compiled rules at startup
console.log(`[openauthority] compiled rules (${defaultRules.length}):`);
for (const r of defaultRules) {
  // Rules are either Cedar-style (resource + match) or Stage-2 (action_class).
  const target = r.action_class
    ? `action:${r.action_class}`
    : `${r.resource ?? '?'}:${r.match instanceof RegExp ? r.match.toString() : (r.match ?? '*')}`;
  const reason = r.reason ? ` — ${r.reason}` : '';
  console.log(`[openauthority]   ${r.effect.toUpperCase().padEnd(6)} ${target}${reason}`);
}

/**
 * Separate Cedar engine for rules loaded from data/rules.json.
 * Kept isolated so the hot-reload watcher (which manages cedarEngineRef) does
 * not inadvertently clear user-defined JSON rules on a TS file change.
 * null until loadJsonRules() succeeds on activate.
 */
const jsonRulesEngineRef: { current: CedarPolicyEngine | null } = {
  current: null,
};

/**
 * JSON rule record as written in data/rules.json.
 * Uses Cedar-style fields — effect, resource, match — not the TypeBox schema.
 */
interface JsonRuleRecord {
  id?: string;
  effect: "permit" | "forbid";
  resource: "tool" | "command" | "channel" | "prompt" | "model";
  /** Exact string or regex source (e.g. "^web_fetch$") to match resource name. */
  match: string;
  reason?: string;
  tags?: string[];
}

/**
 * Resolves data/rules.json relative to this module's dist/ directory, reads
 * it, translates each record into a Cedar Rule, and loads them into a fresh
 * PolicyEngine stored in jsonRulesEngineRef.current.
 *
 * Errors are logged but never thrown so a malformed rules file does not
 * prevent the rest of the plugin from activating.
 */
async function loadJsonRules(): Promise<void> {
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    // data/rules.json sits two levels up from dist/ (project root/data/)
    const rulesPath = resolve(moduleDir, "../../data/rules.json");

    let raw: string;
    try {
      raw = await readFile(rulesPath, "utf-8");
    } catch (readErr: unknown) {
      const code = (readErr as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        console.log("[plugin:openauthority] no data/rules.json found — skipping JSON rule load");
        return;
      }
      throw readErr;
    }

    const records: JsonRuleRecord[] = JSON.parse(raw);
    if (!Array.isArray(records)) {
      throw new TypeError("data/rules.json must be a JSON array of rule objects");
    }

    const cedarRules: Rule[] = records.map((rec, i) => {
      // Convert to RegExp when regex metacharacters are present; otherwise
      // normalise to lowercase (tool names in OpenClaw are always lowercase,
      // so "Exec" in JSON would never match without this).
      let match: string | RegExp = rec.match;
      if (/[\\^$.|?*+()[\]{}]/.test(rec.match)) {
        try {
          match = new RegExp(rec.match);
        } catch {
          console.warn(
            `[plugin:openauthority] data/rules.json rule[${i}] has invalid regex "${rec.match}" — using exact match`
          );
        }
      } else {
        match = rec.match.toLowerCase();
      }

      return {
        effect: rec.effect,
        resource: rec.resource,
        match,
        ...(rec.reason !== undefined ? { reason: rec.reason } : {}),
        ...(rec.tags !== undefined ? { tags: rec.tags } : {}),
      } satisfies Rule;
    });

    const engine = new CedarPolicyEngine();
    engine.addRules(cedarRules);
    jsonRulesEngineRef.current = engine;

    console.log(`[plugin:openauthority] loaded ${cedarRules.length} rule(s) from data/rules.json`);
  } catch (err) {
    console.error("[plugin:openauthority] failed to load data/rules.json — JSON rules will not be enforced:", err);
  }
}

// ─── HITL state ──────────────────────────────────────────────────────────────

/** Mutable ref for the loaded HITL policy config. null until loaded. */
const hitlConfigRef: { current: HitlPolicyConfig | null } = { current: null };
let hitlWatcher: HitlWatcherHandle | null = null;
let telegramListener: TelegramListener | null = null;
let slackInteractionServer: SlackInteractionServer | null = null;
const approvalManager = new ApprovalManager();

/** Maps HITL token → Slack message timestamp for chat.update on decision. */
const slackMessageTimestamps = new Map<string, string>();

/** JSONL audit logger for HITL decisions — initialised in activate(). */
let hitlAuditLogger: JsonlAuditLogger | null = null;

/** Budget tracker — appends events to data/budget.jsonl; initialised in activate(). */
let budgetTracker: BudgetTracker | null = null;

/** Activation guard — prevents duplicate hook registration when openclaw
 *  loads the plugin from multiple subsystems (gateway, CLI, etc.). */
let activated = false;

// ─── Hook implementations ─────────────────────────────────────────────────────

/**
 * before_tool_call
 *
 * Evaluates whether a tool may be called by consulting the Cedar policy engine.
 * Returns { block: true, blockReason } when the engine returns forbid.
 * Fails closed on unexpected errors.
 */
/** Format a matched rule for log output. */
function formatMatchedRule(rule: { effect: string; resource?: string; action_class?: string; match?: string | RegExp; condition?: unknown; reason?: string } | undefined): string {
  if (!rule) return "no matching rule (implicit permit)";
  const match = rule.match instanceof RegExp ? rule.match.source : String(rule.match ?? "*");
  const truncMatch = match.length > 40 ? match.slice(0, 37) + "..." : match;
  const cond = rule.condition ? " [conditional]" : "";
  const scope = rule.resource ?? rule.action_class ?? "(action_class)";
  return `${rule.effect} ${scope}:${truncMatch}${cond}`;
}

/**
 * Dispatches a HITL approval request to the appropriate channel adapter (Telegram or Slack).
 *
 * Returns a `BeforeToolCallResult` when the action should be blocked, or `undefined` to allow.
 */
async function dispatchHitlChannel(
  policy: import('./hitl/types.js').HitlPolicy,
  toolName: string,
  identity: ResolvedIdentity,
): Promise<BeforeToolCallResult | void> {
  const channel = policy.approval.channel;
  const auditAgent = identity.auditAgentId;
  const auditChannel = identity.auditChannel;

  if (channel === 'telegram') {
    const telegramConfig = resolveTelegramConfig(hitlConfigRef.current?.telegram);
    if (!telegramConfig) {
      console.log(`[openauthority] │ [hitl] telegram not configured — applying fallback: ${policy.approval.fallback}`);
      await logHitlDecision(policy.approval.fallback === 'deny' ? 'fallback-deny' : 'fallback-auto-approve', '', toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
      if (policy.approval.fallback === 'deny') {
        console.log(`[openauthority] │ DECISION: ✕ BLOCKED (hitl/telegram-not-configured)`);
        console.log(`[openauthority] └──────────────────────────────────────────────────────`);
        return { block: true, blockReason: 'HITL approval required but Telegram not configured' };
      }
      return;
    }

    const { token, promise } = approvalManager.createApprovalRequest({ toolName, agentId: auditAgent, channelId: auditChannel, policy });
    const sent = await sendApprovalRequest(telegramConfig, { token, toolName, agentId: auditAgent, policyName: policy.name, timeoutSeconds: policy.approval.timeout, verified: identity.verified });

    if (!sent) {
      approvalManager.cancel(token);
      console.log(`[openauthority] │ [hitl] telegram unreachable — applying fallback: ${policy.approval.fallback}`);
      await logHitlDecision('telegram-unreachable', token, toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
      if (policy.approval.fallback === 'deny') {
        console.log(`[openauthority] │ DECISION: ✕ BLOCKED (hitl/telegram-unreachable)`);
        console.log(`[openauthority] └──────────────────────────────────────────────────────`);
        return { block: true, blockReason: 'HITL: Telegram unreachable — fail closed' };
      }
      return;
    }

    return await resolveHitlDecision(token, promise, policy, toolName, identity, (t, decision) => {
      void sendConfirmation(telegramConfig, { token: t, decision, toolName });
    });
  }

  if (channel === 'slack') {
    const slackConfig = resolveSlackConfig(hitlConfigRef.current?.slack);
    if (!slackConfig) {
      console.log(`[openauthority] │ [hitl] slack not configured — applying fallback: ${policy.approval.fallback}`);
      await logHitlDecision(policy.approval.fallback === 'deny' ? 'fallback-deny' : 'fallback-auto-approve', '', toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
      if (policy.approval.fallback === 'deny') {
        console.log(`[openauthority] │ DECISION: ✕ BLOCKED (hitl/slack-not-configured)`);
        console.log(`[openauthority] └──────────────────────────────────────────────────────`);
        return { block: true, blockReason: 'HITL approval required but Slack not configured' };
      }
      return;
    }

    const { token, promise } = approvalManager.createApprovalRequest({ toolName, agentId: auditAgent, channelId: auditChannel, policy });
    const result = await sendSlackApprovalRequest(slackConfig, { token, toolName, agentId: auditAgent, policyName: policy.name, timeoutSeconds: policy.approval.timeout, verified: identity.verified });

    if (!result.ok) {
      approvalManager.cancel(token);
      console.log(`[openauthority] │ [hitl] slack unreachable — applying fallback: ${policy.approval.fallback}`);
      await logHitlDecision('slack-unreachable', token, toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
      if (policy.approval.fallback === 'deny') {
        console.log(`[openauthority] │ DECISION: ✕ BLOCKED (hitl/slack-unreachable)`);
        console.log(`[openauthority] └──────────────────────────────────────────────────────`);
        return { block: true, blockReason: 'HITL: Slack unreachable — fail closed' };
      }
      return;
    }

    // Store message timestamp for chat.update on decision
    if (result.messageTs) slackMessageTimestamps.set(token, result.messageTs);

    return await resolveHitlDecision(token, promise, policy, toolName, identity, (t, decision) => {
      const messageTs = slackMessageTimestamps.get(t);
      slackMessageTimestamps.delete(t);
      if (messageTs) {
        void sendSlackConfirmation(slackConfig, { token: t, decision, toolName, messageTs });
      }
    });
  }

  // Unknown channel — no adapter available
  return;
}

/**
 * Awaits a HITL approval decision and returns the appropriate hook result.
 * Shared between Telegram and Slack flows.
 */
async function resolveHitlDecision(
  token: string,
  promise: Promise<import('./hitl/approval-manager.js').HitlDecision>,
  policy: import('./hitl/types.js').HitlPolicy,
  toolName: string,
  identity: ResolvedIdentity,
  sendConfirmationFn: (token: string, decision: string) => void,
): Promise<BeforeToolCallResult | void> {
  console.log(`[openauthority] │ [hitl] awaiting operator response for token=${token} (timeout=${policy.approval.timeout}s)`);
  const decision = await promise;
  const auditAgent = identity.auditAgentId;
  const auditChannel = identity.auditChannel;

  if (decision === 'approved') {
    console.log(`[openauthority] │ [hitl] ✓ APPROVED (token=${token})`);
    await logHitlDecision('approved', token, toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
    sendConfirmationFn(token, 'approved');
    return;
  }

  if (decision === 'denied') {
    console.log(`[openauthority] │ [hitl] ✕ DENIED (token=${token})`);
    await logHitlDecision('denied', token, toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
    sendConfirmationFn(token, 'denied');
    console.log(`[openauthority] │ DECISION: ✕ BLOCKED (hitl/denied)`);
    console.log(`[openauthority] └──────────────────────────────────────────────────────`);
    return { block: true, blockReason: 'HITL: Operator denied the tool call' };
  }

  // expired
  console.log(`[openauthority] │ [hitl] ⏱ EXPIRED (token=${token}) — fallback: ${policy.approval.fallback}`);
  const auditDecision = policy.approval.fallback === 'deny' ? 'fallback-deny' as const : 'fallback-auto-approve' as const;
  await logHitlDecision(auditDecision, token, toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
  if (policy.approval.fallback === 'deny') {
    sendConfirmationFn(token, 'expired (denied)');
    console.log(`[openauthority] │ DECISION: ✕ BLOCKED (hitl/expired-deny)`);
    console.log(`[openauthority] └──────────────────────────────────────────────────────`);
    return { block: true, blockReason: 'HITL: Approval timed out — denied by policy fallback' };
  }
  sendConfirmationFn(token, 'expired (auto-approved)');
  return;
}

/** Log a HITL decision to the JSONL audit file. */
async function logHitlDecision(
  decision: HitlDecisionEntry['decision'],
  token: string,
  toolName: string,
  agentId: string,
  channel: string,
  policyName: string,
  timeoutSeconds: number,
  verified: boolean,
): Promise<void> {
  if (!hitlAuditLogger) return;
  await hitlAuditLogger.log({
    ts: new Date().toISOString(),
    type: 'hitl',
    decision,
    token,
    toolName,
    agentId,
    channel,
    policyName,
    timeoutSeconds,
    verified,
  });
}

/**
 * Determines the source trust level from the event source field.
 *
 * Mapping:
 *   'user'               → 'user'      (direct user instruction)
 *   'agent' | undefined  → 'agent'     (autonomous agent reasoning)
 *   anything else        → 'untrusted' (external content: web, file, email, etc.)
 */
function determineSourceTrustLevel(source?: string): 'user' | 'agent' | 'untrusted' {
  if (source === 'user') return 'user';
  if (source === 'agent' || source === undefined) return 'agent';
  return 'untrusted';
}

const beforeToolCallHandler: BeforeToolCallHandler = ({ toolName, params, source }, ctx) => {
  console.log(`[openauthority] ┌─ before_tool_call ──────────────────────────────────`);
  console.log(`[openauthority] │ tool=${toolName}  agent=${ctx.agentId ?? "unknown"}  channel=${ctx.channelId ?? "unknown"}`);

  // ── Budget tracking — log every hook event to data/budget.jsonl ───────────
  if (budgetTracker !== null) {
    // Estimate input tokens from serialised params (rough: 1 token ≈ 4 UTF-16
    // code units). Output tokens are not available pre-call; recorded as 0.
    const paramJson = params !== undefined ? JSON.stringify(params) : '';
    const estimatedInputTokens = Math.max(1, Math.round(paramJson.length / 4));
    budgetTracker.append(estimatedInputTokens, 0);
  }

  // ── Identity verification (V-03 v0.1 follow-up) ──────────────────────────
  // Verify the (agentId, channel) claim against the AgentIdentityRegistry
  // before the identity is used for audit logging or HITL approval messages.
  // When the registry is empty, every claim is accepted (back-compat).
  // Preserve the real channel name in the rule context. Only fall back to
  // "default" when the host provides no channel at all (undefined/empty
  // string). Do NOT remap named channels like "webchat" — rules explicitly
  // reference them.
  const identity = resolveIdentity(ctx.agentId, ctx.channelId);
  if (!identity.verified) {
    console.log(`[openauthority] │ [identity] ⚠ UNVERIFIED — claim agent=${identity.agentId} channel=${identity.channel}`);
  }
  const ruleContext: RuleContext = defaultAgentIdentityRegistry.buildRuleContext(
    identity.agentId,
    identity.channel,
  );

  // ── 0. Source trust level determination ───────────────────────────────────
  const normalizedParams = (params !== null && typeof params === 'object' && !Array.isArray(params))
    ? (params as Record<string, unknown>)
    : {};
  const sourceTrustLevel = determineSourceTrustLevel(source);
  const normalizedAction = normalize_action(toolName, normalizedParams);
  console.log(`[openauthority] │ [trust] source=${source ?? "undefined"} → trustLevel=${sourceTrustLevel}  actionClass=${normalizedAction.action_class}  risk=${normalizedAction.risk}`);

  // Build envelope to propagate trust context for audit and pipeline tracing.
  const _envelope = buildEnvelope(
    {
      action_class: normalizedAction.action_class,
      target: normalizedAction.target,
      summary: `tool call: ${toolName}`,
      payload_hash: createHash('sha256').update(sortedJsonStringify(normalizedParams)).digest('hex'),
      parameters: normalizedParams,
    },
    null,
    sourceTrustLevel,
    ctx.agentId ?? 'unknown',
    '',
    0,
    '',
  );

  // ── Stage 1: trust level gate ─────────────────────────────────────────────
  // Untrusted sources (external content: web, file, email, etc.) are blocked
  // from triggering high/critical-risk actions.
  if (sourceTrustLevel === 'untrusted' && (normalizedAction.risk === 'high' || normalizedAction.risk === 'critical')) {
    console.log(`[openauthority] │ DECISION: ✕ BLOCKED (stage1/untrusted_source_high_risk) — actionClass=${normalizedAction.action_class} risk=${normalizedAction.risk}`);
    console.log(`[openauthority] └──────────────────────────────────────────────────────`);
    return { block: true, blockReason: 'untrusted_source_high_risk' };
  }

  // ── 1. Cedar engine (TypeScript rules, hot-reloaded) ──────────────────────
  try {
    const decision = cedarEngineRef.current.evaluate("tool", toolName, ruleContext);
    console.log(`[openauthority] │ [cedar] matched: ${formatMatchedRule(decision.matchedRule)}`);
    if (decision.matchedRule?.reason) console.log(`[openauthority] │ [cedar] reason: ${decision.matchedRule.reason}`);
    if (decision.rateLimit) console.log(`[openauthority] │ [cedar] rate-limit: ${decision.rateLimit.currentCount}/${decision.rateLimit.maxCalls} per ${decision.rateLimit.windowSeconds}s${decision.rateLimit.limited ? " [EXCEEDED]" : ""}`);
    // Phase 2: record in coverage map (rate-limited is a specialised forbid)
    const covState = decision.rateLimit?.limited ? 'rate-limited' : decision.effect === 'permit' ? 'permit' : 'forbid';
    coverageMap.record('tool', toolName, covState, decision.matchedRule);
    if (decision.effect === "forbid") {
      const blockReason = decision.reason ?? "Tool call denied by Cedar policy";
      console.log(`[openauthority] │ DECISION: ✕ BLOCKED (cedar/${decision.effect}) — ${blockReason}`);
      console.log(`[openauthority] └──────────────────────────────────────────────────────`);
      return { block: true, blockReason };
    }
    console.log(`[openauthority] │ [cedar] ✓ passed`);
  } catch (err) {
    console.error(`[openauthority] │ [cedar] ✕ ERROR — fail closed`, err);
    console.log(`[openauthority] └──────────────────────────────────────────────────────`);
    return { block: true, blockReason: "Cedar policy evaluation error — fail closed" };
  }

  // ── 2. JSON Cedar engine (data/rules.json, loaded at startup) ─────────────
  if (jsonRulesEngineRef.current !== null) {
    try {
      const jsonDecision = jsonRulesEngineRef.current.evaluate("tool", toolName, ruleContext);
      console.log(`[openauthority] │ [json-rules] matched: ${formatMatchedRule(jsonDecision.matchedRule)}`);
      if (jsonDecision.matchedRule?.reason) console.log(`[openauthority] │ [json-rules] reason: ${jsonDecision.matchedRule.reason}`);
      if (jsonDecision.effect === "forbid") {
        const blockReason = jsonDecision.reason ?? "Tool call denied by JSON rule";
        console.log(`[openauthority] │ DECISION: ✕ BLOCKED (json-rules/${jsonDecision.effect}) — ${blockReason}`);
        console.log(`[openauthority] └──────────────────────────────────────────────────────`);
        return { block: true, blockReason };
      }
      console.log(`[openauthority] │ [json-rules] ✓ passed`);
    } catch (err) {
      console.error(`[openauthority] │ [json-rules] ✕ ERROR — fail closed`, err);
      console.log(`[openauthority] └──────────────────────────────────────────────────────`);
      return { block: true, blockReason: "JSON rule evaluation error — fail closed" };
    }
  }

  // ── Fast path: no HITL — return synchronously ─────────────────────────────
  if (hitlConfigRef.current === null) {
    console.log(`[openauthority] │ DECISION: ✓ ALLOWED (all engines passed)`);
    console.log(`[openauthority] └──────────────────────────────────────────────────────`);
    return;
  }

  // ── Async path: HITL evaluation ───────────────────────────────────────────
  return (async () => {
    // ── HITL policy check ────────────────────────────────────────────────────
    if (hitlConfigRef.current !== null) {
      try {
        const hitlResult = checkAction(hitlConfigRef.current, normalizedAction.action_class);

        if (hitlResult.requiresApproval && hitlResult.matchedPolicy) {
          const policy = hitlResult.matchedPolicy;
          console.log(`[openauthority] │ [hitl] matched policy "${policy.name}" — requesting approval via ${policy.approval.channel}`);

          // ── Dispatch to channel-specific adapter ──────────────────────────
          const hitlChannelResult = await dispatchHitlChannel(policy, toolName, identity);
          if (hitlChannelResult) return hitlChannelResult;
        } else {
          console.log(`[openauthority] │ [hitl] ✓ no matching HITL policy`);
        }
      } catch (err) {
        console.error(`[openauthority] │ [hitl] ✕ ERROR — fail closed`, err);
        console.log(`[openauthority] └──────────────────────────────────────────────────────`);
        return { block: true, blockReason: 'HITL evaluation error — fail closed' };
      }
    }

    console.log(`[openauthority] │ DECISION: ✓ ALLOWED (all engines passed)`);
    console.log(`[openauthority] └──────────────────────────────────────────────────────`);
    return;
  })();
};

/**
 * before_prompt_build
 *
 * Checks non-user sources for prompt injection and blocks when detected.
 * User prompts (source === 'user') are always allowed through.
 *
 * 1. Blocks prompts from non-user sources that match injection patterns.
 * 2. Evaluates prompt rules and can prepend policy context.
 */
const beforePromptBuildHandler: BeforePromptBuildHandler = ({ prompt, messages, source }, ctx) => {
  console.log(`[openauthority] ▶ before_prompt_build ENTER agentId=${ctx.agentId ?? "unknown"} channelId=${ctx.channelId ?? "unknown"} source=${source ?? "unknown"} messageCount=${messages?.length ?? 0} promptLen=${prompt?.length ?? 0}`);
  try {
    // Only check non-user sources for prompt injection
    if (source !== 'user' && detectPromptInjection(messages)) {
      const blockReason = `Prompt injection detected from source '${source ?? "unknown"}'`;
      console.log(`[openauthority] ⚠ before_prompt_build INJECTION BLOCKED source=${source ?? "unknown"} agentId=${ctx.agentId ?? "unknown"}`);
      console.log(`[openauthority] ◀ before_prompt_build EXIT  → block (injection)`);
      return { block: true, blockReason };
    }

    // Evaluate the prompt identifier against Cedar prompt rules.
    // before_prompt_build cannot block, so a FORBID match results in a
    // prependContext warning rather than a hard block.
    const ruleContext: RuleContext = defaultAgentIdentityRegistry.buildRuleContext(
      ctx.agentId ?? "unknown",
      ctx.channelId || "default",
    );
    const decision = cedarEngineRef.current.evaluate("prompt", prompt, ruleContext);
    if (decision.effect === "forbid") {
      const reason = decision.reason ?? "This prompt type is restricted by policy";
      console.log(`[openauthority] ⚠ before_prompt_build POLICY VIOLATION: ${reason}`);
      console.log(`[openauthority] ◀ before_prompt_build EXIT  → prependContext (policy warning)`);
      return {
        prependContext: `[POLICY WARNING] ${reason}.`,
      };
    }

    console.log(`[openauthority] ✓ before_prompt_build OK — no injection detected`);
    console.log(`[openauthority] ◀ before_prompt_build EXIT  → no modification`);
    return;
  } catch (err) {
    console.error(`[openauthority] ✕ before_prompt_build ERROR`, err);
    console.log(`[openauthority] ◀ before_prompt_build EXIT  → no modification (error)`);
    return;
  }
};

/**
 * before_model_resolve
 *
 * Cannot block — can only override the model or provider.
 * Evaluates model rules and overrides to a fallback model when the requested
 * model is forbidden by policy.
 */
const beforeModelResolveHandler: BeforeModelResolveHandler = ({ prompt }, ctx) => {
  console.log(`[openauthority] ▶ before_model_resolve ENTER agentId=${ctx.agentId ?? "unknown"} channelId=${ctx.channelId ?? "unknown"} promptLen=${prompt?.length ?? 0}`);

  // NOTE: The before_model_resolve event only provides `prompt` (the full prompt
  // text), NOT the model name. Evaluating the prompt text against model rules
  // (which match patterns like /^claude-/) would produce misleading results,
  // potentially triggering a modelOverride on every call and API rate limits.
  //
  // This hook will be useful once openclaw passes the model name in the event.
  // For now, pass through without interference.

  console.log(`[openauthority] ✓ before_model_resolve OK — passthrough (no model name in event)`);
  console.log(`[openauthority] ◀ before_model_resolve EXIT  → no override`);
  return;
};

// ─── Plugin definition ────────────────────────────────────────────────────────

interface VersionInfo {
  version: string;
  commit: string;
  commitDirty: boolean;
  builtAt: string;
  pluginRoot: string;
}

/**
 * Collect best-effort version info for the activation banner so the operator
 * can confirm at a glance which build of openauthority is running.
 */
function getVersionInfo(): VersionInfo {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = resolve(moduleDir, "..");

  let version = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(resolve(pluginRoot, "package.json"), "utf8"));
    version = pkg.version ?? "unknown";
  } catch {}

  let commit = "unknown";
  let commitDirty = false;
  try {
    commit = execSync("git rev-parse --short HEAD", {
      cwd: pluginRoot,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    const status = execSync("git status --porcelain", {
      cwd: pluginRoot,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    commitDirty = status.trim().length > 0;
  } catch {}

  let builtAt = "unknown";
  try {
    builtAt = statSync(fileURLToPath(import.meta.url)).mtime.toISOString();
  } catch {}

  return { version, commit, commitDirty, builtAt, pluginRoot };
}

let rulesWatcher: WatcherHandle | null = null;

/**
 * Returns true when policy enforcement should be active.
 *
 * Activation is deferred until `data/.installed` exists — written by the
 * install script after bootstrap completes. Activation is also deferred when
 * `npm_lifecycle_event` indicates an active npm install lifecycle (install,
 * preinstall, postinstall, prepare) to prevent policy from blocking bootstrap
 * commands. Set `OPENAUTH_FORCE_ACTIVE=1` to bypass both gates in development
 * or CI environments.
 */
function isInstalled(): boolean {
  if (process.env.OPENAUTH_FORCE_ACTIVE === "1") return true;
  // Defer during npm install lifecycle phases (preinstall, install, postinstall, prepare).
  const lifecycleEvent = process.env.npm_lifecycle_event ?? "";
  if (["install", "preinstall", "postinstall", "prepare"].includes(lifecycleEvent)) return false;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = resolve(moduleDir, "..");
  return existsSync(resolve(pluginRoot, "data", ".installed"));
}

const plugin: OpenclawPlugin = {
  name: "openauthority",
  // Single source of truth: package.json (read by getVersionInfo at activation).
  version: getVersionInfo().version,

  async activate(ctx: OpenclawPluginContext) {
    // ── Install lifecycle gate ────────────────────────────────────────────────
    // Policy enforcement is deferred until install completes (indicated by
    // data/.installed). This prevents bootstrap commands from being blocked
    // before plugin setup finishes. Set OPENAUTH_FORCE_ACTIVE=1 to bypass
    // this gate in development or CI environments.
    if (!isInstalled()) {
      console.log("[plugin:openauthority] install incomplete — policy activation deferred (data/.installed not found; set OPENAUTH_FORCE_ACTIVE=1 to override)");
      return;
    }

    // ── Typed hooks: register into EVERY registry ───────────────────────────
    // OpenClaw loads plugins from multiple subsystems, each with its own
    // registry. ctx.on() targets the calling registry's typedHooks array.
    // The global hook runner is overwritten on each loadOpenClawPlugins call,
    // so we must register into every registry to ensure the hook is present
    // in whichever registry ends up as the active one.
    ctx.on("before_tool_call", beforeToolCallHandler, { name: "openauthority:before_tool_call" });
    ctx.on("before_prompt_build", beforePromptBuildHandler, { name: "openauthority:before_prompt_build" });
    ctx.on("before_model_resolve", beforeModelResolveHandler, { name: "openauthority:before_model_resolve" });

    // ── Guard: side effects (watchers, engines) only once ────────────────────
    if (activated) {
      console.log("[plugin:openauthority] hooks re-registered into new registry — skipping side effects");
      return;
    }
    activated = true;

    // ── Budget tracker — initialise singleton for data/budget.jsonl ──────────
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const pluginRoot = resolve(moduleDir, "..");
    budgetTracker = createBudgetTracker(pluginRoot);
    console.log(`[plugin:openauthority] budget tracker active — session=${budgetTracker.sessionId}  dailyLimit=${budgetTracker.dailyTokenLimit}  warnAt=${budgetTracker.warnAt}`);

    // ── Version banner: confirm at a glance which build is running ──────────
    const v = getVersionInfo();
    const dirtyTag = v.commitDirty ? " (dirty)" : "";
    console.log("┌──────────────────────────────────────────────────────────────┐");
    console.log("│  [plugin:openauthority] VERSION                              │");
    console.log("├──────────────────────────────────────────────────────────────┤");
    console.log(`│  version:    ${v.version}${dirtyTag}`.padEnd(63) + "│");
    console.log(`│  commit:     ${v.commit}${dirtyTag}`.padEnd(63) + "│");
    console.log(`│  built at:   ${v.builtAt}`.padEnd(63) + "│");
    console.log(`│  root:       ${v.pluginRoot}`.padEnd(63) + "│");
    console.log("└──────────────────────────────────────────────────────────────┘");

    rulesWatcher = startRulesWatcher(cedarEngineRef, 300, undefined, { defaultEffect: 'forbid' }, defaultRules, coverageMap);

    // Load user-defined JSON rules from data/rules.json into the dedicated
    // JSON Cedar engine. Async but errors are swallowed so activation is
    // never blocked by a missing or malformed rules file.
    loadJsonRules().catch((err) =>
      console.error("[plugin:openauthority] unexpected error in loadJsonRules:", err)
    );

    // ── Diagnostic: log registered hooks and loaded rules ────────────────────
    const registeredHooks = ["before_tool_call", "before_prompt_build", "before_model_resolve"];
    const disabledHooks: string[] = [];
    const rules = cedarEngineRef.current.rules;
    const rulesByResource: Record<string, Rule[]> = {};
    for (const r of rules) {
      // Group action_class rules under their dotted namespace prefix
      // (e.g. "filesystem.read" → "filesystem"); fall back to resource.
      const key = r.action_class
        ? r.action_class.split(".")[0] ?? "action"
        : (r.resource ?? "unknown");
      if (!rulesByResource[key]) rulesByResource[key] = [];
      rulesByResource[key].push(r);
    }
    console.log("┌──────────────────────────────────────────────────────────────┐");
    console.log("│  [plugin:openauthority] ACTIVATION SUMMARY                  │");
    console.log("├──────────────────────────────────────────────────────────────┤");
    console.log("│  HOOKS REGISTERED (via ctx.on):                              │");
    for (const h of registeredHooks) {
      console.log(`│    ✓ ${h.padEnd(54)}│`);
    }
    for (const h of disabledHooks) {
      console.log(`│    ✗ ${h} (disabled)`.padEnd(63) + "│");
    }
    console.log("├──────────────────────────────────────────────────────────────┤");
    console.log(`│  POLICY RULES LOADED: ${String(rules.length).padEnd(38)}│`);
    for (const [resource, resourceRules] of Object.entries(rulesByResource)) {
      const permits = resourceRules.filter((r) => r.effect === "permit").length;
      const forbids = resourceRules.filter((r) => r.effect === "forbid").length;
      console.log(`│    ${resource}: ${resourceRules.length} rules (${permits} permit, ${forbids} forbid)`.padEnd(63) + "│");
    }
    console.log("├──────────────────────────────────────────────────────────────┤");
    console.log("│  RULE DETAILS:                                               │");
    for (const r of rules) {
      const effect = r.effect === "permit" ? "✓ PERMIT" : "✕ FORBID";
      const target = r.action_class
        ? `action:${r.action_class}`
        : `${r.resource ?? "?"}:${r.match instanceof RegExp ? r.match.source : String(r.match ?? "*")}`;
      const truncTarget = target.length > 48 ? target.slice(0, 45) + "..." : target;
      const cond = r.condition ? " [conditional]" : "";
      console.log(`│  ${effect} ${truncTarget}${cond}`.padEnd(63) + "│");
    }
    console.log("└──────────────────────────────────────────────────────────────┘");

    // ── HITL policy loading + Telegram listener ─────────────────────────────
    try {
      const moduleDir = dirname(fileURLToPath(import.meta.url));
      const pluginRoot = resolve(moduleDir, "..");
      const hitlPolicyPath = resolve(pluginRoot, "hitl-policy.yaml");

      const hitlConfig = await parseHitlPolicyFile(hitlPolicyPath);
      hitlConfigRef.current = hitlConfig;

      // Initialise HITL audit logger (same data/ directory as other audit logs)
      const auditLogPath = resolve(pluginRoot, "data", "audit.jsonl");
      hitlAuditLogger = new JsonlAuditLogger({ logFile: auditLogPath });

      // Start hot-reload watcher
      hitlWatcher = startHitlPolicyWatcher(hitlPolicyPath, hitlConfigRef as { current: HitlPolicyConfig });

      // Start channel listeners
      const listeners: string[] = [];

      // Telegram listener
      const telegramConfig = resolveTelegramConfig(hitlConfig.telegram);
      if (telegramConfig) {
        telegramListener = new TelegramListener(
          telegramConfig.botToken,
          (command, token) => {
            const decision = command === 'approve' ? 'approved' as const : 'denied' as const;
            const resolved = approvalManager.resolveApproval(token, decision);
            if (!resolved) {
              console.log(`[hitl-telegram] unknown or expired token: ${token}`);
            }
          },
        );
        telegramListener.start();
        listeners.push('Telegram');
      }

      // Slack interaction server
      const slackConfig = resolveSlackConfig(hitlConfig.slack);
      if (slackConfig) {
        slackInteractionServer = new SlackInteractionServer(
          slackConfig.interactionPort,
          slackConfig.signingSecret,
          (command, token) => {
            const decision = command === 'approve' ? 'approved' as const : 'denied' as const;
            const resolved = approvalManager.resolveApproval(token, decision);
            if (!resolved) {
              console.log(`[hitl-slack] unknown or expired token: ${token}`);
            }
          },
        );
        await slackInteractionServer.start();
        listeners.push(`Slack (port ${slackConfig.interactionPort})`);
      }

      const listenerInfo = listeners.length > 0 ? `, listeners: ${listeners.join(', ')}` : ' (no channel listeners configured)';
      console.log(`[plugin:openauthority] HITL loaded: ${hitlConfig.policies.length} polic${hitlConfig.policies.length !== 1 ? 'ies' : 'y'}${listenerInfo}`);
    } catch (err) {
      // HITL is optional — failing to load doesn't prevent activation.
      // parseHitlPolicyFile wraps the underlying fs error in `cause`, so
      // check both the top-level code and the cause chain.
      const directCode = (err as NodeJS.ErrnoException)?.code;
      const causeCode = ((err as { cause?: NodeJS.ErrnoException })?.cause)?.code;
      if (directCode === 'ENOENT' || causeCode === 'ENOENT') {
        console.log("[plugin:openauthority] no hitl-policy.yaml found — HITL disabled");
      } else {
        console.warn("[plugin:openauthority] HITL policy not loaded (invalid config):", err);
      }
    }

    console.log("[plugin:openauthority] activated – lifecycle hooks registered");
  },

  async deactivate() {
    // ── HITL cleanup ──────────────────────────────────────────────────────
    if (telegramListener !== null) {
      telegramListener.stop();
      telegramListener = null;
    }
    if (slackInteractionServer !== null) {
      await slackInteractionServer.stop();
      slackInteractionServer = null;
    }
    slackMessageTimestamps.clear();
    approvalManager.shutdown();
    if (hitlWatcher !== null) {
      await hitlWatcher.stop();
      hitlWatcher = null;
    }
    hitlConfigRef.current = null;
    hitlAuditLogger = null;

    // ── Rules watcher cleanup ─────────────────────────────────────────────
    if (rulesWatcher !== null) {
      await rulesWatcher.stop();
      rulesWatcher = null;
    }
    activated = false;
    console.log("[plugin:openauthority] deactivated");
  },
};

export default plugin;

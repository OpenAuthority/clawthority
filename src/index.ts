// ─── Audit re-exports ─────────────────────────────────────────────────────────
export { JsonlAuditLogger } from "./audit.js";
export type {
  PolicyDecisionEntry,
  HitlDecisionEntry,
  NormalizerUnclassifiedEntry,
  AutoPermitAddedEntry,
  JsonlAuditLoggerOptions,
} from "./audit.js";

// ─── Identity registry re-exports (V-03 v0.1 follow-up) ─────────────────────
export {
  AgentIdentityRegistry,
  defaultAgentIdentityRegistry,
} from "./identity.js";
export type { RegisteredAgent, IdentityVerificationResult } from "./identity.js";

// ─── Auto-permits subsystem re-exports ───────────────────────────────────────
export {
  AutoPermitStorageModeSchema,
  DEFAULT_AUTO_PERMIT_STORE_PATH,
  RULES_FILE_PATH,
  resolveAutoPermitStoreConfig,
  compilePatternRegex,
  FileAutoPermitChecker,
  loadAutoPermitRulesFromFile,
  saveAutoPermitRules,
  watchAutoPermitStore,
} from "./auto-permits/index.js";
export type {
  AutoPermitStorageMode,
  ResolvedAutoPermitStoreConfig,
  AutoPermitRuleChecker,
  LoadResult,
  AutoPermitWatchHandle,
} from "./auto-permits/index.js";

// ─── Cedar-style engine re-exports ───────────────────────────────────────────
export { PolicyEngine as CedarPolicyEngine } from "./policy/engine.js";
export type { EvaluationDecision, EvaluationEffect } from "./policy/engine.js";
export type { Rule, RuleContext, Resource, Effect, RateLimit } from "./policy/types.js";
export { default as defaultRules, mergeRules, OPEN_MODE_RULES } from "./policy/rules.js";
export { resolveMode, modeToDefaultEffect } from "./policy/mode.js";
export type { ClawMode } from "./policy/mode.js";
export { resolveFeatureFlags } from "./features.js";
export type { FeatureFlags } from "./features.js";

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
export type { BudgetEntry, BudgetTrackerOptions, BudgetCheckResult } from "./budget/tracker.js";

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
  editMessageDecision,
  sendApproveAlwaysConfirmation,
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
  SendApproveAlwaysConfirmationOpts,
  TelegramCommand,
  TelegramOperatorInfo,
  ResolvedSlackConfig,
  SlackSendApprovalOpts,
  SlackSendApprovalResult,
  SlackActionCommand,
} from "./hitl/index.js";

// ─── Internal imports ─────────────────────────────────────────────────────────
import { JsonlAuditLogger } from "./audit.js";
import type { AutoPermitAddedEntry, AutoPermitDerivationSkippedEntry, AutoPermitMatchedEntry, HitlDecisionEntry, NormalizerUnclassifiedEntry, PolicyDecisionEntry } from "./audit.js";
import { PolicyEngine as CedarPolicyEngine } from "./policy/engine.js";
import type { Rule, RuleContext } from "./policy/types.js";
import defaultRules, { OPEN_MODE_RULES } from "./policy/rules.js";
import { resolveMode, modeToDefaultEffect, type ClawMode } from "./policy/mode.js";
import { resolveFeatureFlags, type FeatureFlags } from "./features.js";
import { startRulesWatcher, type WatcherHandle } from "./watcher.js";
import { CoverageMap } from "./policy/coverage.js";
import { checkAction, matchesActionPattern } from "./hitl/matcher.js";
import { parseHitlPolicyFile } from "./hitl/parser.js";
import { startHitlPolicyWatcher, type HitlWatcherHandle } from "./hitl/watcher.js";
import type { HitlPolicyConfig } from "./hitl/types.js";
import { ApprovalManager } from "./hitl/approval-manager.js";
import { TelegramListener, sendApprovalRequest, sendConfirmation, editMessageDecision, sendApproveAlwaysConfirmation, resolveTelegramConfig } from "./hitl/telegram.js";
import type { TelegramOperatorInfo } from "./hitl/telegram.js";
import { SlackInteractionServer, sendSlackApprovalRequest, sendSlackConfirmation, resolveSlackConfig } from "./hitl/slack.js";
import { sendConsoleApprovalRequest } from "./hitl/console.js";
import { explainCommand } from "./hitl/command-explainer.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_VERSION, BUILD_COMMIT, BUILD_DIRTY, BUILD_AT } from "./build-info.js";
import { normalize_action, sortedJsonStringify, getRegistryEntry } from "./enforcement/normalize.js";
import { defaultAgentIdentityRegistry } from "./identity.js";
import { BudgetTracker, createBudgetTracker } from "./budget/tracker.js";
import { EventEmitter } from "node:events";
import { runPipeline, isInstallPhase } from "./enforcement/pipeline.js";
import type { PipelineContext, Stage1Fn, Stage2Fn, CeeDecision } from "./enforcement/pipeline.js";
import { validateCapability } from "./enforcement/stage1-capability.js";
import { createCombinedStage2 } from "./enforcement/stage2-policy.js";
import { FileAuthorityAdapter } from "./adapter/file-adapter.js";
import type { WatchHandle } from "./adapter/types.js";
import { FileAutoPermitChecker, resolveAutoPermitStoreConfig, loadAutoPermitRulesFromFile, saveAutoPermitRules, watchAutoPermitStore, derivePattern, compilePatternRegex } from "./auto-permits/index.js";
import type { AutoPermitWatchHandle } from "./auto-permits/index.js";
import type { AutoPermit } from "./models/auto-permit.js";

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
  /**
   * Arbitrary metadata provided by the caller. When present,
   * `intent_hint` (string) carries the agent's stated rationale for the
   * tool call and is forwarded to HITL approval messages.
   */
  metadata?: Record<string, unknown>;
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

// ─── Mode resolution ──────────────────────────────────────────────────────────

/**
 * Install mode — controls the policy engine's implicit decision when no rule
 * matches and which baseline rule set is loaded.
 *
 * - `open`    — implicit permit. Ship {@link OPEN_MODE_RULES} (critical-forbid
 *               subset: shell.exec, code.execute, payment.initiate,
 *               credential.read/write, unknown_sensitive_action). User adds
 *               forbid rules to lock things down.
 * - `closed`  — implicit deny. Ship the full {@link defaultRules}. User adds
 *               permit rules to open things up.
 *
 * Read once at module load from `CLAWTHORITY_MODE` env var. Default is `open`
 * so a fresh install works out-of-the-box without every tool call hitting an
 * implicit deny. Change requires a plugin restart.
 */
const MODE: ClawMode = resolveMode();
const DEFAULT_EFFECT: 'permit' | 'forbid' = modeToDefaultEffect(MODE);
const ACTIVE_RULES: Rule[] = MODE === 'open' ? OPEN_MODE_RULES : defaultRules;

/**
 * Feature flags resolved once at module load.
 * A plugin restart is required to change them.
 */
const FEATURES: FeatureFlags = resolveFeatureFlags();

console.log(
  `[clawthority] mode: ${MODE.toUpperCase()} (${
    MODE === 'open'
      ? 'implicit permit; critical forbids enforced'
      : 'implicit deny; explicit permits required'
  })`
);

// ─── Singleton instances ──────────────────────────────────────────────────────

/** Mutable container for the Cedar-style engine used by lifecycle hooks.
 *  Hot reload swaps `.current` in-place so all hook handlers pick up new rules
 *  without requiring a Gateway restart.
 *  `defaultEffect` is driven by the resolved install mode — `forbid` in closed
 *  mode (fail-closed), `permit` in open mode (fail-open with a critical-forbid
 *  safety net). */
const cedarEngineRef: { current: CedarPolicyEngine } = {
  current: new CedarPolicyEngine({ defaultEffect: DEFAULT_EFFECT }),
};
cedarEngineRef.current.addRules(ACTIVE_RULES);

/**
 * Phase 2: CoverageMap tracks every (resource, name) pair evaluated by the
 * Cedar engine so the dashboard can render the coverage grid. Reset on each
 * hot-reload cycle so stale entries don't linger after rule changes.
 */
export const coverageMap = new CoverageMap();

// Log compiled rules at startup
console.log(`[clawthority] compiled rules (${ACTIVE_RULES.length}):`);
for (const r of ACTIVE_RULES) {
  // Rules are either Cedar-style (resource + match) or Stage-2 (action_class).
  const target = r.action_class
    ? `action:${r.action_class}`
    : `${r.resource ?? '?'}:${r.match instanceof RegExp ? r.match.toString() : (r.match ?? '*')}`;
  const reason = r.reason ? ` — ${r.reason}` : '';
  console.log(`[clawthority]   ${r.effect.toUpperCase().padEnd(6)} ${target}${reason}`);
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
 * File-based authority adapter instance, created during activate() with the
 * same data directory used by loadJsonRules(). null until activate() runs.
 */
let adapterRef: FileAuthorityAdapter | null = null;

/**
 * File-based auto-permit rule checker. Loaded from the auto-permit store
 * (data/auto-permits.json by default) during activate(). Undefined until
 * loadAutoPermitRules() completes or when the store file does not exist yet.
 *
 * Re-created on each successful loadAutoPermitRules() call so that rules
 * added to the store (e.g. via "Approve Always") are visible to subsequent
 * tool calls without a plugin restart.
 */
const autoPermitCheckerRef: { current: FileAutoPermitChecker | undefined } = {
  current: undefined,
};

/**
 * WatchHandle returned by adapterRef.watchPolicyBundle(). Stored so it can
 * be stopped in deactivate() to avoid leaked chokidar watchers.
 */
let adapterBundleWatchHandle: WatchHandle | null = null;

/**
 * JSON rule record as written in data/rules.json.
 *
 * Three matching forms are supported (one per rule):
 *
 * 1. Tool/resource name matching (original form):
 *    { "resource": "tool", "match": "web_search", "effect": "forbid" }
 *
 * 2. Action class matching (preferred for semantic rules):
 *    { "action_class": "filesystem.delete", "effect": "forbid", "priority": 90 }
 *
 *    Action class values correspond to the normalizer registry in
 *    src/enforcement/normalize.ts (e.g. filesystem.read, filesystem.delete,
 *    shell.exec, web.search, credential.read, payment.initiate, etc.).
 *    This form matches all tools that normalise to that action class,
 *    so you don't need to enumerate every tool name alias.
 *
 * 3. Intent-group matching (for cross-cutting semantic categories):
 *    { "intent_group": "data_exfiltration", "effect": "forbid", "priority": 90 }
 *
 *    Intent groups tag clusters of action classes that share a threat model
 *    regardless of transport (e.g. `data_exfiltration` covers `web.fetch`,
 *    `web.post` uploads, and anything else the normalizer tags with that
 *    intent). Rules in this form fire after action-class evaluation and
 *    participate in HITL gating the same way (priority < 100 → HITL-gated).
 *
 * `priority` tiers are documented on the `Rule.priority` field — 90 means
 * "HITL-gated forbid", 100+ means "unconditional forbid".
 */
interface JsonRuleRecord {
  id?: string;
  effect: "permit" | "forbid";
  /** Resource-based matching: pair with `match`. */
  resource?: "tool" | "command" | "channel" | "prompt" | "model";
  /** Exact string or regex source (e.g. "^web_fetch$") to match resource name. */
  match?: string;
  /** Action-class matching: semantic class from the normalizer registry. */
  action_class?: string;
  /** Intent-group matching: cross-cutting category (e.g. "data_exfiltration"). */
  intent_group?: string;
  /** Rule priority — 90 is the HITL-gated tier, 100+ is unconditional. */
  priority?: number;
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
    // data/bundle.json (preferred) or data/rules.json (fallback) sit two levels
    // up from dist/ (project root/data/).  bundle.json takes precedence when
    // present; this mirrors the watcher resolveActiveJsonRulesFile() logic.
    // `CLAWTHORITY_RULES_FILE` overrides both for non-standard install layouts
    // and for tests that need to inject a fixture.
    const bundleFilePath = resolve(moduleDir, "../../data/bundle.json");
    const rulesFilePath = resolve(moduleDir, "../../data/rules.json");
    const rulesPath = process.env['CLAWTHORITY_RULES_FILE']
      ?? (existsSync(bundleFilePath) ? bundleFilePath : rulesFilePath);

    let raw: string;
    try {
      raw = await readFile(rulesPath, "utf-8");
    } catch (readErr: unknown) {
      const code = (readErr as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        console.log("[plugin:clawthority] no data/bundle.json or data/rules.json found — skipping JSON rule load");
        return;
      }
      throw readErr;
    }

    const parsed: unknown = JSON.parse(raw);

    // Accept both formats:
    //   bundle.json → { version, rules, checksum } object; extract rules array.
    //   rules.json  → plain JSON array of rule objects.
    let records: JsonRuleRecord[];
    if (Array.isArray(parsed)) {
      records = parsed as JsonRuleRecord[];
    } else if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'rules' in (parsed as object) &&
      Array.isArray((parsed as { rules: unknown }).rules)
    ) {
      records = (parsed as { rules: JsonRuleRecord[] }).rules;
    } else {
      throw new TypeError("Rules file must be a JSON array or a bundle object with a 'rules' array");
    }

    // Reject any permit rule targeting shell.exec — this class is
    // unconditionally forbidden at priority 100 and cannot be overridden
    // via data/rules.json. Any such entry indicates a misconfiguration.
    const shellExecPermitIdx = records.findIndex(
      (rec) => rec.effect === 'permit' && rec.action_class === 'shell.exec'
    );
    if (shellExecPermitIdx !== -1) {
      throw new TypeError(
        `data/rules.json rule[${shellExecPermitIdx}]: shell.exec cannot be permitted — ` +
        'it is unconditionally forbidden at priority 100. ' +
        'Replace shell.exec usage with fine-grained tools: filesystem.read, filesystem.write, ' +
        'filesystem.list, web.search, web.fetch, or web.post.'
      );
    }

    const cedarRules: Rule[] = records.map((rec, i) => {
      // Intent-group form: { intent_group, effect, priority?, reason?, tags? }
      // Matches all action classes carrying that intent group — evaluated by
      // the handler's intent-group pass, which runs after action-class eval.
      if (rec.intent_group !== undefined) {
        if (rec.resource !== undefined || rec.match !== undefined || rec.action_class !== undefined) {
          console.warn(
            `[plugin:clawthority] data/rules.json rule[${i}] mixes intent_group with resource/match/action_class — ignoring others`
          );
        }
        return {
          effect: rec.effect,
          intent_group: rec.intent_group,
          ...(rec.priority !== undefined ? { priority: rec.priority } : {}),
          ...(rec.reason !== undefined ? { reason: rec.reason } : {}),
          ...(rec.tags !== undefined ? { tags: rec.tags } : {}),
        } satisfies Rule;
      }

      // Action-class form: { action_class, effect, priority?, reason?, tags? }
      // Matches all tools that normalise to that action class.
      if (rec.action_class !== undefined) {
        if (rec.resource !== undefined || rec.match !== undefined) {
          console.warn(
            `[plugin:clawthority] data/rules.json rule[${i}] mixes action_class with resource/match — ignoring resource/match`
          );
        }
        return {
          effect: rec.effect,
          action_class: rec.action_class,
          ...(rec.priority !== undefined ? { priority: rec.priority } : {}),
          ...(rec.reason !== undefined ? { reason: rec.reason } : {}),
          ...(rec.tags !== undefined ? { tags: rec.tags } : {}),
        } satisfies Rule;
      }

      // Resource/match form: { resource, match, effect, reason?, tags? }
      if (rec.resource === undefined || rec.match === undefined) {
        throw new TypeError(
          `data/rules.json rule[${i}] must have either action_class, intent_group, or both resource+match`
        );
      }

      // Convert to RegExp when regex metacharacters are present; otherwise
      // normalise to lowercase (tool names in OpenClaw are always lowercase,
      // so "Exec" in JSON would never match without this).
      let match: string | RegExp = rec.match;
      if (/[\\^$.|?*+()[\]{}]/.test(rec.match)) {
        try {
          match = new RegExp(rec.match);
        } catch {
          console.warn(
            `[plugin:clawthority] data/rules.json rule[${i}] has invalid regex "${rec.match}" — using exact match`
          );
        }
      } else {
        match = rec.match.toLowerCase();
      }

      return {
        effect: rec.effect,
        resource: rec.resource,
        match,
        ...(rec.priority !== undefined ? { priority: rec.priority } : {}),
        ...(rec.reason !== undefined ? { reason: rec.reason } : {}),
        ...(rec.tags !== undefined ? { tags: rec.tags } : {}),
      } satisfies Rule;
    });

    // ── Merge auto-permit rules from auto-permits.json ─────────────────────
    // Only in 'separate' mode; in 'rules' mode the auto-permit store path is
    // data/rules.json itself (already loaded above) and AutoPermit records
    // use a different schema (pattern/method/createdAt/originalCommand) that
    // the rules parser silently ignores — no need to load twice.
    const apConfig = resolveAutoPermitStoreConfig();
    if (apConfig.mode === 'separate') {
      try {
        const apPath = resolve(moduleDir, '../../', apConfig.path);
        const apResult = await loadAutoPermitRulesFromFile(apPath);
        if (apResult.found) {
          if (apResult.skipped > 0) {
            console.warn(
              `[plugin:clawthority] auto-permits.json: ${apResult.skipped} invalid record(s) skipped`,
            );
          }
          for (const err of apResult.validationErrors) {
            console.warn(err);
          }
          let merged = 0;
          for (const permit of apResult.rules) {
            const compiled = compilePatternRegex(permit.pattern);
            if (compiled === null) continue;
            cedarRules.push({
              effect: 'permit',
              resource: 'tool',
              match: '*',
              target_match: compiled,
              priority: 50,
              reason: `auto-permit: ${permit.pattern}`,
              tags: ['auto-permit'],
            } satisfies Rule);
            merged++;
          }
          if (merged > 0) {
            console.log(
              `[plugin:clawthority] merged ${merged} auto-permit rule(s) from ${apConfig.path}`,
            );
          }
        }
      } catch (apErr) {
        console.warn('[plugin:clawthority] failed to load auto-permits.json — skipping:', apErr);
      }
    }

    const engine = new CedarPolicyEngine();
    engine.addRules(cedarRules);
    jsonRulesEngineRef.current = engine;

    const activeFile = basename(rulesPath);
    console.log(`[plugin:clawthority] loaded ${cedarRules.length} rule(s) from data/${activeFile}`);
  } catch (err) {
    console.error("[plugin:clawthority] failed to load rules file — JSON rules will not be enforced:", err);
  }
}

// ─── Auto-permit rules loader ─────────────────────────────────────────────────

/**
 * Loads auto-permit rules from the configured store file and populates
 * `autoPermitCheckerRef.current` with a `FileAutoPermitChecker` instance.
 *
 * Delegates entirely to {@link loadAutoPermitRulesFromFile} from the store
 * module. The store path is resolved via `resolveAutoPermitStoreConfig()`
 * which reads the `CLAWTHORITY_AUTO_PERMIT_STORE` env var (defaults to
 * `data/auto-permits.json`). The file is optional — when absent the function
 * returns silently and `autoPermitCheckerRef.current` remains undefined,
 * meaning auto-permit matching is skipped for all subsequent tool calls.
 *
 * Invalid records (those that fail the `AutoPermit` schema) are skipped with
 * a warning so a single corrupt entry does not discard the entire store.
 */
async function loadAutoPermitRules(): Promise<void> {
  try {
    const config = resolveAutoPermitStoreConfig();
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const storePath = resolve(moduleDir, "../../", config.path);

    const result = await loadAutoPermitRulesFromFile(storePath);

    if (result.skipped > 0) {
      console.warn(
        `[plugin:clawthority] auto-permit store: ${result.skipped} invalid record(s) skipped (schema mismatch)`,
      );
    }
    for (const err of result.validationErrors) {
      console.warn(err);
    }

    if (!result.found) {
      // Store file does not exist yet — silently skip; auto-permit matching
      // will be disabled until the file is created (e.g. on first approval).
      return;
    }

    autoPermitCheckerRef.current = new FileAutoPermitChecker(result.rules);
    console.log(
      `[plugin:clawthority] auto-permit rules loaded: ${result.rules.length} rule(s) from ${config.path}`,
    );
  } catch (err) {
    console.warn("[plugin:clawthority] failed to load auto-permit rules — matching will be skipped:", err);
  }
}

// ─── Auto-permit pattern persistence ─────────────────────────────────────────

/**
 * Derives a permit pattern from `command` and appends it to the auto-permit
 * store file.  On success the in-memory checker is reloaded so the new rule
 * takes effect immediately for subsequent tool calls.
 *
 * Called from the "Approve Always" callbacks (Telegram and Slack) after the
 * session-scoped auto-approval is registered.  Failures are swallowed and
 * logged so that the broader approval flow is never interrupted.
 *
 * Derivation strategy:
 *   - Exec-type tools (`shell.exec`, `code.execute`): the `command` param IS
 *     the shell command (e.g. `"git commit -m 'msg'"`).  The pattern is
 *     derived from the command string: binary + first-positional + `*`.
 *   - Registered non-exec tools (all others): the `command` param is a
 *     resource (file path, URL, etc.) which is not meaningful as a pattern
 *     anchor.  The pattern is derived from `toolName` instead, yielding a
 *     `toolName *` wildcard that covers all invocations of that tool.
 *
 * @param command     The raw target string from the pending approval (resource
 *                    for most tools; the shell command for exec tools).
 * @param toolName    The original tool name (e.g. `'bash'`, `'read_file'`).
 * @param actionClass The normalized action class (e.g. `'shell.exec'`,
 *                    `'filesystem.read'`) — used to select the derivation path.
 * @param channel     Log prefix / audit channel tag (e.g. `'telegram'`).
 * @param operatorId  Identity of the operator who clicked "Approve Always".
 * @param agentId     Agent ID that triggered the original HITL approval request.
 */
async function persistAutoPermitPattern(
  command: string,
  toolName: string,
  actionClass: string,
  channel: string,
  operatorId?: string,
  agentId?: string,
): Promise<void> {
  // Determine derivation strategy based on action class.
  const EXEC_ACTION_CLASSES: ReadonlySet<string> = new Set([
    'shell.exec',
    'code.execute',
  ]);
  const isExec = EXEC_ACTION_CLASSES.has(actionClass);

  let derived: ReturnType<typeof derivePattern>;
  try {
    if (isExec) {
      // Exec path: tokenise the shell command string.
      derived = derivePattern({ command });
    } else {
      // Registered-tool path: generate a tool-name wildcard pattern.
      derived = derivePattern({ command: toolName, toolName });
    }
  } catch (err) {
    // Shell metacharacters, empty command, or other derivation failures are
    // expected for compound commands — log and return quietly.
    const reason = (err as Error).message;
    console.log(`[hitl-${channel}] auto-permit pattern derivation skipped: ${reason}`);
    void logAutoPermitDerivationSkipped({
      reason,
      command: isExec ? command : toolName,
      toolName,
      actionClass,
      channel,
      agentId: agentId ?? 'unknown',
      ...(operatorId !== undefined ? { operatorId } : {}),
    });
    return;
  }

  // Confirmation: show the derived pattern before persisting.
  console.log(`[hitl-${channel}] auto-permit pattern derived: '${derived.pattern}' — saving to store`);

  try {
    const config = resolveAutoPermitStoreConfig();
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const storePath = resolve(moduleDir, "../../", config.path);

    const existing = await loadAutoPermitRulesFromFile(storePath);
    const nextVersion = existing.version + 1;

    const now = Date.now();
    const newRule: AutoPermit = {
      pattern: derived.pattern,
      method: derived.method,
      createdAt: now,
      originalCommand: command,
      created_by: operatorId ?? channel,
      created_at: new Date(now).toISOString(),
      derived_from: command,
    };

    await saveAutoPermitRules(storePath, [...existing.rules, newRule], nextVersion);
    await loadAutoPermitRules();
    console.log(`[hitl-${channel}] auto-permit rule saved: '${derived.pattern}' (store v${nextVersion})`);

    // Emit auto_permit_added audit event.
    if (hitlAuditLogger) {
      const entry: AutoPermitAddedEntry = {
        ts: new Date().toISOString(),
        type: 'auto_permit_added',
        pattern: derived.pattern,
        method: derived.method,
        originalCommand: command,
        channel,
        agentId: agentId ?? 'unknown',
        storeVersion: nextVersion,
        ...(operatorId !== undefined ? { operatorId } : {}),
      };
      await hitlAuditLogger.log(entry);
    }
  } catch (err) {
    console.warn(`[hitl-${channel}] failed to save auto-permit rule: ${(err as Error).message}`);
  }
}

// ─── HITL state ──────────────────────────────────────────────────────────────

/**
 * Emits a one-shot warning when operator config has a permit rule targeting
 * `unknown_sensitive_action` (the catch-all bucket for unregistered tools)
 * without a matching HITL policy.
 *
 * In OPEN mode this is the misconfig that lets agents call raw shell tools
 * (`exec`, `sh`, `eval`, `process`, …) and have them sail through with no
 * forbid (OPEN strips the default unknown_sensitive_action forbid) and no
 * human review (no HITL policy matches the bucket). The permit looks like a
 * deliberate gate to the operator but is actually an unguarded fall-through.
 *
 * Does not change behaviour — only logs at activation time so the misconfig
 * is loud at boot rather than silent in production.
 */
function warnIfPermitOnUnknownToolsWithoutHitl(
  rules: readonly Rule[],
  hitlConfig: HitlPolicyConfig | null,
): void {
  const permits = rules.filter(
    (r) => r.effect === 'permit' && r.action_class === 'unknown_sensitive_action',
  );
  if (permits.length === 0) return;

  const hitlCovers = hitlConfig?.policies.some((p) =>
    p.actions.some((a) => matchesActionPattern(a, 'unknown_sensitive_action')),
  ) ?? false;
  if (hitlCovers) return;

  console.warn(
    `[plugin:clawthority] ⚠ ${permits.length} permit rule(s) target ` +
    `action_class "unknown_sensitive_action" without a matching HITL policy. ` +
    `Unrecognised tool calls (e.g. exec, sh, eval, process) will execute ` +
    `without human review. To gate them, add a HITL policy targeting ` +
    `"unknown_sensitive_action" in your hitl-policy.yaml — note the existing ` +
    `parser warning about approval-loop lockout when doing so.`,
  );
}

/**
 * Logs an info-level recommendation when the plugin is running in OPEN mode
 * without any protection for `unknown_sensitive_action`.
 *
 * In OPEN mode the `unknown_sensitive_action` forbid is intentionally absent
 * from the active rule set — unrecognised tool names fall through to the
 * implicit permit. When no operator-supplied forbid rule and no HITL policy
 * cover `unknown_sensitive_action`, the agent can invoke any unregistered tool
 * with no gate at all. This function surfaces that gap at activation time so
 * operators can make an informed decision about their posture.
 *
 * Only runs in OPEN mode; CLOSED mode carries an implicit deny that already
 * covers unknown tools. Logged at most once per startup — the `activated`
 * guard in `activate()` ensures this path is reached at most once per
 * plugin lifecycle.
 */
function logOpenModeRecommendation(
  mode: ClawMode,
  jsonRules: readonly Rule[] | null,
  hitlConfig: HitlPolicyConfig | null,
): void {
  if (mode !== 'open') return;

  // Operator has an explicit forbid rule covering unknown_sensitive_action.
  const hasForbidRule = jsonRules !== null && jsonRules.some(
    (r) => r.effect === 'forbid' && r.action_class === 'unknown_sensitive_action',
  );
  if (hasForbidRule) return;

  // A HITL policy covers unknown_sensitive_action (exact or wildcard match).
  const hitlCovers = hitlConfig?.policies.some((p) =>
    p.actions.some((a) => matchesActionPattern(a, 'unknown_sensitive_action')),
  ) ?? false;
  if (hitlCovers) return;

  console.log(
    `[plugin:clawthority] ℹ OPEN mode: unrecognised tool calls are implicitly permitted — ` +
    `no forbid rule or HITL policy covers "unknown_sensitive_action". ` +
    `Add a forbid rule in data/rules.json or a HITL policy in hitl-policy.yaml to gate ` +
    `unknown tools. See docs/configuration.md#install-mode for recommended bootstrap configuration.`,
  );
}

/** Mutable ref for the loaded HITL policy config. null until loaded. */
const hitlConfigRef: { current: HitlPolicyConfig | null } = { current: null };
let hitlWatcher: HitlWatcherHandle | null = null;
let telegramListener: TelegramListener | null = null;
let slackInteractionServer: SlackInteractionServer | null = null;
const approvalManager = new ApprovalManager();

/**
 * Chokidar watch handle for the auto-permit store file. Set up in activate()
 * to reload rules when the store is modified externally. Cleaned up in deactivate().
 */
let autoPermitStoreWatcher: AutoPermitWatchHandle | null = null;

/** @deprecated Use per-call EventEmitter inside beforeToolCallHandler instead. */
const pipelineEmitter = new EventEmitter();

/** Maps HITL token → Slack message timestamp for chat.update on decision. */
const slackMessageTimestamps = new Map<string, string>();

/** Maps HITL token → Telegram message_id for editMessageText on decision. */
const telegramMessageIds = new Map<string, number>();

/**
 * How long (ms) an Approve Always confirmation waits for a Save/Cancel
 * response before timing out.  After timeout the confirmation is silently
 * discarded; the original approval continues to age toward its own TTL.
 */
const APPROVE_ALWAYS_CONFIRM_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

interface PendingApproveAlwaysConfirmation {
  token: string;
  pattern: string;
  method: string;
  operatorId: string | undefined;
  agentId: string;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Maps HITL token → pending Approve Always confirmation state.
 * Set when the operator clicks "Approve Always" and a pattern confirmation
 * message is sent.  Cleared on Save, Cancel, or timeout.
 */
const pendingApproveAlwaysConfirmations = new Map<string, PendingApproveAlwaysConfirmation>();

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
 * Dispatches a HITL approval request to the appropriate channel adapter
 * (Telegram, Slack, or console). Calls `explainCommand` on `target` and
 * spreads the resulting explanation, effects, warnings, rawCommand,
 * action_class, target, and expires_at into all channel send calls.
 *
 * Returns a `BeforeToolCallResult` when the action should be blocked, or `undefined` to allow.
 */
async function dispatchHitlChannel(
  policy: import('./hitl/types.js').HitlPolicy,
  toolName: string,
  identity: ResolvedIdentity,
  target: string,
  action_class: string,
  intentHint?: string,
): Promise<BeforeToolCallResult | void> {
  const channel = policy.approval.channel;
  const auditAgent = identity.auditAgentId;
  const auditChannel = identity.auditChannel;

  // Compute shared fields for all channel send calls.
  // When CLAWTHORITY_HITL_MINIMAL=1, the explainer is skipped entirely and the
  // rich-body sections (explanation, effects, warnings, intentHint) are
  // omitted — channels render only the raw command + buttons, matching the
  // v1.2.x message style. The §16 rollback escape hatch.
  const expires_at = new Date(Date.now() + policy.approval.timeout * 1000).toISOString();
  const sharedOpts: Record<string, unknown> = {
    action_class,
    target,
    expires_at,
    rawCommand: target,
  };
  if (!FEATURES.hitlMinimal) {
    const { summary, effects, warnings, inferred_action_class } = explainCommand(target);
    const explanation = summary !== `Runs ${target.trim().split(/\s+/)[0]}` && summary !== 'Runs an unrecognised command'
      ? summary
      : undefined;
    if (explanation !== undefined) sharedOpts.explanation = explanation;
    if (effects.length > 0) sharedOpts.effects = effects;
    if (warnings.length > 0) sharedOpts.warnings = warnings;
    if (intentHint !== undefined) sharedOpts.intentHint = intentHint;
    void inferred_action_class; // available for future use
  }

  if (channel === 'telegram') {
    const telegramConfig = resolveTelegramConfig(hitlConfigRef.current?.telegram);
    if (!telegramConfig) {
      console.log(`[clawthority] │ [hitl] telegram not configured — applying fallback: ${policy.approval.fallback}`);
      await logHitlDecision(policy.approval.fallback === 'deny' ? 'fallback-deny' : 'fallback-auto-approve', '', toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
      if (policy.approval.fallback === 'deny') {
        console.log(`[clawthority] │ DECISION: ✕ BLOCKED (hitl/telegram-not-configured)`);
        console.log(`[clawthority] └──────────────────────────────────────────────────────`);
        return { block: true, blockReason: 'HITL approval required but Telegram not configured' };
      }
      return;
    }

    const { token, promise } = approvalManager.createApprovalRequest({ toolName, agentId: auditAgent, channelId: auditChannel, policy, target });
    const sendResult = await sendApprovalRequest(telegramConfig, { token, toolName, agentId: auditAgent, policyName: policy.name, timeoutSeconds: policy.approval.timeout, verified: identity.verified, showApproveAlways: FEATURES.approveAlwaysEnabled, ...sharedOpts });

    if (!sendResult.ok) {
      approvalManager.cancel(token);
      console.log(`[clawthority] │ [hitl] telegram unreachable — applying fallback: ${policy.approval.fallback}`);
      await logHitlDecision('telegram-unreachable', token, toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
      if (policy.approval.fallback === 'deny') {
        console.log(`[clawthority] │ DECISION: ✕ BLOCKED (hitl/telegram-unreachable)`);
        console.log(`[clawthority] └──────────────────────────────────────────────────────`);
        return { block: true, blockReason: 'HITL: Telegram unreachable — fail closed' };
      }
      return;
    }

    // Store message_id for editMessageText on decision (mirrors Slack's messageTs).
    if (sendResult.messageId !== undefined) telegramMessageIds.set(token, sendResult.messageId);

    return await resolveHitlDecision(token, promise, policy, toolName, identity, (t, decision) => {
      const messageId = telegramMessageIds.get(t);
      telegramMessageIds.delete(t);
      if (messageId !== undefined) {
        void editMessageDecision(telegramConfig, { messageId, token: t, decision, toolName });
      } else {
        void sendConfirmation(telegramConfig, { token: t, decision, toolName });
      }
    });
  }

  if (channel === 'slack') {
    const slackConfig = resolveSlackConfig(hitlConfigRef.current?.slack);
    if (!slackConfig) {
      console.log(`[clawthority] │ [hitl] slack not configured — applying fallback: ${policy.approval.fallback}`);
      await logHitlDecision(policy.approval.fallback === 'deny' ? 'fallback-deny' : 'fallback-auto-approve', '', toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
      if (policy.approval.fallback === 'deny') {
        console.log(`[clawthority] │ DECISION: ✕ BLOCKED (hitl/slack-not-configured)`);
        console.log(`[clawthority] └──────────────────────────────────────────────────────`);
        return { block: true, blockReason: 'HITL approval required but Slack not configured' };
      }
      return;
    }

    const { token, promise } = approvalManager.createApprovalRequest({ toolName, agentId: auditAgent, channelId: auditChannel, policy, target });
    const result = await sendSlackApprovalRequest(slackConfig, { token, toolName, agentId: auditAgent, policyName: policy.name, timeoutSeconds: policy.approval.timeout, verified: identity.verified, showApproveAlways: FEATURES.approveAlwaysEnabled, ...sharedOpts });

    if (!result.ok) {
      approvalManager.cancel(token);
      console.log(`[clawthority] │ [hitl] slack unreachable — applying fallback: ${policy.approval.fallback}`);
      await logHitlDecision('slack-unreachable', token, toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
      if (policy.approval.fallback === 'deny') {
        console.log(`[clawthority] │ DECISION: ✕ BLOCKED (hitl/slack-unreachable)`);
        console.log(`[clawthority] └──────────────────────────────────────────────────────`);
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

  if (channel === 'console') {
    const { token, promise } = approvalManager.createApprovalRequest({ toolName, agentId: auditAgent, channelId: auditChannel, policy, target });
    const result = await sendConsoleApprovalRequest({ token, toolName, agentId: auditAgent, policyName: policy.name, timeoutSeconds: policy.approval.timeout, verified: identity.verified, showApproveAlways: FEATURES.approveAlwaysEnabled, ...sharedOpts });

    if (result.decision === 'approved_always') {
      approvalManager.addSessionAutoApproval(auditChannel, action_class);
      console.log(`[hitl-console] session auto-approval registered: channel=${auditChannel} action_class=${action_class}`);
      if (target.length > 0 || !['shell.exec', 'code.execute'].includes(action_class)) {
        void persistAutoPermitPattern(target, toolName, action_class, 'console', undefined, auditAgent);
      }
    }

    const decision: 'approved' | 'denied' = result.decision === 'denied' ? 'denied' : 'approved';
    approvalManager.resolveApproval(token, decision);

    return await resolveHitlDecision(token, promise, policy, toolName, identity, () => { /* result already shown inline */ });
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
  console.log(`[clawthority] │ [hitl] awaiting operator response for token=${token} (timeout=${policy.approval.timeout}s)`);
  const decision = await promise;
  const auditAgent = identity.auditAgentId;
  const auditChannel = identity.auditChannel;

  if (decision === 'approved') {
    console.log(`[clawthority] │ [hitl] ✓ APPROVED (token=${token})`);
    await logHitlDecision('approved', token, toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
    sendConfirmationFn(token, 'approved');
    return;
  }

  if (decision === 'denied') {
    console.log(`[clawthority] │ [hitl] ✕ DENIED (token=${token})`);
    await logHitlDecision('denied', token, toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
    sendConfirmationFn(token, 'denied');
    console.log(`[clawthority] │ DECISION: ✕ BLOCKED (hitl/denied)`);
    console.log(`[clawthority] └──────────────────────────────────────────────────────`);
    return { block: true, blockReason: 'HITL: Operator denied the tool call' };
  }

  // expired
  console.log(`[clawthority] │ [hitl] ⏱ EXPIRED (token=${token}) — fallback: ${policy.approval.fallback}`);
  const auditDecision = policy.approval.fallback === 'deny' ? 'fallback-deny' as const : 'fallback-auto-approve' as const;
  await logHitlDecision(auditDecision, token, toolName, auditAgent, auditChannel, policy.name, policy.approval.timeout, identity.verified);
  if (policy.approval.fallback === 'deny') {
    sendConfirmationFn(token, 'expired (denied)');
    console.log(`[clawthority] │ DECISION: ✕ BLOCKED (hitl/expired-deny)`);
    console.log(`[clawthority] └──────────────────────────────────────────────────────`);
    return { block: true, blockReason: 'HITL: Approval timed out — denied by policy fallback' };
  }
  sendConfirmationFn(token, 'expired (auto-approved)');
  return;
}

/**
 * Formats a `Rule` for a human-readable identifier used in logs and audit
 * entries. Prefers the semantic `action_class`, falls back to
 * `resource:match`, and returns `'<default>'` when neither is set (implicit
 * mode-default decisions carry no matched rule).
 */
function formatRuleTag(rule: { action_class?: string; resource?: string; match?: string | RegExp } | undefined): string {
  if (rule === undefined) return '<default>';
  if (rule.action_class !== undefined) return `action:${rule.action_class}`;
  const res = rule.resource ?? '?';
  const m = rule.match instanceof RegExp ? rule.match.source : (rule.match ?? '*');
  return `${res}:${m}`;
}

/**
 * Append a structured policy decision to the JSONL audit log.
 *
 * Records every *block* path produced by `beforeToolCallHandler`: Stage 1
 * trust-gate rejections, Cedar unconditional forbids, JSON-rule forbids,
 * and HITL-gated forbids upheld because no HITL policy matched (or HITL
 * was not configured). HITL approval/denial outcomes are written
 * separately by {@link logHitlDecision} so each stage owns its own audit
 * shape — the two entry types carry distinct `type` markers to make
 * post-mortem filtering straightforward.
 *
 * Permits are intentionally not logged: on most hosts the vast majority
 * of tool calls are permits and writing every one would make the audit
 * log unusable. Operators who want a permit trail can wire their own
 * logging via a custom rule condition or by tailing stdout.
 */
async function logPolicyDecision(entry: Omit<PolicyDecisionEntry, 'ts' | 'type'>): Promise<void> {
  if (!hitlAuditLogger) return;
  await hitlAuditLogger.log({
    ts: new Date().toISOString(),
    type: 'policy',
    ...entry,
  });
}

/** Log a normalizer-unclassified event to the JSONL audit file. */
async function logNormalizerUnclassified(
  entry: Omit<NormalizerUnclassifiedEntry, 'ts' | 'type' | 'stage'>,
): Promise<void> {
  if (!hitlAuditLogger) return;
  await hitlAuditLogger.log({
    ts: new Date().toISOString(),
    type: 'normalizer-unclassified',
    stage: 'normalizer-unclassified',
    ...entry,
  } satisfies NormalizerUnclassifiedEntry);
}

/** Log an auto-permit match event to the JSONL audit file. */
async function logAutoPermitMatched(
  entry: Omit<AutoPermitMatchedEntry, 'ts' | 'type'>,
): Promise<void> {
  if (!hitlAuditLogger) return;
  await hitlAuditLogger.log({
    ts: new Date().toISOString(),
    type: 'auto_permit_matched',
    ...entry,
  } satisfies AutoPermitMatchedEntry);
}

/** Log a skipped auto-permit derivation to the JSONL audit file. */
async function logAutoPermitDerivationSkipped(
  entry: Omit<AutoPermitDerivationSkippedEntry, 'ts' | 'type'>,
): Promise<void> {
  if (!hitlAuditLogger) return;
  await hitlAuditLogger.log({
    ts: new Date().toISOString(),
    type: 'auto_permit_derivation_skipped',
    ...entry,
  } satisfies AutoPermitDerivationSkippedEntry);
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
 * Priority at or above which a Cedar `forbid` rule is treated as an
 * unconditional block. Rules below this threshold that carry an explicit
 * priority are treated as "HITL-gated forbids" — they block unless an HITL
 * policy matches the action class AND the operator approves the request.
 *
 * Rules without an explicit priority default to unconditional (so
 * user-written rules fail closed unless they opt into the HITL tier).
 */
const UNCONDITIONAL_FORBID_PRIORITY = 100;

function isHitlGatedForbid(rule: Rule | undefined): boolean {
  if (rule === undefined) return false;
  if (rule.priority === undefined) return false;
  return rule.priority < UNCONDITIONAL_FORBID_PRIORITY;
}

const beforeToolCallHandler: BeforeToolCallHandler = async ({ toolName, params, source }, ctx) => {
  console.log(`[clawthority] ┌─ before_tool_call ──────────────────────────────────`);
  console.log(`[clawthority] │ tool=${toolName}  agent=${ctx.agentId ?? "unknown"}  channel=${ctx.channelId ?? "unknown"}`);

  // ── Budget tracking + enforcement ──────────────────────────────────────────
  if (budgetTracker !== null) {
    // Estimate input tokens from serialised params (rough: 1 token ≈ 4 UTF-16
    // code units). Output tokens are not available pre-call; recorded as 0.
    const paramJson = params !== undefined ? JSON.stringify(params) : '';
    const estimatedInputTokens = Math.max(1, Math.round(paramJson.length / 4));
    budgetTracker.append(estimatedInputTokens, 0);

    // Hard limit enforcement — block tool calls when daily budget is exceeded.
    const budgetCheck = budgetTracker.check();
    if (budgetCheck.exceeded) {
      const tokenInfo = `${budgetCheck.dailyTokens}/${budgetCheck.dailyTokenLimit} tokens`;
      const costInfo = budgetCheck.dailyCostLimit !== undefined
        ? `, $${budgetCheck.dailyCost.toFixed(4)}/$${budgetCheck.dailyCostLimit.toFixed(4)}`
        : '';
      console.log(`[clawthority] │ DECISION: ✕ BLOCKED (budget/daily_limit_exceeded) — ${tokenInfo}${costInfo}`);
      console.log(`[clawthority] └──────────────────────────────────────────────────────`);
      return { block: true, blockReason: 'daily_budget_exceeded' };
    }

    // Warn when approaching the limit.
    if (budgetCheck.dailyTokens >= budgetTracker.warnAt) {
      console.warn(`[clawthority] ⚠ budget warning — ${budgetCheck.dailyTokens}/${budgetCheck.dailyTokenLimit} tokens used today`);
    }
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
    console.log(`[clawthority] │ [identity] ⚠ UNVERIFIED — claim agent=${identity.agentId} channel=${identity.channel}`);
  }
  const ruleContext: RuleContext = defaultAgentIdentityRegistry.buildRuleContext(
    identity.agentId,
    identity.channel,
  );

  // ── Extract intent_hint from caller metadata ──────────────────────────────
  // Agents may supply ctx.metadata.intent_hint to explain why they are
  // invoking the tool. Sanitised to printable ASCII/whitespace and capped at
  // 500 chars before being forwarded to HITL approval messages.
  const rawIntentHint = typeof ctx.metadata?.['intent_hint'] === 'string'
    ? ctx.metadata['intent_hint']
    : undefined;
  const intentHint: string | undefined = rawIntentHint !== undefined
    ? (rawIntentHint.replace(/[^\x20-\x7E\t\n]/g, '').trim().slice(0, 500) || undefined)
    : undefined;

  const normalizedParams = (params !== null && typeof params === 'object' && !Array.isArray(params))
    ? (params as Record<string, unknown>)
    : {};

  // ── 0a. Tool registry gate — pre-normalization check ─────────────────────
  // Check whether the tool is present in the @openclaw/action-registry alias
  // index before normalization. Tools not found in the index, and registered
  // entries that lack a valid action_class, are classified as
  // unknown_sensitive_action by normalize_action (fail-closed). A warning is
  // emitted in both cases so operators can identify unrecognised tools early.
  const preRegistryEntry = getRegistryEntry(toolName);
  const toolIsRegistered =
    !!preRegistryEntry.action_class &&
    preRegistryEntry.action_class !== 'unknown_sensitive_action';
  if (!toolIsRegistered) {
    console.warn(
      `[clawthority] │ [registry] ⚠ tool="${toolName}" is not registered in the action registry — will be classified as unknown_sensitive_action`,
    );
    await logNormalizerUnclassified({
      toolName,
      agentId: identity.auditAgentId,
      channel: identity.auditChannel,
      verified: identity.verified,
    });
  }

  const normalizedAction = normalize_action(toolName, normalizedParams);
  console.log(`[clawthority] │ [trust] source=${source ?? "undefined"}  actionClass=${normalizedAction.action_class}  risk=${normalizedAction.risk}`);

  // Rules 4–8 (command-regex reclassification) were retired in commit 403cb72.
  // The `NormalizedAction.reclassification` field no longer exists; the
  // telemetry hook is dead code and has been removed.

  const payloadHash = createHash('sha256').update(sortedJsonStringify(normalizedParams)).digest('hex');

  // Common audit-entry scaffolding — every block path fills these fields in
  // addition to its stage-specific details.
  const auditBase = {
    toolName,
    actionClass: normalizedAction.action_class,
    agentId: identity.auditAgentId,
    channel: identity.auditChannel,
    verified: identity.verified,
    mode: MODE,
  } as const;

  // ── Build PipelineContext ─────────────────────────────────────────────────
  // hitl_mode is set to 'none' so runPipeline's built-in HITL pre-check is
  // bypassed; the existing HITL resolution stage below handles approval dispatch.
  const pipelineCtx: PipelineContext = {
    action_class: normalizedAction.action_class,
    target: normalizedAction.target,
    payload_hash: payloadHash,
    hitl_mode: 'none',
    rule_context: ruleContext,
    risk: normalizedAction.risk,
    ...(source !== undefined && { source }),
    ...(normalizedAction.intent_group !== undefined && { intent_group: normalizedAction.intent_group }),
  };

  // Stage 1: capability gate — validates source trust level and risk via
  // validateCapability (check 0: untrusted+high/critical → forbid; check 1:
  // hitl_mode none → permit bypass so capability token checks are skipped).
  const stage1: Stage1Fn = (pCtx) => validateCapability(pCtx, approvalManager, () => undefined);

  // Stage 2: policy evaluation — delegates to createCombinedStage2 which
  // consolidates the Cedar TS engine, the JSON rules engine, and intent-group
  // evaluation into a single Stage2Fn. HITL-gated forbids (priority < 100)
  // are returned as forbid decisions with their priority preserved so the
  // post-pipeline handler can route them through HITL resolution.
  // Auto-permits are wired in when approveAlwaysEnabled is true so that
  // session-scoped auto-approvals bypass HITL gating in the policy engine
  // itself. Passing undefined when the flag is off disables the check without
  // clearing any in-process state (evaluation is disabled; creation was already
  // prevented at the Slack UI layer by hiding the Approve Always button).
  const stage2 = createCombinedStage2(
    cedarEngineRef.current,
    jsonRulesEngineRef.current,
    toolName,
    FEATURES.approveAlwaysEnabled ? approvalManager : undefined,
    autoPermitCheckerRef.current,
  );

  // ── Route all tool calls through runPipeline ─────────────────────────────
  // A per-call EventEmitter is used instead of a module-level emitter to
  // prevent cross-call listener interference under concurrent invocations.
  // HITL-gated forbids (priority < 100) are NOT logged here; they are logged
  // by the HITL resolution stage below once the final disposition is known.
  const callEmitter = new EventEmitter();
  callEmitter.once('executionEvent', ({ decision }: { decision: CeeDecision }) => {
    // File-based auto-permit rule match: log the matched pattern and record
    // usage in the coverage map so the dashboard can track which rules fire.
    if (decision.effect === 'permit' && decision.stage === 'auto-permit') {
      const patternLabel = decision.rule ?? 'unknown';
      console.log(
        `[clawthority] │ [stage2/auto-permit] ✓ matched rule '${patternLabel}' (${normalizedAction.action_class})`,
      );
      coverageMap.record('command', patternLabel, 'permit');
      // Resolve the full rule object from the in-memory checker so we can
      // include the derivation method in the audit entry.
      const matchedRule = autoPermitCheckerRef.current?.matchCommand(
        normalizedAction.target ?? toolName,
      ) ?? null;
      void logAutoPermitMatched({
        pattern: patternLabel,
        method: matchedRule?.method ?? 'unknown',
        command: normalizedAction.target ?? toolName,
        ...auditBase,
      });
      return;
    }
    // Session auto-approval: log with source tag so the auto-generated permit
    // reason ('session_auto_approved') is visible in the operator log stream.
    if (decision.effect === 'permit' && decision.reason === 'session_auto_approved') {
      console.log(
        `[clawthority] │ [stage2/auto-permit] ✓ session_auto_approved (${normalizedAction.action_class})`,
      );
      return;
    }
    // Permits are intentionally not logged (see logPolicyDecision comment above).
    // pipeline_error fails closed without an audit entry — the error is already
    // visible on stderr and a logged forbid with no rule context would be noise.
    if (decision.effect !== 'forbid' || decision.reason === 'pipeline_error') return;
    // HITL-gated forbids (priority < 100) are logged by HITL resolution below.
    if (decision.priority !== undefined && decision.priority < UNCONDITIONAL_FORBID_PRIORITY) return;
    const entry: Omit<PolicyDecisionEntry, 'ts' | 'type'> = {
      effect: 'forbid',
      resource: 'tool',
      match: toolName,
      reason: decision.reason,
      ...auditBase,
    };
    const policyStage = decision.stage as PolicyDecisionEntry['stage'];
    if (policyStage !== undefined) entry.stage = policyStage;
    if (decision.rule !== undefined) entry.rule = decision.rule;
    if (decision.priority !== undefined) entry.priority = decision.priority;
    void logPolicyDecision(entry);
  });
  const { decision: pipelineDecision } = await runPipeline(pipelineCtx, stage1, stage2, callEmitter);

  // Record tool coverage after pipeline completes.
  coverageMap.record('tool', toolName, pipelineDecision.effect === 'permit' ? 'permit' : 'forbid');

  // When the forbid was issued against the catch-all unknown_sensitive_action
  // bucket, prepend the original tool name to the reason so operators can
  // tell which call triggered the forbid. Without this, the user-facing
  // blockReason and audit reason field name only the bucket
  // ("Unknown sensitive actions are unconditionally forbidden"), forcing
  // operators to cross-reference the audit's actionClass+toolName fields to
  // figure out what was actually blocked.
  if (
    pipelineDecision.effect === 'forbid' &&
    normalizedAction.action_class === 'unknown_sensitive_action' &&
    pipelineDecision.reason !== undefined &&
    !pipelineDecision.reason.startsWith(`tool '${toolName}'`)
  ) {
    pipelineDecision.reason = `tool '${toolName}' is not registered: ${pipelineDecision.reason}`;
  }

  if (pipelineDecision.effect === 'forbid') {
    if (pipelineDecision.reason === 'untrusted_source_high_risk') {
      const blockReason = 'untrusted_source_high_risk';
      console.log(`[clawthority] │ DECISION: ✕ BLOCKED (stage1/untrusted_source_high_risk) — actionClass=${normalizedAction.action_class} risk=${normalizedAction.risk}`);
      console.log(`[clawthority] └──────────────────────────────────────────────────────`);
      // Audit entry written by the callEmitter listener above.
      return { block: true, blockReason };
    }

    // ── HITL-gated forbid (priority < 100) ───────────────────────────────
    // The pipeline returned a forbid with a sub-100 priority. Try to release
    // it via a matching HITL policy; otherwise uphold the forbid.
    const isHitlGated =
      pipelineDecision.priority !== undefined &&
      pipelineDecision.priority < UNCONDITIONAL_FORBID_PRIORITY;

    if (isHitlGated) {
      try {
        const hitlConfig = hitlConfigRef.current;
        const hitlResult = hitlConfig !== null
          ? checkAction(hitlConfig, normalizedAction.action_class)
          : { requiresApproval: false };

        if (hitlResult.requiresApproval && hitlResult.matchedPolicy) {
          const policy = hitlResult.matchedPolicy;
          if (approvalManager.isSessionAutoApproved(identity.auditChannel, normalizedAction.action_class)) {
            console.log(`[clawthority] │ [hitl] ✓ session auto-approved (${normalizedAction.action_class}) — skipping HITL dispatch`);
          } else {
            console.log(`[clawthority] │ [hitl] releasing ${pipelineDecision.stage ?? 'unknown'} HITL-gated forbid via policy "${policy.name}" (${policy.approval.channel})`);
            const hitlChannelResult = await dispatchHitlChannel(policy, toolName, identity, normalizedAction.target, normalizedAction.action_class, intentHint);
            if (hitlChannelResult) return hitlChannelResult;
          }
          // Approved (or auto-approved): fall through to the pre-existing HITL check and then ALLOWED.
        } else {
          const priority = pipelineDecision.priority;
          const ruleTag = pipelineDecision.rule;
          const source = pipelineDecision.stage ?? 'unknown';
          console.log(`[clawthority] │ DECISION: ✕ BLOCKED (${source}/forbid priority=${priority ?? '?'}; no HITL policy matches) — ${pipelineDecision.reason}`);
          console.log(`[clawthority] └──────────────────────────────────────────────────────`);
          await logPolicyDecision({
            effect: 'forbid',
            stage: 'hitl-gated',
            resource: 'tool',
            match: toolName,
            reason: pipelineDecision.reason,
            ...(ruleTag !== undefined && { rule: ruleTag }),
            ...(priority !== undefined && { priority }),
            ...auditBase,
          });
          return { block: true, blockReason: pipelineDecision.reason };
        }
      } catch (err) {
        console.error(`[clawthority] │ [hitl] ✕ ERROR — fail closed`, err);
        console.log(`[clawthority] └──────────────────────────────────────────────────────`);
        await logPolicyDecision({
          effect: 'forbid',
          stage: 'hitl-gated',
          resource: 'tool',
          match: toolName,
          reason: 'HITL evaluation error — fail closed',
          rule: '<error>',
          ...auditBase,
        });
        return { block: true, blockReason: 'HITL evaluation error — fail closed' };
      }
    } else {
      // Unconditional forbid (stage1 trust gate, pipeline_error, priority ≥ 100,
      // or no priority). callEmitter already wrote the JSONL audit entry.
      return { block: true, blockReason: pipelineDecision.reason };
    }
  }

  // ── 3. HITL resolution — pre-existing HITL policy check ──────────────────
  // Runs when the pipeline permitted the action but a HITL policy requires
  // explicit operator approval before execution (the "approve to proceed" flow).
  // Also runs when a HITL-gated forbid was released above (fell through).
  try {
    const hitlConfig = hitlConfigRef.current;
    const hitlResult = hitlConfig !== null
      ? checkAction(hitlConfig, normalizedAction.action_class)
      : { requiresApproval: false };

    if (hitlResult.requiresApproval && hitlResult.matchedPolicy) {
      const policy = hitlResult.matchedPolicy;
      if (approvalManager.isSessionAutoApproved(identity.auditChannel, normalizedAction.action_class)) {
        console.log(`[clawthority] │ [hitl] ✓ session auto-approved (${normalizedAction.action_class}) — skipping HITL dispatch`);
      } else {
        console.log(`[clawthority] │ [hitl] matched policy "${policy.name}" — requesting approval via ${policy.approval.channel}`);
        const hitlChannelResult = await dispatchHitlChannel(policy, toolName, identity, normalizedAction.target, normalizedAction.action_class, intentHint);
        if (hitlChannelResult) return hitlChannelResult;
      }
    } else if (hitlConfig !== null) {
      console.log(`[clawthority] │ [hitl] ✓ no matching HITL policy`);
    }
  } catch (err) {
    console.error(`[clawthority] │ [hitl] ✕ ERROR — fail closed`, err);
    console.log(`[clawthority] └──────────────────────────────────────────────────────`);
    await logPolicyDecision({
      effect: 'forbid',
      stage: 'hitl-gated',
      resource: 'tool',
      match: toolName,
      reason: 'HITL evaluation error — fail closed',
      rule: '<error>',
      ...auditBase,
    });
    return { block: true, blockReason: 'HITL evaluation error — fail closed' };
  }

  console.log(`[clawthority] │ DECISION: ✓ ALLOWED (all engines passed)`);
  console.log(`[clawthority] └──────────────────────────────────────────────────────`);
  return;
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
  console.log(`[clawthority] ▶ before_prompt_build ENTER agentId=${ctx.agentId ?? "unknown"} channelId=${ctx.channelId ?? "unknown"} source=${source ?? "unknown"} messageCount=${messages?.length ?? 0} promptLen=${prompt?.length ?? 0}`);
  try {
    // Only check non-user sources for prompt injection
    if (source !== 'user' && detectPromptInjection(messages)) {
      const blockReason = `Prompt injection detected from source '${source ?? "unknown"}'`;
      console.log(`[clawthority] ⚠ before_prompt_build INJECTION BLOCKED source=${source ?? "unknown"} agentId=${ctx.agentId ?? "unknown"}`);
      console.log(`[clawthority] ◀ before_prompt_build EXIT  → block (injection)`);
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
      console.log(`[clawthority] ⚠ before_prompt_build POLICY VIOLATION: ${reason}`);
      console.log(`[clawthority] ◀ before_prompt_build EXIT  → prependContext (policy warning)`);
      return {
        prependContext: `[POLICY WARNING] ${reason}.`,
      };
    }

    console.log(`[clawthority] ✓ before_prompt_build OK — no injection detected`);
    console.log(`[clawthority] ◀ before_prompt_build EXIT  → no modification`);
    return;
  } catch (err) {
    console.error(`[clawthority] ✕ before_prompt_build ERROR`, err);
    console.log(`[clawthority] ◀ before_prompt_build EXIT  → no modification (error)`);
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
  console.log(`[clawthority] ▶ before_model_resolve ENTER agentId=${ctx.agentId ?? "unknown"} channelId=${ctx.channelId ?? "unknown"} promptLen=${prompt?.length ?? 0}`);

  // NOTE: The before_model_resolve event only provides `prompt` (the full prompt
  // text), NOT the model name. Evaluating the prompt text against model rules
  // (which match patterns like /^claude-/) would produce misleading results,
  // potentially triggering a modelOverride on every call and API rate limits.
  //
  // This hook will be useful once openclaw passes the model name in the event.
  // For now, pass through without interference.

  console.log(`[clawthority] ✓ before_model_resolve OK — passthrough (no model name in event)`);
  console.log(`[clawthority] ◀ before_model_resolve EXIT  → no override`);
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
 * can confirm at a glance which build of clawthority is running.
 *
 * Build-time constants (version, commit, builtAt) are injected by
 * scripts/gen-build-info.mjs during `npm run build`. This avoids any
 * runtime use of execSync / child_process, which triggers security scanners.
 */
function getVersionInfo(): VersionInfo {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = resolve(moduleDir, "..");
  return {
    version: BUILD_VERSION,
    commit: BUILD_COMMIT,
    commitDirty: BUILD_DIRTY,
    builtAt: BUILD_AT,
    pluginRoot,
  };
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
  // Defer during npm install lifecycle phases — delegate to the single bypass
  // point in pipeline.ts rather than duplicating the detection logic here.
  if (isInstallPhase()) return false;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = resolve(moduleDir, "..");
  return existsSync(resolve(pluginRoot, "data", ".installed"));
}

const plugin: OpenclawPlugin & { register?: (api: OpenclawPluginContext) => void } = {
  name: "clawthority",
  // Single source of truth: package.json (read by getVersionInfo at activation).
  version: getVersionInfo().version,

  /**
   * register() — synchronous entry point required by OpenClaw's plugin loader.
   *
   * OpenClaw calls register() (not activate()) and requires it to be sync.
   * We register hooks immediately here, then kick off async init (file loading,
   * watchers, HITL, budget tracker) as a fire-and-forget Promise that logs
   * errors but never throws. This guarantees before_tool_call fires even on
   * the first tool call during startup, before async init completes — the
   * Cedar engine is already populated at module load time with ACTIVE_RULES.
   */
  register(api: OpenclawPluginContext) {
    // 1. Register hooks synchronously — the Cedar engine is already populated.
    api.on("before_tool_call", beforeToolCallHandler, { name: "clawthority:before_tool_call" });
    api.on("before_prompt_build", beforePromptBuildHandler, { name: "clawthority:before_prompt_build" });
    api.on("before_model_resolve", beforeModelResolveHandler, { name: "clawthority:before_model_resolve" });

    // 2. Async init — deferred, non-blocking. Call activate directly (not via
    // `this`) to avoid losing context when OpenClaw invokes register().
    void Promise.resolve(plugin.activate(api)).catch((err: unknown) => {
      console.error("[plugin:clawthority] async activate() failed:", err);
    });
  },

  async activate(ctx: OpenclawPluginContext) {
    // ── Install lifecycle gate ────────────────────────────────────────────────
    // Policy enforcement is deferred until install completes (indicated by
    // data/.installed). This prevents bootstrap commands from being blocked
    // before plugin setup finishes. Set OPENAUTH_FORCE_ACTIVE=1 to bypass
    // this gate in development or CI environments.
    if (!isInstalled()) {
      console.log("[plugin:clawthority] install incomplete — policy activation deferred (data/.installed not found; set OPENAUTH_FORCE_ACTIVE=1 to override)");
      return;
    }

    // ── Typed hooks: register into EVERY registry ───────────────────────────
    // OpenClaw loads plugins from multiple subsystems, each with its own
    // registry. ctx.on() targets the calling registry's typedHooks array.
    // The global hook runner is overwritten on each loadOpenClawPlugins call,
    // so we must register into every registry to ensure the hook is present
    // in whichever registry ends up as the active one.
    ctx.on("before_tool_call", beforeToolCallHandler, { name: "clawthority:before_tool_call" });
    ctx.on("before_prompt_build", beforePromptBuildHandler, { name: "clawthority:before_prompt_build" });
    ctx.on("before_model_resolve", beforeModelResolveHandler, { name: "clawthority:before_model_resolve" });

    // ── Guard: side effects (watchers, engines) only once ────────────────────
    if (activated) {
      console.log("[plugin:clawthority] hooks re-registered into new registry — skipping side effects");
      return;
    }
    activated = true;

    // ── Budget tracker — initialise singleton for data/budget.jsonl ──────────
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const pluginRoot = resolve(moduleDir, "..");
    budgetTracker = createBudgetTracker(pluginRoot);
    console.log(`[plugin:clawthority] budget tracker active — session=${budgetTracker.sessionId}  dailyLimit=${budgetTracker.dailyTokenLimit}  warnAt=${budgetTracker.warnAt}`);

    // ── Version banner: confirm at a glance which build is running ──────────
    const v = getVersionInfo();
    const dirtyTag = v.commitDirty ? " (dirty)" : "";
    console.log("┌──────────────────────────────────────────────────────────────┐");
    console.log("│  [plugin:clawthority] VERSION                              │");
    console.log("├──────────────────────────────────────────────────────────────┤");
    console.log(`│  version:    ${v.version}${dirtyTag}`.padEnd(63) + "│");
    console.log(`│  commit:     ${v.commit}${dirtyTag}`.padEnd(63) + "│");
    console.log(`│  built at:   ${v.builtAt}`.padEnd(63) + "│");
    console.log(`│  root:       ${v.pluginRoot}`.padEnd(63) + "│");
    console.log("└──────────────────────────────────────────────────────────────┘");

    rulesWatcher = startRulesWatcher(cedarEngineRef, 300, undefined, { defaultEffect: DEFAULT_EFFECT }, ACTIVE_RULES, coverageMap);

    // Load user-defined JSON rules from data/rules.json into the dedicated
    // JSON Cedar engine. Awaited so the engine is populated before the host
    // dispatches its first tool call — an unawaited load races with the
    // initial `before_tool_call` and silently skips custom rules. Errors
    // are still swallowed (the file is optional).
    try {
      await loadJsonRules();
    } catch (err) {
      console.error("[plugin:clawthority] unexpected error in loadJsonRules:", err);
    }

    // Load file-based auto-permit rules from the auto-permit store.
    // Awaited for the same reason as loadJsonRules() above — an unawaited load
    // would race with the first tool call and silently skip the rules.
    // The file is optional; absence is handled gracefully inside the function.
    try {
      await loadAutoPermitRules();
    } catch (err) {
      console.error("[plugin:clawthority] unexpected error in loadAutoPermitRules:", err);
    }

    // Watch the auto-permit store for external modifications (e.g. direct
    // file edits by an operator) so the in-memory checker stays in sync.
    try {
      const apConfig = resolveAutoPermitStoreConfig();
      const apModuleDir = dirname(fileURLToPath(import.meta.url));
      const apStorePath = resolve(apModuleDir, "../../", apConfig.path);
      autoPermitStoreWatcher = watchAutoPermitStore(apStorePath, () => {
        void loadAutoPermitRules();
        void loadJsonRules();
      });
    } catch (err) {
      console.warn("[plugin:clawthority] failed to start auto-permit store watcher:", err);
    }

    // Instantiate the file-based authority adapter using the same rules file
    // path as loadJsonRules() so both subsystems read from the same source.
    // bundle.json takes precedence over rules.json when present.
    {
      const moduleDir = dirname(fileURLToPath(import.meta.url));
      const bundleFilePath = resolve(moduleDir, "../../data/bundle.json");
      const rulesFilePath = resolve(moduleDir, "../../data/rules.json");
      const bundlePath = process.env['CLAWTHORITY_RULES_FILE']
        ?? (existsSync(bundleFilePath) ? bundleFilePath : rulesFilePath);
      adapterRef = new FileAuthorityAdapter({ bundlePath });
      adapterBundleWatchHandle = await adapterRef.watchPolicyBundle((bundle) => {
        console.log(`[plugin:clawthority] policy bundle hot-reload: version ${bundle.version}`);
        void loadJsonRules();
      });
    }

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
    console.log("│  [plugin:clawthority] ACTIVATION SUMMARY                  │");
    console.log("├──────────────────────────────────────────────────────────────┤");
    console.log("│  HOOKS REGISTERED (via ctx.on):                              │");
    for (const h of registeredHooks) {
      console.log(`│    ✓ ${h.padEnd(54)}│`);
    }
    for (const h of disabledHooks) {
      console.log(`│    ✗ ${h} (disabled)`.padEnd(63) + "│");
    }
    console.log("├──────────────────────────────────────────────────────────────┤");
    const modeLabel = MODE === 'open'
      ? 'OPEN   (implicit permit; critical forbids enforced)'
      : 'CLOSED (implicit deny; explicit permits required)';
    console.log(`│  MODE: ${modeLabel.padEnd(54)}│`);
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

    // ── Audit logger — wire up before any stage so policy decisions land ────
    // The logger backs both HITL events (logHitlDecision) and structured
    // policy decisions (logPolicyDecision). Initialising it unconditionally,
    // before HITL loading, ensures block entries are captured even when
    // there is no hitl-policy.yaml in play.
    const auditModuleDir = dirname(fileURLToPath(import.meta.url));
    const auditPluginRoot = resolve(auditModuleDir, "..");
    const auditLogPath = resolve(auditPluginRoot, "data", "audit.jsonl");
    hitlAuditLogger = new JsonlAuditLogger({ logFile: auditLogPath });

    // ── HITL policy loading + Telegram listener ─────────────────────────────
    try {
      const moduleDir = dirname(fileURLToPath(import.meta.url));
      const pluginRoot = resolve(moduleDir, "..");
      const hitlPolicyPath = resolve(pluginRoot, "hitl-policy.yaml");

      const hitlConfig = await parseHitlPolicyFile(hitlPolicyPath);
      hitlConfigRef.current = hitlConfig;

      // Start hot-reload watcher
      hitlWatcher = startHitlPolicyWatcher(hitlPolicyPath, hitlConfigRef as { current: HitlPolicyConfig });

      // Start channel listeners
      const listeners: string[] = [];

      // Telegram listener
      const telegramConfig = resolveTelegramConfig(hitlConfig.telegram);
      if (telegramConfig) {
        telegramListener = new TelegramListener(
          telegramConfig.botToken,
          (command, token, from?: TelegramOperatorInfo) => {
            // Build operator identity string from Telegram callback_query.from.
            // Format: "<userId>" or "<userId>@<username>" when username is set.
            const operatorId = from !== undefined
              ? (from.username !== undefined
                ? `${from.userId}@${from.username}`
                : String(from.userId))
              : undefined;

            // ── confirm_approve_always ────────────────────────────────────
            if (command === 'confirm_approve_always') {
              const conf = pendingApproveAlwaysConfirmations.get(token);
              if (conf) {
                clearTimeout(conf.timer);
                pendingApproveAlwaysConfirmations.delete(token);
                const pending = approvalManager.getPending(token);
                if (pending) {
                  approvalManager.addSessionAutoApproval(pending.channelId, pending.action_class);
                  console.log(
                    `[hitl-telegram] session auto-approval registered: channel=${pending.channelId} action_class=${pending.action_class}` +
                    (operatorId !== undefined ? ` operator=${operatorId}` : ''),
                  );
                  if (pending.target.length > 0 || !['shell.exec', 'code.execute'].includes(pending.action_class)) {
                    void persistAutoPermitPattern(pending.target, pending.toolName, pending.action_class, 'telegram', operatorId, conf.agentId);
                  }
                }
              } else {
                console.log(`[hitl-telegram] confirm_approve_always: no pending confirmation for token=${token}`);
              }
              const resolved = approvalManager.resolveApproval(token, 'approved');
              if (!resolved) {
                console.log(`[hitl-telegram] confirm_approve_always: unknown or expired token: ${token}`);
              }
              return;
            }

            // ── cancel_approve_always ─────────────────────────────────────
            if (command === 'cancel_approve_always') {
              const conf = pendingApproveAlwaysConfirmations.get(token);
              if (conf) {
                clearTimeout(conf.timer);
                pendingApproveAlwaysConfirmations.delete(token);
              }
              console.log(`[hitl-telegram] approve-always confirmation cancelled for token=${token}`);
              // Original approval stays pending — operator can still use the original buttons.
              return;
            }

            // ── approve_always ────────────────────────────────────────────
            if (command === 'approve_always' && FEATURES.approveAlwaysEnabled) {
              // Cancel any stale pending confirmation for this token.
              const existingConf = pendingApproveAlwaysConfirmations.get(token);
              if (existingConf) {
                clearTimeout(existingConf.timer);
                pendingApproveAlwaysConfirmations.delete(token);
              }

              const pending = approvalManager.getPending(token);
              if (pending) {
                // Try to derive a pattern for the confirmation message, unless
                // auto-confirm is enabled (CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM=1).
                let derived: ReturnType<typeof derivePattern> | undefined;
                const isExecAction = ['shell.exec', 'code.execute'].includes(pending.action_class);
                const hasDerivableInput = isExecAction ? pending.target.length > 0 : pending.toolName.length > 0;
                if (hasDerivableInput && !FEATURES.approveAlwaysAutoConfirm) {
                  try {
                    if (isExecAction) {
                      derived = derivePattern({ command: pending.target });
                    } else {
                      derived = derivePattern({ command: pending.toolName, toolName: pending.toolName });
                    }
                  } catch {
                    // Shell metacharacters or empty command — skip confirmation.
                  }
                }

                if (derived !== undefined) {
                  // Show confirmation message; do NOT resolve the original approval yet.
                  const confTimer = setTimeout(() => {
                    pendingApproveAlwaysConfirmations.delete(token);
                    console.log(`[hitl-telegram] approve-always confirmation timed out for token=${token}`);
                  }, APPROVE_ALWAYS_CONFIRM_TIMEOUT_MS);
                  if (typeof confTimer === 'object' && 'unref' in confTimer) confTimer.unref();

                  pendingApproveAlwaysConfirmations.set(token, {
                    token,
                    pattern: derived.pattern,
                    method: derived.method,
                    operatorId,
                    agentId: pending.agentId,
                    timer: confTimer,
                  });

                  void sendApproveAlwaysConfirmation(telegramConfig, {
                    token,
                    pattern: derived.pattern,
                    originalCommand: pending.target,
                  });
                  return; // Wait for confirm or cancel — do not resolve yet.
                }

                // Auto-confirm path: CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM=1,
                // target is empty, or pattern derivation failed.
                approvalManager.addSessionAutoApproval(pending.channelId, pending.action_class);
                console.log(
                  `[hitl-telegram] session auto-approval registered: channel=${pending.channelId} action_class=${pending.action_class}` +
                  (operatorId !== undefined ? ` operator=${operatorId}` : ''),
                );
                if (pending.target.length > 0 || !['shell.exec', 'code.execute'].includes(pending.action_class)) {
                  void persistAutoPermitPattern(pending.target, pending.toolName, pending.action_class, 'telegram', operatorId, pending.agentId);
                }
              }
            }

            // ── approve / deny (and approve_always feature-disabled fallthrough) ─
            // Cancel any stale pending confirmation for this token (operator chose
            // a different action on the original message).
            const staleConf = pendingApproveAlwaysConfirmations.get(token);
            if (staleConf) {
              clearTimeout(staleConf.timer);
              pendingApproveAlwaysConfirmations.delete(token);
            }

            // Duplicate tap: token already consumed — show alert to operator.
            if (approvalManager.isConsumed(token)) {
              return 'Already decided';
            }

            // approve_always resolves the current request as approved.
            const decision = command === 'deny' ? 'denied' as const : 'approved' as const;
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
            if (command === 'approve_always' && FEATURES.approveAlwaysEnabled) {
              // Register session auto-approval before resolving so future
              // requests of the same action class in this channel skip HITL.
              const pending = approvalManager.getPending(token);
              if (pending) {
                approvalManager.addSessionAutoApproval(pending.channelId, pending.action_class);
                console.log(`[hitl-slack] session auto-approval registered: channel=${pending.channelId} action_class=${pending.action_class}`);
                // Derive and persist an auto-permit pattern from the command
                // target so future matching commands are auto-permitted without
                // requiring HITL at all. Failures are logged, not thrown.
                // Slack interaction payloads do not expose a structured operator
                // identity at this level; operatorId is omitted.
                if (pending.target.length > 0 || !['shell.exec', 'code.execute'].includes(pending.action_class)) {
                  void persistAutoPermitPattern(pending.target, pending.toolName, pending.action_class, 'slack', undefined, pending.agentId);
                }
              }
            }
            // approve_always resolves the current request as approved.
            const decision = command === 'deny' ? 'denied' as const : 'approved' as const;
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
      console.log(`[plugin:clawthority] HITL loaded: ${hitlConfig.policies.length} polic${hitlConfig.policies.length !== 1 ? 'ies' : 'y'}${listenerInfo}`);
    } catch (err) {
      // HITL is optional — failing to load doesn't prevent activation.
      // parseHitlPolicyFile wraps the underlying fs error in `cause`, so
      // check both the top-level code and the cause chain.
      const directCode = (err as NodeJS.ErrnoException)?.code;
      const causeCode = ((err as { cause?: NodeJS.ErrnoException })?.cause)?.code;
      if (directCode === 'ENOENT' || causeCode === 'ENOENT') {
        console.log("[plugin:clawthority] no hitl-policy.yaml found — HITL disabled");
      } else {
        console.warn("[plugin:clawthority] HITL policy not loaded (invalid config):", err);
      }
    }

    // Cross-check: rules.json + HITL config are both loaded by this point.
    // Surface the "permit-bypasses-HITL" misconfig the tester walked into.
    // Look at operator-supplied rules only — the JSON engine, not the default
    // engine — because defaults never permit unknown_sensitive_action and we
    // don't want false positives if the default set ever evolves.
    if (jsonRulesEngineRef.current !== null) {
      warnIfPermitOnUnknownToolsWithoutHitl(
        jsonRulesEngineRef.current.rules,
        hitlConfigRef.current,
      );
    }

    // Mode recommendation: surface open-mode gap when no protection exists
    // for unknown_sensitive_action (neither a forbid rule nor a HITL policy).
    // Passes null when no JSON rules are loaded so the function treats that as
    // "no operator forbid" — correct because an absent rules.json means no
    // operator-supplied constraints at all.
    logOpenModeRecommendation(
      MODE,
      jsonRulesEngineRef.current?.rules ?? null,
      hitlConfigRef.current,
    );

    console.log("[plugin:clawthority] activated – lifecycle hooks registered");
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
    telegramMessageIds.clear();
    for (const conf of pendingApproveAlwaysConfirmations.values()) {
      clearTimeout(conf.timer);
    }
    pendingApproveAlwaysConfirmations.clear();
    approvalManager.shutdown();
    if (hitlWatcher !== null) {
      await hitlWatcher.stop();
      hitlWatcher = null;
    }
    hitlConfigRef.current = null;
    hitlAuditLogger = null;

    // ── Auto-permit store watcher cleanup ─────────────────────────────────
    if (autoPermitStoreWatcher !== null) {
      autoPermitStoreWatcher.stop();
      autoPermitStoreWatcher = null;
    }

    // ── Rules watcher cleanup ─────────────────────────────────────────────
    if (rulesWatcher !== null) {
      await rulesWatcher.stop();
      rulesWatcher = null;
    }

    // ── Bundle watcher cleanup ────────────────────────────────────────────
    if (adapterBundleWatchHandle !== null) {
      await adapterBundleWatchHandle.stop();
      adapterBundleWatchHandle = null;
    }
    adapterRef = null;
    activated = false;
    console.log("[plugin:clawthority] deactivated");
  },
};

export default plugin;

/**
 * Stage 2 evaluator factory.
 *
 * Creates `Stage2Fn` implementations backed by an `EnforcementPolicyEngine`.
 * The factory decouples engine construction from orchestration so tests can
 * supply a pre-configured engine without modifying the pipeline.
 *
 * Usage:
 *   import { createStage2 } from './stage2-policy.js';
 *   import { EnforcementPolicyEngine } from './pipeline.js';
 *
 *   const engine = new EnforcementPolicyEngine();
 *   engine.addRules(defaultRules);
 *   const stage2 = createStage2(engine);
 *   // pass stage2 to runPipeline(ctx, stage1, stage2, emitter)
 */

import { EnforcementPolicyEngine } from './pipeline.js';
import type { Stage2Fn, CeeDecision, PipelineContext } from './pipeline.js';
import type { PolicyEngine } from '../policy/engine.js';
import type { EvaluationDecision } from '../policy/engine.js';
import type { AutoPermitRuleChecker } from '../auto-permits/matcher.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Stage 2 evaluator backed by the given `EnforcementPolicyEngine`.
 *
 * The returned function:
 *   1. Calls `engine.evaluateByActionClass(action_class, target, rule_context)`.
 *   2. Maps the `EvaluationDecision` to a `CeeDecision`:
 *        - `effect`  → 'permit' | 'forbid' (direct)
 *        - `reason`  → forwarded when present; defaults to the effect string
 *        - `stage`   → always 'stage2'
 *   3. Any uncaught exception is caught at the boundary and returned as
 *      `{ effect: 'forbid', reason: 'stage2_error', stage: 'stage2' }` (fail closed).
 *
 * @param engine An EnforcementPolicyEngine instance with rules loaded.
 * @returns A Stage2Fn suitable for use with runPipeline.
 */
export function createStage2(engine: EnforcementPolicyEngine): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    try {
      const result = engine.evaluateByActionClass(
        ctx.action_class,
        ctx.target,
        ctx.rule_context,
      );

      // Cedar semantics: forbid from action_class evaluation wins immediately
      if (result.effect === 'forbid') {
        return {
          effect: 'forbid',
          reason: result.reason ?? 'forbid',
          stage: 'stage2',
          ...(result.matchedRule?.priority !== undefined ? { priority: result.matchedRule.priority } : {}),
        };
      }

      // Also evaluate intent_group rules if the action belongs to a group.
      // Any forbid from intent_group rules wins (Cedar semantics).
      if (ctx.intent_group !== undefined) {
        const igResult = engine.evaluateByIntentGroup(ctx.intent_group, ctx.rule_context);
        if (igResult.effect === 'forbid') {
          return {
            effect: 'forbid',
            reason: igResult.reason ?? 'forbid',
            stage: 'stage2',
            ...(igResult.matchedRule?.priority !== undefined ? { priority: igResult.matchedRule.priority } : {}),
          };
        }
      }

      return {
        effect: result.effect,
        reason: result.reason ?? result.effect,
        stage: 'stage2',
      };
    } catch {
      return { effect: 'forbid', reason: 'stage2_error', stage: 'stage2' };
    }
  };
}

// ---------------------------------------------------------------------------
// Default engine factory
// ---------------------------------------------------------------------------

/**
 * Creates a new `EnforcementPolicyEngine` with the given rules pre-loaded.
 *
 * Convenience wrapper so callers do not need to import EnforcementPolicyEngine
 * separately when all they need is a default-configured engine.
 *
 * @param rules Rules to load into the engine. Defaults to an empty array.
 */
export function createEnforcementEngine(
  rules: Parameters<EnforcementPolicyEngine['addRules']>[0] = [],
): EnforcementPolicyEngine {
  const engine = new EnforcementPolicyEngine();
  if (rules.length > 0) {
    engine.addRules(rules);
  }
  return engine;
}

// ---------------------------------------------------------------------------
// Combined handler stage2 factory
// ---------------------------------------------------------------------------

/**
 * Minimal interface for checking session-scoped auto-approvals.
 *
 * `ApprovalManager` satisfies this interface. Accepting an interface rather
 * than a concrete class keeps `createCombinedStage2` decoupled from the HITL
 * subsystem and makes unit testing straightforward.
 */
export interface AutoPermitChecker {
  /** Returns true when the `channelId:actionClass` pair has been auto-approved. */
  isSessionAutoApproved(channelId: string, actionClass: string): boolean;
}

/** Priority threshold below which a forbid is treated as HITL-gated. */
const HITL_PRIORITY_THRESHOLD = 100;

/**
 * Synthetic priority assigned to closed-mode implicit-deny forbids so the
 * downstream HITL-gated check treats them as HITL-gateable (priority < 100).
 * HITL is the operator's escape hatch for action classes that have no explicit
 * permit rule — if no HITL policy matches, the forbid is still upheld.
 */
const IMPLICIT_DENY_PRIORITY = 0;

function isHitlGatedDecision(result: EvaluationDecision): boolean {
  // Closed-mode implicit deny (no matchedRule) is HITL-gated.
  if (result.matchedRule === undefined) return true;
  const p = result.matchedRule.priority;
  return p !== undefined && p < HITL_PRIORITY_THRESHOLD;
}

function toStagedForbid(result: EvaluationDecision, stage: string): CeeDecision {
  const priority = result.matchedRule?.priority
    ?? (result.matchedRule === undefined ? IMPLICIT_DENY_PRIORITY : undefined);
  return {
    effect: 'forbid',
    reason: result.reason ?? 'forbid',
    stage,
    ...(priority !== undefined ? { priority } : {}),
  };
}

/**
 * Creates a Stage 2 evaluator that consolidates the Cedar TS engine, an
 * optional JSON rules engine, and intent-group evaluation into a single
 * `Stage2Fn`. Intended for use in `beforeToolCallHandler` where two separate
 * engine references are managed independently.
 *
 * Stage labels in returned `CeeDecision.stage`:
 *   'cedar'      — decision came from the Cedar TS engine
 *   'json-rules' — decision came from the JSON rules engine
 *   'stage2'     — permit or catch-all error (no engine-specific attribution)
 *
 * HITL-gating semantics (mirroring the inline closure this replaces):
 *   - Rules with `priority < 100` are HITL-gated forbids.
 *   - Unconditional forbids (priority ≥ 100 or undefined) are returned
 *     immediately and win over any captured HITL-gated forbid.
 *   - The first HITL-gated forbid found is captured; subsequent HITL-gated
 *     forbids from other engines are ignored.
 *   - If no unconditional forbid is found, the captured HITL-gated forbid
 *     is returned so the caller can route it through HITL resolution.
 *
 * Intent-group evaluation is skipped when a HITL-gated forbid has already
 * been captured — the first HITL signal is sufficient for dispatch.
 *
 * @param cedarEngine      Cedar TS policy engine (evaluateByActionClass used).
 * @param jsonEngine       JSON rules engine, or null if not configured.
 * @param toolName         Original tool name used for JSON resource/match rules.
 * @param autoPermit       Optional checker for session-scoped auto-approvals.
 *                         When provided and `isSessionAutoApproved` returns true
 *                         for the current channel + action class, the function
 *                         returns a permit immediately before any engine
 *                         evaluation occurs. Pass `undefined` (or omit) to
 *                         disable auto-permit checks — controlled externally via
 *                         the `approveAlwaysEnabled` feature flag so that
 *                         disabling the flag at startup prevents any new
 *                         auto-permit decisions from being issued.
 * @param autoPermitRules  Optional checker for file-based auto-permit rules
 *                         loaded from the auto-permit store. When provided and
 *                         `matchCommand` returns a matching rule, the function
 *                         returns a permit with `stage: 'auto-permit'` and
 *                         `rule` set to the matched pattern. Failed pattern
 *                         compilations are silently skipped so the call falls
 *                         through to HITL gating — fail-safe behaviour.
 */
export function createCombinedStage2(
  cedarEngine: PolicyEngine,
  jsonEngine: PolicyEngine | null,
  toolName: string,
  autoPermit?: AutoPermitChecker,
  autoPermitRules?: AutoPermitRuleChecker,
): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    try {
      // ── Session auto-approval pre-check ───────────────────────────────────
      // Checked first so session-scoped auto-approvals bypass HITL gating with
      // minimal overhead (a single Set.has lookup). The source tag
      // 'session_auto_approved' in the returned reason identifies the origin of
      // the permit for audit and logging purposes.
      if (autoPermit !== undefined) {
        const channelId = ctx.rule_context.channel;
        if (autoPermit.isSessionAutoApproved(channelId, ctx.action_class)) {
          return { effect: 'permit', reason: 'session_auto_approved', stage: 'stage2' };
        }
      }

      // ── File-based auto-permit rules check ────────────────────────────────
      // Checked after session auto-approval but before Cedar/JSON engine
      // evaluation. A matching stored rule returns a permit immediately with
      // stage 'auto-permit'; the matched pattern is forwarded in `rule` so
      // the callsite can log it and record coverage map usage.
      // Failed pattern compilations are silently skipped — the rule is ignored
      // and the command falls through to HITL gating (fail-safe behaviour).
      //
      // Command string selection:
      //   - Exec-type tools (shell.exec, code.execute, unknown_sensitive_action):
      //     ctx.target IS the shell command string (extracted from the
      //     `command`/`cmd`/`script` param by normalize_action, or set directly
      //     when the unregistered tool falls through to the catch-all class).
      //     Match directly against it so that patterns like `git commit *`
      //     match incoming shell commands.
      //   - Registered non-exec tools: target is a resource (file path, URL,
      //     etc.), not a shell command.  Match against the tool name so that
      //     tool-name patterns (`read_file *`) match any invocation of that
      //     tool regardless of which resource it targets.
      if (autoPermitRules !== undefined) {
        const EXEC_ACTION_CLASSES: ReadonlySet<string> = new Set([
          'shell.exec',
          'code.execute',
          'unknown_sensitive_action',
        ]);
        const cmdToMatch = EXEC_ACTION_CLASSES.has(ctx.action_class)
          ? ctx.target
          : toolName;
        if (cmdToMatch.length > 0) {
          const matched = autoPermitRules.matchCommand(cmdToMatch);
          if (matched !== null) {
            return {
              effect: 'permit',
              reason: 'auto_permit_rule',
              stage: 'auto-permit',
              rule: matched.pattern,
            };
          }
        }
      }

      let pendingHitlGated: CeeDecision | null = null;

      // ── Cedar engine ──────────────────────────────────────────────────────
      const cedarResult = cedarEngine.evaluateByActionClass(
        ctx.action_class,
        ctx.target,
        ctx.rule_context,
      );
      if (cedarResult.effect === 'forbid') {
        if (isHitlGatedDecision(cedarResult)) {
          pendingHitlGated = toStagedForbid(cedarResult, 'cedar');
        } else {
          return toStagedForbid(cedarResult, 'cedar');
        }
      }

      // ── JSON rules engine (resource/match-based, keyed by toolName) ───────
      if (jsonEngine !== null) {
        const jsonResult = jsonEngine.evaluate('tool', toolName, ctx.rule_context, ctx.target);
        if (jsonResult.effect === 'forbid') {
          if (isHitlGatedDecision(jsonResult)) {
            pendingHitlGated ??= toStagedForbid(jsonResult, 'json-rules');
          } else {
            return toStagedForbid(jsonResult, 'json-rules');
          }
        }
      }

      // ── Intent-group evaluation (skipped if HITL-gated forbid captured) ───
      // When a HITL-gated forbid is already pending we skip intent-group so
      // the pending signal is not overridden by a possibly less specific group
      // rule. Unconditional intent-group forbids still escape via early return.
      if (ctx.intent_group !== undefined && pendingHitlGated === null) {
        const intentGroup = ctx.intent_group;
        type EngineEntry = readonly [PolicyEngine, string];
        const engines: EngineEntry[] = [
          [cedarEngine, 'cedar'] as EngineEntry,
          ...(jsonEngine !== null ? [[jsonEngine, 'json-rules'] as EngineEntry] : []),
        ];
        for (const [eng, engStage] of engines) {
          const igResult = eng.evaluateByIntentGroup(intentGroup, ctx.rule_context);
          if (igResult.effect !== 'forbid' || igResult.matchedRule === undefined) continue;
          if (isHitlGatedDecision(igResult)) {
            pendingHitlGated = toStagedForbid(igResult, engStage);
          } else {
            return toStagedForbid(igResult, engStage);
          }
          break; // first forbid wins
        }
      }

      if (pendingHitlGated !== null) return pendingHitlGated;
      return { effect: 'permit', reason: 'all_policies_passed', stage: 'stage2' };
    } catch {
      return { effect: 'forbid', reason: 'stage2_error', stage: 'stage2' };
    }
  };
}

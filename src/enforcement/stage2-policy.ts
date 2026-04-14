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
 *   await engine.init();
 *   const stage2 = createStage2(engine);
 *   // pass stage2 to runPipeline(ctx, stage1, stage2, emitter)
 */

import { EnforcementPolicyEngine } from './pipeline.js';
import type { CedarEngineOptions } from '../policy/cedar-engine.js';
import type { Stage2Fn, CeeDecision, PipelineContext } from './pipeline.js';

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
 * @param engine An EnforcementPolicyEngine instance.
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
 * Creates a new `EnforcementPolicyEngine` with the given options.
 *
 * Pass `{ defaultEffect: 'permit' }` in tests or development to get an
 * implicit-permit engine without loading Cedar WASM. Production deployments
 * should call `engine.init()` after construction to enable full Cedar WASM
 * evaluation (which is deny-by-default unless policies are loaded).
 *
 * @param options Options forwarded to the underlying {@link CedarEngine}.
 */
export function createEnforcementEngine(
  options?: CedarEngineOptions,
): EnforcementPolicyEngine {
  return new EnforcementPolicyEngine(options);
}

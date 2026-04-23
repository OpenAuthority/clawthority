/**
 * HITL dispatch wrapper — T19
 *
 * Wraps `runPipeline` so that HITL approval dispatch happens as a consequence
 * of pipeline results rather than being interleaved inside Stage 2.
 *
 * Option A ("keep pipeline pure"):
 *   1. Run the pipeline with `hitl_mode: 'none'` so Cedar evaluates
 *      unconditionally without the built-in HITL pre-check firing.
 *   2. If the pipeline permits → return immediately.
 *   3. If the pipeline forbids with priority >= 100 (or no priority) →
 *      unconditional block; HITL cannot override.
 *   4. If the pipeline forbids with priority < 100 AND the action matches a
 *      HITL policy → dispatch HITL:
 *        a. Create an approval request via `ApprovalManager`.
 *        b. Await the operator's decision.
 *        c. Approved → mint capability → re-run pipeline with `approval_id`.
 *        d. Denied / expired → return forbid with the original pipeline reason.
 *   5. If no HITL policy matches the action → uphold the forbid.
 */

import { EventEmitter } from 'node:events';
import { runPipeline } from './pipeline.js';
import type {
  PipelineContext,
  Stage1Fn,
  Stage2Fn,
  OrchestratorResult,
  CeeDecision,
} from './pipeline.js';
import type { ApprovalManager } from '../hitl/approval-manager.js';
import type { HitlPolicyConfig } from '../hitl/types.js';
import { checkAction } from '../hitl/matcher.js';
import type { Capability } from '../adapter/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cedar forbid rules with a priority at or above this threshold are
 * unconditional — HITL cannot release them.  Rules with a lower explicit
 * priority (the "HITL-gated" tier, conventionally priority 90) defer the
 * final decision to the HITL policy.
 *
 * Mirrors `UNCONDITIONAL_FORBID_PRIORITY` in `src/index.ts`.
 */
const UNCONDITIONAL_FORBID_PRIORITY = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for the HITL dispatch wrapper.
 *
 * The caller is responsible for:
 *   - Providing an `ApprovalManager` shared with the `Stage1Fn` so that the
 *     re-run's capability consumption check works correctly.
 *   - Implementing `issueCapability` to both create the capability AND add it
 *     to whatever store `stage1`'s `getCapability` function reads from, so
 *     that Stage 1 can retrieve the capability on the re-run.
 */
export interface HitlDispatchOpts {
  /** Loaded HITL policy configuration — used to check for a matching policy. */
  hitlConfig: HitlPolicyConfig;
  /** Approval manager used to create and track approval requests. */
  manager: ApprovalManager;
  /**
   * Issues a capability after HITL approval and makes it retrievable by Stage 1.
   *
   * Implementations must:
   *   1. Generate a fresh capability ID (UUID v7) distinct from the approval token.
   *   2. Store the capability in the `getCapability` backing store so Stage 1
   *      can look it up by `approval_id` on the re-run.
   *   3. Return the issued `Capability`.
   *
   * @param action_class  Normalised action class (e.g. `'filesystem.delete'`).
   * @param target        Target resource (e.g. file path or email address).
   * @param payload_hash  SHA-256 hex digest of the tool call payload.
   * @param session_id    Session identifier, forwarded when present.
   */
  issueCapability: (
    action_class: string,
    target: string,
    payload_hash: string,
    session_id?: string,
  ) => Promise<Capability>;
  /** Agent ID included in the approval request sent to the operator. */
  agentId: string;
  /** Channel ID included in the approval request sent to the operator. */
  channelId: string;
}

// ---------------------------------------------------------------------------
// runWithHitl
// ---------------------------------------------------------------------------

/**
 * Runs the enforcement pipeline then dispatches a HITL approval request if
 * the pipeline produced a HITL-gated forbid that matches a HITL policy.
 *
 * Execution order:
 *   1. Pipeline runs with `hitl_mode: 'none'` — Cedar evaluates unconditionally.
 *   2. Pipeline permits → return.
 *   3. Pipeline forbids, `priority >= 100` (or absent) → unconditional block.
 *   4. Pipeline forbids, `priority < 100` AND HITL policy matches:
 *        a. Create approval request via `opts.manager`.
 *        b. Await operator decision.
 *        c. Approved → `opts.issueCapability(...)` → re-run with `approval_id`.
 *        d. Denied / expired → return forbid with original pipeline reason.
 *   5. Pipeline forbids, `priority < 100` but no HITL policy matches → block.
 *
 * The re-run uses a wrapped stage2 that converts priority < 100 forbids to
 * permits — the operator has already approved the action, so only unconditional
 * rules (priority >= 100) can still block.
 */
export async function runWithHitl(
  ctx: PipelineContext,
  stage1: Stage1Fn,
  stage2: Stage2Fn,
  emitter: EventEmitter,
  opts: HitlDispatchOpts,
): Promise<OrchestratorResult> {
  // ── First pass: run pipeline with hitl_mode 'none' ────────────────────────
  // Bypassing the built-in HITL pre-check lets Cedar evaluate unconditionally
  // so that priority-90 forbids surface as real forbid decisions here rather
  // than being gated before Cedar even runs.
  const firstCtx: PipelineContext = { ...ctx, hitl_mode: 'none' };
  const firstResult = await runPipeline(firstCtx, stage1, stage2, emitter);

  if (firstResult.decision.effect === 'permit') {
    return firstResult;
  }

  // ── HITL-gated check ──────────────────────────────────────────────────────
  const { priority } = firstResult.decision;
  const isHitlGated =
    priority !== undefined && priority < UNCONDITIONAL_FORBID_PRIORITY;

  if (!isHitlGated) {
    // Unconditional forbid (priority >= 100, or no explicit priority) —
    // HITL cannot override.
    return firstResult;
  }

  const hitlCheck = checkAction(opts.hitlConfig, ctx.action_class);
  if (!hitlCheck.requiresApproval || !hitlCheck.matchedPolicy) {
    // No HITL policy covers this action — uphold the forbid.
    return firstResult;
  }

  // ── Dispatch HITL ─────────────────────────────────────────────────────────
  const policy = hitlCheck.matchedPolicy;
  const handle = opts.manager.createApprovalRequest({
    toolName: ctx.action_class,
    agentId: opts.agentId,
    channelId: opts.channelId,
    policy,
    action_class: ctx.action_class,
    target: ctx.target,
    payload_hash: ctx.payload_hash,
    session_id: ctx.session_id,
  });

  const hitlDecision = await handle.promise;

  if (hitlDecision === 'approved') {
    // Mint capability before re-run so Stage 1 can validate it.
    const capability = await opts.issueCapability(
      ctx.action_class,
      ctx.target,
      ctx.payload_hash,
      ctx.session_id,
    );

    // Wrap stage2 for the re-run: HITL has approved, so priority < 100 forbids
    // are released.  Priority >= 100 (unconditional) forbids still block.
    const approvedStage2: Stage2Fn = async (pCtx) => {
      const decision = await stage2(pCtx);
      if (
        decision.effect === 'forbid' &&
        decision.priority !== undefined &&
        decision.priority < UNCONDITIONAL_FORBID_PRIORITY
      ) {
        return { effect: 'permit', reason: 'hitl_approved', stage: 'hitl' } satisfies CeeDecision;
      }
      return decision;
    };

    const rerunCtx: PipelineContext = {
      ...ctx,
      hitl_mode: 'per_request',
      approval_id: capability.approval_id,
    };

    return runPipeline(rerunCtx, stage1, approvedStage2, emitter);
  }

  // Denied or expired: uphold the original pipeline forbid reason.
  return {
    decision: {
      effect: 'forbid',
      reason: firstResult.decision.reason,
      stage: 'hitl',
    },
    latency_ms: firstResult.latency_ms,
  };
}

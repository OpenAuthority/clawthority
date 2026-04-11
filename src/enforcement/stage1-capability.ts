import { createHash } from 'node:crypto';
import type { PipelineContext, CeeDecision } from './pipeline.js';
import type { ApprovalManager } from '../hitl/approval-manager.js';
import type { Capability } from '../adapter/types.js';

/**
 * Stage 1 capability gate.
 *
 * Validates a capability token against seven ordered security checks.
 * Checks short-circuit on the first failure. Any uncaught error is caught
 * at the boundary and returned as a `stage1_error` forbid decision (fail closed).
 *
 * Check order:
 *   0. Untrusted source + high/critical risk → forbid (untrusted_source_high_risk)
 *   1. hitl_mode none → permit bypass (low-risk actions)
 *   2. Missing approval_id → forbid (approval required)
 *   3. TTL expiration → forbid (capability expired)
 *   4. Payload hash binding verification (SHA-256) → forbid on mismatch
 *   5. One-time consumption check via approval manager → forbid if consumed
 *   6. Session scope validation → forbid on session_id mismatch
 *
 * @param ctx             Pipeline context for the current request.
 * @param approvalManager Approval manager used for one-time consumption checks.
 * @param getCapability   Looks up a stored capability by its approval_id.
 */
export async function validateCapability(
  ctx: PipelineContext,
  approvalManager: ApprovalManager,
  getCapability: (id: string) => Capability | undefined,
): Promise<CeeDecision> {
  try {
    // 0. Untrusted source + high/critical risk → deny regardless of HITL mode.
    if (
      ctx.sourceTrustLevel === 'untrusted' &&
      (ctx.risk === 'high' || ctx.risk === 'critical')
    ) {
      return { effect: 'forbid', reason: 'untrusted_source_high_risk', stage: 'stage1' };
    }

    // 1. Low-risk bypass: hitl_mode none skips all capability checks.
    if (ctx.hitl_mode === 'none') {
      return { effect: 'permit', reason: 'hitl_mode none; capability gate bypassed', stage: 'stage1' };
    }

    // 2. Approval ID required.
    if (!ctx.approval_id) {
      return { effect: 'forbid', reason: 'approval_id required', stage: 'stage1' };
    }

    // 3. Capability lookup and TTL expiration check.
    const capability = getCapability(ctx.approval_id);
    if (!capability) {
      return { effect: 'forbid', reason: 'capability not found', stage: 'stage1' };
    }
    if (Date.now() > capability.expires_at) {
      return { effect: 'forbid', reason: 'capability expired', stage: 'stage1' };
    }

    // 4. Payload hash binding verification (SHA-256).
    const expectedBinding = createHash('sha256')
      .update(`${ctx.action_class}|${ctx.target}|${ctx.payload_hash}`)
      .digest('hex');
    if (expectedBinding !== capability.binding) {
      return { effect: 'forbid', reason: 'payload binding mismatch', stage: 'stage1' };
    }

    // 5. One-time consumption check via approval manager.
    if (approvalManager.isConsumed(ctx.approval_id)) {
      return { effect: 'forbid', reason: 'capability already consumed', stage: 'stage1' };
    }

    // 6. Session scope validation.
    if (capability.session_id !== undefined && capability.session_id !== ctx.session_id) {
      return { effect: 'forbid', reason: 'session scope mismatch', stage: 'stage1' };
    }

    return { effect: 'permit', reason: 'capability valid', stage: 'stage1' };
  } catch {
    return { effect: 'forbid', reason: 'stage1_error', stage: 'stage1' };
  }
}

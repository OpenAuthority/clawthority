/**
 * Stage 1 capability gate — test suite
 *
 * Covers all validation paths of validateCapability:
 *   0. Untrusted source + high/critical risk → forbid (untrusted_source_high_risk)
 *   1. hitl_mode none → permit bypass
 *   2. Missing approval_id → forbid (approval_id required)
 *   3. Capability not found → forbid (capability not found)
 *   4. TTL expiration → forbid (capability expired)
 *   5. Payload hash binding mismatch → forbid (payload binding mismatch)
 *   6. Already consumed → forbid (capability already consumed)
 *   7. Session scope mismatch → forbid (session scope mismatch)
 *   8. All checks pass → permit (capability valid)
 *   9. Exception → forbid (stage1_error)
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { validateCapability } from './stage1-capability.js';
import type { PipelineContext } from './pipeline.js';
import type { ApprovalManager } from '../hitl/approval-manager.js';
import type { Capability } from '../adapter/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeBinding(action_class: string, target: string, payload_hash: string): string {
  return createHash('sha256')
    .update(`${action_class}|${target}|${payload_hash}`)
    .digest('hex');
}

/** Base context with all fields set to valid defaults that pass all checks. */
function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    action_class: 'filesystem.read',
    target: '/tmp/test.txt',
    payload_hash: 'abc123',
    hitl_mode: 'per_request',
    approval_id: 'approval-001',
    session_id: 'session-001',
    rule_context: { agentId: 'agent-1', channel: 'test' },
    sourceTrustLevel: 'user',
    risk: 'low',
    ...overrides,
  };
}

/** Base capability whose binding matches makeCtx() defaults. */
function makeCapability(overrides?: Partial<Capability>): Capability {
  const action_class = 'filesystem.read';
  const target = '/tmp/test.txt';
  const payload_hash = 'abc123';
  return {
    approval_id: 'approval-001',
    binding: computeBinding(action_class, target, payload_hash),
    action_class,
    target,
    issued_at: Date.now() - 1_000,
    expires_at: Date.now() + 60_000,
    ...overrides,
  };
}

function makeApprovalManager(consumed = false): ApprovalManager {
  return { isConsumed: vi.fn().mockReturnValue(consumed) } as unknown as ApprovalManager;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('validateCapability', () => {
  // ── Check 0: Untrusted source + high/critical risk ────────────────────────

  it('forbids when source is untrusted and risk is high', async () => {
    const ctx = makeCtx({ sourceTrustLevel: 'untrusted', risk: 'high' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => undefined);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('untrusted_source_high_risk');
    expect(result.stage).toBe('stage1-trust');
    expect(result.rule).toBe('trust:untrusted+high');
  });

  it('forbids when source is untrusted and risk is critical', async () => {
    const ctx = makeCtx({ sourceTrustLevel: 'untrusted', risk: 'critical' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => undefined);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('untrusted_source_high_risk');
    expect(result.stage).toBe('stage1-trust');
    expect(result.rule).toBe('trust:untrusted+critical');
  });

  it('permits when source is untrusted but risk is low', async () => {
    // Check 0 does not fire; hitl_mode none causes bypass at check 1
    const ctx = makeCtx({ sourceTrustLevel: 'untrusted', risk: 'low', hitl_mode: 'none' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => undefined);
    expect(result.effect).toBe('permit');
  });

  it('permits when source is untrusted but risk is medium', async () => {
    const ctx = makeCtx({ sourceTrustLevel: 'untrusted', risk: 'medium', hitl_mode: 'none' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => undefined);
    expect(result.effect).toBe('permit');
  });

  it('permits when source is user regardless of risk', async () => {
    const ctx = makeCtx({ sourceTrustLevel: 'user', risk: 'critical', hitl_mode: 'none' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => undefined);
    expect(result.effect).toBe('permit');
  });

  it('permits when source is agent regardless of risk', async () => {
    const ctx = makeCtx({ sourceTrustLevel: 'agent', risk: 'critical', hitl_mode: 'none' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => undefined);
    expect(result.effect).toBe('permit');
  });

  // ── Check 1: hitl_mode none bypass ────────────────────────────────────────

  it('permits when hitl_mode is none (low-risk bypass)', async () => {
    const ctx = makeCtx({ hitl_mode: 'none', sourceTrustLevel: 'user' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => undefined);
    expect(result.effect).toBe('permit');
    expect(result.reason).toBe('hitl_mode none; capability gate bypassed');
    expect(result.stage).toBe('stage1');
  });

  // ── Check 2: Missing approval_id ─────────────────────────────────────────

  it('forbids when approval_id is missing', async () => {
    const ctx = makeCtx({ approval_id: undefined, hitl_mode: 'per_request' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => undefined);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('approval_id required');
    expect(result.stage).toBe('stage1');
  });

  // ── Check 3: Capability lookup and TTL ───────────────────────────────────

  it('forbids when capability is not found in the store', async () => {
    const ctx = makeCtx({ approval_id: 'unknown-id' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => undefined);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('capability not found');
    expect(result.stage).toBe('stage1');
  });

  it('forbids when capability TTL has expired', async () => {
    const cap = makeCapability({ expires_at: Date.now() - 1 });
    const ctx = makeCtx();
    const result = await validateCapability(ctx, makeApprovalManager(), () => cap);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('capability expired');
    expect(result.stage).toBe('stage1');
  });

  // ── Check 4: Payload hash binding ────────────────────────────────────────

  it('forbids when payload hash binding does not match (SHA-256)', async () => {
    const cap = makeCapability({ binding: 'deadbeef-wrong-binding' });
    const ctx = makeCtx();
    const result = await validateCapability(ctx, makeApprovalManager(), () => cap);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('payload binding mismatch');
    expect(result.stage).toBe('stage1');
  });

  // ── Capability replay protection ─────────────────────────────────────────

  it('forbids when approval_id is reused with different tool parameters (capability replay via SHA-256 binding)', async () => {
    // Compute real SHA-256 payload hashes for two distinct parameter sets.
    const payloadHashP1 = createHash('sha256')
      .update(JSON.stringify({ path: '/data/config.json' }))
      .digest('hex');
    const payloadHashP2 = createHash('sha256')
      .update(JSON.stringify({ path: '/data/secret.json' }))
      .digest('hex');

    // P1 and P2 must produce distinct hashes — replay is only meaningful if the
    // hashes differ, confirming the SHA-256 binding actually changes.
    expect(payloadHashP1).not.toBe(payloadHashP2);

    // Capability was issued for P1; binding = SHA-256(action_class|target|payloadHashP1).
    const cap = makeCapability({
      binding: computeBinding('filesystem.read', '/tmp/test.txt', payloadHashP1),
    });

    // Replay attempt: same approval_id presented with P2's payload hash — the
    // Stage 1 gate must recompute the binding and detect the mismatch.
    const ctx = makeCtx({ payload_hash: payloadHashP2 });

    const result = await validateCapability(ctx, makeApprovalManager(), () => cap);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('payload binding mismatch');
    expect(result.stage).toBe('stage1');
  });

  // ── Check 5: One-time consumption ────────────────────────────────────────

  it('forbids when capability has already been consumed', async () => {
    const cap = makeCapability();
    const ctx = makeCtx();
    const result = await validateCapability(ctx, makeApprovalManager(true), () => cap);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('capability already consumed');
    expect(result.stage).toBe('stage1');
  });

  // ── Check 6: Session scope ────────────────────────────────────────────────

  it('forbids when session_id does not match capability scope', async () => {
    const cap = makeCapability({ session_id: 'session-XYZ' });
    const ctx = makeCtx({ session_id: 'session-ABC' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => cap);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('session scope mismatch');
    expect(result.stage).toBe('stage1');
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('permits when all checks pass', async () => {
    const cap = makeCapability();
    const ctx = makeCtx();
    const result = await validateCapability(ctx, makeApprovalManager(), () => cap);
    expect(result.effect).toBe('permit');
    expect(result.reason).toBe('capability valid');
    expect(result.stage).toBe('stage1');
  });

  it('permits when capability has no session_id (no scope restriction)', async () => {
    const cap = makeCapability({ session_id: undefined });
    const ctx = makeCtx({ session_id: 'any-session' });
    const result = await validateCapability(ctx, makeApprovalManager(), () => cap);
    expect(result.effect).toBe('permit');
    expect(result.reason).toBe('capability valid');
  });

  // ── Exception handling (fail closed) ─────────────────────────────────────

  it('fails closed with stage1_error when getCapability throws', async () => {
    const ctx = makeCtx();
    const getCapability = vi.fn().mockImplementation(() => {
      throw new Error('store failure');
    });
    const result = await validateCapability(ctx, makeApprovalManager(), getCapability);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('stage1_error');
    expect(result.stage).toBe('stage1');
  });

  it('fails closed with stage1_error when approvalManager.isConsumed throws', async () => {
    const cap = makeCapability();
    const ctx = makeCtx();
    const am = {
      isConsumed: vi.fn().mockImplementation(() => {
        throw new Error('manager failure');
      }),
    } as unknown as ApprovalManager;
    const result = await validateCapability(ctx, am, () => cap);
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('stage1_error');
    expect(result.stage).toBe('stage1');
  });

  // ── Short-circuit behavior ────────────────────────────────────────────────

  it('short-circuits on first failure without evaluating subsequent checks', async () => {
    // Check 0 fires (untrusted + high risk) before check 2 (missing approval_id)
    const ctx = makeCtx({
      sourceTrustLevel: 'untrusted',
      risk: 'high',
      approval_id: undefined,
    });
    const getCapability = vi.fn();
    const result = await validateCapability(ctx, makeApprovalManager(), getCapability);
    expect(result.reason).toBe('untrusted_source_high_risk');
    expect(getCapability).not.toHaveBeenCalled();
  });
});

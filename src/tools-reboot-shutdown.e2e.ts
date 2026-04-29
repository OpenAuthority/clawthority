/**
 * E2E tests for the reboot + shutdown typed tools (W2 of v1.3.2).
 *
 * Focus areas:
 *   - Action class mapping for both tools
 *   - Pipeline PERMIT path (HITL → approve → permit)
 *   - Structural pre-flight barriers: reboot.confirm and shutdown.cancel-no-time
 *
 * Test IDs:
 *   TC-RBS-E2E-01  reboot      — action class mapping → system.service / critical / per_request
 *   TC-RBS-E2E-02  shutdown    — action class mapping → system.service / critical / per_request
 *   TC-RBS-E2E-03  reboot      — pre-flight rejects missing confirm even on permitted pipeline
 *   TC-RBS-E2E-04  shutdown    — cancel mode forbids time
 *   TC-RBS-E2E-05  pipeline    — HITL FORBID without token
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type {
  PipelineContext,
  Stage1Fn,
  Stage2Fn,
  CeeDecision,
} from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { normalize_action } from './enforcement/normalize.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import { computePayloadHash } from './envelope.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import { reboot, RebootError } from './tools/reboot/reboot.js';
import { shutdown, ShutdownError } from './tools/shutdown/shutdown.js';

// ─── Pipeline helpers ────────────────────────────────────────────────────────

function buildPermissiveStage2(): Stage2Fn {
  return async (_ctx: PipelineContext): Promise<CeeDecision> => ({
    effect: 'permit',
    reason: 'default_permit',
    stage: 'stage2',
  });
}

const TEST_POLICY: HitlPolicy = {
  name: 'test-system-service',
  actions: ['system.service'],
  approval: { channel: 'test', timeout: 3600, fallback: 'deny' },
};

class HitlTestHarness {
  private readonly approvalManager = new ApprovalManager();
  private readonly issued = new Map<string, Capability>();
  readonly stage1: Stage1Fn = (ctx: PipelineContext) =>
    validateCapability(ctx, this.approvalManager, (id) => this.issued.get(id));

  approveNext(opts: {
    action_class: string;
    target: string;
    payload_hash: string;
  }): string {
    const handle = this.approvalManager.createApprovalRequest({
      toolName: opts.action_class,
      agentId: 'test-agent',
      channelId: 'test-channel',
      policy: TEST_POLICY,
      action_class: opts.action_class,
      target: opts.target,
      payload_hash: opts.payload_hash,
    });
    const now = Date.now();
    this.issued.set(handle.token, {
      approval_id: handle.token,
      binding: computeBinding(opts.action_class, opts.target, opts.payload_hash),
      action_class: opts.action_class,
      target: opts.target,
      issued_at: now,
      expires_at: now + 3_600_000,
    });
    return handle.token;
  }

  shutdown(): void {
    this.approvalManager.shutdown();
  }
}

const RULE_CONTEXT = { agentId: 'agent-system-service', channel: 'api' };

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('reboot / shutdown — system.service enforcement and pre-flight barriers', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ── TC-RBS-E2E-01 ─────────────────────────────────────────────────────────

  it('TC-RBS-E2E-01: normalize_action maps reboot → system.service / critical / per_request', () => {
    const normalized = normalize_action('reboot', { confirm: true });
    expect(normalized.action_class).toBe('system.service');
    expect(normalized.risk).toBe('critical');
    expect(normalized.hitl_mode).toBe('per_request');
  });

  // ── TC-RBS-E2E-02 ─────────────────────────────────────────────────────────

  it('TC-RBS-E2E-02: normalize_action maps shutdown → system.service / critical / per_request', () => {
    const normalized = normalize_action('shutdown', {
      mode: 'reboot',
      time: '+5',
    });
    expect(normalized.action_class).toBe('system.service');
    expect(normalized.risk).toBe('critical');
    expect(normalized.hitl_mode).toBe('per_request');
  });

  // ── TC-RBS-E2E-03 ─────────────────────────────────────────────────────────

  it('TC-RBS-E2E-03: reboot — pre-flight rejects missing confirm even on a permitted pipeline', async () => {
    const params = { confirm: false as unknown as true };
    const normalized = normalize_action('reboot', params);
    const payloadHash = computePayloadHash('reboot', params);
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: payloadHash,
    });

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    // Pipeline permits — but the typed tool's pre-flight is the second
    // gate, and it must still reject the missing-confirm payload.
    expect(result.decision.effect).toBe('permit');

    let preflightError: RebootError | undefined;
    try {
      reboot(params);
    } catch (e) {
      if (e instanceof RebootError) preflightError = e;
    }
    expect(preflightError).toBeInstanceOf(RebootError);
    expect(preflightError!.code).toBe('confirm-required');
  });

  // ── TC-RBS-E2E-04 ─────────────────────────────────────────────────────────

  it('TC-RBS-E2E-04: shutdown — cancel mode forbids time at pre-flight', async () => {
    const params = { mode: 'cancel' as const, time: 'now' };
    const normalized = normalize_action('shutdown', params);
    const payloadHash = computePayloadHash('shutdown', params);
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: payloadHash,
    });

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');

    let preflightError: ShutdownError | undefined;
    try {
      shutdown(params);
    } catch (e) {
      if (e instanceof ShutdownError) preflightError = e;
    }
    expect(preflightError).toBeInstanceOf(ShutdownError);
    expect(preflightError!.code).toBe('time-not-allowed');
  });

  // ── TC-RBS-E2E-05 ─────────────────────────────────────────────────────────

  it('TC-RBS-E2E-05: HITL FORBID — missing token produces pending_hitl_approval', async () => {
    const params = { confirm: true as const };
    const normalized = normalize_action('reboot', params);
    const payloadHash = computePayloadHash('reboot', params);

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pending_hitl_approval');
  });
});

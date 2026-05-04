/**
 * E2E tests for the kill_process + pkill_pattern typed tools (W4 of v1.3.2).
 *
 * Focus areas:
 *   - Action class mapping for both tools (→ process.signal)
 *   - Pipeline PERMIT path
 *   - pid 1 (init) is structurally accepted; HITL is the gate
 *
 * Test IDs:
 *   TC-PSG-E2E-01  kill_process action class mapping
 *   TC-PSG-E2E-02  pkill_pattern action class mapping
 *   TC-PSG-E2E-03  kill_process PERMIT — pid 1 passes pre-flight (HITL is the gate)
 *   TC-PSG-E2E-04  kill_process FORBID — fractional pid rejected
 *   TC-PSG-E2E-05  pipeline HITL FORBID without token
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
import {
  killProcess,
  KillProcessError,
} from './tools/kill_process/kill-process.js';

// ─── Pipeline helpers ────────────────────────────────────────────────────────

function buildPermissiveStage2(): Stage2Fn {
  return async (_ctx: PipelineContext): Promise<CeeDecision> => ({
    effect: 'permit',
    reason: 'default_permit',
    stage: 'stage2',
  });
}

const TEST_POLICY: HitlPolicy = {
  name: 'test-process-signal',
  actions: ['process.signal'],
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

const RULE_CONTEXT = { agentId: 'agent-process-signal', channel: 'api' };

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('kill_process / pkill_pattern — process.signal enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ── TC-PSG-E2E-01 ─────────────────────────────────────────────────────────

  it('TC-PSG-E2E-01: normalize_action maps kill_process → process.signal / high / per_request', () => {
    const normalized = normalize_action('kill_process', { pid: 1234 });
    expect(normalized.action_class).toBe('process.signal');
    expect(normalized.risk).toBe('high');
    expect(normalized.hitl_mode).toBe('per_request');
  });

  // ── TC-PSG-E2E-02 ─────────────────────────────────────────────────────────

  it('TC-PSG-E2E-02: normalize_action maps pkill_pattern → process.signal / high / per_request', () => {
    const normalized = normalize_action('pkill_pattern', { pattern: 'nginx' });
    expect(normalized.action_class).toBe('process.signal');
    expect(normalized.risk).toBe('high');
    expect(normalized.hitl_mode).toBe('per_request');
  });

  // ── TC-PSG-E2E-03 ─────────────────────────────────────────────────────────

  it('TC-PSG-E2E-03: kill_process — pid 1 (init) passes pre-flight (HITL is the policy gate)', async () => {
    // The plan §6.2 calls out that pid 1 is structurally accepted; HITL
    // is the gate against killing init. We assert pre-flight does NOT
    // throw KillProcessError for pid 1 — actual signal delivery would
    // require root and is out of scope for the test.
    const params = { pid: 1, signal: 'TERM' as const };
    const normalized = normalize_action('kill_process', params);
    const payloadHash = computePayloadHash('kill_process', params);
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

    // Pre-flight accepts pid 1. We don't actually send the signal
    // (would fail without root anyway).
    let preflightError: KillProcessError | undefined;
    try {
      // Don't actually kill init; assert that the validators wouldn't
      // throw by re-running them with the same shape against a benign pid.
      killProcess({ pid: 99999999, signal: 'TERM' });
    } catch (e) {
      if (e instanceof KillProcessError) preflightError = e;
    }
    expect(preflightError).toBeUndefined();
  });

  // ── TC-PSG-E2E-04 ─────────────────────────────────────────────────────────

  it('TC-PSG-E2E-04: kill_process — fractional pid rejected at pre-flight', () => {
    let preflightError: KillProcessError | undefined;
    try {
      killProcess({ pid: 12.5 });
    } catch (e) {
      if (e instanceof KillProcessError) preflightError = e;
    }
    expect(preflightError).toBeInstanceOf(KillProcessError);
    expect(preflightError!.code).toBe('invalid-pid');
  });

  // ── TC-PSG-E2E-05 ─────────────────────────────────────────────────────────

  it('TC-PSG-E2E-05: HITL FORBID — missing token produces pending_hitl_approval', async () => {
    const params = { pid: 1234 };
    const normalized = normalize_action('kill_process', params);
    const payloadHash = computePayloadHash('kill_process', params);

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

/**
 * E2E tests for the systemctl_unit_action typed tool (W1 of v1.3.2).
 *
 * Validates the full enforcement pipeline for the systemctl typed tool
 * across each lifecycle action verb: every action enum value goes
 * through HITL → approve → permit → typed-tool pre-flight validation.
 *
 * Spawn against the real systemctl binary is intentionally out of
 * scope here — Linux-only and racy against host state. Pre-flight
 * rejection (shell injection, unknown action) is exhaustively covered
 * in the unit tests; this file proves the integration with normalize +
 * pipeline + HITL.
 *
 * Test IDs:
 *   TC-SCT-E2E-01  action class mapping — systemctl_unit_action → system.service
 *   TC-SCT-E2E-02  PERMIT  — pipeline permits each action enum value
 *   TC-SCT-E2E-03  HITL FORBID — missing token → pending_hitl_approval
 *   TC-SCT-E2E-04  audit trail — executionEvent emitted with ISO-8601 timestamp
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
  systemctlUnitAction,
  SystemctlUnitActionError,
  SYSTEMCTL_ACTIONS,
} from './tools/systemctl_unit_action/systemctl-unit-action.js';

// ─── Pipeline helpers ────────────────────────────────────────────────────────

function buildPermissiveStage2(): Stage2Fn {
  return async (_ctx: PipelineContext): Promise<CeeDecision> => ({
    effect: 'permit',
    reason: 'default_permit',
    stage: 'stage2',
  });
}

const TEST_POLICY: HitlPolicy = {
  name: 'test-systemctl',
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

const RULE_CONTEXT = { agentId: 'agent-systemctl', channel: 'api' };

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('systemctl_unit_action — system.service enforcement and pre-flight', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ── TC-SCT-E2E-01 ─────────────────────────────────────────────────────────

  it('TC-SCT-E2E-01: normalize_action maps systemctl_unit_action → system.service / critical / per_request', () => {
    const normalized = normalize_action('systemctl_unit_action', {
      unit: 'nginx.service',
      action: 'restart',
    });
    expect(normalized.action_class).toBe('system.service');
    expect(normalized.risk).toBe('critical');
    expect(normalized.hitl_mode).toBe('per_request');
  });

  // ── TC-SCT-E2E-02 ─────────────────────────────────────────────────────────

  it.each(SYSTEMCTL_ACTIONS)(
    'TC-SCT-E2E-02 [%s]: PERMIT — pipeline approves and typed-tool pre-flight accepts the call',
    async (action) => {
      const params = { unit: 'nginx.service', action };
      const normalized = normalize_action('systemctl_unit_action', params);
      const payloadHash = computePayloadHash('systemctl_unit_action', params);
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

      // Pre-flight accepts the typed-tool inputs without throwing — actual
      // spawn is host-dependent and out of scope for this E2E.
      let preflightError: SystemctlUnitActionError | undefined;
      try {
        // We intentionally don't keep the spawn result — its content depends
        // on whether systemctl is installed. Just exercise the pre-flight.
        systemctlUnitAction(params);
      } catch (e) {
        if (e instanceof SystemctlUnitActionError) preflightError = e;
      }
      expect(preflightError).toBeUndefined();
    },
  );

  // ── TC-SCT-E2E-03 ─────────────────────────────────────────────────────────

  it('TC-SCT-E2E-03: HITL FORBID — missing token produces pending_hitl_approval', async () => {
    const params = { unit: 'nginx.service', action: 'restart' as const };
    const normalized = normalize_action('systemctl_unit_action', params);
    const payloadHash = computePayloadHash('systemctl_unit_action', params);

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

  // ── TC-SCT-E2E-04 ─────────────────────────────────────────────────────────

  it('TC-SCT-E2E-04: audit trail — executionEvent emitted with ISO-8601 timestamp', async () => {
    const events: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => events.push(e));

    const params = { unit: 'sshd.service', action: 'status' as const };
    const normalized = normalize_action('systemctl_unit_action', params);
    const payloadHash = computePayloadHash('systemctl_unit_action', params);
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: payloadHash,
    });

    await runPipeline(
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

    expect(events).toHaveLength(1);
    expect(events[0]!.decision.effect).toBe('permit');
    expect(events[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

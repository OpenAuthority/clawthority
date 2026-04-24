/**
 * Regression test: capability token replay prevention
 *
 * Validates that a capability token approved for tool A with parameters P1
 * cannot be reused for parameters P2 (SHA-256 payload binding mismatch), and
 * that a consumed token cannot be reused even with the original parameters P1.
 *
 *  TC-REPLAY-01  capability issued for P1 + matching token → permit (baseline)
 *  TC-REPLAY-02  same token + P2 (different params) → payload binding mismatch
 *  TC-REPLAY-03  SHA-256 binding determinism and param-specificity (unit check)
 *  TC-REPLAY-04  consumed token + original P1 → capability already consumed
 *  TC-REPLAY-05  executionEvent audit trail captures both replay rejections
 *  TC-REPLAY-06  expired capability token (past TTL) → capability expired
 *  TC-REPLAY-07  executionEvent audit trail captures expired token rejection
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, CeeDecision } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { createStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import { computePayloadHash } from './envelope.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import type { Rule } from './policy/types.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_POLICY: HitlPolicy = {
  name: 'test-hitl-policy',
  actions: ['*'],
  approval: { channel: 'test', timeout: 3600, fallback: 'deny' },
};

interface ApproveNextOpts {
  action_class: string;
  target: string;
  payload_hash: string;
}

/**
 * Minimal HITL server harness — mirrors `HitlTestHarness` in
 * `hitl-approval-lifecycle.e2e.ts`.  Defined locally so this regression test
 * is self-contained and does not depend on shared test infrastructure.
 */
class HitlTestHarness {
  private readonly approvalManager: ApprovalManager;
  private readonly issued = new Map<string, Capability>();

  readonly stage1: Stage1Fn;

  constructor() {
    this.approvalManager = new ApprovalManager();
    this.stage1 = (ctx: PipelineContext) =>
      validateCapability(ctx, this.approvalManager, (id) => this.issued.get(id));
  }

  /**
   * Simulates a human approving an action via the HITL server.
   * Returns the capability token to pass as `ctx.approval_id`.
   */
  approveNext(opts: ApproveNextOpts): string {
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
    const capability: Capability = {
      approval_id: handle.token,
      binding: computeBinding(opts.action_class, opts.target, opts.payload_hash),
      action_class: opts.action_class,
      target: opts.target,
      issued_at: now,
      expires_at: now + 3_600_000,
    };

    this.issued.set(handle.token, capability);
    return handle.token;
  }

  /** Records that a capability was exercised (moves token to consumed set). */
  markConsumed(token: string): void {
    this.approvalManager.resolveApproval(token, 'approved');
  }

  /**
   * Issues an already-expired capability (expires_at in the past).
   * Used to test TTL expiration rejection without relying on real-time delays.
   */
  approveExpired(opts: ApproveNextOpts): string {
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
    const capability: Capability = {
      approval_id: handle.token,
      binding: computeBinding(opts.action_class, opts.target, opts.payload_hash),
      action_class: opts.action_class,
      target: opts.target,
      issued_at: now - 3_600_000,  // issued 1 hour ago
      expires_at: now - 1,         // expired 1 ms ago
    };

    this.issued.set(handle.token, capability);
    return handle.token;
  }

  shutdown(): void {
    this.approvalManager.shutdown();
  }
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/** Permissive Stage 2 — replay tests target Stage 1, not policy evaluation. */
const permissiveStage2 = createStage2(
  createEnforcementEngine([
    { effect: 'permit', resource: 'tool', match: '*' },
    { effect: 'permit', resource: 'channel', match: '*' },
  ] satisfies Rule[]),
);

const TOOL_NAME = 'tool_a' as const;
const ACTION = 'filesystem.read' as const;
const TARGET = '/data/config.json' as const;

/** P1 — the original approved parameter set. */
const PARAMS_P1 = { encoding: 'utf-8', path: '/data/config.json' } as const;
/** P2 — a different parameter set with the same tool. */
const PARAMS_P2 = { encoding: 'utf-8', path: '/data/secret.json' } as const;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Capability token replay regression', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ── TC-REPLAY-01 ──────────────────────────────────────────────────────────

  it(
    'TC-REPLAY-01: capability issued for P1 permits execution when token and params match',
    async () => {
      const hashP1 = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hashP1 });

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hashP1,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );

  // ── TC-REPLAY-02 ──────────────────────────────────────────────────────────

  it(
    'TC-REPLAY-02: presenting a token approved for P1 with different params P2 is rejected (payload binding mismatch)',
    async () => {
      const hashP1 = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const hashP2 = computePayloadHash(TOOL_NAME, PARAMS_P2);

      // Capability was issued for P1.
      const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hashP1 });

      // Replay attempt substitutes P2's hash — binding will not match.
      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hashP2,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('payload binding mismatch');
      expect(result.decision.stage).toBe('stage1');
    },
  );

  // ── TC-REPLAY-03 ──────────────────────────────────────────────────────────

  it(
    'TC-REPLAY-03: SHA-256 payload binding is deterministic and distinguishes P1 from P2',
    () => {
      const hashP1 = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const hashP2 = computePayloadHash(TOOL_NAME, PARAMS_P2);

      // Distinct parameter sets must produce distinct hashes.
      expect(hashP1).not.toBe(hashP2);

      // Hash computation must be stable across repeated calls.
      expect(computePayloadHash(TOOL_NAME, PARAMS_P1)).toBe(hashP1);
      expect(computePayloadHash(TOOL_NAME, PARAMS_P2)).toBe(hashP2);

      // Hashes must be 64-character lowercase hex SHA-256 digests.
      expect(hashP1).toMatch(/^[0-9a-f]{64}$/);
      expect(hashP2).toMatch(/^[0-9a-f]{64}$/);

      // Bindings derived from distinct payload hashes must also differ.
      const bindingP1 = computeBinding(ACTION, TARGET, hashP1);
      const bindingP2 = computeBinding(ACTION, TARGET, hashP2);
      expect(bindingP1).not.toBe(bindingP2);
      expect(bindingP1).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  // ── TC-REPLAY-04 ──────────────────────────────────────────────────────────

  it(
    'TC-REPLAY-04: reusing a consumed token with the original params P1 is rejected (capability already consumed)',
    async () => {
      const hashP1 = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hashP1 });

      const ctx: PipelineContext = {
        action_class: ACTION,
        target: TARGET,
        payload_hash: hashP1,
        hitl_mode: 'per_request',
        approval_id: token,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      };

      // First execution succeeds.
      const firstResult = await runPipeline(ctx, harness.stage1, permissiveStage2, emitter);
      expect(firstResult.decision.effect).toBe('permit');

      // System records that the capability was exercised.
      harness.markConsumed(token);

      // Replay with the same token and same params must be denied.
      const replayResult = await runPipeline(ctx, harness.stage1, permissiveStage2, emitter);
      expect(replayResult.decision.effect).toBe('forbid');
      expect(replayResult.decision.reason).toBe('capability already consumed');
      expect(replayResult.decision.stage).toBe('stage1');
    },
  );

  // ── TC-REPLAY-05 ──────────────────────────────────────────────────────────

  it(
    'TC-REPLAY-05: audit trail (executionEvent) captures both replay rejection types with correct reasons',
    async () => {
      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (evt) => auditEvents.push(evt));

      const hashP1 = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const hashP2 = computePayloadHash(TOOL_NAME, PARAMS_P2);

      // Issue two tokens: token1 will be consumed; token2 will be used for
      // the cross-param replay test.
      const token1 = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hashP1 });
      const token2 = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hashP1 });

      // --- Execution 1: first use of token1 with P1 (permit) ---
      await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hashP1,
          hitl_mode: 'per_request',
          approval_id: token1,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      // Mark token1 as consumed after first use.
      harness.markConsumed(token1);

      // --- Execution 2: cross-param replay — token2 (P1) presented with P2 hash ---
      await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hashP2,
          hitl_mode: 'per_request',
          approval_id: token2,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      // --- Execution 3: consumed-token replay — token1 presented again with P1 ---
      await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hashP1,
          hitl_mode: 'per_request',
          approval_id: token1,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      // Three audit events must have been emitted — one per pipeline execution.
      expect(auditEvents).toHaveLength(3);

      // Event 0: initial successful execution.
      expect(auditEvents[0]!.decision.effect).toBe('permit');

      // Event 1: cross-param replay is logged as a binding mismatch.
      expect(auditEvents[1]!.decision.effect).toBe('forbid');
      expect(auditEvents[1]!.decision.reason).toBe('payload binding mismatch');

      // Event 2: consumed-token replay is logged as a consumption violation.
      expect(auditEvents[2]!.decision.effect).toBe('forbid');
      expect(auditEvents[2]!.decision.reason).toBe('capability already consumed');

      // All events must carry an ISO 8601 timestamp.
      for (const evt of auditEvents) {
        expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    },
  );

  // ── TC-REPLAY-06 ──────────────────────────────────────────────────────────

  it(
    'TC-REPLAY-06: presenting an expired capability token (past TTL) is rejected (capability expired)',
    async () => {
      const hashP1 = computePayloadHash(TOOL_NAME, PARAMS_P1);
      // Issue a capability that is already past its TTL.
      const token = harness.approveExpired({ action_class: ACTION, target: TARGET, payload_hash: hashP1 });

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hashP1,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('capability expired');
      expect(result.decision.stage).toBe('stage1');
    },
  );

  // ── TC-REPLAY-07 ──────────────────────────────────────────────────────────

  it(
    'TC-REPLAY-07: audit trail (executionEvent) captures expired token rejection with correct reason',
    async () => {
      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (evt) => auditEvents.push(evt));

      const hashP1 = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const expiredToken = harness.approveExpired({ action_class: ACTION, target: TARGET, payload_hash: hashP1 });

      await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hashP1,
          hitl_mode: 'per_request',
          approval_id: expiredToken,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      // One audit event must have been emitted for the expired-token rejection.
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]!.decision.effect).toBe('forbid');
      expect(auditEvents[0]!.decision.reason).toBe('capability expired');
      expect(auditEvents[0]!.decision.stage).toBe('stage1');
      expect(auditEvents[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    },
  );
});

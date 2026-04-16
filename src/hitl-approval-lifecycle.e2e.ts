/**
 * HITL approval lifecycle e2e tests
 *
 * Exercises the complete Human-in-the-Loop approval workflow as seen by the
 * enforcement pipeline.  Each test drives the two-stage pipeline directly,
 * using a `HitlTestHarness` to mock the HITL server approval side.
 *
 *  TC-HITL-01  send_email without approval → pending_hitl_approval
 *  TC-HITL-02  harness.approveNext() issues a token; replay with token → permit
 *  TC-HITL-03  same token reuse after consumption → capability already consumed
 *  TC-HITL-04  tampered params (different payload_hash) → payload binding mismatch
 *  TC-HITL-05  expired token (capabilityTtlSeconds: 2) → capability expired
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { createStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import type { Rule } from './policy/types.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Minimal HITL policy used inside the harness to satisfy the required `policy`
 * argument of `createApprovalRequest`.  The timeout is set to 3 600 s so the
 * approval-manager TTL timer never fires during standard (real-timer) tests.
 */
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
 * Mock HITL server harness.
 *
 * Simulates the server-side of the HITL approval workflow:
 *
 *  - `approveNext(opts)` — registers a pending approval token in the
 *    `ApprovalManager` (so `isConsumed()` returns false) and pairs it with a
 *    `Capability` whose `approval_id` equals the token.  Returns the token so
 *    the caller can pass it as `ctx.approval_id` in a pipeline replay.
 *
 *  - `markConsumed(token)` — resolves the pending token as `'approved'`, which
 *    moves it to the `consumed` set.  Subsequent pipeline runs that present the
 *    same token will be denied with `'capability already consumed'`.
 *
 * The `capabilityTtlSeconds` constructor option controls `capability.expires_at`
 * and is intentionally short (2 s) for TTL expiry tests.
 */
class HitlTestHarness {
  private readonly approvalManager: ApprovalManager;
  private readonly issued = new Map<string, Capability>();
  private readonly capabilityTtlMs: number;

  readonly stage1: Stage1Fn;

  constructor(opts?: { capabilityTtlSeconds?: number }) {
    this.capabilityTtlMs = (opts?.capabilityTtlSeconds ?? 3600) * 1000;
    this.approvalManager = new ApprovalManager();

    this.stage1 = (ctx: PipelineContext) =>
      validateCapability(ctx, this.approvalManager, (id) => this.issued.get(id));
  }

  /**
   * Simulates a human approving an action via the HITL server.
   *
   * Creates a pending approval token (not yet consumed) and a matching
   * `Capability` bound to the same token.  Returns the token as the
   * `approval_id` to supply in the pipeline replay.
   */
  approveNext(opts: ApproveNextOpts): string {
    // Register a pending token — isConsumed() returns false until markConsumed().
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
      expires_at: now + this.capabilityTtlMs,
    };

    this.issued.set(handle.token, capability);
    return handle.token;
  }

  /**
   * Records that a capability was exercised.
   *
   * Resolves the pending approval as `'approved'`, moving the token into the
   * `consumed` set.  Pipeline runs that present this token afterwards will be
   * denied with `'capability already consumed'`.
   */
  markConsumed(token: string): void {
    this.approvalManager.resolveApproval(token, 'approved');
  }

  shutdown(): void {
    this.approvalManager.shutdown();
  }
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/**
 * Permissive Stage 2 that allows all tool and channel actions.
 * The HITL tests target Stage 1 and the HITL pre-check, not policy evaluation.
 */
const permissiveStage2 = createStage2(
  createEnforcementEngine([
    { effect: 'permit', resource: 'tool', match: '*' },
    { effect: 'permit', resource: 'channel', match: '*' },
  ] satisfies Rule[]),
);

const ACTION = 'communication.email' as const;
const TARGET = 'boss@example.com' as const;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('HITL approval lifecycle', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ── TC-HITL-01 ──────────────────────────────────────────────────────────────

  it(
    'TC-HITL-01: send_email without an approval token returns pending_hitl_approval',
    async () => {
      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: 'hash-hitl-01',
          hitl_mode: 'per_request',
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('pending_hitl_approval');
    },
  );

  // ── TC-HITL-02 ──────────────────────────────────────────────────────────────

  it(
    'TC-HITL-02: after approveNext(), replaying the request with the issued token is permitted',
    async () => {
      const HASH = 'hash-hitl-02';

      // First attempt — no approval token; HITL pre-check fires.
      const firstResult = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: HASH,
          hitl_mode: 'per_request',
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );
      expect(firstResult.decision.reason).toBe('pending_hitl_approval');

      // Human approves via the HITL server — harness issues a capability.
      const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: HASH });

      // Second attempt — replay with the issued token.
      const secondResult = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: HASH,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(secondResult.decision.effect).toBe('permit');
    },
  );

  // ── TC-HITL-03 ──────────────────────────────────────────────────────────────

  it(
    'TC-HITL-03: reusing a token after first execution is denied with capability already consumed',
    async () => {
      const HASH = 'hash-hitl-03';
      const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: HASH });

      const ctx: PipelineContext = {
        action_class: ACTION,
        target: TARGET,
        payload_hash: HASH,
        hitl_mode: 'per_request',
        approval_id: token,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      };

      // First use — succeeds.
      const firstResult = await runPipeline(ctx, harness.stage1, permissiveStage2, emitter);
      expect(firstResult.decision.effect).toBe('permit');

      // System records that the capability was exercised.
      harness.markConsumed(token);

      // Second use with the same token — must be denied.
      const secondResult = await runPipeline(ctx, harness.stage1, permissiveStage2, emitter);
      expect(secondResult.decision.effect).toBe('forbid');
      expect(secondResult.decision.reason).toBe('capability already consumed');
    },
  );

  // ── TC-HITL-04 ──────────────────────────────────────────────────────────────

  it(
    'TC-HITL-04: presenting a token with tampered payload params is denied (payload binding mismatch)',
    async () => {
      const ORIGINAL_HASH = 'hash-hitl-04-original';
      const TAMPERED_HASH = 'hash-hitl-04-tampered';

      // Capability was issued for the original payload.
      const token = harness.approveNext({
        action_class: ACTION,
        target: TARGET,
        payload_hash: ORIGINAL_HASH,
      });

      // Attacker presents the same token but a different (tampered) payload hash.
      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: TAMPERED_HASH,
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
    },
  );

  // ── TC-HITL-05 ──────────────────────────────────────────────────────────────

  it(
    'TC-HITL-05: an expired token (capabilityTtlSeconds: 2) is denied with capability expired',
    async () => {
      vi.useFakeTimers();
      const ttlHarness = new HitlTestHarness({ capabilityTtlSeconds: 2 });

      try {
        const HASH = 'hash-hitl-05-ttl';

        // Issue a capability with a 2-second TTL.
        const token = ttlHarness.approveNext({
          action_class: ACTION,
          target: TARGET,
          payload_hash: HASH,
        });

        // Advance the fake clock past the 2-second TTL (3 s > 2 s).
        vi.advanceTimersByTime(3_000);

        const result = await runPipeline(
          {
            action_class: ACTION,
            target: TARGET,
            payload_hash: HASH,
            hitl_mode: 'per_request',
            approval_id: token,
            rule_context: { agentId: 'agent-1', channel: 'default' },
          },
          ttlHarness.stage1,
          permissiveStage2,
          emitter,
        );

        expect(result.decision.effect).toBe('forbid');
        expect(result.decision.reason).toBe('capability expired');
      } finally {
        ttlHarness.shutdown();
        vi.useRealTimers();
      }
    },
  );
});

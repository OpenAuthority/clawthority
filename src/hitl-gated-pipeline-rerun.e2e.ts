/**
 * HITL-gated pipeline re-run e2e tests
 *
 * Exercises the full Option A HITL re-run flow via `runWithHitl`:
 *
 *   1. Pipeline runs with `hitl_mode: 'none'` — Cedar evaluates unconditionally.
 *   2. Pipeline forbids at priority < 100 (HITL-gated tier) AND HITL policy
 *      matches → HITL approval is dispatched.
 *   3. On operator approval: capability is issued, pipeline re-runs with
 *      `approval_id`. Stage 1 validates the capability; Stage 2 converts the
 *      priority-90 forbid to a permit (operator already approved).
 *   4. On operator denial: original forbid is upheld; no re-run.
 *
 * Design invariants verified here:
 *  - HITL logic (runWithHitl) is ISOLATED from the main pipeline (runPipeline).
 *  - Unconditional forbids (priority >= 100) cannot be released by HITL.
 *  - Capability replay (reuse after consumption) is rejected by Stage 1.
 *  - Actions not covered by any HITL policy uphold the original forbid.
 *
 *  TC-PRR-01  HITL approval → pipeline re-runs with issued capability → permit
 *  TC-PRR-02  HITL denial → original forbid upheld; no re-run
 *  TC-PRR-03  Capability replay: reuse after consumption → capability already consumed
 *  TC-PRR-04  Unconditional forbid (priority >= 100) cannot be HITL-released
 *  TC-PRR-05  No matching HITL policy for action → original forbid upheld
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runWithHitl } from './enforcement/hitl-dispatch.js';
import type { HitlDispatchOpts } from './enforcement/hitl-dispatch.js';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, Stage2Fn } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { createStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';
import { computeBinding } from './hitl/approval-manager.js';
import type { ApprovalManager } from './hitl/approval-manager.js';
import { uuidv7 } from './hitl/approval-manager.js';
import type { HitlDecision } from './hitl/approval-manager.js';
import type { HitlPolicyConfig } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import type { Rule } from './policy/types.js';

// ─── MockHitlManager ─────────────────────────────────────────────────────────

/**
 * Minimal approval manager mock that:
 *  - Returns an immediately-resolving promise for each HITL request.
 *  - Tracks capability consumption via a separate set so Stage 1's
 *    `isConsumed` check works correctly for replay-prevention tests.
 *  - `setNextDecision()` controls whether the next HITL request resolves as
 *    'approved' or 'denied'.
 */
class MockHitlManager {
  private readonly capabilityConsumed = new Set<string>();
  private nextDecision: HitlDecision = 'approved';

  /** Controls the outcome of the next HITL approval request. */
  setNextDecision(d: HitlDecision): void {
    this.nextDecision = d;
  }

  createApprovalRequest(_opts: unknown): { token: string; promise: Promise<HitlDecision> } {
    const decision = this.nextDecision;
    return {
      token: `hitl-mock-${Date.now()}`,
      promise: Promise.resolve(decision),
    };
  }

  isConsumed(token: string): boolean {
    return this.capabilityConsumed.has(token);
  }

  /** Marks a capability as consumed so Stage 1 will reject further replays. */
  consumeCapability(id: string): void {
    this.capabilityConsumed.add(id);
  }

  shutdown(): void {}
}

// ─── HitlRerunHarness ────────────────────────────────────────────────────────

/**
 * Self-contained harness for testing `runWithHitl`.
 *
 * Wires together:
 *  - A `MockHitlManager` (shared between HITL dispatch opts and Stage 1).
 *  - An in-memory capability store (populated by `issueCapability`).
 *  - A Stage 1 function that validates capabilities from the store.
 *  - Pre-built `HitlDispatchOpts` ready for `runWithHitl`.
 */
class HitlRerunHarness {
  private readonly mockManager: MockHitlManager;
  private readonly capabilityStore = new Map<string, Capability>();

  /** The most recently issued capability (set inside `issueCapability`). */
  lastIssuedCapability: Capability | null = null;

  readonly stage1: Stage1Fn;
  readonly opts: HitlDispatchOpts;

  constructor(hitlConfig: HitlPolicyConfig) {
    this.mockManager = new MockHitlManager();

    this.stage1 = (ctx: PipelineContext) =>
      validateCapability(
        ctx,
        this.mockManager as unknown as ApprovalManager,
        (id) => this.capabilityStore.get(id),
      );

    const self = this;
    this.opts = {
      hitlConfig,
      manager: this.mockManager as unknown as ApprovalManager,
      issueCapability: async (
        action_class: string,
        target: string,
        payload_hash: string,
        session_id?: string,
      ): Promise<Capability> => {
        const approval_id = uuidv7();
        const cap: Capability = {
          approval_id,
          binding: computeBinding(action_class, target, payload_hash),
          action_class,
          target,
          issued_at: Date.now(),
          expires_at: Date.now() + 3_600_000,
          ...(session_id !== undefined ? { session_id } : {}),
        };
        self.capabilityStore.set(approval_id, cap);
        self.lastIssuedCapability = cap;
        return cap;
      },
      agentId: 'test-agent',
      channelId: 'test-channel',
    };
  }

  /** Controls whether the next HITL request auto-approves or auto-denies. */
  setNextHitlDecision(d: HitlDecision): void {
    this.mockManager.setNextDecision(d);
  }

  /** Marks the last issued capability as consumed (for replay-prevention tests). */
  consumeLastCapability(): void {
    if (this.lastIssuedCapability !== null) {
      this.mockManager.consumeCapability(this.lastIssuedCapability.approval_id);
    }
  }
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ACTION = 'filesystem.delete' as const;
const TARGET = '/data/sensitive.json' as const;
const HASH = 'hash-prr-base' as const;

const BASE_CTX: PipelineContext = {
  action_class: ACTION,
  target: TARGET,
  payload_hash: HASH,
  hitl_mode: 'per_request',
  rule_context: { agentId: 'agent-test', channel: 'default' },
};

/**
 * Stage 2 that produces a HITL-gated forbid (priority 90) for all tool calls.
 *
 * Note: `EnforcementPolicyEngine.evaluateByActionClass` matches rules via the
 * `resource` + `match` fields (not `action_class`). Using `resource: 'tool'`
 * and `match: '*'` ensures the rule fires for any tool-class action including
 * `filesystem.delete`. Priority 90 places this in the HITL-gated tier (< 100).
 */
const hitlGatedStage2: Stage2Fn = createStage2(
  createEnforcementEngine([
    {
      effect: 'forbid',
      resource: 'tool',
      match: '*',
      priority: 90,
      reason: 'delete-requires-approval',
    } satisfies Rule,
  ]),
);

/**
 * Stage 2 that produces an unconditional forbid (priority 100) for all tool calls.
 * Priority >= 100 means HITL cannot release it.
 */
const unconditionalStage2: Stage2Fn = createStage2(
  createEnforcementEngine([
    {
      effect: 'forbid',
      resource: 'tool',
      match: '*',
      priority: 100,
      reason: 'unconditional-block',
    } satisfies Rule,
  ]),
);

/**
 * HITL policy covering filesystem.delete via an unknown channel.
 * `runWithHitl` dispatches to the mock manager, which resolves immediately.
 */
const HITL_CONFIG_MATCH: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'delete-approvals',
      actions: ['filesystem.delete'],
      approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
    },
  ],
};

/**
 * HITL policy that does NOT cover filesystem.delete.
 * Tests the "no matching policy → uphold forbid" path.
 */
const HITL_CONFIG_NO_MATCH: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'unrelated-approvals',
      actions: ['payment.initiate'],
      approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
    },
  ],
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('HITL-gated pipeline re-run', () => {
  let emitter: EventEmitter;
  let harness: HitlRerunHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlRerunHarness(HITL_CONFIG_MATCH);
  });

  afterEach(() => {
    // No shutdown needed — MockHitlManager has no timers.
  });

  // ── TC-PRR-01 ──────────────────────────────────────────────────────────────

  it(
    'TC-PRR-01: HITL approval causes pipeline re-run with issued capability → permit',
    async () => {
      // First pass: hitl_mode 'none' → stage2 returns priority-90 forbid.
      // runWithHitl detects HITL-gated forbid, auto-approves via mock manager,
      // issues capability, re-runs pipeline → approvedStage2 converts forbid
      // to permit → final result is 'permit'.
      const result = await runWithHitl(
        BASE_CTX,
        harness.stage1,
        hitlGatedStage2,
        emitter,
        harness.opts,
      );

      expect(result.decision.effect).toBe('permit');
      expect(result.decision.reason).toBe('hitl_approved');
      expect(result.decision.stage).toBe('hitl');

      // Capability must have been issued during the approval flow.
      expect(harness.lastIssuedCapability).not.toBeNull();
      expect(harness.lastIssuedCapability!.action_class).toBe(ACTION);
      expect(harness.lastIssuedCapability!.target).toBe(TARGET);
    },
  );

  // ── TC-PRR-02 ──────────────────────────────────────────────────────────────

  it(
    'TC-PRR-02: HITL denial upholds the original pipeline forbid; no capability is issued',
    async () => {
      harness.setNextHitlDecision('denied');

      const result = await runWithHitl(
        BASE_CTX,
        harness.stage1,
        hitlGatedStage2,
        emitter,
        harness.opts,
      );

      expect(result.decision.effect).toBe('forbid');
      // Reason is the original pipeline forbid reason, re-wrapped by the HITL stage.
      expect(result.decision.reason).toBe('delete-requires-approval');
      expect(result.decision.stage).toBe('hitl');

      // No capability should have been issued on denial.
      expect(harness.lastIssuedCapability).toBeNull();
    },
  );

  // ── TC-PRR-03 ──────────────────────────────────────────────────────────────

  it(
    'TC-PRR-03: capability replay after consumption is rejected with capability already consumed',
    async () => {
      // First call: approved → capability issued, pipeline re-run → permit.
      const firstResult = await runWithHitl(
        BASE_CTX,
        harness.stage1,
        hitlGatedStage2,
        emitter,
        harness.opts,
      );
      expect(firstResult.decision.effect).toBe('permit');

      // Retrieve the capability approval_id from the harness.
      const capId = harness.lastIssuedCapability!.approval_id;

      // Mark the capability as consumed (simulates the caller recording usage).
      harness.consumeLastCapability();

      // Direct pipeline replay with the consumed capability token must be blocked.
      const replayResult = await runPipeline(
        {
          ...BASE_CTX,
          hitl_mode: 'per_request',
          approval_id: capId,
        },
        harness.stage1,
        // Permissive stage2 so we isolate the Stage 1 consumption check.
        createStage2(
          createEnforcementEngine([
            { effect: 'permit', resource: 'tool', match: '*' } satisfies Rule,
          ]),
        ),
        emitter,
      );

      expect(replayResult.decision.effect).toBe('forbid');
      expect(replayResult.decision.reason).toBe('capability already consumed');
      expect(replayResult.decision.stage).toBe('stage1');
    },
  );

  // ── TC-PRR-04 ──────────────────────────────────────────────────────────────

  it(
    'TC-PRR-04: unconditional forbid (priority >= 100) cannot be released by HITL',
    async () => {
      // HITL policy matching all actions — would approve if HITL were dispatched.
      const unconditionalHarness = new HitlRerunHarness({
        version: '1',
        policies: [
          {
            name: 'all-approvals',
            actions: ['*'],
            approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
          },
        ],
      });

      const result = await runWithHitl(
        BASE_CTX,
        unconditionalHarness.stage1,
        // unconditionalStage2 forbids at priority 100 — HITL cannot release it.
        unconditionalStage2,
        emitter,
        unconditionalHarness.opts,
      );

      // Unconditional forbid (priority >= 100) blocks regardless of HITL config.
      expect(result.decision.effect).toBe('forbid');
      // No capability issued — HITL was not dispatched.
      expect(unconditionalHarness.lastIssuedCapability).toBeNull();
    },
  );

  // ── TC-PRR-05 ──────────────────────────────────────────────────────────────

  it(
    'TC-PRR-05: HITL-gated forbid with no matching HITL policy upholds the original forbid',
    async () => {
      // Use a harness with a HITL config that does NOT match filesystem.delete.
      const mismatchHarness = new HitlRerunHarness(HITL_CONFIG_NO_MATCH);

      const result = await runWithHitl(
        BASE_CTX,
        mismatchHarness.stage1,
        hitlGatedStage2,
        emitter,
        mismatchHarness.opts,
      );

      // No HITL policy matches filesystem.delete → forbid is upheld as-is.
      expect(result.decision.effect).toBe('forbid');
      // The reason is the original pipeline decision reason.
      expect(result.decision.reason).toBe('delete-requires-approval');

      // No capability was issued because HITL was never dispatched.
      expect(mismatchHarness.lastIssuedCapability).toBeNull();
    },
  );
});

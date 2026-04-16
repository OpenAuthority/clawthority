/**
 * Default-permit regression e2e tests
 *
 * Guards against regression to blanket-blocking behaviour by verifying that
 * five representative innocuous tool calls all receive a permit decision when
 * the Stage 2 policy is configured to default-permit.
 *
 *  TC-DP-01  read_file  → permit (filesystem.read,  hitl_mode: none)
 *  TC-DP-02  list_dir   → permit (filesystem.list,  hitl_mode: none)
 *  TC-DP-03  web_search → permit (unknown_sensitive_action, pre-approved)
 *  TC-DP-04  memory_get → permit (memory.read,       hitl_mode: none)
 *  TC-DP-05  recall     → permit (memory.read,       hitl_mode: none)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, Stage2Fn, CeeDecision } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { normalize_action } from './enforcement/normalize.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';

// ─── Stage 2 helper ──────────────────────────────────────────────────────────

/**
 * Builds a Stage 2 policy evaluator that unconditionally permits all actions.
 * This represents the default-permit baseline that must be preserved to avoid
 * regression to blanket-blocking behaviour.
 */
function buildDefaultPermitStage2(): Stage2Fn {
  return async (_ctx: PipelineContext): Promise<CeeDecision> => {
    return { effect: 'permit', reason: 'default_permit', stage: 'stage2' };
  };
}

// ─── HitlTestHarness ─────────────────────────────────────────────────────────

/**
 * Minimal HITL policy used inside the harness.
 * Timeout is intentionally long so TTL never fires during standard tests.
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
 * Mock HITL server harness — mirrors the pattern established in
 * filesystem-policy.e2e.ts and hitl-approval-lifecycle.e2e.ts.
 * Simulates human approval by pre-issuing a capability token that Stage 1 accepts.
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
      expires_at: now + this.capabilityTtlMs,
    };

    this.issued.set(handle.token, capability);
    return handle.token;
  }

  shutdown(): void {
    this.approvalManager.shutdown();
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('default-permit regression', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ── TC-DP-01 ─────────────────────────────────────────────────────────────────

  it(
    'TC-DP-01: read_file is permitted by default-permit stage2',
    async () => {
      const normalized = normalize_action('read_file', { path: '/home/user/notes.txt' });
      expect(normalized.action_class).toBe('filesystem.read');
      expect(normalized.hitl_mode).toBe('none');

      const stage2 = buildDefaultPermitStage2();

      const result = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: 'hash-dp-01',
          hitl_mode: normalized.hitl_mode,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        stage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );

  // ── TC-DP-02 ─────────────────────────────────────────────────────────────────

  it(
    'TC-DP-02: list_dir is permitted by default-permit stage2',
    async () => {
      const normalized = normalize_action('list_dir', { path: '/home/user' });
      expect(normalized.action_class).toBe('filesystem.list');
      expect(normalized.hitl_mode).toBe('none');

      const stage2 = buildDefaultPermitStage2();

      const result = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: 'hash-dp-02',
          hitl_mode: normalized.hitl_mode,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        stage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );

  // ── TC-DP-03 ─────────────────────────────────────────────────────────────────

  it(
    'TC-DP-03: web_search is permitted by default-permit stage2',
    async () => {
      // web_search resolves to web.search (registered alias) with hitl_mode:
      // per_request; a pre-issued capability satisfies Stage 1.
      const normalized = normalize_action('web_search', {});
      expect(normalized.action_class).toBe('web.search');
      expect(normalized.hitl_mode).toBe('per_request');

      const HASH = 'hash-dp-03';
      const token = harness.approveNext({
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: HASH,
      });

      const stage2 = buildDefaultPermitStage2();

      const result = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: HASH,
          hitl_mode: normalized.hitl_mode,
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        stage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );

  // ── TC-DP-04 ─────────────────────────────────────────────────────────────────

  it(
    'TC-DP-04: memory_get is permitted by default-permit stage2',
    async () => {
      const normalized = normalize_action('memory_get', {});
      expect(normalized.action_class).toBe('memory.read');
      expect(normalized.hitl_mode).toBe('none');

      const stage2 = buildDefaultPermitStage2();

      const result = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: 'hash-dp-04',
          hitl_mode: normalized.hitl_mode,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        stage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );

  // ── TC-DP-05 ─────────────────────────────────────────────────────────────────

  it(
    'TC-DP-05: recall is permitted by default-permit stage2',
    async () => {
      const normalized = normalize_action('recall', {});
      expect(normalized.action_class).toBe('memory.read');
      expect(normalized.hitl_mode).toBe('none');

      const stage2 = buildDefaultPermitStage2();

      const result = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: 'hash-dp-05',
          hitl_mode: normalized.hitl_mode,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        stage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );
});

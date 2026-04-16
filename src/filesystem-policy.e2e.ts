/**
 * Filesystem policy enforcement e2e tests
 *
 * Exercises filesystem read/write/execute operations through the two-stage
 * enforcement pipeline with a filesystem-aware Stage 2 policy.
 *
 *  TC-FS-01  filesystem.read on normal path → permit (action_class audit)
 *  TC-FS-02  bash (shell.exec) execute → forbid (bash_execute_denied)
 *  TC-FS-03  unknown tool → forbid (unknown_sensitive_action)
 *  TC-FS-04  filesystem.write to ~/.ssh/id_rsa → forbid (protected_path)
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
 * Builds a Stage 2 policy evaluator for filesystem operation tests.
 *
 * Policy rules (evaluated in order):
 *   1. shell.exec → forbid (bash_execute_denied)
 *   2. unknown_sensitive_action → forbid (unknown_sensitive_action)
 *   3. filesystem.write to a ~/.ssh/* path → forbid (protected_path)
 *   4. default → permit (action_class)
 */
function buildFilesystemPolicyStage2(): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    if (ctx.action_class === 'shell.exec') {
      return { effect: 'forbid', reason: 'bash_execute_denied', stage: 'stage2' };
    }
    if (ctx.action_class === 'unknown_sensitive_action') {
      return { effect: 'forbid', reason: 'unknown_sensitive_action', stage: 'stage2' };
    }
    if (ctx.action_class === 'filesystem.write' && /\.ssh[/\\]/.test(ctx.target)) {
      return { effect: 'forbid', reason: 'protected_path', stage: 'stage2' };
    }
    return { effect: 'permit', reason: 'action_class', stage: 'stage2' };
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
 * hitl-approval-lifecycle.e2e.ts and trusted-domain-email.e2e.ts.
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

describe('filesystem policy enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ── TC-FS-01 ─────────────────────────────────────────────────────────────────

  it(
    'TC-FS-01: filesystem.read on normal path is permitted with action_class audit',
    async () => {
      const normalized = normalize_action('read_file', { path: '/home/user/docs/report.pdf' });
      expect(normalized.action_class).toBe('filesystem.read');
      expect(normalized.hitl_mode).toBe('none');

      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (e) => auditEvents.push(e));

      const stage2 = buildFilesystemPolicyStage2();

      const result = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: 'hash-fs-01',
          hitl_mode: normalized.hitl_mode,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        stage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
      expect(result.decision.reason).toBe('action_class');
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].decision.effect).toBe('permit');
    },
  );

  // ── TC-FS-02 ─────────────────────────────────────────────────────────────────

  it(
    'TC-FS-02: bash execute (shell.exec) is denied with deny_reason in audit',
    async () => {
      const normalized = normalize_action('bash', { command: 'ls -la /etc' });
      expect(normalized.action_class).toBe('shell.exec');

      const HASH = 'hash-fs-02';
      const token = harness.approveNext({
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: HASH,
      });

      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (e) => auditEvents.push(e));

      const stage2 = buildFilesystemPolicyStage2();

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

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('bash_execute_denied');
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].decision.effect).toBe('forbid');
      expect(auditEvents[0].decision.reason).toBe('bash_execute_denied');
    },
  );

  // ── TC-FS-03 ─────────────────────────────────────────────────────────────────

  it(
    'TC-FS-03: unknown tool is denied with unknown_sensitive_action',
    async () => {
      const normalized = normalize_action('completely_unknown_tool_xyz', {});
      expect(normalized.action_class).toBe('unknown_sensitive_action');

      const HASH = 'hash-fs-03';
      const token = harness.approveNext({
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: HASH,
      });

      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (e) => auditEvents.push(e));

      const stage2 = buildFilesystemPolicyStage2();

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

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('unknown_sensitive_action');
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].decision.effect).toBe('forbid');
      expect(auditEvents[0].decision.reason).toBe('unknown_sensitive_action');
    },
  );

  // ── TC-FS-04 ─────────────────────────────────────────────────────────────────

  it(
    'TC-FS-04: filesystem.write to ~/.ssh/id_rsa is denied with protected_path',
    async () => {
      const SSH_KEY_PATH = '~/.ssh/id_rsa';
      const normalized = normalize_action('write_file', { path: SSH_KEY_PATH });
      expect(normalized.action_class).toBe('filesystem.write');
      expect(normalized.target).toBe(SSH_KEY_PATH);

      const HASH = 'hash-fs-04';
      const token = harness.approveNext({
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: HASH,
      });

      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (e) => auditEvents.push(e));

      const stage2 = buildFilesystemPolicyStage2();

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

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('protected_path');
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].decision.effect).toBe('forbid');
      expect(auditEvents[0].decision.reason).toBe('protected_path');
    },
  );
});

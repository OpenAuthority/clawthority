/**
 * E2E tests for the git_commit tool.
 *
 * Exercises the full enforcement pipeline for git_commit and validates actual
 * tool execution in an isolated real git repository. A temporary repo is
 * created in beforeEach and removed in afterEach so each test runs in a clean,
 * independent environment.
 *
 * Tool → action class mapping:
 *   git_commit → vcs.write (risk: medium, hitl_mode: per_request)
 *
 * TC-GCM-18  PERMIT              — pipeline permits, gitCommit executes and returns 40-char hash
 * TC-GCM-19  HITL FORBID         — no capability token → pending_hitl_approval
 * TC-GCM-20  vcs-write FORBID    — valid token, stage2 forbids vcs.write operations
 * TC-GCM-21  action class mapping — normalize_action maps git_commit to vcs.write with per_request
 * TC-GCM-22  audit trail         — executionEvent emitted with ISO 8601 timestamp on every path
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, Stage2Fn, CeeDecision } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { normalize_action } from './enforcement/normalize.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import { computePayloadHash } from './envelope.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import { gitCommit } from './tools/git_commit/git-commit.js';

// ─── Git repo helpers ─────────────────────────────────────────────────────────

function initRepo(dir: string): void {
  spawnSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, encoding: 'utf-8' });
}

function stageFile(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content, 'utf-8');
  spawnSync('git', ['add', filename], { cwd: dir, encoding: 'utf-8' });
}

function headHash(dir: string): string {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' });
  return typeof res.stdout === 'string' ? res.stdout.trim() : '';
}

// ─── Stage 2 helpers ─────────────────────────────────────────────────────────

function buildPermissiveStage2(): Stage2Fn {
  return async (_ctx: PipelineContext): Promise<CeeDecision> => {
    return { effect: 'permit', reason: 'default_permit', stage: 'stage2' };
  };
}

/**
 * Stage 2 that forbids all vcs.write operations.
 * Used to validate that a CLOSED policy correctly blocks git commits.
 */
function buildVcsWriteForbidStage2(): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    if (ctx.action_class === 'vcs.write') {
      return { effect: 'forbid', reason: 'vcs_write_forbidden', stage: 'stage2' };
    }
    return { effect: 'permit', reason: 'permitted', stage: 'stage2' };
  };
}

// ─── HITL test harness ───────────────────────────────────────────────────────

const TEST_POLICY: HitlPolicy = {
  name: 'test-hitl-policy',
  actions: ['vcs.write'],
  approval: { channel: 'test', timeout: 3600, fallback: 'deny' },
};

interface ApproveNextOpts {
  action_class: string;
  target: string;
  payload_hash: string;
}

class HitlTestHarness {
  private readonly approvalManager: ApprovalManager;
  private readonly issued = new Map<string, Capability>();

  readonly stage1: Stage1Fn;

  constructor() {
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
      expires_at: now + 3_600_000,
    };

    this.issued.set(handle.token, capability);
    return handle.token;
  }

  shutdown(): void {
    this.approvalManager.shutdown();
  }
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const RULE_CONTEXT = { agentId: 'agent-vcs', channel: 'api' };

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('git_commit — vcs.write enforcement and execution', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;
  let repoDir: string;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
    repoDir = mkdtempSync(join(tmpdir(), 'git-commit-e2e-'));
    initRepo(repoDir);
  });

  afterEach(() => {
    harness.shutdown();
    rmSync(repoDir, { recursive: true, force: true });
  });

  // ── TC-GCM-18 ──────────────────────────────────────────────────────────────

  it(
    'TC-GCM-18: PERMIT — pipeline permits git_commit, gitCommit executes and returns 40-char SHA-1 hash',
    async () => {
      const params = { message: 'feat: initial implementation' };
      const normalized = normalize_action('git_commit', params);
      const payloadHash = computePayloadHash('git_commit', params);
      const token = harness.approveNext({
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
      });

      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (e) => auditEvents.push(e));

      const pipelineResult = await runPipeline(
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

      expect(pipelineResult.decision.effect).toBe('permit');
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]!.decision.effect).toBe('permit');

      // Execute the tool with a real staged change in the isolated repo.
      stageFile(repoDir, 'README.md', '# Hello\n');

      const toolResult = gitCommit(params, { cwd: repoDir });

      expect(toolResult.hash).toMatch(/^[0-9a-f]{40}$/);
      // Verify the returned hash matches the actual HEAD commit.
      expect(toolResult.hash).toBe(headHash(repoDir));
    },
  );

  // ── TC-GCM-19 ──────────────────────────────────────────────────────────────

  it(
    'TC-GCM-19: HITL FORBID — missing capability token causes pipeline to return pending_hitl_approval',
    async () => {
      const params = { message: 'feat: add feature' };
      const normalized = normalize_action('git_commit', params);
      const payloadHash = computePayloadHash('git_commit', params);

      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (e) => auditEvents.push(e));

      const result = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: payloadHash,
          hitl_mode: normalized.hitl_mode,
          // approval_id intentionally absent
          rule_context: RULE_CONTEXT,
        },
        harness.stage1,
        buildPermissiveStage2(),
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('pending_hitl_approval');
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]!.decision.effect).toBe('forbid');
      expect(auditEvents[0]!.decision.reason).toBe('pending_hitl_approval');
    },
  );

  // ── TC-GCM-20 ──────────────────────────────────────────────────────────────

  it(
    'TC-GCM-20: vcs-write FORBID — valid token, stage2 policy forbids vcs.write operations',
    async () => {
      const params = { message: 'chore: update dependencies' };
      const normalized = normalize_action('git_commit', params);
      const payloadHash = computePayloadHash('git_commit', params);
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
        buildVcsWriteForbidStage2(),
        emitter,
      );

      // Stage 1 passes (valid token), stage 2 forbids for vcs_write_forbidden.
      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('vcs_write_forbidden');
      expect(result.decision.stage).toBe('stage2');
    },
  );

  // ── TC-GCM-21 ──────────────────────────────────────────────────────────────

  it(
    'TC-GCM-21: action class mapping — normalize_action maps git_commit to vcs.write with per_request HITL mode',
    () => {
      const normalized = normalize_action('git_commit', {
        message: 'fix: patch security issue',
        files: ['src/auth.ts'],
      });

      expect(normalized.action_class).toBe('vcs.write');
      expect(normalized.hitl_mode).toBe('per_request');
      expect(normalized.risk).toBe('medium');
      // git_commit has no intent_group in the registry.
      expect(normalized.intent_group).toBeUndefined();
    },
  );

  // ── TC-GCM-22 ──────────────────────────────────────────────────────────────

  it(
    'TC-GCM-22: audit trail — executionEvent emitted with ISO 8601 timestamp on permit and forbid paths',
    async () => {
      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (e) => auditEvents.push(e));

      const params = { message: 'docs: update changelog' };
      const payloadHash = computePayloadHash('git_commit', params);
      const normalized = normalize_action('git_commit', params);

      // --- Path 1: permit ---
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

      // --- Path 2: forbid (no token) ---
      await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: payloadHash,
          hitl_mode: normalized.hitl_mode,
          // approval_id intentionally absent
          rule_context: RULE_CONTEXT,
        },
        harness.stage1,
        buildPermissiveStage2(),
        emitter,
      );

      expect(auditEvents).toHaveLength(2);

      // Every event must carry an ISO 8601 timestamp.
      for (const evt of auditEvents) {
        expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }

      expect(auditEvents[0]!.decision.effect).toBe('permit');
      expect(auditEvents[1]!.decision.effect).toBe('forbid');
      expect(auditEvents[1]!.decision.reason).toBe('pending_hitl_approval');
    },
  );
});

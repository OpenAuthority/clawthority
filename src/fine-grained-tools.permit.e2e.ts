/**
 * Fine-grained tools — permit taxonomy e2e tests
 *
 * Generated test suite verifying that each fine-grained tool alias in the
 * @openclaw/action-registry taxonomy produces a permit decision when the
 * Stage 2 policy is the default-permit baseline.
 *
 * Organisation: tests are grouped by action class. Within each group every
 * tested alias is normalised, asserted to resolve to the expected action_class
 * and hitl_mode, then driven through the full enforcement pipeline.
 *
 * HITL gating strategy:
 *   - hitl_mode: 'none'          → pipeline runs without an approval token
 *   - hitl_mode: 'per_request'   → capability token pre-issued via HitlTestHarness
 *
 * Test IDs: TC-FGT-01 … TC-FGT-73 (Fine-Grained Tools permit)
 *
 * Covers 27 action classes (all registered classes except the exempt pair
 * unknown_sensitive_action and shell.exec which carry special handling).
 *
 * ── Action class coverage ────────────────────────────────────────────────────
 *  hitl: none      filesystem.read, filesystem.list, memory.read, memory.write,
 *                  vcs.read, package.read, build.test, build.lint            (25)
 *  hitl: per_req   filesystem.write, filesystem.delete, web.search, web.fetch,
 *                  browser.scrape, web.post, shell.exec, communication.email,
 *                  communication.slack, communication.webhook, credential.read,
 *                  credential.write, code.execute, payment.initiate, vcs.write,
 *                  vcs.remote, package.install, package.run, build.compile    (47)
 * ─────────────────────────────────────────────────────────────────────────────
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

function buildDefaultPermitStage2(): Stage2Fn {
  return async (_ctx: PipelineContext): Promise<CeeDecision> => {
    return { effect: 'permit', reason: 'default_permit', stage: 'stage2' };
  };
}

// ─── HitlTestHarness ─────────────────────────────────────────────────────────

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

class HitlTestHarness {
  private readonly approvalManager: ApprovalManager;
  private readonly issued = new Map<string, Capability>();
  private readonly capabilityTtlMs: number;

  readonly stage1: Stage1Fn;

  constructor() {
    this.capabilityTtlMs = 3600 * 1000;
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

describe('fine-grained tools — permit taxonomy', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // filesystem.read  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-01: read_file → filesystem.read is permitted', async () => {
    const normalized = normalize_action('read_file', { path: '/home/user/notes.txt' });
    expect(normalized.action_class).toBe('filesystem.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-01',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-02: cat_file → filesystem.read is permitted', async () => {
    const normalized = normalize_action('cat_file', { path: '/etc/hostname' });
    expect(normalized.action_class).toBe('filesystem.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-02',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-03: view_file → filesystem.read is permitted', async () => {
    const normalized = normalize_action('view_file', { file_path: '/project/README.md' });
    expect(normalized.action_class).toBe('filesystem.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-03',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-04: open_file → filesystem.read is permitted', async () => {
    const normalized = normalize_action('open_file', { path: '/tmp/data.json' });
    expect(normalized.action_class).toBe('filesystem.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-04',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-73: read_files_batch → filesystem.read is permitted', async () => {
    const normalized = normalize_action('read_files_batch', { paths: ['/home/user/a.txt', '/home/user/b.txt'] });
    expect(normalized.action_class).toBe('filesystem.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-73',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // filesystem.list  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-05: list_dir → filesystem.list is permitted', async () => {
    const normalized = normalize_action('list_dir', { path: '/home/user' });
    expect(normalized.action_class).toBe('filesystem.list');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-05',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-06: list_files → filesystem.list is permitted', async () => {
    const normalized = normalize_action('list_files', { path: '/workspace/src' });
    expect(normalized.action_class).toBe('filesystem.list');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-06',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-07: ls → filesystem.list is permitted', async () => {
    const normalized = normalize_action('ls', { path: '/etc' });
    expect(normalized.action_class).toBe('filesystem.list');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-07',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // memory.read  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-08: memory_get → memory.read is permitted', async () => {
    const normalized = normalize_action('memory_get', {});
    expect(normalized.action_class).toBe('memory.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-08',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-09: recall → memory.read is permitted', async () => {
    const normalized = normalize_action('recall', {});
    expect(normalized.action_class).toBe('memory.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-09',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-10: retrieve_memory → memory.read is permitted', async () => {
    const normalized = normalize_action('retrieve_memory', {});
    expect(normalized.action_class).toBe('memory.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-10',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // memory.write  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-11: memory_set → memory.write is permitted', async () => {
    const normalized = normalize_action('memory_set', {});
    expect(normalized.action_class).toBe('memory.write');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-11',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-12: remember → memory.write is permitted', async () => {
    const normalized = normalize_action('remember', {});
    expect(normalized.action_class).toBe('memory.write');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-12',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // vcs.read  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-13: git_status → vcs.read is permitted', async () => {
    const normalized = normalize_action('git_status', {});
    expect(normalized.action_class).toBe('vcs.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-13',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-14: git_log → vcs.read is permitted', async () => {
    const normalized = normalize_action('git_log', {});
    expect(normalized.action_class).toBe('vcs.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-14',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-15: git_diff → vcs.read is permitted', async () => {
    const normalized = normalize_action('git_diff', { path: 'src/index.ts' });
    expect(normalized.action_class).toBe('vcs.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-15',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-16: view_diff → vcs.read is permitted', async () => {
    const normalized = normalize_action('view_diff', {});
    expect(normalized.action_class).toBe('vcs.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-16',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // package.read  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-17: npm_list → package.read is permitted', async () => {
    const normalized = normalize_action('npm_list', {});
    expect(normalized.action_class).toBe('package.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-17',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-18: pip_list → package.read is permitted', async () => {
    const normalized = normalize_action('pip_list', {});
    expect(normalized.action_class).toBe('package.read');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-18',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // build.test  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-19: run_tests → build.test is permitted', async () => {
    const normalized = normalize_action('run_tests', { target: 'unit' });
    expect(normalized.action_class).toBe('build.test');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-19',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-20: npm_test → build.test is permitted', async () => {
    const normalized = normalize_action('npm_test', {});
    expect(normalized.action_class).toBe('build.test');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-20',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-21: vitest → build.test is permitted', async () => {
    const normalized = normalize_action('vitest', {});
    expect(normalized.action_class).toBe('build.test');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-21',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-22: pytest → build.test is permitted', async () => {
    const normalized = normalize_action('pytest', { path: 'tests/' });
    expect(normalized.action_class).toBe('build.test');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-22',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // build.lint  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-23: eslint → build.lint is permitted', async () => {
    const normalized = normalize_action('eslint', { path: 'src/' });
    expect(normalized.action_class).toBe('build.lint');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-23',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-24: prettier → build.lint is permitted', async () => {
    const normalized = normalize_action('prettier', { path: 'src/' });
    expect(normalized.action_class).toBe('build.lint');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-24',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-25: run_typecheck → build.lint is permitted', async () => {
    const normalized = normalize_action('run_typecheck', {});
    expect(normalized.action_class).toBe('build.lint');
    expect(normalized.hitl_mode).toBe('none');

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'hash-fgt-25',
        hitl_mode: normalized.hitl_mode,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // filesystem.write  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-26: write_file → filesystem.write is permitted with approval', async () => {
    const normalized = normalize_action('write_file', { file_path: '/workspace/output.txt' });
    expect(normalized.action_class).toBe('filesystem.write');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-26';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-27: edit_file → filesystem.write is permitted with approval', async () => {
    const normalized = normalize_action('edit_file', { file_path: '/src/app.ts' });
    expect(normalized.action_class).toBe('filesystem.write');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-27';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-28: save_file → filesystem.write is permitted with approval', async () => {
    const normalized = normalize_action('save_file', { path: '/workspace/result.json' });
    expect(normalized.action_class).toBe('filesystem.write');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-28';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // filesystem.delete  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-29: delete_file → filesystem.delete is permitted with approval', async () => {
    const normalized = normalize_action('delete_file', { path: '/tmp/old_cache.txt' });
    expect(normalized.action_class).toBe('filesystem.delete');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-29';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-30: remove_file → filesystem.delete is permitted with approval', async () => {
    const normalized = normalize_action('remove_file', { path: '/tmp/temp.log' });
    expect(normalized.action_class).toBe('filesystem.delete');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-30';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // web.search  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-31: web_search → web.search is permitted with approval', async () => {
    const normalized = normalize_action('web_search', { query: 'typescript best practices' });
    expect(normalized.action_class).toBe('web.search');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-31';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-32: google_search → web.search is permitted with approval', async () => {
    const normalized = normalize_action('google_search', { query: 'vitest documentation' });
    expect(normalized.action_class).toBe('web.search');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-32';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-33: search_web → web.search is permitted with approval', async () => {
    const normalized = normalize_action('search_web', { query: 'open source licensing' });
    expect(normalized.action_class).toBe('web.search');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-33';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // web.fetch  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-34: fetch → web.fetch is permitted with approval', async () => {
    const normalized = normalize_action('fetch', { url: 'https://api.example.com/data' });
    expect(normalized.action_class).toBe('web.fetch');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-34';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-35: web_fetch → web.fetch is permitted with approval', async () => {
    const normalized = normalize_action('web_fetch', { url: 'https://docs.example.com' });
    expect(normalized.action_class).toBe('web.fetch');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-35';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-36: get_url → web.fetch is permitted with approval', async () => {
    const normalized = normalize_action('get_url', { url: 'https://example.com/robots.txt' });
    expect(normalized.action_class).toBe('web.fetch');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-36';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // browser.scrape  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-37: scrape_page → browser.scrape is permitted with approval', async () => {
    const normalized = normalize_action('scrape_page', { url: 'https://news.example.com' });
    expect(normalized.action_class).toBe('browser.scrape');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-37';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-38: read_url → browser.scrape is permitted with approval', async () => {
    const normalized = normalize_action('read_url', { url: 'https://docs.example.com/api' });
    expect(normalized.action_class).toBe('browser.scrape');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-38';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // web.post  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-39: http_post → web.post is permitted with approval', async () => {
    const normalized = normalize_action('http_post', { url: 'https://api.example.com/report' });
    expect(normalized.action_class).toBe('web.post');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-39';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-40: web_post → web.post is permitted with approval', async () => {
    const normalized = normalize_action('web_post', { url: 'https://api.example.com/events' });
    expect(normalized.action_class).toBe('web.post');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-40';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // shell.exec  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-41: run_command → shell.exec is permitted with approval', async () => {
    const normalized = normalize_action('run_command', {});
    expect(normalized.action_class).toBe('shell.exec');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-41';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-42: execute_command → shell.exec is permitted with approval', async () => {
    const normalized = normalize_action('execute_command', {});
    expect(normalized.action_class).toBe('shell.exec');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-42';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-43: terminal_exec → shell.exec is permitted with approval', async () => {
    const normalized = normalize_action('terminal_exec', {});
    expect(normalized.action_class).toBe('shell.exec');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-43';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // communication.email  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-44: send_email → communication.email is permitted with approval', async () => {
    const normalized = normalize_action('send_email', { to: 'team@example.com' });
    expect(normalized.action_class).toBe('communication.email');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-44';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-45: compose_email → communication.email is permitted with approval', async () => {
    const normalized = normalize_action('compose_email', { to: 'report@example.com' });
    expect(normalized.action_class).toBe('communication.email');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-45';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // communication.slack  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-46: send_slack → communication.slack is permitted with approval', async () => {
    const normalized = normalize_action('send_slack', { channel: 'general' });
    expect(normalized.action_class).toBe('communication.slack');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-46';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-47: slack_message → communication.slack is permitted with approval', async () => {
    const normalized = normalize_action('slack_message', {});
    expect(normalized.action_class).toBe('communication.slack');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-47';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // communication.webhook  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-48: call_webhook → communication.webhook is permitted with approval', async () => {
    const normalized = normalize_action('call_webhook', { url: 'https://hooks.example.com/notify' });
    expect(normalized.action_class).toBe('communication.webhook');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-48';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-49: trigger_webhook → communication.webhook is permitted with approval', async () => {
    const normalized = normalize_action('trigger_webhook', { url: 'https://hooks.example.com/deploy' });
    expect(normalized.action_class).toBe('communication.webhook');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-49';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // credential.read  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-50: read_secret → credential.read is permitted with approval', async () => {
    const normalized = normalize_action('read_secret', { name: 'API_KEY' });
    expect(normalized.action_class).toBe('credential.read');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-50';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-51: get_secret → credential.read is permitted with approval', async () => {
    const normalized = normalize_action('get_secret', { name: 'DATABASE_URL' });
    expect(normalized.action_class).toBe('credential.read');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-51';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // credential.write  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-52: write_secret → credential.write is permitted with approval', async () => {
    const normalized = normalize_action('write_secret', { name: 'APP_SECRET' });
    expect(normalized.action_class).toBe('credential.write');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-52';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-53: set_secret → credential.write is permitted with approval', async () => {
    const normalized = normalize_action('set_secret', { name: 'WEBHOOK_TOKEN' });
    expect(normalized.action_class).toBe('credential.write');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-53';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // code.execute  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-54: run_code → code.execute is permitted with approval', async () => {
    const normalized = normalize_action('run_code', { language: 'python', code: 'print("hello")' });
    expect(normalized.action_class).toBe('code.execute');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-54';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-55: python → code.execute is permitted with approval', async () => {
    const normalized = normalize_action('python', { code: 'x = 1 + 1' });
    expect(normalized.action_class).toBe('code.execute');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-55';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-56: execute_code → code.execute is permitted with approval', async () => {
    const normalized = normalize_action('execute_code', { language: 'javascript', code: 'console.log(1)' });
    expect(normalized.action_class).toBe('code.execute');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-56';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // payment.initiate  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-57: pay → payment.initiate is permitted with approval', async () => {
    const normalized = normalize_action('pay', { amount: 10, currency: 'USD', recipient: 'vendor-123' });
    expect(normalized.action_class).toBe('payment.initiate');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-57';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-58: initiate_payment → payment.initiate is permitted with approval', async () => {
    const normalized = normalize_action('initiate_payment', { amount: 5, currency: 'EUR' });
    expect(normalized.action_class).toBe('payment.initiate');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-58';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // vcs.write  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-59: git_add → vcs.write is permitted with approval', async () => {
    const normalized = normalize_action('git_add', { path: 'src/index.ts' });
    expect(normalized.action_class).toBe('vcs.write');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-59';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-60: git_commit → vcs.write is permitted with approval', async () => {
    const normalized = normalize_action('git_commit', { path: '.' });
    expect(normalized.action_class).toBe('vcs.write');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-60';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-61: stage_file → vcs.write is permitted with approval', async () => {
    const normalized = normalize_action('stage_file', { path: 'README.md' });
    expect(normalized.action_class).toBe('vcs.write');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-61';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // vcs.remote  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-62: git_push → vcs.remote is permitted with approval', async () => {
    const normalized = normalize_action('git_push', { repo_url: 'https://github.com/example/repo.git' });
    expect(normalized.action_class).toBe('vcs.remote');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-62';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-63: git_pull → vcs.remote is permitted with approval', async () => {
    const normalized = normalize_action('git_pull', { repo_url: 'https://github.com/example/repo.git' });
    expect(normalized.action_class).toBe('vcs.remote');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-63';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-64: git_clone → vcs.remote is permitted with approval', async () => {
    const normalized = normalize_action('git_clone', { repo_url: 'https://github.com/example/new-repo.git' });
    expect(normalized.action_class).toBe('vcs.remote');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-64';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // package.install  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-65: npm_install → package.install is permitted with approval', async () => {
    const normalized = normalize_action('npm_install', { package_name: 'lodash' });
    expect(normalized.action_class).toBe('package.install');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-65';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-66: pip_install → package.install is permitted with approval', async () => {
    const normalized = normalize_action('pip_install', { package_name: 'requests' });
    expect(normalized.action_class).toBe('package.install');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-66';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-67: install_package → package.install is permitted with approval', async () => {
    const normalized = normalize_action('install_package', { package_name: 'express' });
    expect(normalized.action_class).toBe('package.install');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-67';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // package.run  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-68: npm_run → package.run is permitted with approval', async () => {
    const normalized = normalize_action('npm_run', { script: 'build' });
    expect(normalized.action_class).toBe('package.run');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-68';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-69: run_script → package.run is permitted with approval', async () => {
    const normalized = normalize_action('run_script', { script: 'start' });
    expect(normalized.action_class).toBe('package.run');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-69';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // build.compile  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-FGT-70: tsc → build.compile is permitted with approval', async () => {
    const normalized = normalize_action('tsc', { path: '.' });
    expect(normalized.action_class).toBe('build.compile');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-70';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-71: compile → build.compile is permitted with approval', async () => {
    const normalized = normalize_action('compile', { path: 'src/' });
    expect(normalized.action_class).toBe('build.compile');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-71';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('TC-FGT-72: build → build.compile is permitted with approval', async () => {
    const normalized = normalize_action('build', { target: 'release' });
    expect(normalized.action_class).toBe('build.compile');
    expect(normalized.hitl_mode).toBe('per_request');

    const HASH = 'hash-fgt-72';
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: HASH,
    });

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
      buildDefaultPermitStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });
});

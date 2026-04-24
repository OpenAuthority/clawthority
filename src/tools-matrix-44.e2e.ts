/**
 * Comprehensive 44-tool e2e matrix (W10)
 *
 * Verifies that each of the 44 canonical tool aliases in the
 * @openclaw/action-registry produces a permit decision when the Stage 2
 * policy is the default-permit baseline.
 *
 * Test organisation mirrors fine-grained-tools.permit.e2e.ts:
 *  - normalize_action asserts the correct action_class and hitl_mode
 *  - runPipeline drives the full enforcement pipeline
 *  - hitl_mode: 'none'        → pipeline runs without an approval token
 *  - hitl_mode: 'per_request' → capability token pre-issued via HitlTestHarness
 *
 * The 44 canonical tool names are the primary names used by tool implementations
 * in the tools/ directory (one test per canonical name). This supplements the
 * broader alias coverage in fine-grained-tools.permit.e2e.ts (TC-FGT-01…89)
 * by specifically targeting the canonical names, including newly-added aliases:
 *  - create_directory, list_directory (filesystem)
 *  - fetch_url, http_get, http_put, http_patch, http_delete (HTTP)
 *  - store_secret (credential.write, T160)
 *  - rotate_secret (credential.rotate)
 *  - list_secrets (credential.list, T89)
 *
 * ── Coverage breakdown ────────────────────────────────────────────────────────
 *
 *  hitl: none      read_file, list_dir, list_directory, find_files, grep_files,
 *                  check_exists, read_files_batch, run_tests, run_linter,
 *                  pip_list, git_status, get_env_var, get_system_info          (13)
 *
 *  hitl: per_req   write_file, delete_file, edit_file, copy_file, move_file,
 *                  make_dir, create_directory, fetch_url, http_get, http_post,
 *                  http_put, http_patch, http_delete, scrape_page, search_web,
 *                  send_email, send_slack, call_webhook, read_secret,
 *                  write_secret, store_secret, rotate_secret, list_secrets,
 *                  npm_run_build, npm_install, npm_run, run_code, git_commit,
 *                  git_add, git_push, git_clone                                (31)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Test IDs: TC-MAT-01 … TC-MAT-44 (44-tool Matrix)
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
  name: 'matrix-test-policy',
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
  private readonly capabilityTtlMs = 3_600_000;

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

describe('44-tool matrix — permit taxonomy', () => {
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
  // filesystem.read  (hitl: none) — canonical tool names
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-01: read_file → filesystem.read is permitted', async () => {
    const n = normalize_action('read_file', { path: '/workspace/src/index.ts' });
    expect(n.action_class).toBe('filesystem.read');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-01', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-02: find_files → filesystem.read is permitted', async () => {
    const n = normalize_action('find_files', { pattern: '**/*.ts', directory: '/workspace' });
    expect(n.action_class).toBe('filesystem.read');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-02', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-03: grep_files → filesystem.read is permitted', async () => {
    const n = normalize_action('grep_files', { pattern: 'TODO', path: '/workspace/src' });
    expect(n.action_class).toBe('filesystem.read');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-03', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-04: check_exists → filesystem.read is permitted', async () => {
    const n = normalize_action('check_exists', { path: '/workspace/dist/index.js' });
    expect(n.action_class).toBe('filesystem.read');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-04', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-05: read_files_batch → filesystem.read is permitted', async () => {
    const n = normalize_action('read_files_batch', { paths: ['/workspace/a.ts', '/workspace/b.ts'] });
    expect(n.action_class).toBe('filesystem.read');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-05', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // filesystem.list  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-06: list_dir → filesystem.list is permitted', async () => {
    const n = normalize_action('list_dir', { path: '/workspace/src' });
    expect(n.action_class).toBe('filesystem.list');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-06', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-07: list_directory → filesystem.list is permitted', async () => {
    const n = normalize_action('list_directory', { path: '/workspace/src' });
    expect(n.action_class).toBe('filesystem.list');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-07', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // filesystem.write  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-08: write_file → filesystem.write is permitted with capability', async () => {
    const n = normalize_action('write_file', { path: '/workspace/out.txt', content: 'data' });
    expect(n.action_class).toBe('filesystem.write');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-08' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-08', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-09: edit_file → filesystem.write is permitted with capability', async () => {
    const n = normalize_action('edit_file', { file_path: '/workspace/src/main.ts', content: 'export {}' });
    expect(n.action_class).toBe('filesystem.write');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-09' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-09', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-10: copy_file → filesystem.write is permitted with capability', async () => {
    const n = normalize_action('copy_file', { source: '/workspace/template.ts', destination: '/workspace/copy.ts' });
    expect(n.action_class).toBe('filesystem.write');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-10' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-10', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-11: move_file → filesystem.write is permitted with capability', async () => {
    const n = normalize_action('move_file', { source: '/tmp/draft.md', destination: '/workspace/docs/final.md' });
    expect(n.action_class).toBe('filesystem.write');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-11' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-11', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-12: make_dir → filesystem.write is permitted with capability', async () => {
    const n = normalize_action('make_dir', { path: '/workspace/dist' });
    expect(n.action_class).toBe('filesystem.write');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-12' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-12', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-13: create_directory → filesystem.write is permitted with capability', async () => {
    const n = normalize_action('create_directory', { path: '/workspace/reports' });
    expect(n.action_class).toBe('filesystem.write');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-13' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-13', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // filesystem.delete  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-14: delete_file → filesystem.delete is permitted with capability', async () => {
    const n = normalize_action('delete_file', { path: '/tmp/old.log' });
    expect(n.action_class).toBe('filesystem.delete');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-14' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-14', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // web.fetch  (hitl: per_request) — new canonical HTTP aliases
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-15: fetch_url → web.fetch is permitted with capability', async () => {
    const n = normalize_action('fetch_url', { url: 'https://api.example.com/data' });
    expect(n.action_class).toBe('web.fetch');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-15' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-15', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-16: http_get → web.fetch is permitted with capability', async () => {
    const n = normalize_action('http_get', { url: 'https://api.example.com/users' });
    expect(n.action_class).toBe('web.fetch');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-16' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-16', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // web.post  (hitl: per_request) — new HTTP mutation aliases
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-17: http_post → web.post is permitted with capability', async () => {
    const n = normalize_action('http_post', { url: 'https://api.example.com/items', body: '{}' });
    expect(n.action_class).toBe('web.post');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-17' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-17', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-18: http_put → web.post is permitted with capability', async () => {
    const n = normalize_action('http_put', { url: 'https://api.example.com/items/1', body: '{"name":"new"}' });
    expect(n.action_class).toBe('web.post');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-18' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-18', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-19: http_patch → web.post is permitted with capability', async () => {
    const n = normalize_action('http_patch', { url: 'https://api.example.com/items/1', body: '{"status":"active"}' });
    expect(n.action_class).toBe('web.post');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-19' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-19', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-20: http_delete → web.post is permitted with capability', async () => {
    const n = normalize_action('http_delete', { url: 'https://api.example.com/items/1' });
    expect(n.action_class).toBe('web.post');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-20' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-20', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // browser.scrape  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-21: scrape_page → browser.scrape is permitted with capability', async () => {
    const n = normalize_action('scrape_page', { url: 'https://example.com/article' });
    expect(n.action_class).toBe('browser.scrape');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-21' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-21', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // web.search  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-22: search_web → web.search is permitted with capability', async () => {
    const n = normalize_action('search_web', { query: 'TypeScript generics tutorial' });
    expect(n.action_class).toBe('web.search');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-22' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-22', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // communication.*  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-23: send_email → communication.email is permitted with capability', async () => {
    const n = normalize_action('send_email', { to: 'user@example.com', subject: 'Report', body: 'Hi' });
    expect(n.action_class).toBe('communication.email');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-23' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-23', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-24: send_slack → communication.slack is permitted with capability', async () => {
    const n = normalize_action('send_slack', { channel: '#alerts', message: 'Deployment complete' });
    expect(n.action_class).toBe('communication.slack');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-24' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-24', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-25: call_webhook → communication.webhook is permitted with capability', async () => {
    const n = normalize_action('call_webhook', { url: 'https://hooks.example.com/notify', payload: '{}' });
    expect(n.action_class).toBe('communication.webhook');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-25' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-25', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // credential.*  (hitl: per_request) — including new aliases
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-26: read_secret → credential.read is permitted with capability', async () => {
    const n = normalize_action('read_secret', { key: 'DB_PASSWORD' });
    expect(n.action_class).toBe('credential.read');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-26' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-26', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-27: write_secret → credential.write is permitted with capability', async () => {
    const n = normalize_action('write_secret', { key: 'API_KEY', value: 'sk-abc123' });
    expect(n.action_class).toBe('credential.write');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-27' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-27', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-28: store_secret (T160) → credential.write is permitted with capability', async () => {
    const n = normalize_action('store_secret', { key: 'VAULT_TOKEN', value: 'hvs.xxxxx' });
    expect(n.action_class).toBe('credential.write');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-28' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-28', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-29: rotate_secret → credential.rotate is permitted with capability', async () => {
    const n = normalize_action('rotate_secret', { key: 'DB_PASSWORD' });
    expect(n.action_class).toBe('credential.rotate');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-29' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-29', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-30: list_secrets (T89) → credential.list is permitted with capability (default-permit stage2)', async () => {
    const n = normalize_action('list_secrets', { prefix: 'app/' });
    expect(n.action_class).toBe('credential.list');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-30' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-30', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    // Stage2 is default-permit (bypasses real credential.list forbid rule)
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // build.*  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-31: run_tests → build.test is permitted (hitl: none)', async () => {
    const n = normalize_action('run_tests', { command: 'vitest run' });
    expect(n.action_class).toBe('build.test');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-31', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-32: run_linter → build.lint is permitted (hitl: none)', async () => {
    const n = normalize_action('run_linter', { command: 'eslint src/' });
    expect(n.action_class).toBe('build.lint');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-32', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // build.compile  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-33: npm_run_build → build.compile is permitted with capability', async () => {
    const n = normalize_action('npm_run_build', { script: 'build' });
    expect(n.action_class).toBe('build.compile');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-33' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-33', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // package.*
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-34: npm_install → package.install is permitted with capability', async () => {
    const n = normalize_action('npm_install', { package: 'lodash', dev: false });
    expect(n.action_class).toBe('package.install');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-34' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-34', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-35: npm_run → package.run is permitted with capability', async () => {
    const n = normalize_action('npm_run', { script: 'generate:types' });
    expect(n.action_class).toBe('package.run');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-35' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-35', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-36: pip_list → package.read is permitted (hitl: none)', async () => {
    const n = normalize_action('pip_list', {});
    expect(n.action_class).toBe('package.read');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-36', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // code.execute  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-37: run_code → code.execute is permitted with capability (default-permit stage2)', async () => {
    const n = normalize_action('run_code', { language: 'python', code: 'print("hello")' });
    expect(n.action_class).toBe('code.execute');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-37' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-37', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    // Note: real policy has code.execute at priority-100 forbid.
    // Default-permit stage2 bypasses that; real policy tested in fine-grained-tools.forbid.e2e.ts.
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // vcs.read  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-38: git_status → vcs.read is permitted (hitl: none)', async () => {
    const n = normalize_action('git_status', { directory: '/workspace' });
    expect(n.action_class).toBe('vcs.read');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-38', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // vcs.write  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-39: git_commit → vcs.write is permitted with capability', async () => {
    const n = normalize_action('git_commit', { message: 'feat: add new feature', all: false });
    expect(n.action_class).toBe('vcs.write');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-39' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-39', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-40: git_add → vcs.write is permitted with capability', async () => {
    const n = normalize_action('git_add', { path: 'src/index.ts' });
    expect(n.action_class).toBe('vcs.write');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-40' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-40', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // vcs.remote  (hitl: per_request)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-41: git_push → vcs.remote is permitted with capability', async () => {
    const n = normalize_action('git_push', { remote: 'origin', branch: 'main' });
    expect(n.action_class).toBe('vcs.remote');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-41' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-41', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-42: git_clone → vcs.remote is permitted with capability', async () => {
    const n = normalize_action('git_clone', { url: 'https://github.com/org/repo.git', directory: '/workspace/repo' });
    expect(n.action_class).toBe('vcs.remote');
    expect(n.hitl_mode).toBe('per_request');
    const token = harness.approveNext({ action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-42' });
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-42', hitl_mode: n.hitl_mode, approval_id: token, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // system.read  (hitl: none)
  // ══════════════════════════════════════════════════════════════════════════

  it('TC-MAT-43: get_env_var → system.read is permitted (hitl: none)', async () => {
    const n = normalize_action('get_env_var', { name: 'NODE_ENV' });
    expect(n.action_class).toBe('system.read');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-43', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });

  it('TC-MAT-44: get_system_info → system.read is permitted (hitl: none)', async () => {
    const n = normalize_action('get_system_info', {});
    expect(n.action_class).toBe('system.read');
    expect(n.hitl_mode).toBe('none');
    const r = await runPipeline(
      { action_class: n.action_class, target: n.target, payload_hash: 'hash-mat-44', hitl_mode: n.hitl_mode, rule_context: { agentId: 'agent-1', channel: 'default' } },
      harness.stage1, buildDefaultPermitStage2(), emitter,
    );
    expect(r.decision.effect).toBe('permit');
  });
});

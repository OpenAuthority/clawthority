/**
 * E2E tests for the kubectl_* typed tools (W5 of v1.3.2).
 *
 * Focus areas:
 *   - kubectl_get binds to cluster.read (the only one)
 *   - kubectl_apply / kubectl_delete / kubectl_rollout bind to cluster.write
 *   - Pipeline PERMIT path for both classes
 *   - Pre-flight rejection of shell metachars at the parameter level
 *
 * Test IDs:
 *   TC-KCL-E2E-01  kubectl_get      → cluster.read
 *   TC-KCL-E2E-02  kubectl_apply    → cluster.write
 *   TC-KCL-E2E-03  kubectl_delete   → cluster.write
 *   TC-KCL-E2E-04  kubectl_rollout  → cluster.write
 *   TC-KCL-E2E-05  kubectl_get      PERMIT pipeline
 *   TC-KCL-E2E-06  kubectl_delete   pre-flight rejects shell injection in resource
 *   TC-KCL-E2E-07  bare `kubectl`   alias falls through to cluster.write (RFC-003 fallback)
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
  kubectlDelete,
  KubectlDeleteError,
} from './tools/kubectl_delete/kubectl-delete.js';

// ─── Pipeline helpers ────────────────────────────────────────────────────────

function buildPermissiveStage2(): Stage2Fn {
  return async (_ctx: PipelineContext): Promise<CeeDecision> => ({
    effect: 'permit',
    reason: 'default_permit',
    stage: 'stage2',
  });
}

const TEST_POLICY: HitlPolicy = {
  name: 'test-cluster',
  actions: ['cluster.read', 'cluster.write'],
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

const RULE_CONTEXT = { agentId: 'agent-kubectl', channel: 'api' };

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('kubectl_* typed tools — cluster.read / cluster.write enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ── TC-KCL-E2E-01 ─────────────────────────────────────────────────────────

  it('TC-KCL-E2E-01: kubectl_get → cluster.read / low / per_request', () => {
    const normalized = normalize_action('kubectl_get', {
      resource: 'pods',
      namespace: 'default',
    });
    expect(normalized.action_class).toBe('cluster.read');
    expect(normalized.risk).toBe('low');
    expect(normalized.hitl_mode).toBe('per_request');
  });

  // ── TC-KCL-E2E-02 ─────────────────────────────────────────────────────────

  it('TC-KCL-E2E-02: kubectl_apply → cluster.write / high / per_request', () => {
    const normalized = normalize_action('kubectl_apply', {
      manifest_path: '/tmp/deploy.yaml',
    });
    expect(normalized.action_class).toBe('cluster.write');
    expect(normalized.risk).toBe('high');
    expect(normalized.hitl_mode).toBe('per_request');
  });

  // ── TC-KCL-E2E-03 ─────────────────────────────────────────────────────────

  it('TC-KCL-E2E-03: kubectl_delete → cluster.write', () => {
    const normalized = normalize_action('kubectl_delete', {
      resource: 'deployment',
      name: 'web',
    });
    expect(normalized.action_class).toBe('cluster.write');
    expect(normalized.risk).toBe('high');
  });

  // ── TC-KCL-E2E-04 ─────────────────────────────────────────────────────────

  it('TC-KCL-E2E-04: kubectl_rollout → cluster.write', () => {
    const normalized = normalize_action('kubectl_rollout', {
      action: 'restart',
      resource: 'deployment',
      name: 'web',
    });
    expect(normalized.action_class).toBe('cluster.write');
    expect(normalized.risk).toBe('high');
  });

  // ── TC-KCL-E2E-05 ─────────────────────────────────────────────────────────

  it('TC-KCL-E2E-05: kubectl_get PERMIT pipeline run', async () => {
    const params = { resource: 'pods', namespace: 'default' };
    const normalized = normalize_action('kubectl_get', params);
    const payloadHash = computePayloadHash('kubectl_get', params);
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
  });

  // ── TC-KCL-E2E-06 ─────────────────────────────────────────────────────────

  it('TC-KCL-E2E-06: kubectl_delete pre-flight rejects shell injection in resource', () => {
    let preflightError: KubectlDeleteError | undefined;
    try {
      kubectlDelete({ resource: 'pods; rm -rf /', name: 'web' });
    } catch (e) {
      if (e instanceof KubectlDeleteError) preflightError = e;
    }
    expect(preflightError).toBeInstanceOf(KubectlDeleteError);
    expect(preflightError!.code).toBe('invalid-resource');
  });

  // ── TC-KCL-E2E-07 ─────────────────────────────────────────────────────────

  it('TC-KCL-E2E-07: bare `kubectl` alias maps to cluster.write (RFC-003 conservative fallback)', () => {
    const normalized = normalize_action('kubectl', {});
    expect(normalized.action_class).toBe('cluster.write');
    expect(normalized.risk).toBe('high');
    expect(normalized.hitl_mode).toBe('per_request');
  });
});

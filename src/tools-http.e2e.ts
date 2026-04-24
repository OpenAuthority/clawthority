/**
 * E2E tests for HTTP tools (http_get, http_post, http_put, http_delete, http_patch).
 *
 * Exercises the enforcement pipeline for all five HTTP method tools across
 * three scenarios each: PERMIT, HITL-gated FORBID, and unknown-URL FORBID.
 * The global fetch is stubbed so no real network requests are made.
 *
 * Tool → action class mapping (via @openclaw/action-registry):
 *   http_get    → web.fetch    (intent_group: data_exfiltration)
 *   http_post   → web.post     (intent_group: web_access)
 *   http_put    → web.post     (intent_group: web_access)
 *   http_delete → web.post     (intent_group: web_access)
 *   http_patch  → web.post     (intent_group: web_access)
 *
 * TC-HTT-01  http_get    PERMIT          — token issued, permissive stage2 → permit
 * TC-HTT-02  http_get    HITL FORBID     — no token, stage1 → pending_hitl_approval
 * TC-HTT-03  http_get    unknown-URL     — token issued, untrusted URL → unknown_url_forbidden
 * TC-HTT-04  http_post   PERMIT          — token issued, permissive stage2 → permit
 * TC-HTT-05  http_post   HITL FORBID     — no token, stage1 → pending_hitl_approval
 * TC-HTT-06  http_post   unknown-URL     — token issued, untrusted URL → unknown_url_forbidden
 * TC-HTT-07  http_put    PERMIT          — token issued, permissive stage2 → permit
 * TC-HTT-08  http_put    HITL FORBID     — no token, stage1 → pending_hitl_approval
 * TC-HTT-09  http_put    unknown-URL     — token issued, untrusted URL → unknown_url_forbidden
 * TC-HTT-10  http_delete PERMIT          — token issued, permissive stage2 → permit
 * TC-HTT-11  http_delete HITL FORBID     — no token, stage1 → pending_hitl_approval
 * TC-HTT-12  http_delete unknown-URL     — token issued, untrusted URL → unknown_url_forbidden
 * TC-HTT-13  http_patch  PERMIT          — token issued, permissive stage2 → permit
 * TC-HTT-14  http_patch  HITL FORBID     — no token, stage1 → pending_hitl_approval
 * TC-HTT-15  http_patch  unknown-URL     — token issued, untrusted URL → unknown_url_forbidden
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, Stage2Fn, CeeDecision } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { normalize_action } from './enforcement/normalize.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import { computePayloadHash } from './envelope.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';

// ─── Fetch mock ───────────────────────────────────────────────────────────────
//
// Stub the global fetch so no real HTTP requests can escape during tests.
// The mock response mirrors a minimal successful HTTP response.

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({ data: 'mocked' }),
  text: async () => 'mocked response body',
  headers: new Headers({ 'content-type': 'application/json' }),
}));

// ─── Stage 2 helpers ─────────────────────────────────────────────────────────

/**
 * Permissive stage2 — permits all HTTP actions regardless of target.
 * Used for PERMIT scenarios where the policy is intentionally open.
 */
function buildPermissiveStage2(): Stage2Fn {
  return async (_ctx: PipelineContext): Promise<CeeDecision> => {
    return { effect: 'permit', reason: 'default_permit', stage: 'stage2' };
  };
}

/**
 * Stage 2 that forbids HTTP targets not matching the given trusted-URL pattern.
 * Callers pass a pattern that MATCHES untrusted (to-be-blocked) URLs; targets
 * not matching the pattern are permitted.
 *
 * Convention mirrors `buildChannelForbidStage2` from tools-communication.e2e.ts:
 * the pattern describes what to FORBID; non-matching targets receive implicit permit.
 *
 * Example: `/^https:\/\/(?!api\.trusted\.internal\/)/ ` forbids all HTTPS URLs
 * except those on api.trusted.internal.
 */
function buildHttpForbidStage2(pattern: RegExp): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    if (pattern.test(ctx.target)) {
      return { effect: 'forbid', reason: 'unknown_url_forbidden', stage: 'stage2' };
    }
    return { effect: 'permit', reason: 'trusted_url_permitted', stage: 'stage2' };
  };
}

// ─── HITL test harness ───────────────────────────────────────────────────────

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

const RULE_CONTEXT = { agentId: 'agent-http', channel: 'api' };

/**
 * A URL on the trusted internal API host — used for PERMIT and HITL FORBID tests.
 * The buildHttpForbidStage2 trusted pattern allows this host.
 */
const TRUSTED_URL = 'https://api.trusted.internal/v1/resource';

/**
 * An external URL that does not match the trusted host pattern.
 * Used for unknown-URL FORBID tests.
 */
const UNTRUSTED_URL = 'https://untrusted.example.com/exfil';

/**
 * Forbids all HTTPS URLs whose host is NOT api.trusted.internal.
 * Follows the negative-lookahead convention for distinguishing trusted
 * from untrusted targets.
 */
const UNTRUSTED_URL_PATTERN = /^https:\/\/(?!api\.trusted\.internal\/)/;

// ─── http_get — TC-HTT-01..03 ─────────────────────────────────────────────────

describe('http_get — web.fetch (data_exfiltration) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-HTT-01: PERMIT — valid HITL token, permissive stage2, pipeline permits http_get', async () => {
    const normalized = normalize_action('http_get', { url: TRUSTED_URL });

    expect(normalized.action_class).toBe('web.fetch');
    expect(normalized.intent_group).toBe('data_exfiltration');
    expect(normalized.hitl_mode).toBe('per_request');
    expect(normalized.target).toBe(TRUSTED_URL);

    const payloadHash = computePayloadHash('http_get', { url: TRUSTED_URL });
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: payloadHash,
    });

    const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => auditEvents.push(e));

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.decision.effect).toBe('permit');
    expect(auditEvents[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('TC-HTT-02: HITL FORBID — no capability token, stage1 returns pending_hitl_approval for http_get', async () => {
    const normalized = normalize_action('http_get', { url: TRUSTED_URL });
    const payloadHash = computePayloadHash('http_get', { url: TRUSTED_URL });

    const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => auditEvents.push(e));

    // No token issued — approval is still pending.
    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
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
  });

  it('TC-HTT-03: unknown-URL FORBID — untrusted URL target rejected by stage2 for http_get', async () => {
    const normalized = normalize_action('http_get', { url: UNTRUSTED_URL });
    const payloadHash = computePayloadHash('http_get', { url: UNTRUSTED_URL });
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: payloadHash,
    });

    const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => auditEvents.push(e));

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildHttpForbidStage2(UNTRUSTED_URL_PATTERN),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('unknown_url_forbidden');
    expect(result.decision.stage).toBe('stage2');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.decision.effect).toBe('forbid');
  });
});

// ─── http_post — TC-HTT-04..06 ────────────────────────────────────────────────

describe('http_post — web.post (web_access) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-HTT-04: PERMIT — valid HITL token, permissive stage2, pipeline permits http_post', async () => {
    const normalized = normalize_action('http_post', { url: TRUSTED_URL });

    expect(normalized.action_class).toBe('web.post');
    expect(normalized.intent_group).toBe('web_access');
    expect(normalized.hitl_mode).toBe('per_request');
    expect(normalized.target).toBe(TRUSTED_URL);

    const payloadHash = computePayloadHash('http_post', { url: TRUSTED_URL });
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: payloadHash,
    });

    const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => auditEvents.push(e));

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.decision.effect).toBe('permit');
  });

  it('TC-HTT-05: HITL FORBID — no capability token, stage1 returns pending_hitl_approval for http_post', async () => {
    const normalized = normalize_action('http_post', { url: TRUSTED_URL });
    const payloadHash = computePayloadHash('http_post', { url: TRUSTED_URL });

    const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => auditEvents.push(e));

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        // approval_id intentionally absent
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pending_hitl_approval');
    expect(auditEvents[0]!.decision.reason).toBe('pending_hitl_approval');
  });

  it('TC-HTT-06: unknown-URL FORBID — untrusted URL target rejected by stage2 for http_post', async () => {
    const normalized = normalize_action('http_post', { url: UNTRUSTED_URL });
    const payloadHash = computePayloadHash('http_post', { url: UNTRUSTED_URL });
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
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildHttpForbidStage2(UNTRUSTED_URL_PATTERN),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('unknown_url_forbidden');
    expect(result.decision.stage).toBe('stage2');
  });
});

// ─── http_put — TC-HTT-07..09 ─────────────────────────────────────────────────

describe('http_put — web.post (web_access) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-HTT-07: PERMIT — valid HITL token, permissive stage2, pipeline permits http_put', async () => {
    const normalized = normalize_action('http_put', { url: TRUSTED_URL });

    expect(normalized.action_class).toBe('web.post');
    expect(normalized.intent_group).toBe('web_access');
    expect(normalized.hitl_mode).toBe('per_request');

    const payloadHash = computePayloadHash('http_put', { url: TRUSTED_URL });
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: payloadHash,
    });

    const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => auditEvents.push(e));

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
    expect(auditEvents[0]!.decision.effect).toBe('permit');
  });

  it('TC-HTT-08: HITL FORBID — no capability token, stage1 returns pending_hitl_approval for http_put', async () => {
    const normalized = normalize_action('http_put', { url: TRUSTED_URL });
    const payloadHash = computePayloadHash('http_put', { url: TRUSTED_URL });

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        // approval_id intentionally absent
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pending_hitl_approval');
  });

  it('TC-HTT-09: unknown-URL FORBID — untrusted URL target rejected by stage2 for http_put', async () => {
    const normalized = normalize_action('http_put', { url: UNTRUSTED_URL });
    const payloadHash = computePayloadHash('http_put', { url: UNTRUSTED_URL });
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
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildHttpForbidStage2(UNTRUSTED_URL_PATTERN),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('unknown_url_forbidden');
    expect(result.decision.stage).toBe('stage2');
  });
});

// ─── http_delete — TC-HTT-10..12 ──────────────────────────────────────────────
//
// http_delete is registered in @openclaw/action-registry as web.post (web_access).
// hitl_mode: per_request. The pipeline enforces HITL gating and stage2 URL
// policy via the same path as http_post.

describe('http_delete — web.post (web_access) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-HTT-10: PERMIT — valid HITL token, permissive stage2, pipeline permits http_delete', async () => {
    const normalized = normalize_action('http_delete', { url: TRUSTED_URL });

    expect(normalized.action_class).toBe('web.post');
    expect(normalized.intent_group).toBe('web_access');
    expect(normalized.hitl_mode).toBe('per_request');
    expect(normalized.target).toBe(TRUSTED_URL);

    const payloadHash = computePayloadHash('http_delete', { url: TRUSTED_URL });
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: payloadHash,
    });

    const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => auditEvents.push(e));

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('TC-HTT-11: HITL FORBID — no capability token, stage1 returns pending_hitl_approval for http_delete', async () => {
    const normalized = normalize_action('http_delete', { url: TRUSTED_URL });
    const payloadHash = computePayloadHash('http_delete', { url: TRUSTED_URL });

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        // approval_id intentionally absent
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pending_hitl_approval');
  });

  it('TC-HTT-12: unknown-URL FORBID — untrusted URL target rejected by stage2 for http_delete', async () => {
    const normalized = normalize_action('http_delete', { url: UNTRUSTED_URL });
    const payloadHash = computePayloadHash('http_delete', { url: UNTRUSTED_URL });
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
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildHttpForbidStage2(UNTRUSTED_URL_PATTERN),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('unknown_url_forbidden');
    expect(result.decision.stage).toBe('stage2');
  });
});

// ─── http_patch — TC-HTT-13..15 ───────────────────────────────────────────────

describe('http_patch — web.post (web_access) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-HTT-13: PERMIT — valid HITL token, permissive stage2, pipeline permits http_patch', async () => {
    const normalized = normalize_action('http_patch', { url: TRUSTED_URL });

    expect(normalized.action_class).toBe('web.post');
    expect(normalized.intent_group).toBe('web_access');
    expect(normalized.hitl_mode).toBe('per_request');

    const payloadHash = computePayloadHash('http_patch', { url: TRUSTED_URL });
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: payloadHash,
    });

    const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => auditEvents.push(e));

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.decision.effect).toBe('permit');
  });

  it('TC-HTT-14: HITL FORBID — no capability token, stage1 returns pending_hitl_approval for http_patch', async () => {
    const normalized = normalize_action('http_patch', { url: TRUSTED_URL });
    const payloadHash = computePayloadHash('http_patch', { url: TRUSTED_URL });

    const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => auditEvents.push(e));

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        // approval_id intentionally absent
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pending_hitl_approval');
    expect(auditEvents[0]!.decision.effect).toBe('forbid');
    expect(auditEvents[0]!.decision.reason).toBe('pending_hitl_approval');
  });

  it('TC-HTT-15: unknown-URL FORBID — untrusted URL target rejected by stage2 for http_patch', async () => {
    const normalized = normalize_action('http_patch', { url: UNTRUSTED_URL });
    const payloadHash = computePayloadHash('http_patch', { url: UNTRUSTED_URL });
    const token = harness.approveNext({
      action_class: normalized.action_class,
      target: normalized.target,
      payload_hash: payloadHash,
    });

    const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
    emitter.on('executionEvent', (e) => auditEvents.push(e));

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: payloadHash,
        hitl_mode: normalized.hitl_mode,
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildHttpForbidStage2(UNTRUSTED_URL_PATTERN),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('unknown_url_forbidden');
    expect(result.decision.stage).toBe('stage2');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.decision.effect).toBe('forbid');
  });
});

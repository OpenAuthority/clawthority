/**
 * E2E tests for communication tools (send_email, send_slack, call_webhook).
 *
 * Exercises the enforcement pipeline for all three communication tools across
 * three scenarios each: PERMIT, HITL-gated FORBID, and channel-blocked FORBID.
 * No real messages are sent — these tests validate pipeline enforcement only.
 *
 * Tool → action class mapping (via @openclaw/action-registry):
 *   send_email    → communication.email    (intent_group: external_send)
 *   send_slack    → communication.slack    (intent_group: external_send)
 *   call_webhook  → communication.webhook  (intent_group: external_send)
 *
 * TC-CMM-01  send_email    PERMIT             — token issued, permissive stage2 → permit
 * TC-CMM-02  send_email    HITL FORBID        — no token, stage1 → pending_hitl_approval
 * TC-CMM-03  send_email    recipient-FORBID   — external recipient blocked by stage2
 * TC-CMM-04  send_slack    PERMIT             — token issued, permissive stage2 → permit
 * TC-CMM-05  send_slack    HITL FORBID        — no token, stage1 → pending_hitl_approval
 * TC-CMM-06  send_slack    channel-FORBID     — communication.slack blocked by stage2
 * TC-CMM-07  call_webhook  PERMIT             — token issued, permissive stage2 → permit
 * TC-CMM-08  call_webhook  HITL FORBID        — no token, stage1 → pending_hitl_approval
 * TC-CMM-09  call_webhook  URL-FORBID         — untrusted webhook URL blocked by stage2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, Stage2Fn, CeeDecision } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { normalize_action } from './enforcement/normalize.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import { computePayloadHash } from './envelope.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';

// ─── Stage 2 helpers ─────────────────────────────────────────────────────────

/**
 * Permissive stage2 — permits all communication actions regardless of target.
 * Used for PERMIT scenarios where the policy is intentionally open.
 */
function buildPermissiveStage2(): Stage2Fn {
  return async (_ctx: PipelineContext): Promise<CeeDecision> => {
    return { effect: 'permit', reason: 'default_permit', stage: 'stage2' };
  };
}

/**
 * Stage 2 that forbids communication targets matching the given pattern.
 * Callers pass a pattern that MATCHES channels/recipients/URLs to BLOCK.
 * Non-matching targets receive implicit permit.
 *
 * For send_email: pattern matches blocked recipient addresses.
 * For call_webhook: pattern matches untrusted webhook URLs.
 *
 * Note: when a target is empty (e.g. send_slack where 'channel' is not a
 * recognised target key), use `buildActionClassForbidStage2` instead.
 */
export function buildChannelForbidStage2(pattern: RegExp): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    if (ctx.target && pattern.test(ctx.target)) {
      return { effect: 'forbid', reason: 'channel_send_forbidden', stage: 'stage2' };
    }
    return { effect: 'permit', reason: 'channel_permitted', stage: 'stage2' };
  };
}

/**
 * Stage 2 that forbids actions whose action_class matches the given pattern.
 * Used when the target field is empty (e.g. send_slack) and blocking must be
 * based on the action class instead.
 */
function buildActionClassForbidStage2(pattern: RegExp): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    if (pattern.test(ctx.action_class)) {
      return { effect: 'forbid', reason: 'channel_send_forbidden', stage: 'stage2' };
    }
    return { effect: 'permit', reason: 'channel_permitted', stage: 'stage2' };
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

const RULE_CONTEXT = { agentId: 'agent-comms', channel: 'api' };

/** Trusted email recipient used for PERMIT and HITL FORBID tests. */
const TRUSTED_RECIPIENT = 'ops-team@internal.example.com';

/** External email recipient blocked by the stage2 recipient policy. */
const EXTERNAL_RECIPIENT = 'attacker@evil.example.com';

/**
 * Pattern matching external recipients to be blocked.
 * Permits recipients on the trusted internal.example.com domain.
 */
const EXTERNAL_RECIPIENT_PATTERN = /^(?!.+@internal\.example\.com$).+@.+\..+$/;

/** Trusted webhook URL used for PERMIT and HITL FORBID tests. */
const TRUSTED_WEBHOOK_URL = 'https://hooks.internal.example.com/trigger/deploy';

/** Untrusted webhook URL blocked by stage2 URL policy. */
const UNTRUSTED_WEBHOOK_URL = 'https://webhook.untrusted.io/exfil';

/** Pattern matching untrusted webhook URLs (not on hooks.internal.example.com). */
const UNTRUSTED_WEBHOOK_PATTERN = /^https:\/\/(?!hooks\.internal\.example\.com\/)/;

// ─── send_email — TC-CMM-01..03 ───────────────────────────────────────────────

describe('send_email — communication.email (external_send) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-CMM-01: PERMIT — valid HITL token, permissive stage2, pipeline permits send_email', async () => {
    const normalized = normalize_action('send_email', {
      to: TRUSTED_RECIPIENT,
      subject: 'Deployment notice',
      body: 'Deploy complete.',
    });

    expect(normalized.action_class).toBe('communication.email');
    expect(normalized.intent_group).toBe('external_send');
    expect(normalized.hitl_mode).toBe('per_request');
    expect(normalized.target).toBe(TRUSTED_RECIPIENT);

    const payloadHash = computePayloadHash('send_email', { to: TRUSTED_RECIPIENT });
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

  it('TC-CMM-02: HITL FORBID — no capability token, stage1 returns pending_hitl_approval for send_email', async () => {
    const normalized = normalize_action('send_email', { to: TRUSTED_RECIPIENT });
    const payloadHash = computePayloadHash('send_email', { to: TRUSTED_RECIPIENT });

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
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.decision.effect).toBe('forbid');
    expect(auditEvents[0]!.decision.reason).toBe('pending_hitl_approval');
  });

  it('TC-CMM-03: recipient-FORBID — external recipient blocked by stage2 channel policy for send_email', async () => {
    const normalized = normalize_action('send_email', { to: EXTERNAL_RECIPIENT });
    const payloadHash = computePayloadHash('send_email', { to: EXTERNAL_RECIPIENT });
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
      buildChannelForbidStage2(EXTERNAL_RECIPIENT_PATTERN),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('channel_send_forbidden');
    expect(result.decision.stage).toBe('stage2');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.decision.effect).toBe('forbid');
  });
});

// ─── send_slack — TC-CMM-04..06 ───────────────────────────────────────────────
//
// send_slack normalises to communication.slack with intent_group: external_send.
// The 'channel' parameter is not extracted as a target (it is not in the
// target-key registry), so ctx.target is always '' for send_slack calls.
// The CLOSED-mode test blocks by action_class pattern instead.

describe('send_slack — communication.slack (external_send) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-CMM-04: PERMIT — valid HITL token, permissive stage2, pipeline permits send_slack', async () => {
    const normalized = normalize_action('send_slack', {
      channel: '#ops-alerts',
      text: 'Deployment complete.',
    });

    expect(normalized.action_class).toBe('communication.slack');
    expect(normalized.intent_group).toBe('external_send');
    expect(normalized.hitl_mode).toBe('per_request');
    // 'channel' is not a recognized target key — target is empty.
    expect(normalized.target).toBe('');

    const payloadHash = computePayloadHash('send_slack', { channel: '#ops-alerts' });
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

  it('TC-CMM-05: HITL FORBID — no capability token, stage1 returns pending_hitl_approval for send_slack', async () => {
    const normalized = normalize_action('send_slack', { channel: '#ops-alerts' });
    const payloadHash = computePayloadHash('send_slack', { channel: '#ops-alerts' });

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

  it('TC-CMM-06: channel-FORBID — communication.slack action class blocked by stage2 for send_slack', async () => {
    const normalized = normalize_action('send_slack', { channel: '#ops-alerts' });
    const payloadHash = computePayloadHash('send_slack', { channel: '#ops-alerts' });
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
      buildActionClassForbidStage2(/^communication\.slack$/),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('channel_send_forbidden');
    expect(result.decision.stage).toBe('stage2');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.decision.effect).toBe('forbid');
  });
});

// ─── call_webhook — TC-CMM-07..09 ─────────────────────────────────────────────

describe('call_webhook — communication.webhook (external_send) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-CMM-07: PERMIT — valid HITL token, permissive stage2, pipeline permits call_webhook', async () => {
    const normalized = normalize_action('call_webhook', { url: TRUSTED_WEBHOOK_URL });

    expect(normalized.action_class).toBe('communication.webhook');
    expect(normalized.intent_group).toBe('external_send');
    expect(normalized.hitl_mode).toBe('per_request');
    expect(normalized.target).toBe(TRUSTED_WEBHOOK_URL);

    const payloadHash = computePayloadHash('call_webhook', { url: TRUSTED_WEBHOOK_URL });
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

  it('TC-CMM-08: HITL FORBID — no capability token, stage1 returns pending_hitl_approval for call_webhook', async () => {
    const normalized = normalize_action('call_webhook', { url: TRUSTED_WEBHOOK_URL });
    const payloadHash = computePayloadHash('call_webhook', { url: TRUSTED_WEBHOOK_URL });

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
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.decision.effect).toBe('forbid');
    expect(auditEvents[0]!.decision.reason).toBe('pending_hitl_approval');
  });

  it('TC-CMM-09: URL-FORBID — untrusted webhook URL blocked by stage2 channel policy for call_webhook', async () => {
    const normalized = normalize_action('call_webhook', { url: UNTRUSTED_WEBHOOK_URL });
    const payloadHash = computePayloadHash('call_webhook', { url: UNTRUSTED_WEBHOOK_URL });
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
      buildChannelForbidStage2(UNTRUSTED_WEBHOOK_PATTERN),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('channel_send_forbidden');
    expect(result.decision.stage).toBe('stage2');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.decision.effect).toBe('forbid');
  });
});

/**
 * Payload classifier e2e tests
 *
 * Proves that send_email with a credit card number in the body triggers HITL
 * enforcement through the two-stage pipeline. Extends the filesystem-policy
 * e2e pattern.
 *
 *  TC-PC-01  classifyPayload detects credit card in email body
 *  TC-PC-02  send_email with credit card in body, no approval → pending_hitl_approval
 *  TC-PC-03  after approveNext(), send_email with credit card in body → permit
 *  TC-PC-04  send_email with clean body — HITL still enforced (email is always per_request)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, CeeDecision } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { createStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';
import { normalize_action } from './enforcement/normalize.js';
import { classifyPayload } from './enforcement/classify-payload.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import type { Rule } from './policy/types.js';

// ─── Stage 2 helper ───────────────────────────────────────────────────────────

/**
 * Permissive Stage 2 that allows all tool and channel actions.
 * The payload-classifier tests target the HITL pre-check and Stage 1 layers,
 * not policy evaluation, so a permissive engine is sufficient.
 */
const permissiveStage2 = createStage2(
  createEnforcementEngine([
    { effect: 'permit', resource: 'tool', match: '*' },
    { effect: 'permit', resource: 'channel', match: '*' },
  ] satisfies Rule[]),
);

// ─── HitlTestHarness ─────────────────────────────────────────────────────────

/**
 * Minimal HITL policy — timeout is set to 3 600 s so the approval-manager
 * TTL timer never fires during standard tests.
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
 * hitl-approval-lifecycle.e2e.ts and filesystem-policy.e2e.ts.
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

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/** Email body that contains a Luhn-valid Visa card number. */
const EMAIL_BODY_WITH_CARD =
  'Your payment card 4111111111111111 was charged $49.00 for your subscription.';

/** Email body with no sensitive data. */
const EMAIL_BODY_CLEAN =
  'Your subscription has been renewed for another month. Thank you!';

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('payload classifier — send_email HITL enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ── TC-PC-01 ─────────────────────────────────────────────────────────────────

  it(
    'TC-PC-01: classifyPayload detects credit card in email body (hasPii=true, credit_card category)',
    () => {
      const classification = classifyPayload(EMAIL_BODY_WITH_CARD);
      expect(classification.hasPii).toBe(true);
      expect(classification.categories).toContain('credit_card');
      expect(classification.customMatched).toBe(false);

      // Clean body has no PII
      const clean = classifyPayload(EMAIL_BODY_CLEAN);
      expect(clean.hasPii).toBe(false);
      expect(clean.categories).toHaveLength(0);
    },
  );

  // ── TC-PC-02 ─────────────────────────────────────────────────────────────────

  it(
    'TC-PC-02: send_email with credit card in body, no approval → pending_hitl_approval',
    async () => {
      const TOOL = 'send_email';
      const PARAMS = { to: 'customer@example.com', body: EMAIL_BODY_WITH_CARD };

      // Caller classifies the payload — credit card detected, HITL warranted.
      const classification = classifyPayload(PARAMS.body);
      expect(classification.hasPii).toBe(true);

      // Normalize reveals the action class and confirms per_request HITL mode.
      const normalized = normalize_action(TOOL, PARAMS);
      expect(normalized.action_class).toBe('communication.email');
      expect(normalized.hitl_mode).toBe('per_request');

      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (e) => auditEvents.push(e));

      // Run pipeline without an approval_id — HITL pre-check must fire.
      const result = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: 'hash-pc-02',
          hitl_mode: normalized.hitl_mode,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('pending_hitl_approval');
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].decision.effect).toBe('forbid');
    },
  );

  // ── TC-PC-03 ─────────────────────────────────────────────────────────────────

  it(
    'TC-PC-03: after HITL approval (human reviewed PII), send_email with credit card → permit',
    async () => {
      const TOOL = 'send_email';
      const PARAMS = { to: 'customer@example.com', body: EMAIL_BODY_WITH_CARD };
      const HASH = 'hash-pc-03';

      const normalized = normalize_action(TOOL, PARAMS);

      // First attempt without approval — blocked.
      const firstResult = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: HASH,
          hitl_mode: normalized.hitl_mode,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );
      expect(firstResult.decision.reason).toBe('pending_hitl_approval');

      // Human reviews the credit card in the email body and approves the send.
      const token = harness.approveNext({
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: HASH,
      });

      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (e) => auditEvents.push(e));

      // Replay with the approval token — pipeline should permit.
      const secondResult = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: HASH,
          hitl_mode: normalized.hitl_mode,
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(secondResult.decision.effect).toBe('permit');
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].decision.effect).toBe('permit');
    },
  );

  // ── TC-PC-04 ─────────────────────────────────────────────────────────────────

  it(
    'TC-PC-04: send_email with clean body — HITL still enforced (email is always per_request)',
    async () => {
      const TOOL = 'send_email';
      const PARAMS = { to: 'customer@example.com', body: EMAIL_BODY_CLEAN };

      // No PII in the clean body.
      const classification = classifyPayload(PARAMS.body);
      expect(classification.hasPii).toBe(false);

      const normalized = normalize_action(TOOL, PARAMS);
      expect(normalized.hitl_mode).toBe('per_request');

      // Despite no PII, email action class requires per_request HITL.
      const result = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: 'hash-pc-04',
          hitl_mode: normalized.hitl_mode,
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
});

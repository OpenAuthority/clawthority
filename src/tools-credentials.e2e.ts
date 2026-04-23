/**
 * E2E tests for credential tools (read_secret, write_secret, rotate_secret).
 *
 * Exercises the enforcement pipeline for all three credential tools across
 * three scenarios each: PERMIT (with actual tool execution), HITL-gated FORBID,
 * and key-blocked FORBID via stage2 policy.
 *
 * Tool → action class mapping (via @openclaw/action-registry):
 *   read_secret    → credential.read    (intent_group: credential_access, risk: high)
 *   write_secret   → credential.write   (intent_group: credential_access, risk: critical)
 *   rotate_secret  → credential.rotate  (intent_group: credential_access, risk: critical)
 *
 * All three tools have implementations and are tested end-to-end: the
 * pipeline permit decision is obtained first, then the tool is invoked with
 * the issued capability token. An in-memory MemorySecretBackend is injected
 * so no real secret store is accessed during tests.
 *
 * TC-CRD-01  read_secret   PERMIT         — pipeline permits, readSecret returns value
 * TC-CRD-02  read_secret   HITL FORBID    — no token → pending_hitl_approval
 * TC-CRD-03  read_secret   action-FORBID  — stage2 blocks all credential.read access
 * TC-CRD-04  write_secret  PERMIT         — pipeline permits, writeSecret writes value
 * TC-CRD-05  write_secret  HITL FORBID    — no token → pending_hitl_approval
 * TC-CRD-06  write_secret  action-FORBID  — stage2 blocks all credential.write access
 * TC-CRD-07  rotate_secret PERMIT         — pipeline permits, rotateSecret rotates value
 * TC-CRD-08  rotate_secret HITL FORBID    — no token → pending_hitl_approval
 * TC-CRD-09  rotate_secret action-FORBID  — stage2 blocks all credential.rotate access
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
import { readSecret } from './tools/read_secret/read-secret.js';
import { writeSecret } from './tools/write_secret/write-secret.js';
import { rotateSecret } from './tools/rotate_secret/rotate-secret.js';
import { MemorySecretBackend } from './tools/secrets/secret-backend.js';

// ─── Stage 2 helpers ─────────────────────────────────────────────────────────

/**
 * Permissive stage2 — permits all credential actions regardless of target key.
 */
function buildPermissiveStage2(): Stage2Fn {
  return async (_ctx: PipelineContext): Promise<CeeDecision> => {
    return { effect: 'permit', reason: 'default_permit', stage: 'stage2' };
  };
}

/**
 * Stage 2 that forbids credential actions whose action_class matches the given
 * pattern. Used to model a policy that blocks all access for a credential class
 * (e.g. during an incident response where secret reads are suspended).
 *
 * Note: credential tools extract an empty target because 'key' is not in the
 * TARGET_PARAM_KEYS fallback list in normalize.ts (only system.read maps 'key').
 * Action-class-based blocking is the appropriate CLOSED-mode pattern here.
 */
function buildCredentialClassForbidStage2(actionClassPattern: RegExp): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    if (actionClassPattern.test(ctx.action_class)) {
      return { effect: 'forbid', reason: 'credential_access_forbidden', stage: 'stage2' };
    }
    return { effect: 'permit', reason: 'credential_access_permitted', stage: 'stage2' };
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
  readonly approvalManager: ApprovalManager;
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

const RULE_CONTEXT = { agentId: 'agent-secrets', channel: 'api' };

/**
 * Secret key used in PERMIT scenarios — present in the test allowlist.
 * Keys with a PROD_ prefix are treated as sensitive and blocked in FORBID tests.
 */
const PERMITTED_KEY = 'API_KEY';
const SENSITIVE_KEY = 'PROD_ROOT_PASSWORD';

/** Allowlist used by credential tools in PERMIT tests. */
const SECRET_ALLOWLIST = [PERMITTED_KEY, 'DB_PASSWORD', 'STRIPE_SECRET'];
/** Allowlist used when the tool is expected to execute (PERMIT tests). */
const FULL_ALLOWLIST = [...SECRET_ALLOWLIST, SENSITIVE_KEY];

// ─── read_secret — TC-CRD-01..03 ─────────────────────────────────────────────

describe('read_secret — credential.read (credential_access) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-CRD-01: PERMIT — pipeline permits, readSecret executes and returns stored value', async () => {
    const params = { key: PERMITTED_KEY };
    const normalized = normalize_action('read_secret', params);

    expect(normalized.action_class).toBe('credential.read');
    expect(normalized.intent_group).toBe('credential_access');
    expect(normalized.hitl_mode).toBe('per_request');
    // 'key' is not in TARGET_PARAM_KEYS, so target is empty for credential tools.
    expect(normalized.target).toBe('');

    const payloadHash = computePayloadHash('read_secret', params);
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
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(pipelineResult.decision.effect).toBe('permit');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // Execute the tool now that the pipeline has issued a permit decision.
    const backend = new MemorySecretBackend({ [PERMITTED_KEY]: 'super-secret-value' });
    const toolResult = await readSecret(params, {
      allowlist: SECRET_ALLOWLIST,
      backend,
      approval_id: token,
      approvalManager: harness.approvalManager,
      agentId: RULE_CONTEXT.agentId,
      channel: RULE_CONTEXT.channel,
    });

    expect(toolResult.value).toBe('super-secret-value');
  });

  it('TC-CRD-02: HITL FORBID — no capability token, pipeline returns pending_hitl_approval for read_secret', async () => {
    const normalized = normalize_action('read_secret', { key: PERMITTED_KEY });
    const payloadHash = computePayloadHash('read_secret', { key: PERMITTED_KEY });

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

  it('TC-CRD-03: action-FORBID — stage2 blocks all credential.read access via action class policy', async () => {
    const params = { key: PERMITTED_KEY };
    const normalized = normalize_action('read_secret', params);
    const payloadHash = computePayloadHash('read_secret', params);
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
      buildCredentialClassForbidStage2(/^credential\.read$/),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('credential_access_forbidden');
    expect(result.decision.stage).toBe('stage2');
  });
});

// ─── write_secret — TC-CRD-04..06 ────────────────────────────────────────────

describe('write_secret — credential.write (credential_access) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-CRD-04: PERMIT — pipeline permits, writeSecret executes and returns written: true', async () => {
    const params = { key: PERMITTED_KEY, value: 'new-secret-value' };
    const normalized = normalize_action('write_secret', params);

    expect(normalized.action_class).toBe('credential.write');
    expect(normalized.intent_group).toBe('credential_access');
    expect(normalized.hitl_mode).toBe('per_request');
    // 'key' is not in TARGET_PARAM_KEYS, so target is empty for credential tools.
    expect(normalized.target).toBe('');

    const payloadHash = computePayloadHash('write_secret', params);
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
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(pipelineResult.decision.effect).toBe('permit');
    expect(auditEvents).toHaveLength(1);

    // Execute the tool now that the pipeline has issued a permit decision.
    const backend = new MemorySecretBackend();
    const toolResult = await writeSecret(params, {
      allowlist: FULL_ALLOWLIST,
      backend,
      approval_id: token,
      approvalManager: harness.approvalManager,
      agentId: RULE_CONTEXT.agentId,
      channel: RULE_CONTEXT.channel,
    });

    expect(toolResult.written).toBe(true);
    // Verify the value was actually written to the backend.
    expect(backend.get(PERMITTED_KEY)).toBe('new-secret-value');
  });

  it('TC-CRD-05: HITL FORBID — no capability token, pipeline returns pending_hitl_approval for write_secret', async () => {
    const normalized = normalize_action('write_secret', { key: PERMITTED_KEY, value: 'val' });
    const payloadHash = computePayloadHash('write_secret', { key: PERMITTED_KEY, value: 'val' });

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

  it('TC-CRD-06: action-FORBID — stage2 blocks all credential.write access via action class policy', async () => {
    const params = { key: PERMITTED_KEY, value: 'new-value' };
    const normalized = normalize_action('write_secret', params);
    const payloadHash = computePayloadHash('write_secret', params);
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
      buildCredentialClassForbidStage2(/^credential\.write$/),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('credential_access_forbidden');
    expect(result.decision.stage).toBe('stage2');
  });
});

// ─── rotate_secret — TC-CRD-07..09 ───────────────────────────────────────────

describe('rotate_secret — credential.rotate (credential_access) enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-CRD-07: PERMIT — pipeline permits, rotateSecret executes and returns rotated: true', async () => {
    const params = { key: PERMITTED_KEY };
    const normalized = normalize_action('rotate_secret', params);

    expect(normalized.action_class).toBe('credential.rotate');
    expect(normalized.intent_group).toBe('credential_access');
    expect(normalized.hitl_mode).toBe('per_request');
    // 'key' is not in TARGET_PARAM_KEYS, so target is empty for credential tools.
    expect(normalized.target).toBe('');

    const payloadHash = computePayloadHash('rotate_secret', params);
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
        ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
        approval_id: token,
        rule_context: RULE_CONTEXT,
      },
      harness.stage1,
      buildPermissiveStage2(),
      emitter,
    );

    expect(pipelineResult.decision.effect).toBe('permit');
    expect(auditEvents).toHaveLength(1);

    // Execute the tool now that the pipeline has issued a permit decision.
    // rotate_secret requires the key to already exist in the store.
    const originalValue = 'old-secret-hex-value';
    const backend = new MemorySecretBackend({ [PERMITTED_KEY]: originalValue });
    const toolResult = await rotateSecret(params, {
      allowlist: SECRET_ALLOWLIST,
      backend,
      approval_id: token,
      approvalManager: harness.approvalManager,
      agentId: RULE_CONTEXT.agentId,
      channel: RULE_CONTEXT.channel,
      // Deterministic value generator for test assertions.
      generateValue: () => 'rotated-value-64-hex-chars-deterministic-for-tests-00000000',
    });

    expect(toolResult.rotated).toBe(true);
    expect(toolResult.key).toBe(PERMITTED_KEY);
    // Verify the old value was actually replaced in the backend.
    expect(backend.get(PERMITTED_KEY)).not.toBe(originalValue);
    expect(backend.get(PERMITTED_KEY)).toBe('rotated-value-64-hex-chars-deterministic-for-tests-00000000');
  });

  it('TC-CRD-08: HITL FORBID — no capability token, pipeline returns pending_hitl_approval for rotate_secret', async () => {
    const normalized = normalize_action('rotate_secret', { key: PERMITTED_KEY });
    const payloadHash = computePayloadHash('rotate_secret', { key: PERMITTED_KEY });

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

  it('TC-CRD-09: action-FORBID — stage2 blocks all credential.rotate access via action class policy', async () => {
    const params = { key: PERMITTED_KEY };
    const normalized = normalize_action('rotate_secret', params);
    const payloadHash = computePayloadHash('rotate_secret', params);
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
      buildCredentialClassForbidStage2(/^credential\.rotate$/),
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('credential_access_forbidden');
    expect(result.decision.stage).toBe('stage2');
  });
});

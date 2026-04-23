/**
 * Pipeline integration tests — T22
 *
 * Verifies end-to-end pipeline behaviour for:
 *   TC-PI-01  tool:read forbid priority-200 rule blocks filesystem.read call
 *   TC-PI-02  blocked call emits executionEvent audit entry
 *   TC-PI-03  HITL approve flow: approved capability allows tool to proceed
 *   TC-PI-04  HITL deny flow: denied approval keeps tool blocked
 *   TC-PI-05  HITL timeout: expired approval applies configured fallback
 *
 * Uses patterns established in src/enforcement/approval-lifecycle.test.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './pipeline.js';
import type { PipelineContext, Stage1Fn, Stage2Fn } from './pipeline.js';
import { createStage2, createEnforcementEngine } from './stage2-policy.js';
import { validateCapability } from './stage1-capability.js';
import { ApprovalManager, computeBinding } from '../hitl/approval-manager.js';
import type { HitlPolicy } from '../hitl/types.js';
import type { Rule } from '../policy/types.js';
import type { Capability } from '../adapter/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const permitStage1: Stage1Fn = async () => ({
  effect: 'permit',
  reason: 'capability gate bypassed',
  stage: 'stage1',
});

const permitStage2: Stage2Fn = async () => ({
  effect: 'permit',
  reason: 'policy allow',
  stage: 'stage2',
});

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    action_class: 'filesystem.read',
    target: '/tmp/test.txt',
    payload_hash: 'abc123',
    hitl_mode: 'none',
    rule_context: { agentId: 'agent-1', channel: 'test' },
    ...overrides,
  };
}

const baseHitlPolicy: HitlPolicy = {
  name: 'test-policy',
  actions: ['*'],
  approval: { channel: 'slack', timeout: 30, fallback: 'deny' },
};

function makeCapability(
  approval_id: string,
  action_class: string,
  target: string,
  payload_hash: string,
  overrides?: Partial<Omit<Capability, 'approval_id' | 'action_class' | 'target' | 'binding'>>,
): Capability {
  return {
    approval_id,
    binding: computeBinding(action_class, target, payload_hash),
    action_class,
    target,
    issued_at: Date.now() - 1_000,
    expires_at: Date.now() + 3_600_000,
    ...overrides,
  };
}

/** Builds a stage1 function backed by a real ApprovalManager + capability store. */
function makeRealStage1(
  manager: ApprovalManager,
  capStore: Map<string, Capability>,
): Stage1Fn {
  return (ctx: PipelineContext) => validateCapability(ctx, manager, (id) => capStore.get(id));
}

// ─── TC-PI-01: tool:read forbid priority-200 rule ─────────────────────────────

describe('TC-PI-01: tool:read forbid priority-200 rule blocks filesystem.read', () => {
  // EnforcementPolicyEngine maps filesystem.* → resource 'tool'.
  // A rule with resource:'tool' + match:'*' covers all filesystem action targets.
  const FORBID_READ_RULE: Rule = {
    resource: 'tool',
    match: '*',
    effect: 'forbid',
    priority: 200,
    reason: 'filesystem.read blocked by priority-200 rule',
  };

  it('forbids filesystem.read when priority-200 forbid rule is loaded', async () => {
    const engine = createEnforcementEngine([FORBID_READ_RULE]);
    const stage2 = createStage2(engine);

    const result = await runPipeline(makeCtx(), permitStage1, stage2, new EventEmitter());

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('filesystem.read blocked by priority-200 rule');
    expect(result.decision.stage).toBe('stage2');
  });

  it('priority-200 forbid rule wins over implicit permit (Cedar forbid-wins)', async () => {
    const engine = createEnforcementEngine([FORBID_READ_RULE]);
    const stage2 = createStage2(engine);

    const result = await runPipeline(makeCtx(), permitStage1, stage2, new EventEmitter());

    expect(result.decision.effect).toBe('forbid');
  });

  it('priority-200 forbid rule applies regardless of target path', async () => {
    const engine = createEnforcementEngine([FORBID_READ_RULE]);
    const stage2 = createStage2(engine);

    const targets = ['/etc/passwd', '/tmp/test.txt', '/home/user/docs/report.pdf'];
    for (const target of targets) {
      const result = await runPipeline(
        makeCtx({ target }),
        permitStage1,
        stage2,
        new EventEmitter(),
      );
      expect(result.decision.effect).toBe('forbid');
    }
  });

  it('stage1 still runs before priority-200 stage2 rule is evaluated', async () => {
    const stage1Spy = vi.fn<Stage1Fn>().mockResolvedValue({
      effect: 'permit',
      reason: 'stage1 pass',
      stage: 'stage1',
    });
    const engine = createEnforcementEngine([FORBID_READ_RULE]);
    const stage2 = createStage2(engine);

    await runPipeline(makeCtx(), stage1Spy, stage2, new EventEmitter());

    expect(stage1Spy).toHaveBeenCalledOnce();
  });

  it('stage1 forbid prevents stage2 from applying the priority-200 rule', async () => {
    const stage1Deny: Stage1Fn = async () => ({
      effect: 'forbid',
      reason: 'stage1_deny',
      stage: 'stage1',
    });
    const stage2Spy = vi.fn<Stage2Fn>().mockResolvedValue({
      effect: 'forbid',
      reason: 'should not be reached',
      stage: 'stage2',
    });

    await runPipeline(makeCtx(), stage1Deny, stage2Spy, new EventEmitter());

    expect(stage2Spy).not.toHaveBeenCalled();
  });
});

// ─── TC-PI-02: blocked call emits audit entry ─────────────────────────────────

describe('TC-PI-02: blocked call emits executionEvent audit entry', () => {
  const FORBID_READ_RULE: Rule = {
    resource: 'tool',
    match: '*',
    effect: 'forbid',
    priority: 200,
    reason: 'read_file_blocked_priority_200',
  };

  it('emits exactly one executionEvent when blocked by priority-200 rule', async () => {
    const engine = createEnforcementEngine([FORBID_READ_RULE]);
    const stage2 = createStage2(engine);
    const emitter = new EventEmitter();
    const events: unknown[] = [];
    emitter.on('executionEvent', (e) => events.push(e));

    await runPipeline(makeCtx(), permitStage1, stage2, emitter);

    expect(events).toHaveLength(1);
  });

  it('executionEvent carries forbid effect and rule reason when call is blocked', async () => {
    const engine = createEnforcementEngine([FORBID_READ_RULE]);
    const stage2 = createStage2(engine);
    const emitter = new EventEmitter();
    let event: Record<string, unknown> | undefined;
    emitter.on('executionEvent', (e) => { event = e as Record<string, unknown>; });

    await runPipeline(makeCtx(), permitStage1, stage2, emitter);

    expect(event!.decision).toMatchObject({
      effect: 'forbid',
      reason: 'read_file_blocked_priority_200',
    });
  });

  it('executionEvent carries an ISO timestamp when call is blocked', async () => {
    const engine = createEnforcementEngine([FORBID_READ_RULE]);
    const stage2 = createStage2(engine);
    const emitter = new EventEmitter();
    let event: Record<string, unknown> | undefined;
    emitter.on('executionEvent', (e) => { event = e as Record<string, unknown>; });

    await runPipeline(makeCtx(), permitStage1, stage2, emitter);

    expect(typeof event?.timestamp).toBe('string');
    expect(event!.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('executionEvent is emitted even when stage1 blocks the call', async () => {
    const stage1Deny: Stage1Fn = async () => ({
      effect: 'forbid',
      reason: 'stage1_capability_error',
      stage: 'stage1',
    });
    const emitter = new EventEmitter();
    const events: unknown[] = [];
    emitter.on('executionEvent', (e) => events.push(e));

    await runPipeline(makeCtx(), stage1Deny, permitStage2, emitter);

    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>).decision).toMatchObject({ effect: 'forbid' });
  });
});

// ─── TC-PI-03: HITL approve allows tool to proceed ────────────────────────────

describe('TC-PI-03: HITL approve flow — approved capability allows tool to proceed', () => {
  it('first call without approval_id returns pending_hitl_approval', async () => {
    const result = await runPipeline(
      makeCtx({ hitl_mode: 'per_request' }),
      permitStage1,
      permitStage2,
      new EventEmitter(),
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pending_hitl_approval');
  });

  it('approved capability allows the second call to proceed', async () => {
    const manager = new ApprovalManager();
    const ACTION_CLASS = 'filesystem.read';
    const TARGET = '/tmp/safe.txt';
    const PAYLOAD_HASH = 'hash-pi03-a';
    const CAP_ID = 'cap-pi03-approved-001';

    // Simulate operator approval cycle
    const handle = manager.createApprovalRequest({
      toolName: 'read_file',
      agentId: 'agent-1',
      channelId: 'default',
      policy: baseHitlPolicy,
      action_class: ACTION_CLASS,
      target: TARGET,
      payload_hash: PAYLOAD_HASH,
    });
    manager.resolveApproval(handle.token, 'approved');

    // Issue a fresh capability (distinct ID from the approval token)
    const cap = makeCapability(CAP_ID, ACTION_CLASS, TARGET, PAYLOAD_HASH);
    const capStore = new Map([[CAP_ID, cap]]);
    const stage1 = makeRealStage1(manager, capStore);

    const result = await runPipeline(
      makeCtx({
        action_class: ACTION_CLASS,
        target: TARGET,
        payload_hash: PAYLOAD_HASH,
        hitl_mode: 'per_request',
        approval_id: CAP_ID,
      }),
      stage1,
      permitStage2,
      new EventEmitter(),
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('approved capability emits permit executionEvent', async () => {
    const manager = new ApprovalManager();
    const ACTION_CLASS = 'filesystem.read';
    const TARGET = '/tmp/safe.txt';
    const PAYLOAD_HASH = 'hash-pi03-b';
    const CAP_ID = 'cap-pi03-approved-002';

    const handle = manager.createApprovalRequest({
      toolName: 'read_file',
      agentId: 'agent-1',
      channelId: 'default',
      policy: baseHitlPolicy,
      action_class: ACTION_CLASS,
      target: TARGET,
      payload_hash: PAYLOAD_HASH,
    });
    manager.resolveApproval(handle.token, 'approved');

    const cap = makeCapability(CAP_ID, ACTION_CLASS, TARGET, PAYLOAD_HASH);
    const capStore = new Map([[CAP_ID, cap]]);
    const stage1 = makeRealStage1(manager, capStore);

    const emitter = new EventEmitter();
    const events: Array<Record<string, unknown>> = [];
    emitter.on('executionEvent', (e) => events.push(e as Record<string, unknown>));

    await runPipeline(
      makeCtx({
        action_class: ACTION_CLASS,
        target: TARGET,
        payload_hash: PAYLOAD_HASH,
        hitl_mode: 'per_request',
        approval_id: CAP_ID,
      }),
      stage1,
      permitStage2,
      emitter,
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toMatchObject({ effect: 'permit' });
  });

  it('HITL approve does not call stage2 before approval_id is present', async () => {
    const stage2Spy = vi.fn<Stage2Fn>().mockResolvedValue({
      effect: 'permit',
      reason: 'ok',
      stage: 'stage2',
    });

    // First call: no approval_id → HITL pre-check fires, stage2 never called
    await runPipeline(
      makeCtx({ hitl_mode: 'per_request' }),
      permitStage1,
      stage2Spy,
      new EventEmitter(),
    );

    expect(stage2Spy).not.toHaveBeenCalled();
  });
});

// ─── TC-PI-04: HITL deny keeps tool blocked ───────────────────────────────────

describe('TC-PI-04: HITL deny flow — denied approval keeps tool blocked', () => {
  it('denied approval produces no capability — call without approval_id is still blocked', async () => {
    const manager = new ApprovalManager();

    const handle = manager.createApprovalRequest({
      toolName: 'read_file',
      agentId: 'agent-1',
      channelId: 'default',
      policy: baseHitlPolicy,
      action_class: 'filesystem.read',
      target: '/tmp/test.txt',
      payload_hash: 'hash-pi04-a',
    });
    // Operator denies — no capability is issued
    manager.resolveApproval(handle.token, 'denied');

    // Subsequent call without approval_id remains blocked
    const result = await runPipeline(
      makeCtx({ hitl_mode: 'per_request' }),
      permitStage1,
      permitStage2,
      new EventEmitter(),
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pending_hitl_approval');
  });

  it('denied approval token cannot be used as a capability ID', async () => {
    const manager = new ApprovalManager();
    const ACTION_CLASS = 'filesystem.read';
    const TARGET = '/tmp/test.txt';
    const PAYLOAD_HASH = 'hash-pi04-b';

    const handle = manager.createApprovalRequest({
      toolName: 'read_file',
      agentId: 'agent-1',
      channelId: 'default',
      policy: baseHitlPolicy,
      action_class: ACTION_CLASS,
      target: TARGET,
      payload_hash: PAYLOAD_HASH,
    });
    manager.resolveApproval(handle.token, 'denied');

    // No capability in store (none was issued on deny)
    const capStore = new Map<string, Capability>();
    const stage1 = makeRealStage1(manager, capStore);

    const result = await runPipeline(
      makeCtx({
        action_class: ACTION_CLASS,
        target: TARGET,
        payload_hash: PAYLOAD_HASH,
        hitl_mode: 'per_request',
        approval_id: handle.token,
      }),
      stage1,
      permitStage2,
      new EventEmitter(),
    );

    // Capability not in store → stage1 returns 'capability not found'
    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('capability not found');
  });

  it('executionEvent is emitted with forbid decision after denial', async () => {
    const emitter = new EventEmitter();
    const events: Array<Record<string, unknown>> = [];
    emitter.on('executionEvent', (e) => events.push(e as Record<string, unknown>));

    await runPipeline(
      makeCtx({ hitl_mode: 'per_request' }),
      permitStage1,
      permitStage2,
      emitter,
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toMatchObject({
      effect: 'forbid',
      reason: 'pending_hitl_approval',
    });
  });

  it('deny decision is recorded on the approval manager token', async () => {
    const manager = new ApprovalManager();

    const handle = manager.createApprovalRequest({
      toolName: 'read_file',
      agentId: 'agent-1',
      channelId: 'default',
      policy: baseHitlPolicy,
      action_class: 'filesystem.read',
      target: '/tmp/test.txt',
      payload_hash: 'hash-pi04-c',
    });
    manager.resolveApproval(handle.token, 'denied');

    // Token is consumed (moved from pending to consumed set)
    expect(manager.isConsumed(handle.token)).toBe(true);
    // And it is no longer in the pending queue
    expect(manager.size).toBe(0);
  });
});

// ─── TC-PI-05: HITL timeout applies fallback ──────────────────────────────────

describe('TC-PI-05: HITL timeout applies fallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fallback=deny: approval promise resolves as expired after timeout fires', async () => {
    vi.useFakeTimers();
    const manager = new ApprovalManager();
    const TIMEOUT_S = 5;

    const handle = manager.createApprovalRequest({
      toolName: 'read_file',
      agentId: 'agent-1',
      channelId: 'default',
      policy: {
        name: 'deny-fallback',
        actions: ['*'],
        approval: { channel: 'slack', timeout: TIMEOUT_S, fallback: 'deny' },
      },
      action_class: 'filesystem.read',
      target: '/tmp/test.txt',
      payload_hash: 'hash-pi05-deny',
    });

    await vi.advanceTimersByTimeAsync(TIMEOUT_S * 1000 + 100);
    const decision = await handle.promise;

    expect(decision).toBe('expired');
    expect(manager.isConsumed(handle.token)).toBe(true);
  });

  it('fallback=deny: token is consumed after timeout — no capability is issued', async () => {
    vi.useFakeTimers();
    const manager = new ApprovalManager();
    const TIMEOUT_S = 2;

    const handle = manager.createApprovalRequest({
      toolName: 'read_file',
      agentId: 'agent-1',
      channelId: 'default',
      policy: {
        name: 'deny-fallback',
        actions: ['*'],
        approval: { channel: 'slack', timeout: TIMEOUT_S, fallback: 'deny' },
      },
      action_class: 'filesystem.read',
      target: '/tmp/test.txt',
      payload_hash: 'hash-pi05-block',
    });

    await vi.advanceTimersByTimeAsync(TIMEOUT_S * 1000 + 100);
    await handle.promise; // resolves 'expired'

    vi.useRealTimers();

    // fallback=deny: no capability is issued → subsequent call without approval_id stays blocked
    const result = await runPipeline(
      makeCtx({ hitl_mode: 'per_request' }),
      permitStage1,
      permitStage2,
      new EventEmitter(),
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pending_hitl_approval');
  });

  it('fallback=auto-approve: expired approval allows tool when capability is auto-issued', async () => {
    vi.useFakeTimers();
    const manager = new ApprovalManager();
    const TIMEOUT_S = 2;
    const ACTION_CLASS = 'filesystem.read';
    const TARGET = '/tmp/test.txt';
    const PAYLOAD_HASH = 'hash-pi05-auto';
    const CAP_ID = 'cap-pi05-auto-001';

    const handle = manager.createApprovalRequest({
      toolName: 'read_file',
      agentId: 'agent-1',
      channelId: 'default',
      policy: {
        name: 'auto-approve-fallback',
        actions: ['*'],
        approval: { channel: 'slack', timeout: TIMEOUT_S, fallback: 'auto-approve' },
      },
      action_class: ACTION_CLASS,
      target: TARGET,
      payload_hash: PAYLOAD_HASH,
    });

    await vi.advanceTimersByTimeAsync(TIMEOUT_S * 1000 + 100);
    const decision = await handle.promise;
    expect(decision).toBe('expired');

    vi.useRealTimers();

    // Plugin auto-issues a capability when fallback=auto-approve and decision is 'expired'
    const cap = makeCapability(CAP_ID, ACTION_CLASS, TARGET, PAYLOAD_HASH);
    const capStore = new Map([[CAP_ID, cap]]);
    const stage1 = makeRealStage1(manager, capStore);

    const result = await runPipeline(
      makeCtx({
        action_class: ACTION_CLASS,
        target: TARGET,
        payload_hash: PAYLOAD_HASH,
        hitl_mode: 'per_request',
        approval_id: CAP_ID,
      }),
      stage1,
      permitStage2,
      new EventEmitter(),
    );

    expect(result.decision.effect).toBe('permit');
  });

  it('fallback=auto-approve: auto-issued capability emits permit executionEvent', async () => {
    vi.useFakeTimers();
    const manager = new ApprovalManager();
    const TIMEOUT_S = 1;
    const ACTION_CLASS = 'filesystem.read';
    const TARGET = '/tmp/test.txt';
    const PAYLOAD_HASH = 'hash-pi05-auto-event';
    const CAP_ID = 'cap-pi05-auto-002';

    const handle = manager.createApprovalRequest({
      toolName: 'read_file',
      agentId: 'agent-1',
      channelId: 'default',
      policy: {
        name: 'auto-approve-fallback',
        actions: ['*'],
        approval: { channel: 'slack', timeout: TIMEOUT_S, fallback: 'auto-approve' },
      },
      action_class: ACTION_CLASS,
      target: TARGET,
      payload_hash: PAYLOAD_HASH,
    });

    await vi.advanceTimersByTimeAsync(TIMEOUT_S * 1000 + 100);
    await handle.promise;

    vi.useRealTimers();

    const cap = makeCapability(CAP_ID, ACTION_CLASS, TARGET, PAYLOAD_HASH);
    const capStore = new Map([[CAP_ID, cap]]);
    const stage1 = makeRealStage1(manager, capStore);

    const emitter = new EventEmitter();
    const events: Array<Record<string, unknown>> = [];
    emitter.on('executionEvent', (e) => events.push(e as Record<string, unknown>));

    await runPipeline(
      makeCtx({
        action_class: ACTION_CLASS,
        target: TARGET,
        payload_hash: PAYLOAD_HASH,
        hitl_mode: 'per_request',
        approval_id: CAP_ID,
      }),
      stage1,
      permitStage2,
      emitter,
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toMatchObject({ effect: 'permit' });
    expect(typeof events[0]!.timestamp).toBe('string');
    expect(events[0]!.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

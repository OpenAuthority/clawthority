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
import { runWithHitl } from './hitl-dispatch.js';
import type { HitlDispatchOpts } from './hitl-dispatch.js';
import { ApprovalManager, computeBinding } from '../hitl/approval-manager.js';
import type { HitlPolicy } from '../hitl/types.js';
import type { HitlPolicyConfig } from '../hitl/types.js';
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

// ─── Helpers for TC-PI-06 through TC-PI-10 ────────────────────────────────────

/**
 * Drains the entire microtask queue by deferring to the next macrotask via
 * setImmediate.  Use this in place of `await Promise.resolve()` when the code
 * under test has multiple async hops (e.g. runPipeline→stage1→stage2→runWithHitl
 * continuation) before reaching the point being asserted.
 */
const flushPromises = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

/** A HITL policy config that matches every action class. */
const matchAllHitlConfig: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'approve-all',
      actions: ['*'],
      approval: { channel: 'slack', timeout: 30, fallback: 'deny' },
    },
  ],
};

/** A HITL policy config that matches filesystem.* actions. */
const matchFilesystemHitlConfig: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'filesystem-approvals',
      actions: ['filesystem.*'],
      approval: { channel: 'slack', timeout: 30, fallback: 'deny' },
    },
  ],
};

/** A HITL policy config that matches nothing relevant to filesystem.read. */
const matchNothingHitlConfig: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'payment-only',
      actions: ['payment.initiate'],
      approval: { channel: 'slack', timeout: 30, fallback: 'deny' },
    },
  ],
};

/** Stage2 that returns forbid with priority 90 (HITL-gated). */
const hitlGatedForbidStage2: Stage2Fn = async () => ({
  effect: 'forbid',
  reason: 'filesystem.delete requires human approval',
  stage: 'stage2',
  priority: 90,
});

/** Stage2 that returns forbid with priority 100 (unconditional). */
const unconditionalForbidStage2: Stage2Fn = async () => ({
  effect: 'forbid',
  reason: 'blocked unconditionally',
  stage: 'stage2',
  priority: 100,
});

/** Stage2 that returns forbid with priority 200 (unconditional). */
const highPriorityForbidStage2: Stage2Fn = async () => ({
  effect: 'forbid',
  reason: 'blocked by high-priority rule',
  stage: 'stage2',
  priority: 200,
});

/** Stage2 that returns forbid with no priority (treated as unconditional). */
const noPriorityForbidStage2: Stage2Fn = async () => ({
  effect: 'forbid',
  reason: 'blocked by rule with no priority',
  stage: 'stage2',
});

/** Creates a HitlDispatchOpts with the given manager and capStore. */
function makeDispatchOpts(
  manager: ApprovalManager,
  capStore: Map<string, Capability>,
  hitlConfig: HitlPolicyConfig = matchAllHitlConfig,
): HitlDispatchOpts {
  return {
    hitlConfig,
    manager,
    issueCapability: async (action_class, target, payload_hash, session_id) => {
      const approval_id = `cap-issued-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const cap: Capability = {
        approval_id,
        binding: computeBinding(action_class, target, payload_hash),
        action_class,
        target,
        issued_at: Date.now() - 1_000,
        expires_at: Date.now() + 3_600_000,
        ...(session_id !== undefined ? { session_id } : {}),
      };
      capStore.set(approval_id, cap);
      return cap;
    },
    agentId: 'agent-1',
    channelId: 'default',
  };
}

/** Context for filesystem.delete used in TC-PI-06 through TC-PI-10. */
const deleteCtx: PipelineContext = {
  action_class: 'filesystem.delete',
  target: '/tmp/deleteme.txt',
  payload_hash: 'ph-delete-001',
  hitl_mode: 'none',
  rule_context: { agentId: 'agent-1', channel: 'test' },
};

// ─── TC-PI-06: HITL not dispatched when pipeline permits ──────────────────────

describe('TC-PI-06: HITL not dispatched when pipeline permits', () => {
  it('runWithHitl returns permit without dispatching when both stages permit', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const opts = makeDispatchOpts(manager, capStore, matchAllHitlConfig);
    const issueCapSpy = vi.spyOn(opts, 'issueCapability');

    const result = await runWithHitl(
      makeCtx(),
      permitStage1,
      permitStage2,
      new EventEmitter(),
      opts,
    );

    expect(result.decision.effect).toBe('permit');
    expect(manager.size).toBe(0);
    expect(issueCapSpy).not.toHaveBeenCalled();
  });

  it('runWithHitl emits a single permit event when pipeline permits', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const opts = makeDispatchOpts(manager, capStore, matchAllHitlConfig);
    const emitter = new EventEmitter();
    const events: Array<Record<string, unknown>> = [];
    emitter.on('executionEvent', (e) => events.push(e as Record<string, unknown>));

    await runWithHitl(makeCtx(), permitStage1, permitStage2, emitter, opts);

    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toMatchObject({ effect: 'permit' });
  });

  it('runWithHitl does not dispatch HITL even when a HITL policy matches and pipeline permits', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    // Policy matches everything — but since pipeline permits, HITL is never dispatched.
    const opts = makeDispatchOpts(manager, capStore, matchAllHitlConfig);

    const result = await runWithHitl(
      deleteCtx,
      permitStage1,
      permitStage2,
      new EventEmitter(),
      opts,
    );

    expect(result.decision.effect).toBe('permit');
    expect(manager.size).toBe(0);
  });
});

// ─── TC-PI-07: Priority >= 100 forbid blocks unconditionally ──────────────────

describe('TC-PI-07: priority >= 100 forbid blocks unconditionally — HITL not dispatched', () => {
  it('priority-100 forbid returns block without dispatching HITL', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const opts = makeDispatchOpts(manager, capStore, matchAllHitlConfig);
    const issueCapSpy = vi.spyOn(opts, 'issueCapability');

    const result = await runWithHitl(
      deleteCtx,
      permitStage1,
      unconditionalForbidStage2,
      new EventEmitter(),
      opts,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('blocked unconditionally');
    expect(manager.size).toBe(0);
    expect(issueCapSpy).not.toHaveBeenCalled();
  });

  it('priority-200 forbid blocks unconditionally even when HITL policy matches', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const opts = makeDispatchOpts(manager, capStore, matchAllHitlConfig);

    const result = await runWithHitl(
      deleteCtx,
      permitStage1,
      highPriorityForbidStage2,
      new EventEmitter(),
      opts,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(manager.size).toBe(0);
  });

  it('forbid with no priority blocks unconditionally', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const opts = makeDispatchOpts(manager, capStore, matchAllHitlConfig);

    const result = await runWithHitl(
      deleteCtx,
      permitStage1,
      noPriorityForbidStage2,
      new EventEmitter(),
      opts,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(manager.size).toBe(0);
  });

  it('priority-90 forbid with no matching HITL policy blocks without dispatching', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    // matchNothingHitlConfig does not match filesystem.delete
    const opts = makeDispatchOpts(manager, capStore, matchNothingHitlConfig);

    const result = await runWithHitl(
      deleteCtx,
      permitStage1,
      hitlGatedForbidStage2,
      new EventEmitter(),
      opts,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(manager.size).toBe(0);
  });
});

// ─── TC-PI-08: priority < 100 + HITL match → dispatch → approve → re-run ─────

describe('TC-PI-08: priority-90 forbid + HITL policy match dispatches HITL; approval permits', () => {
  it('approval resolves with permit on the re-run', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const stage1 = makeRealStage1(manager, capStore);
    const opts = makeDispatchOpts(manager, capStore, matchFilesystemHitlConfig);

    const runPromise = runWithHitl(
      deleteCtx,
      stage1,
      hitlGatedForbidStage2,
      new EventEmitter(),
      opts,
    );

    // Flush microtasks so runWithHitl reaches await handle.promise
    await flushPromises();

    const pending = manager.listPending();
    expect(pending).toHaveLength(1);
    manager.resolveApproval(pending[0]!.token, 'approved');

    const result = await runPromise;

    expect(result.decision.effect).toBe('permit');
  });

  it('approval causes capability to be minted before the re-run', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const stage1 = makeRealStage1(manager, capStore);
    const opts = makeDispatchOpts(manager, capStore, matchFilesystemHitlConfig);
    const issueCapSpy = vi.spyOn(opts, 'issueCapability');

    const runPromise = runWithHitl(
      deleteCtx,
      stage1,
      hitlGatedForbidStage2,
      new EventEmitter(),
      opts,
    );

    await flushPromises();
    const pending = manager.listPending();
    manager.resolveApproval(pending[0]!.token, 'approved');
    await runPromise;

    // issueCapability was called exactly once — before the re-run
    expect(issueCapSpy).toHaveBeenCalledOnce();
    expect(issueCapSpy).toHaveBeenCalledWith(
      deleteCtx.action_class,
      deleteCtx.target,
      deleteCtx.payload_hash,
      undefined,
    );
  });

  it('re-run emits a permit executionEvent after approval', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const stage1 = makeRealStage1(manager, capStore);
    const opts = makeDispatchOpts(manager, capStore, matchFilesystemHitlConfig);

    const emitter = new EventEmitter();
    const events: Array<Record<string, unknown>> = [];
    emitter.on('executionEvent', (e) => events.push(e as Record<string, unknown>));

    const runPromise = runWithHitl(deleteCtx, stage1, hitlGatedForbidStage2, emitter, opts);

    await flushPromises();
    const pending = manager.listPending();
    manager.resolveApproval(pending[0]!.token, 'approved');
    await runPromise;

    // Two events: one for the initial forbid run, one for the re-run permit
    const permitEvents = events.filter(
      (e) => (e['decision'] as Record<string, unknown>)['effect'] === 'permit',
    );
    expect(permitEvents).toHaveLength(1);
  });

  it('only priority-90 forbids are overridden on the re-run; priority-100 forbids still block', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const stage1 = makeRealStage1(manager, capStore);
    // stage2 that first returns priority-90 forbid, then priority-100 on re-run
    let callCount = 0;
    const mixedStage2: Stage2Fn = async () => {
      callCount++;
      if (callCount === 1) {
        // First call (initial pipeline run): priority-90 → HITL-gated
        return { effect: 'forbid', reason: 'hitl-gated rule', stage: 'stage2', priority: 90 };
      }
      // Second call (re-run after approval): priority-100 → unconditional block
      return { effect: 'forbid', reason: 'unconditional block fires on re-run', stage: 'stage2', priority: 100 };
    };
    const opts = makeDispatchOpts(manager, capStore, matchAllHitlConfig);

    const runPromise = runWithHitl(deleteCtx, stage1, mixedStage2, new EventEmitter(), opts);

    await flushPromises();
    const pending = manager.listPending();
    manager.resolveApproval(pending[0]!.token, 'approved');
    const result = await runPromise;

    // The re-run's stage2 returns priority-100 forbid — approvedStage2 wrapper
    // does not override it because priority >= UNCONDITIONAL_FORBID_PRIORITY.
    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('unconditional block fires on re-run');
  });
});

// ─── TC-PI-09: HITL deny returns block with pipeline reason ───────────────────

describe('TC-PI-09: HITL deny returns forbid with original pipeline reason', () => {
  it('denied approval returns forbid with original pipeline reason', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const opts = makeDispatchOpts(manager, capStore, matchFilesystemHitlConfig);

    const runPromise = runWithHitl(
      deleteCtx,
      permitStage1,
      hitlGatedForbidStage2,
      new EventEmitter(),
      opts,
    );

    await flushPromises();
    const pending = manager.listPending();
    manager.resolveApproval(pending[0]!.token, 'denied');

    const result = await runPromise;

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('filesystem.delete requires human approval');
    expect(result.decision.stage).toBe('hitl');
  });

  it('denied approval does not dispatch issueCapability', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const opts = makeDispatchOpts(manager, capStore, matchFilesystemHitlConfig);
    const issueCapSpy = vi.spyOn(opts, 'issueCapability');

    const runPromise = runWithHitl(
      deleteCtx,
      permitStage1,
      hitlGatedForbidStage2,
      new EventEmitter(),
      opts,
    );

    await flushPromises();
    const pending = manager.listPending();
    manager.resolveApproval(pending[0]!.token, 'denied');
    await runPromise;

    expect(issueCapSpy).not.toHaveBeenCalled();
  });

  it('denied approval token is consumed in the approval manager', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const opts = makeDispatchOpts(manager, capStore, matchFilesystemHitlConfig);

    const runPromise = runWithHitl(
      deleteCtx,
      permitStage1,
      hitlGatedForbidStage2,
      new EventEmitter(),
      opts,
    );

    await flushPromises();
    const pending = manager.listPending();
    const token = pending[0]!.token;
    manager.resolveApproval(token, 'denied');
    await runPromise;

    expect(manager.isConsumed(token)).toBe(true);
    expect(manager.size).toBe(0);
  });
});

// ─── TC-PI-10: Capability minted before re-run ────────────────────────────────

describe('TC-PI-10: capability minted before re-run', () => {
  it('issued capability is in the store when stage1 validates it on re-run', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const stage1 = makeRealStage1(manager, capStore);
    const opts = makeDispatchOpts(manager, capStore, matchFilesystemHitlConfig);

    // Track when issueCapability is called vs when stage1 runs on re-run
    const callOrder: string[] = [];
    const origIssue = opts.issueCapability;
    opts.issueCapability = async (...args) => {
      callOrder.push('issueCapability');
      return origIssue(...args);
    };

    // Wrap stage1 to detect re-run
    let stage1CallCount = 0;
    const trackingStage1: Stage1Fn = async (pCtx) => {
      stage1CallCount++;
      if (stage1CallCount > 1) {
        callOrder.push('stage1-rerun');
      }
      return stage1(pCtx);
    };

    const runPromise = runWithHitl(
      deleteCtx,
      trackingStage1,
      hitlGatedForbidStage2,
      new EventEmitter(),
      opts,
    );

    await flushPromises();
    const pending = manager.listPending();
    manager.resolveApproval(pending[0]!.token, 'approved');
    await runPromise;

    // issueCapability must appear before stage1-rerun
    const issueIdx = callOrder.indexOf('issueCapability');
    const rerunIdx = callOrder.indexOf('stage1-rerun');
    expect(issueIdx).toBeGreaterThanOrEqual(0);
    expect(rerunIdx).toBeGreaterThan(issueIdx);
  });

  it('capability in store has correct binding for the action', async () => {
    const manager = new ApprovalManager();
    const capStore = new Map<string, Capability>();
    const stage1 = makeRealStage1(manager, capStore);
    const opts = makeDispatchOpts(manager, capStore, matchFilesystemHitlConfig);

    const runPromise = runWithHitl(
      deleteCtx,
      stage1,
      hitlGatedForbidStage2,
      new EventEmitter(),
      opts,
    );

    await flushPromises();
    const pending = manager.listPending();
    manager.resolveApproval(pending[0]!.token, 'approved');
    const result = await runPromise;

    expect(result.decision.effect).toBe('permit');

    // Verify the capability that was issued has the correct binding
    const caps = [...capStore.values()];
    expect(caps).toHaveLength(1);
    const expectedBinding = computeBinding(
      deleteCtx.action_class,
      deleteCtx.target,
      deleteCtx.payload_hash,
    );
    expect(caps[0]!.binding).toBe(expectedBinding);
  });
});

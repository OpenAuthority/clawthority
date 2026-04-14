/**
 * TC-14: Approval token one-time consumption
 * TC-15: Session scope binding
 *
 * Integration tests combining a real ApprovalManager, validateCapability,
 * and runPipeline to verify approval token lifecycle and session binding.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { ApprovalManager, computeBinding } from '../hitl/approval-manager.js';
import type { HitlPolicy } from '../hitl/types.js';
import { validateCapability } from './stage1-capability.js';
import { runPipeline } from './pipeline.js';
import type { PipelineContext, Stage2Fn } from './pipeline.js';
import type { Capability } from '../adapter/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const permitStage2: Stage2Fn = async () => ({ effect: 'permit', reason: 'policy allow', stage: 'stage2' });

function makeStage1(
  approvalManager: ApprovalManager,
  getCapability: (id: string) => Capability | undefined,
) {
  return (ctx: PipelineContext) => validateCapability(ctx, approvalManager, getCapability);
}

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

const basePolicy: HitlPolicy = {
  name: 'test-policy',
  actions: ['*'],
  approval: { channel: 'slack', timeout: 30, fallback: 'deny' },
};

// ─── TC-14: One-time consumption ─────────────────────────────────────────────

describe('TC-14: approval token one-time consumption', () => {
  it('second use of same approval token is denied', async () => {
    const manager = new ApprovalManager();

    const handle = manager.createApprovalRequest({
      toolName: 'file.write',
      agentId: 'agent-1',
      channelId: 'default',
      policy: basePolicy,
      action_class: 'file.write',
      target: '/tmp/output.txt',
      payload_hash: 'hash-tc14-a',
    });

    // Consume the token — moves it from pending to consumed
    manager.resolveApproval(handle.token, 'approved');
    expect(manager.isConsumed(handle.token)).toBe(true);

    const cap = makeCapability(handle.token, 'file.write', '/tmp/output.txt', 'hash-tc14-a');
    const capStore = new Map([[handle.token, cap]]);
    const stage1 = makeStage1(manager, (id) => capStore.get(id));

    const ctx: PipelineContext = {
      action_class: 'file.write',
      target: '/tmp/output.txt',
      payload_hash: 'hash-tc14-a',
      hitl_mode: 'per_request',
      approval_id: handle.token,
      session_id: 'session-001',
      rule_context: { agentId: 'agent-1', channel: 'test' },
    };

    const emitter = new EventEmitter();
    const events: Array<Record<string, unknown>> = [];
    emitter.on('executionEvent', (e) => events.push(e as Record<string, unknown>));

    const result = await runPipeline(ctx, stage1, permitStage2, emitter);

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('capability already consumed');
    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toMatchObject({ effect: 'forbid', reason: 'capability already consumed' });
    expect(typeof events[0]!.timestamp).toBe('string');
    expect(events[0]!.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('deny reason for duplicate use is capability already consumed', async () => {
    const manager = new ApprovalManager();

    const handle = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-2',
      channelId: 'default',
      policy: basePolicy,
      action_class: 'email.send',
      target: 'user@example.com',
      payload_hash: 'hash-tc14-b',
    });

    manager.resolveApproval(handle.token, 'approved');

    const cap = makeCapability(handle.token, 'email.send', 'user@example.com', 'hash-tc14-b');
    const capStore = new Map([[handle.token, cap]]);
    const stage1 = makeStage1(manager, (id) => capStore.get(id));

    const ctx: PipelineContext = {
      action_class: 'email.send',
      target: 'user@example.com',
      payload_hash: 'hash-tc14-b',
      hitl_mode: 'per_request',
      approval_id: handle.token,
      session_id: 'session-002',
      rule_context: { agentId: 'agent-2', channel: 'test' },
    };

    const result = await runPipeline(ctx, stage1, permitStage2, new EventEmitter());

    expect(result.decision.reason).toBe('capability already consumed');
  });
});

// ─── TC-15: Session scope binding ────────────────────────────────────────────

describe('TC-15: session scope binding', () => {
  it('approval from session A is denied when used in session B', async () => {
    const manager = new ApprovalManager();

    const cap = makeCapability(
      'cap-session-bound-001',
      'database.query',
      'prod-db',
      'hash-db-01',
      { session_id: 'session-A' },
    );
    const capStore = new Map([['cap-session-bound-001', cap]]);
    const stage1 = makeStage1(manager, (id) => capStore.get(id));

    const ctx: PipelineContext = {
      action_class: 'database.query',
      target: 'prod-db',
      payload_hash: 'hash-db-01',
      hitl_mode: 'per_request',
      approval_id: 'cap-session-bound-001',
      session_id: 'session-B',
      rule_context: { agentId: 'agent-1', channel: 'test' },
    };

    const emitter = new EventEmitter();
    const events: Array<Record<string, unknown>> = [];
    emitter.on('executionEvent', (e) => events.push(e as Record<string, unknown>));

    const result = await runPipeline(ctx, stage1, permitStage2, emitter);

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('session scope mismatch');
    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toMatchObject({ effect: 'forbid', reason: 'session scope mismatch' });
    expect(typeof events[0]!.timestamp).toBe('string');
    expect(events[0]!.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('session mismatch denial reason is session scope mismatch', async () => {
    const manager = new ApprovalManager();

    const cap = makeCapability(
      'cap-session-bound-002',
      'filesystem.delete',
      '/var/data/file.bin',
      'hash-fs-01',
      { session_id: 'session-XYZ' },
    );
    const capStore = new Map([['cap-session-bound-002', cap]]);
    const stage1 = makeStage1(manager, (id) => capStore.get(id));

    const ctx: PipelineContext = {
      action_class: 'filesystem.delete',
      target: '/var/data/file.bin',
      payload_hash: 'hash-fs-01',
      hitl_mode: 'per_request',
      approval_id: 'cap-session-bound-002',
      session_id: 'session-ABC',
      rule_context: { agentId: 'agent-3', channel: 'test' },
    };

    const result = await runPipeline(ctx, stage1, permitStage2, new EventEmitter());

    expect(result.decision.reason).toBe('session scope mismatch');
  });

  it('same session token is permitted', async () => {
    const manager = new ApprovalManager();

    const cap = makeCapability(
      'cap-same-session-001',
      'filesystem.read',
      '/tmp/safe.txt',
      'hash-safe-01',
      { session_id: 'session-SAME' },
    );
    const capStore = new Map([['cap-same-session-001', cap]]);
    const stage1 = makeStage1(manager, (id) => capStore.get(id));

    const ctx: PipelineContext = {
      action_class: 'filesystem.read',
      target: '/tmp/safe.txt',
      payload_hash: 'hash-safe-01',
      hitl_mode: 'per_request',
      approval_id: 'cap-same-session-001',
      session_id: 'session-SAME',
      rule_context: { agentId: 'agent-1', channel: 'test' },
    };

    const result = await runPipeline(ctx, stage1, permitStage2, new EventEmitter());

    expect(result.decision.effect).toBe('permit');
  });

  it('ExecutionEvent captures deny reason on session mismatch', async () => {
    const manager = new ApprovalManager();

    const cap = makeCapability(
      'cap-event-check-001',
      'model.run',
      'gpt-4',
      'hash-model-01',
      { session_id: 'session-ORIGINAL' },
    );
    const capStore = new Map([['cap-event-check-001', cap]]);
    const stage1 = makeStage1(manager, (id) => capStore.get(id));

    const emitter = new EventEmitter();
    const events: Array<Record<string, unknown>> = [];
    emitter.on('executionEvent', (e) => events.push(e as Record<string, unknown>));

    await runPipeline(
      {
        action_class: 'model.run',
        target: 'gpt-4',
        payload_hash: 'hash-model-01',
        hitl_mode: 'per_request',
        approval_id: 'cap-event-check-001',
        session_id: 'session-ATTACKER',
        rule_context: { agentId: 'agent-1', channel: 'test' },
      },
      stage1,
      permitStage2,
      emitter,
    );

    expect(events[0]!.decision).toMatchObject({
      effect: 'forbid',
      reason: 'session scope mismatch',
    });
    expect(typeof events[0]!.timestamp).toBe('string');
    expect(events[0]!.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

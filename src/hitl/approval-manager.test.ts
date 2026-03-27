import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalManager, generateToken } from './approval-manager.js';
import type { HitlPolicy } from './types.js';

const makePolicy = (overrides?: Partial<HitlPolicy>): HitlPolicy => ({
  name: 'Test policy',
  actions: ['test.action'],
  approval: { channel: 'telegram', timeout: 5, fallback: 'deny' },
  ...overrides,
});

describe('generateToken', () => {
  it('produces an 8-character string', () => {
    const token = generateToken();
    expect(token).toHaveLength(8);
  });

  it('produces alphanumeric-safe characters (base64url)', () => {
    for (let i = 0; i < 50; i++) {
      const token = generateToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{8}$/);
    }
  });

  it('generates unique tokens', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i++) {
      tokens.add(generateToken());
    }
    // Allow 1 collision max in 200 tokens as extremely unlikely edge case
    expect(tokens.size).toBeGreaterThanOrEqual(199);
  });
});

describe('ApprovalManager', () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ApprovalManager();
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  it('createApprovalRequest returns a token and a pending promise', () => {
    const handle = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy(),
    });

    expect(handle.token).toHaveLength(8);
    expect(handle.promise).toBeInstanceOf(Promise);
    expect(manager.size).toBe(1);
  });

  it('resolveApproval("approved") resolves the promise with "approved"', async () => {
    const handle = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy(),
    });

    const resolved = manager.resolveApproval(handle.token, 'approved');
    expect(resolved).toBe(true);

    const decision = await handle.promise;
    expect(decision).toBe('approved');
    expect(manager.size).toBe(0);
  });

  it('resolveApproval("denied") resolves the promise with "denied"', async () => {
    const handle = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy(),
    });

    manager.resolveApproval(handle.token, 'denied');
    const decision = await handle.promise;
    expect(decision).toBe('denied');
  });

  it('returns false for unknown token', () => {
    expect(manager.resolveApproval('UNKNOWN_', 'approved')).toBe(false);
  });

  it('double resolve is a no-op (returns false)', async () => {
    const handle = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy(),
    });

    expect(manager.resolveApproval(handle.token, 'approved')).toBe(true);
    expect(manager.resolveApproval(handle.token, 'denied')).toBe(false);
    expect(await handle.promise).toBe('approved');
  });

  it('timer expiry resolves as "expired"', async () => {
    const handle = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy({ approval: { channel: 'telegram', timeout: 3, fallback: 'deny' } }),
    });

    // Advance past the 3-second timeout
    await vi.advanceTimersByTimeAsync(3500);
    const decision = await handle.promise;
    expect(decision).toBe('expired');
    expect(manager.size).toBe(0);
  });

  it('uses the policy timeout for TTL', async () => {
    const handle = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy({ approval: { channel: 'telegram', timeout: 10, fallback: 'deny' } }),
    });

    // Should NOT expire at 9s
    await vi.advanceTimersByTimeAsync(9000);
    expect(manager.size).toBe(1);

    // Should expire at 10s
    await vi.advanceTimersByTimeAsync(1500);
    const decision = await handle.promise;
    expect(decision).toBe('expired');
  });

  it('cancel() resolves as "expired"', async () => {
    const handle = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy(),
    });

    manager.cancel(handle.token);
    const decision = await handle.promise;
    expect(decision).toBe('expired');
    expect(manager.size).toBe(0);
  });

  it('cancel() on unknown token is a no-op', () => {
    expect(() => manager.cancel('UNKNOWN_')).not.toThrow();
  });

  it('shutdown() resolves all pending as "expired"', async () => {
    const h1 = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy(),
    });
    const h2 = manager.createApprovalRequest({
      toolName: 'file.delete',
      agentId: 'agent-2',
      channelId: 'default',
      policy: makePolicy(),
    });

    manager.shutdown();

    expect(await h1.promise).toBe('expired');
    expect(await h2.promise).toBe('expired');
    expect(manager.size).toBe(0);
  });

  it('concurrent approvals are independent', async () => {
    const h1 = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy(),
    });
    const h2 = manager.createApprovalRequest({
      toolName: 'file.delete',
      agentId: 'agent-2',
      channelId: 'default',
      policy: makePolicy(),
    });

    expect(manager.size).toBe(2);

    // Resolve second first
    manager.resolveApproval(h2.token, 'denied');
    expect(await h2.promise).toBe('denied');
    expect(manager.size).toBe(1);

    // First still pending
    manager.resolveApproval(h1.token, 'approved');
    expect(await h1.promise).toBe('approved');
    expect(manager.size).toBe(0);
  });

  it('getPending() returns metadata for a pending token', () => {
    const handle = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy(),
    });

    const info = manager.getPending(handle.token);
    expect(info).toBeDefined();
    expect(info!.toolName).toBe('email.send');
    expect(info!.agentId).toBe('agent-1');
    expect(info!.policyName).toBe('Test policy');
  });

  it('getPending() returns undefined for unknown token', () => {
    expect(manager.getPending('UNKNOWN_')).toBeUndefined();
  });
});

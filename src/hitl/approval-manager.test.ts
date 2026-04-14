import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalManager, generateToken, uuidv7, computeBinding } from './approval-manager.js';
import type { HitlPolicy } from './types.js';

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const makePolicy = (overrides?: Partial<HitlPolicy>): HitlPolicy => ({
  name: 'Test policy',
  actions: ['test.action'],
  approval: { channel: 'telegram', timeout: 5, fallback: 'deny' },
  ...overrides,
});

describe('uuidv7', () => {
  it('produces a 36-character UUID string', () => {
    expect(uuidv7()).toHaveLength(36);
  });

  it('matches UUID v7 format', () => {
    for (let i = 0; i < 20; i++) {
      expect(uuidv7()).toMatch(UUID_V7_RE);
    }
  });

  it('generates unique tokens', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i++) {
      tokens.add(uuidv7());
    }
    expect(tokens.size).toBeGreaterThanOrEqual(199);
  });

  it('is time-ordered (later call has >= timestamp bytes)', () => {
    const a = uuidv7();
    const b = uuidv7();
    // First 8 hex chars encode 32 MSBs of 48-bit timestamp
    expect(b.slice(0, 8) >= a.slice(0, 8)).toBe(true);
  });
});

describe('generateToken (backward compat)', () => {
  it('returns a UUID v7 string', () => {
    expect(generateToken()).toMatch(UUID_V7_RE);
  });
});

describe('computeBinding', () => {
  it('returns a 64-character hex SHA-256 digest', () => {
    const b = computeBinding('email.send', 'user@example.com', 'abc123');
    expect(b).toHaveLength(64);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical inputs', () => {
    const b1 = computeBinding('email.send', 'user@example.com', 'abc123');
    const b2 = computeBinding('email.send', 'user@example.com', 'abc123');
    expect(b1).toBe(b2);
  });

  it('differs when any input changes', () => {
    const base = computeBinding('email.send', 'user@example.com', 'abc123');
    expect(computeBinding('email.delete', 'user@example.com', 'abc123')).not.toBe(base);
    expect(computeBinding('email.send', 'other@example.com', 'abc123')).not.toBe(base);
    expect(computeBinding('email.send', 'user@example.com', 'xyz789')).not.toBe(base);
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

  it('createApprovalRequest returns a UUID v7 token and a pending promise', () => {
    const handle = manager.createApprovalRequest({
      toolName: 'email.send',
      agentId: 'agent-1',
      channelId: 'default',
      policy: makePolicy(),
    });

    expect(handle.token).toMatch(UUID_V7_RE);
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

  describe('payload binding', () => {
    it('stores binding, action_class, target, summary from opts', () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
        payload_hash: 'deadbeef',
        action_class: 'email.send',
        target: 'user@example.com',
        summary: 'Send welcome email',
      });

      const info = manager.getPending(handle.token);
      expect(info!.payload_hash).toBe('deadbeef');
      expect(info!.action_class).toBe('email.send');
      expect(info!.target).toBe('user@example.com');
      expect(info!.summary).toBe('Send welcome email');
      expect(info!.binding).toBe(
        computeBinding('email.send', 'user@example.com', 'deadbeef'),
      );
    });

    it('defaults action_class to toolName when omitted', () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
      });

      const info = manager.getPending(handle.token);
      expect(info!.action_class).toBe('email.send');
    });

    it('resolveApproval succeeds when correct binding is supplied', () => {
      const binding = computeBinding('email.send', 'user@example.com', 'deadbeef');
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
        payload_hash: 'deadbeef',
        action_class: 'email.send',
        target: 'user@example.com',
      });

      expect(manager.resolveApproval(handle.token, 'approved', binding)).toBe(true);
    });

    it('resolveApproval returns false when binding is wrong', () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
        payload_hash: 'deadbeef',
        action_class: 'email.send',
        target: 'user@example.com',
      });

      expect(manager.resolveApproval(handle.token, 'approved', 'wrong-binding')).toBe(false);
      // Token is still pending after a failed binding check
      expect(manager.size).toBe(1);
    });

    it('resolveApproval without binding skips validation', async () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
        payload_hash: 'deadbeef',
      });

      expect(manager.resolveApproval(handle.token, 'approved')).toBe(true);
      expect(await handle.promise).toBe('approved');
    });
  });

  describe('isConsumed', () => {
    it('returns false for a token that is still pending', () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
      });
      expect(manager.isConsumed(handle.token)).toBe(false);
    });

    it('returns true after resolveApproval', () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
      });
      manager.resolveApproval(handle.token, 'approved');
      expect(manager.isConsumed(handle.token)).toBe(true);
    });

    it('returns true after cancel()', () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
      });
      manager.cancel(handle.token);
      expect(manager.isConsumed(handle.token)).toBe(true);
    });

    it('returns true after timer expiry', async () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy({ approval: { channel: 'telegram', timeout: 1, fallback: 'deny' } }),
      });
      await vi.advanceTimersByTimeAsync(1500);
      await handle.promise;
      expect(manager.isConsumed(handle.token)).toBe(true);
    });

    it('returns true for all tokens after shutdown()', async () => {
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
      await Promise.all([h1.promise, h2.promise]);
      expect(manager.isConsumed(h1.token)).toBe(true);
      expect(manager.isConsumed(h2.token)).toBe(true);
    });

    it('returns false for a completely unknown token', () => {
      expect(manager.isConsumed('never-seen')).toBe(false);
    });
  });

  describe('session_approval mode', () => {
    it('uses session_id:action_class as the token', () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
        action_class: 'email.send',
        session_id: 'sess-abc',
        mode: 'session_approval',
      });

      expect(handle.token).toBe('sess-abc:email.send');
      expect(manager.size).toBe(1);
    });

    it('falls back to action_class == toolName when action_class omitted', () => {
      const handle = manager.createApprovalRequest({
        toolName: 'file.delete',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
        session_id: 'sess-xyz',
        mode: 'session_approval',
      });

      expect(handle.token).toBe('sess-xyz:file.delete');
    });

    it('resolveApproval works with the session key token', async () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
        action_class: 'email.send',
        session_id: 'sess-abc',
        mode: 'session_approval',
      });

      manager.resolveApproval('sess-abc:email.send', 'approved');
      expect(await handle.promise).toBe('approved');
    });

    it('uses UUID v7 token when mode is per_request (default)', () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
        mode: 'per_request',
      });

      expect(handle.token).toMatch(UUID_V7_RE);
    });

    it('uses UUID v7 token when session_id is absent even if mode is session_approval', () => {
      const handle = manager.createApprovalRequest({
        toolName: 'email.send',
        agentId: 'agent-1',
        channelId: 'default',
        policy: makePolicy(),
        mode: 'session_approval',
        // no session_id
      });

      expect(handle.token).toMatch(UUID_V7_RE);
    });
  });
});

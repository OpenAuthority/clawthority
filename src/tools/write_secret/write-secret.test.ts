/**
 * Unit tests for the write_secret tool.
 *
 * Test IDs:
 *   TC-WSC-01: Successful write — stores value in backend
 *   TC-WSC-02: Allowlist gate — key-denied when key not in allowlist
 *   TC-WSC-03: Allowlist gate — key-denied when allowlist is empty
 *   TC-WSC-04: HITL gate — hitl-required when approval_id is absent
 *   TC-WSC-05: Replay protection — token-replayed when token is consumed
 *   TC-WSC-06: Audit logging — value never exposed in log entries
 *   TC-WSC-07: Result shape — written field is true on success
 *   TC-WSC-08: agentId and channel propagated to log entries
 */

import { describe, it, expect } from 'vitest';
import { writeSecret, WriteSecretError } from './write-secret.js';
import type { WriteSecretLogger, WriteSecretApprovalManager } from './write-secret.js';
import { MemorySecretBackend } from '../secrets/secret-backend.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger(): { logger: WriteSecretLogger; entries: Array<Record<string, unknown>> } {
  const entries: Array<Record<string, unknown>> = [];
  const logger: WriteSecretLogger = {
    log: async (entry) => {
      entries.push(entry);
    },
  };
  return { logger, entries };
}

function makeApprovalManager(): WriteSecretApprovalManager {
  const consumed = new Set<string>();
  return {
    isConsumed: (token) => consumed.has(token),
    resolveApproval: (token, _decision) => {
      consumed.add(token);
      return true;
    },
  };
}

function makeBackend(initial: Record<string, string> = {}): MemorySecretBackend {
  return new MemorySecretBackend(initial);
}

const ALLOWLIST = ['DB_PASSWORD', 'API_KEY', 'SECRET_TOKEN'];

// ─── TC-WSC-01: Successful write ──────────────────────────────────────────────

describe('TC-WSC-01: successful write — stores value in backend', () => {
  it('returns { written: true } on success', async () => {
    const result = await writeSecret(
      { key: 'DB_PASSWORD', value: 'new-password' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-01a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.written).toBe(true);
  });

  it('persists the value in the backend', async () => {
    const backend = makeBackend();

    await writeSecret(
      { key: 'API_KEY', value: 'sk-new-key' },
      {
        allowlist: ALLOWLIST,
        backend,
        approval_id: 'tok-01b',
        approvalManager: makeApprovalManager(),
      },
    );

    expect(backend.get('API_KEY')).toBe('sk-new-key');
  });

  it('overwrites an existing value', async () => {
    const backend = makeBackend({ DB_PASSWORD: 'old-password' });

    await writeSecret(
      { key: 'DB_PASSWORD', value: 'new-password' },
      {
        allowlist: ALLOWLIST,
        backend,
        approval_id: 'tok-01c',
        approvalManager: makeApprovalManager(),
      },
    );

    expect(backend.get('DB_PASSWORD')).toBe('new-password');
  });

  it('works with store parameter when backend is injected', async () => {
    const result = await writeSecret(
      { key: 'SECRET_TOKEN', value: 'tok', store: 'vault' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-01d',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.written).toBe(true);
  });
});

// ─── TC-WSC-02: Allowlist gate — key not in allowlist ─────────────────────────

describe('TC-WSC-02: allowlist gate — key-denied when key not in allowlist', () => {
  it('throws WriteSecretError with code key-denied', async () => {
    let err: WriteSecretError | undefined;
    try {
      await writeSecret(
        { key: 'FORBIDDEN', value: 'val' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend(),
          approval_id: 'tok-02a',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch (e) {
      err = e as WriteSecretError;
    }
    expect(err).toBeInstanceOf(WriteSecretError);
    expect(err!.code).toBe('key-denied');
  });

  it('error name is WriteSecretError', async () => {
    let err: WriteSecretError | undefined;
    try {
      await writeSecret(
        { key: 'FORBIDDEN', value: 'val' },
        { allowlist: ALLOWLIST, approval_id: 'tok-02b', approvalManager: makeApprovalManager() },
      );
    } catch (e) {
      err = e as WriteSecretError;
    }
    expect(err!.name).toBe('WriteSecretError');
  });

  it('error message includes the denied key name', async () => {
    let err: WriteSecretError | undefined;
    try {
      await writeSecret(
        { key: 'BAD_KEY', value: 'val' },
        { allowlist: ALLOWLIST, approval_id: 'tok-02c' },
      );
    } catch (e) {
      err = e as WriteSecretError;
    }
    expect(err!.message).toContain('BAD_KEY');
  });

  it('does not write to the backend when key is denied', async () => {
    const backend = makeBackend();
    try {
      await writeSecret(
        { key: 'FORBIDDEN', value: 'should-not-be-written' },
        { allowlist: ALLOWLIST, backend, approval_id: 'tok-02d' },
      );
    } catch {
      // expected
    }
    expect(backend.has('FORBIDDEN')).toBe(false);
  });

  it('logs a key-denied event', async () => {
    const { logger, entries } = makeLogger();
    try {
      await writeSecret(
        { key: 'FORBIDDEN', value: 'val' },
        { logger, allowlist: ALLOWLIST, approval_id: 'tok-02e' },
      );
    } catch {
      // expected
    }
    expect(entries[0]).toMatchObject({ type: 'write-secret', event: 'key-denied', key: 'FORBIDDEN' });
  });
});

// ─── TC-WSC-03: Allowlist gate — empty allowlist ──────────────────────────────

describe('TC-WSC-03: allowlist gate — key-denied when allowlist is empty', () => {
  it('throws key-denied when allowlist is an empty array', async () => {
    let err: WriteSecretError | undefined;
    try {
      await writeSecret(
        { key: 'DB_PASSWORD', value: 'val' },
        {
          allowlist: [],
          backend: makeBackend(),
          approval_id: 'tok-03a',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch (e) {
      err = e as WriteSecretError;
    }
    expect(err!.code).toBe('key-denied');
  });
});

// ─── TC-WSC-04: HITL gate — hitl-required ────────────────────────────────────

describe('TC-WSC-04: HITL gate — hitl-required when approval_id is absent', () => {
  it('throws WriteSecretError with code hitl-required', async () => {
    let err: WriteSecretError | undefined;
    try {
      await writeSecret(
        { key: 'DB_PASSWORD', value: 'val' },
        { allowlist: ALLOWLIST, backend: makeBackend() },
      );
    } catch (e) {
      err = e as WriteSecretError;
    }
    expect(err).toBeInstanceOf(WriteSecretError);
    expect(err!.code).toBe('hitl-required');
  });

  it('error message references approval_id', async () => {
    let err: WriteSecretError | undefined;
    try {
      await writeSecret(
        { key: 'DB_PASSWORD', value: 'val' },
        { allowlist: ALLOWLIST },
      );
    } catch (e) {
      err = e as WriteSecretError;
    }
    expect(err!.message).toContain('approval_id');
  });

  it('does not write to the backend when hitl token is absent', async () => {
    const backend = makeBackend();
    try {
      await writeSecret(
        { key: 'DB_PASSWORD', value: 'should-not-be-written' },
        { allowlist: ALLOWLIST, backend },
      );
    } catch {
      // expected
    }
    expect(backend.has('DB_PASSWORD')).toBe(false);
  });

  it('logs a hitl-required event', async () => {
    const { logger, entries } = makeLogger();
    try {
      await writeSecret(
        { key: 'DB_PASSWORD', value: 'val' },
        { logger, allowlist: ALLOWLIST },
      );
    } catch {
      // expected
    }
    expect(entries[0]).toMatchObject({ type: 'write-secret', event: 'hitl-required' });
  });
});

// ─── TC-WSC-05: Replay protection — token-replayed ───────────────────────────

describe('TC-WSC-05: replay protection — token-replayed when token is consumed', () => {
  it('throws token-replayed when token was consumed before the call', async () => {
    const manager = makeApprovalManager();
    manager.resolveApproval('pre-consumed', 'approved');

    let err: WriteSecretError | undefined;
    try {
      await writeSecret(
        { key: 'DB_PASSWORD', value: 'val' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend(),
          approval_id: 'pre-consumed',
          approvalManager: manager,
        },
      );
    } catch (e) {
      err = e as WriteSecretError;
    }
    expect(err).toBeInstanceOf(WriteSecretError);
    expect(err!.code).toBe('token-replayed');
  });

  it('token is consumed after a successful write, preventing replay', async () => {
    const manager = makeApprovalManager();
    const backend = makeBackend();

    await writeSecret(
      { key: 'DB_PASSWORD', value: 'v1' },
      { allowlist: ALLOWLIST, backend, approval_id: 'one-time', approvalManager: manager },
    );

    let err: WriteSecretError | undefined;
    try {
      await writeSecret(
        { key: 'DB_PASSWORD', value: 'v2' },
        { allowlist: ALLOWLIST, backend, approval_id: 'one-time', approvalManager: manager },
      );
    } catch (e) {
      err = e as WriteSecretError;
    }
    expect(err!.code).toBe('token-replayed');
  });

  it('does not overwrite the value when token is replayed', async () => {
    const manager = makeApprovalManager();
    const backend = makeBackend({ DB_PASSWORD: 'original' });

    // Pre-consume
    manager.resolveApproval('replay-tok', 'approved');

    try {
      await writeSecret(
        { key: 'DB_PASSWORD', value: 'overwrite-attempt' },
        { allowlist: ALLOWLIST, backend, approval_id: 'replay-tok', approvalManager: manager },
      );
    } catch {
      // expected
    }

    // Value must remain unchanged
    expect(backend.get('DB_PASSWORD')).toBe('original');
  });
});

// ─── TC-WSC-06: Audit logging — value never exposed ──────────────────────────

describe('TC-WSC-06: audit logging — value never exposed in log entries', () => {
  it('logs write-attempt and write-complete on success', async () => {
    const { logger, entries } = makeLogger();

    await writeSecret(
      { key: 'DB_PASSWORD', value: 'super-secret' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-06a',
        approvalManager: makeApprovalManager(),
      },
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'write-secret', event: 'write-attempt' });
    expect(entries[1]).toMatchObject({ type: 'write-secret', event: 'write-complete' });
  });

  it('no log entry contains the secret value', async () => {
    const { logger, entries } = makeLogger();
    const secretValue = 'super-secret-value-xyz-99';

    await writeSecret(
      { key: 'DB_PASSWORD', value: secretValue },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-06b',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(secretValue);
    }
  });

  it('write-attempt entry includes valueLength but not the value', async () => {
    const { logger, entries } = makeLogger();
    const val = 'my-secret';

    await writeSecret(
      { key: 'DB_PASSWORD', value: val },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-06c',
        approvalManager: makeApprovalManager(),
      },
    );

    const attempt = entries.find((e) => e['event'] === 'write-attempt');
    expect(attempt!['valueLength']).toBe(val.length);
    expect(attempt!['value']).toBeUndefined();
  });

  it('all entries include toolName write_secret', async () => {
    const { logger, entries } = makeLogger();

    await writeSecret(
      { key: 'DB_PASSWORD', value: 'val' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-06d',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['toolName']).toBe('write_secret');
    }
  });
});

// ─── TC-WSC-07: Result shape ──────────────────────────────────────────────────

describe('TC-WSC-07: result shape', () => {
  it('result has a written field', async () => {
    const result = await writeSecret(
      { key: 'DB_PASSWORD', value: 'val' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-07a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result).toHaveProperty('written');
  });

  it('written field is true', async () => {
    const result = await writeSecret(
      { key: 'DB_PASSWORD', value: 'val' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-07b',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.written).toBe(true);
  });
});

// ─── TC-WSC-08: agentId and channel propagation ───────────────────────────────

describe('TC-WSC-08: agentId and channel propagated to log entries', () => {
  it('propagates agentId and channel to all log entries', async () => {
    const { logger, entries } = makeLogger();

    await writeSecret(
      { key: 'DB_PASSWORD', value: 'val' },
      {
        logger,
        agentId: 'agent-wsc',
        channel: 'ops-slack',
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-08a',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['agentId']).toBe('agent-wsc');
      expect(entry['channel']).toBe('ops-slack');
    }
  });

  it('defaults agentId and channel to "unknown" when not provided', async () => {
    const { logger, entries } = makeLogger();

    await writeSecret(
      { key: 'DB_PASSWORD', value: 'val' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-08b',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['agentId']).toBe('unknown');
      expect(entry['channel']).toBe('unknown');
    }
  });
});

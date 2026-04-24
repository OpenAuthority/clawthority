/**
 * Unit tests for the store_secret tool.
 *
 * Test IDs:
 *   TC-SSC-01: Successful store — saves value in backend
 *   TC-SSC-02: Allowlist gate — key-denied when key not in allowlist
 *   TC-SSC-03: Allowlist gate — key-denied when allowlist is empty
 *   TC-SSC-04: HITL gate — hitl-required when approval_id is absent
 *   TC-SSC-05: Replay protection — token-replayed when token is consumed
 *   TC-SSC-06: Audit logging — value never exposed in log entries
 *   TC-SSC-07: Result shape — stored field is true on success
 *   TC-SSC-08: Write error — backend set() failure maps to write-error
 *   TC-SSC-09: agentId and channel propagated to log entries
 *   TC-SSC-10: No backend and no path — write-error thrown before gates
 */

import { describe, it, expect } from 'vitest';
import { storeSecret, StoreSecretError } from './store-secret.js';
import type { StoreSecretLogger, StoreSecretApprovalManager } from './store-secret.js';
import { MemorySecretBackend } from '../secrets/secret-backend.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger(): { logger: StoreSecretLogger; entries: Array<Record<string, unknown>> } {
  const entries: Array<Record<string, unknown>> = [];
  const logger: StoreSecretLogger = {
    log: async (entry) => {
      entries.push(entry);
    },
  };
  return { logger, entries };
}

function makeApprovalManager(): StoreSecretApprovalManager {
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

// ─── TC-SSC-01: Successful store ──────────────────────────────────────────────

describe('TC-SSC-01: successful store — saves value in backend', () => {
  it('returns { stored: true } on success', async () => {
    const result = await storeSecret(
      { key: 'DB_PASSWORD', value: 'new-password' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-01a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.stored).toBe(true);
  });

  it('persists the value in the backend', async () => {
    const backend = makeBackend();

    await storeSecret(
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

  it('overwrites an existing value in the backend', async () => {
    const backend = makeBackend({ DB_PASSWORD: 'old-password' });

    await storeSecret(
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
});

// ─── TC-SSC-02: Allowlist gate — key-denied ───────────────────────────────────

describe('TC-SSC-02: allowlist gate — key-denied when key not in allowlist', () => {
  it('throws StoreSecretError with code key-denied', async () => {
    await expect(
      storeSecret(
        { key: 'FORBIDDEN_KEY', value: 'secret' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend(),
          approval_id: 'tok-02',
          approvalManager: makeApprovalManager(),
        },
      ),
    ).rejects.toThrow(StoreSecretError);

    await expect(
      storeSecret(
        { key: 'FORBIDDEN_KEY', value: 'secret' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend(),
          approval_id: 'tok-02b',
          approvalManager: makeApprovalManager(),
        },
      ),
    ).rejects.toMatchObject({ code: 'key-denied' });
  });

  it('logs the key-denied event without exposing the value', async () => {
    const { logger, entries } = makeLogger();
    const sensitiveValue = 'p@ssw0rd-xyz-99887766';

    await storeSecret(
      { key: 'FORBIDDEN_KEY', value: sensitiveValue },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-02c',
        approvalManager: makeApprovalManager(),
        logger,
      },
    ).catch(() => {});

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ event: 'key-denied', key: 'FORBIDDEN_KEY' });
    expect(JSON.stringify(entries[0])).not.toContain(sensitiveValue);
  });
});

// ─── TC-SSC-03: Allowlist gate — empty allowlist ──────────────────────────────

describe('TC-SSC-03: allowlist gate — key-denied when allowlist is empty', () => {
  it('throws key-denied for any key when allowlist is empty', async () => {
    await expect(
      storeSecret(
        { key: 'DB_PASSWORD', value: 'secret' },
        {
          allowlist: [],
          backend: makeBackend(),
          approval_id: 'tok-03',
          approvalManager: makeApprovalManager(),
        },
      ),
    ).rejects.toMatchObject({ code: 'key-denied' });
  });

  it('throws key-denied when no allowlist is configured', async () => {
    const saved = process.env['CLAWTHORITY_SECRET_ALLOWLIST'];
    delete process.env['CLAWTHORITY_SECRET_ALLOWLIST'];

    await expect(
      storeSecret(
        { key: 'DB_PASSWORD', value: 'secret' },
        {
          backend: makeBackend(),
          approval_id: 'tok-03b',
          approvalManager: makeApprovalManager(),
        },
      ),
    ).rejects.toMatchObject({ code: 'key-denied' });

    if (saved !== undefined) process.env['CLAWTHORITY_SECRET_ALLOWLIST'] = saved;
  });
});

// ─── TC-SSC-04: HITL gate ─────────────────────────────────────────────────────

describe('TC-SSC-04: HITL gate — hitl-required when approval_id is absent', () => {
  it('throws StoreSecretError with code hitl-required', async () => {
    await expect(
      storeSecret(
        { key: 'DB_PASSWORD', value: 'secret' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend(),
        },
      ),
    ).rejects.toMatchObject({ code: 'hitl-required' });
  });

  it('logs the hitl-required event without exposing the value', async () => {
    const { logger, entries } = makeLogger();
    const sensitiveValue = 'c0nfid3ntial-tok-55443322';

    await storeSecret(
      { key: 'DB_PASSWORD', value: sensitiveValue },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        logger,
      },
    ).catch(() => {});

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ event: 'hitl-required' });
    expect(JSON.stringify(entries[0])).not.toContain(sensitiveValue);
  });
});

// ─── TC-SSC-05: Replay protection ────────────────────────────────────────────

describe('TC-SSC-05: replay protection — token-replayed when token is consumed', () => {
  it('throws StoreSecretError with code token-replayed', async () => {
    const backend = makeBackend();
    const approvalManager = makeApprovalManager();

    // Consume the token on first call.
    await storeSecret(
      { key: 'DB_PASSWORD', value: 'first' },
      {
        allowlist: ALLOWLIST,
        backend,
        approval_id: 'tok-05',
        approvalManager,
      },
    );

    // Second call with the same token must be rejected.
    await expect(
      storeSecret(
        { key: 'DB_PASSWORD', value: 'second' },
        {
          allowlist: ALLOWLIST,
          backend,
          approval_id: 'tok-05',
          approvalManager,
        },
      ),
    ).rejects.toMatchObject({ code: 'token-replayed' });
  });

  it('does not modify the backend when replayed', async () => {
    const backend = makeBackend({ DB_PASSWORD: 'original' });
    const approvalManager = makeApprovalManager();

    await storeSecret(
      { key: 'DB_PASSWORD', value: 'first-write' },
      {
        allowlist: ALLOWLIST,
        backend,
        approval_id: 'tok-05b',
        approvalManager,
      },
    );

    await storeSecret(
      { key: 'DB_PASSWORD', value: 'second-write' },
      {
        allowlist: ALLOWLIST,
        backend,
        approval_id: 'tok-05b',
        approvalManager,
      },
    ).catch(() => {});

    // Backend was only written once — second-write was blocked.
    expect(backend.get('DB_PASSWORD')).toBe('first-write');
  });
});

// ─── TC-SSC-06: Audit logging — value never exposed ──────────────────────────

describe('TC-SSC-06: audit logging — value never exposed in log entries', () => {
  it('does not include the secret value in any log entry', async () => {
    const { logger, entries } = makeLogger();
    const sensitiveValue = 'super-secret-password-xyz-9876';

    await storeSecret(
      { key: 'DB_PASSWORD', value: sensitiveValue },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-06',
        approvalManager: makeApprovalManager(),
        logger,
      },
    );

    const logText = JSON.stringify(entries);
    expect(logText).not.toContain(sensitiveValue);
  });

  it('includes valueLength in log entries instead of the value', async () => {
    const { logger, entries } = makeLogger();
    const value = 'password123';

    await storeSecret(
      { key: 'API_KEY', value },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-06b',
        approvalManager: makeApprovalManager(),
        logger,
      },
    );

    const attemptEntry = entries.find((e) => e['event'] === 'store-attempt');
    expect(attemptEntry).toBeDefined();
    expect(attemptEntry?.['valueLength']).toBe(value.length);
  });
});

// ─── TC-SSC-07: Result shape ──────────────────────────────────────────────────

describe('TC-SSC-07: result shape — stored field is true on success', () => {
  it('returns an object with stored: true', async () => {
    const result = await storeSecret(
      { key: 'SECRET_TOKEN', value: 'tok-value' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-07',
        approvalManager: makeApprovalManager(),
      },
    );

    expect(result).toEqual({ stored: true });
  });
});

// ─── TC-SSC-08: Write error ───────────────────────────────────────────────────

describe('TC-SSC-08: write error — backend set() failure maps to write-error', () => {
  it('throws StoreSecretError with code write-error when backend throws', async () => {
    const throwingBackend = {
      get: () => undefined,
      has: () => false,
      set: () => {
        throw new Error('disk full');
      },
    };

    await expect(
      storeSecret(
        { key: 'DB_PASSWORD', value: 'secret' },
        {
          allowlist: ALLOWLIST,
          backend: throwingBackend,
          approval_id: 'tok-08',
          approvalManager: makeApprovalManager(),
        },
      ),
    ).rejects.toMatchObject({ code: 'write-error' });
  });

  it('logs the write-error event with the error message', async () => {
    const { logger, entries } = makeLogger();
    const throwingBackend = {
      get: () => undefined,
      has: () => false,
      set: () => {
        throw new Error('permission denied');
      },
    };

    await storeSecret(
      { key: 'DB_PASSWORD', value: 'secret' },
      {
        allowlist: ALLOWLIST,
        backend: throwingBackend,
        approval_id: 'tok-08b',
        approvalManager: makeApprovalManager(),
        logger,
      },
    ).catch(() => {});

    const errorEntry = entries.find((e) => e['event'] === 'write-error');
    expect(errorEntry).toBeDefined();
    expect(errorEntry?.['error']).toContain('permission denied');
  });
});

// ─── TC-SSC-09: agentId and channel ──────────────────────────────────────────

describe('TC-SSC-09: agentId and channel propagated to log entries', () => {
  it('includes agentId and channel in all log entries', async () => {
    const { logger, entries } = makeLogger();

    await storeSecret(
      { key: 'DB_PASSWORD', value: 'secret' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-09',
        approvalManager: makeApprovalManager(),
        logger,
        agentId: 'agent-xyz',
        channel: 'chan-abc',
      },
    );

    for (const entry of entries) {
      expect(entry['agentId']).toBe('agent-xyz');
      expect(entry['channel']).toBe('chan-abc');
    }
  });

  it('defaults agentId and channel to "unknown" when not provided', async () => {
    const { logger, entries } = makeLogger();

    await storeSecret(
      { key: 'DB_PASSWORD', value: 'secret' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend(),
        approval_id: 'tok-09b',
        approvalManager: makeApprovalManager(),
        logger,
      },
    );

    for (const entry of entries) {
      expect(entry['agentId']).toBe('unknown');
      expect(entry['channel']).toBe('unknown');
    }
  });
});

// ─── TC-SSC-10: No backend and no path ───────────────────────────────────────

describe('TC-SSC-10: no backend and no path — write-error thrown before gates', () => {
  it('throws StoreSecretError with code write-error immediately', async () => {
    await expect(
      storeSecret(
        { key: 'DB_PASSWORD', value: 'secret' },
        {
          allowlist: ALLOWLIST,
          approval_id: 'tok-10',
          approvalManager: makeApprovalManager(),
          // No backend, no path
        },
      ),
    ).rejects.toMatchObject({ code: 'write-error', name: 'StoreSecretError' });
  });

  it('logs the write-error before any gate check', async () => {
    const { logger, entries } = makeLogger();

    await storeSecret(
      { key: 'DB_PASSWORD', value: 'secret' },
      {
        allowlist: ALLOWLIST,
        approval_id: 'tok-10b',
        logger,
        // No backend, no path
      },
    ).catch(() => {});

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ event: 'write-error', toolName: 'store_secret' });
  });
});

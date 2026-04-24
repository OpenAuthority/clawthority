/**
 * Unit tests for the rotate_secret tool.
 *
 * Test IDs:
 *   TC-ROT-01: Successful rotation — generates new value and stores it
 *   TC-ROT-02: Allowlist gate — key-denied when key not in allowlist
 *   TC-ROT-03: HITL gate — hitl-required when approval_id is absent
 *   TC-ROT-04: Replay protection — token-replayed when token is consumed
 *   TC-ROT-05: Existence check — key-not-found when key absent from store
 *   TC-ROT-06: Audit logging — generated value never exposed in log entries
 *   TC-ROT-07: Result shape — rotated and key fields present
 *   TC-ROT-08: Injectable value generator — used for deterministic testing
 *   TC-ROT-09: agentId and channel propagated to log entries
 */

import { describe, it, expect } from 'vitest';
import { rotateSecret, RotateSecretError } from './rotate-secret.js';
import type { RotateSecretLogger, RotateSecretApprovalManager } from './rotate-secret.js';
import { MemorySecretBackend } from '../secrets/secret-backend.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger(): { logger: RotateSecretLogger; entries: Array<Record<string, unknown>> } {
  const entries: Array<Record<string, unknown>> = [];
  const logger: RotateSecretLogger = {
    log: async (entry) => {
      entries.push(entry);
    },
  };
  return { logger, entries };
}

function makeApprovalManager(): RotateSecretApprovalManager {
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

// ─── TC-ROT-01: Successful rotation ──────────────────────────────────────────

describe('TC-ROT-01: successful rotation — generates new value and stores it', () => {
  it('returns { rotated: true, key } on success', async () => {
    const result = await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'old-password' }),
        approval_id: 'tok-01a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.rotated).toBe(true);
    expect(result.key).toBe('DB_PASSWORD');
  });

  it('the stored value changes after rotation', async () => {
    const backend = makeBackend({ DB_PASSWORD: 'old-value' });

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        allowlist: ALLOWLIST,
        backend,
        approval_id: 'tok-01b',
        approvalManager: makeApprovalManager(),
      },
    );

    expect(backend.get('DB_PASSWORD')).not.toBe('old-value');
    expect(backend.get('DB_PASSWORD')).toBeDefined();
  });

  it('uses the injectable value generator when provided', async () => {
    const backend = makeBackend({ API_KEY: 'old' });
    const fixedValue = 'fixed-generated-value';

    await rotateSecret(
      { key: 'API_KEY' },
      {
        allowlist: ALLOWLIST,
        backend,
        approval_id: 'tok-01c',
        approvalManager: makeApprovalManager(),
        generateValue: () => fixedValue,
      },
    );

    expect(backend.get('API_KEY')).toBe(fixedValue);
  });

  it('two consecutive rotations produce different values', async () => {
    const backend = makeBackend({ DB_PASSWORD: 'original' });
    const manager = makeApprovalManager();

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      { allowlist: ALLOWLIST, backend, approval_id: 'tok-01d', approvalManager: manager },
    );
    const afterFirst = backend.get('DB_PASSWORD');

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      { allowlist: ALLOWLIST, backend, approval_id: 'tok-01e', approvalManager: manager },
    );
    const afterSecond = backend.get('DB_PASSWORD');

    // Generated values are random 256-bit hex strings — collision probability is negligible.
    expect(afterFirst).not.toBe(afterSecond);
  });
});

// ─── TC-ROT-02: Allowlist gate — key not in allowlist ─────────────────────────

describe('TC-ROT-02: allowlist gate — key-denied when key not in allowlist', () => {
  it('throws RotateSecretError with code key-denied', async () => {
    let err: RotateSecretError | undefined;
    try {
      await rotateSecret(
        { key: 'FORBIDDEN' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend({ FORBIDDEN: 'val' }),
          approval_id: 'tok-02a',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch (e) {
      err = e as RotateSecretError;
    }
    expect(err).toBeInstanceOf(RotateSecretError);
    expect(err!.code).toBe('key-denied');
  });

  it('error name is RotateSecretError', async () => {
    let err: RotateSecretError | undefined;
    try {
      await rotateSecret(
        { key: 'FORBIDDEN' },
        { allowlist: ALLOWLIST, approval_id: 'tok-02b' },
      );
    } catch (e) {
      err = e as RotateSecretError;
    }
    expect(err!.name).toBe('RotateSecretError');
  });

  it('error message includes the denied key', async () => {
    let err: RotateSecretError | undefined;
    try {
      await rotateSecret(
        { key: 'BAD_KEY' },
        { allowlist: ALLOWLIST, approval_id: 'tok-02c' },
      );
    } catch (e) {
      err = e as RotateSecretError;
    }
    expect(err!.message).toContain('BAD_KEY');
  });

  it('does not modify the backend when key is denied', async () => {
    const backend = makeBackend({ FORBIDDEN: 'original' });
    try {
      await rotateSecret(
        { key: 'FORBIDDEN' },
        { allowlist: ALLOWLIST, backend, approval_id: 'tok-02d' },
      );
    } catch {
      // expected
    }
    expect(backend.get('FORBIDDEN')).toBe('original');
  });
});

// ─── TC-ROT-03: HITL gate — hitl-required ────────────────────────────────────

describe('TC-ROT-03: HITL gate — hitl-required when approval_id is absent', () => {
  it('throws RotateSecretError with code hitl-required', async () => {
    let err: RotateSecretError | undefined;
    try {
      await rotateSecret(
        { key: 'DB_PASSWORD' },
        { allowlist: ALLOWLIST, backend: makeBackend({ DB_PASSWORD: 'v' }) },
      );
    } catch (e) {
      err = e as RotateSecretError;
    }
    expect(err).toBeInstanceOf(RotateSecretError);
    expect(err!.code).toBe('hitl-required');
  });

  it('error message references approval_id', async () => {
    let err: RotateSecretError | undefined;
    try {
      await rotateSecret(
        { key: 'DB_PASSWORD' },
        { allowlist: ALLOWLIST },
      );
    } catch (e) {
      err = e as RotateSecretError;
    }
    expect(err!.message).toContain('approval_id');
  });

  it('logs a hitl-required event', async () => {
    const { logger, entries } = makeLogger();
    try {
      await rotateSecret(
        { key: 'DB_PASSWORD' },
        { logger, allowlist: ALLOWLIST },
      );
    } catch {
      // expected
    }
    expect(entries[0]).toMatchObject({ type: 'rotate-secret', event: 'hitl-required' });
  });
});

// ─── TC-ROT-04: Replay protection — token-replayed ───────────────────────────

describe('TC-ROT-04: replay protection — token-replayed when token is consumed', () => {
  it('throws token-replayed when token was consumed before the call', async () => {
    const manager = makeApprovalManager();
    manager.resolveApproval('pre-consumed', 'approved');

    let err: RotateSecretError | undefined;
    try {
      await rotateSecret(
        { key: 'DB_PASSWORD' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend({ DB_PASSWORD: 'v' }),
          approval_id: 'pre-consumed',
          approvalManager: manager,
        },
      );
    } catch (e) {
      err = e as RotateSecretError;
    }
    expect(err).toBeInstanceOf(RotateSecretError);
    expect(err!.code).toBe('token-replayed');
  });

  it('token is consumed after successful rotation, preventing replay', async () => {
    const manager = makeApprovalManager();
    const backend = makeBackend({ DB_PASSWORD: 'v' });

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      { allowlist: ALLOWLIST, backend, approval_id: 'one-time', approvalManager: manager },
    );

    let err: RotateSecretError | undefined;
    try {
      await rotateSecret(
        { key: 'DB_PASSWORD' },
        { allowlist: ALLOWLIST, backend, approval_id: 'one-time', approvalManager: manager },
      );
    } catch (e) {
      err = e as RotateSecretError;
    }
    expect(err!.code).toBe('token-replayed');
  });

  it('different tokens are independent', async () => {
    const manager = makeApprovalManager();
    const backend = makeBackend({ DB_PASSWORD: 'v' });

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      { allowlist: ALLOWLIST, backend, approval_id: 'token-A', approvalManager: manager },
    );

    const result = await rotateSecret(
      { key: 'DB_PASSWORD' },
      { allowlist: ALLOWLIST, backend, approval_id: 'token-B', approvalManager: manager },
    );
    expect(result.rotated).toBe(true);
  });
});

// ─── TC-ROT-05: Existence check — key-not-found ───────────────────────────────

describe('TC-ROT-05: existence check — key-not-found when key absent from store', () => {
  it('throws RotateSecretError with code key-not-found', async () => {
    let err: RotateSecretError | undefined;
    try {
      await rotateSecret(
        { key: 'DB_PASSWORD' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend({}),
          approval_id: 'tok-05a',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch (e) {
      err = e as RotateSecretError;
    }
    expect(err).toBeInstanceOf(RotateSecretError);
    expect(err!.code).toBe('key-not-found');
  });

  it('error message includes the missing key', async () => {
    let err: RotateSecretError | undefined;
    try {
      await rotateSecret(
        { key: 'DB_PASSWORD' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend({}),
          approval_id: 'tok-05b',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch (e) {
      err = e as RotateSecretError;
    }
    expect(err!.message).toContain('DB_PASSWORD');
  });

  it('logs a key-not-found event', async () => {
    const { logger, entries } = makeLogger();
    try {
      await rotateSecret(
        { key: 'DB_PASSWORD' },
        {
          logger,
          allowlist: ALLOWLIST,
          backend: makeBackend({}),
          approval_id: 'tok-05c',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch {
      // expected
    }
    const notFound = entries.find((e) => e['event'] === 'key-not-found');
    expect(notFound).toBeDefined();
    expect(notFound!['key']).toBe('DB_PASSWORD');
  });
});

// ─── TC-ROT-06: Audit logging — generated value never exposed ────────────────

describe('TC-ROT-06: audit logging — generated value never exposed in log entries', () => {
  it('logs rotate-attempt and rotate-complete on success', async () => {
    const { logger, entries } = makeLogger();

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'old' }),
        approval_id: 'tok-06a',
        approvalManager: makeApprovalManager(),
      },
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'rotate-secret', event: 'rotate-attempt' });
    expect(entries[1]).toMatchObject({ type: 'rotate-secret', event: 'rotate-complete' });
  });

  it('no log entry contains the generated value', async () => {
    const { logger, entries } = makeLogger();
    const fixedValue = 'fixed-generated-secret-value-99999';

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'old' }),
        approval_id: 'tok-06b',
        approvalManager: makeApprovalManager(),
        generateValue: () => fixedValue,
      },
    );

    for (const entry of entries) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(fixedValue);
    }
  });

  it('rotate-attempt entry includes newValueLength but not the value', async () => {
    const { logger, entries } = makeLogger();
    const fixedValue = 'generated-12345';

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'old' }),
        approval_id: 'tok-06c',
        approvalManager: makeApprovalManager(),
        generateValue: () => fixedValue,
      },
    );

    const attempt = entries.find((e) => e['event'] === 'rotate-attempt');
    expect(attempt!['newValueLength']).toBe(fixedValue.length);
    expect(attempt!['value']).toBeUndefined();
    expect(attempt!['newValue']).toBeUndefined();
  });

  it('all entries include toolName rotate_secret', async () => {
    const { logger, entries } = makeLogger();

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'old' }),
        approval_id: 'tok-06d',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['toolName']).toBe('rotate_secret');
    }
  });

  it('all entries include a ts timestamp', async () => {
    const { logger, entries } = makeLogger();

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'old' }),
        approval_id: 'tok-06e',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(typeof entry['ts']).toBe('string');
      expect((entry['ts'] as string).length).toBeGreaterThan(0);
    }
  });
});

// ─── TC-ROT-07: Result shape ──────────────────────────────────────────────────

describe('TC-ROT-07: result shape', () => {
  it('result has rotated and key fields', async () => {
    const result = await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'old' }),
        approval_id: 'tok-07a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result).toHaveProperty('rotated');
    expect(result).toHaveProperty('key');
  });

  it('rotated field is true', async () => {
    const result = await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'old' }),
        approval_id: 'tok-07b',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.rotated).toBe(true);
  });

  it('key field matches the rotated key', async () => {
    const result = await rotateSecret(
      { key: 'API_KEY' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ API_KEY: 'old' }),
        approval_id: 'tok-07c',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.key).toBe('API_KEY');
  });
});

// ─── TC-ROT-08: Injectable value generator ────────────────────────────────────

describe('TC-ROT-08: injectable value generator — used for deterministic testing', () => {
  it('uses the default generator when generateValue is not provided', async () => {
    const backend = makeBackend({ DB_PASSWORD: 'old' });

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        allowlist: ALLOWLIST,
        backend,
        approval_id: 'tok-08a',
        approvalManager: makeApprovalManager(),
      },
    );

    const newVal = backend.get('DB_PASSWORD');
    // Default generator produces 64-char hex string (256-bit random).
    expect(typeof newVal).toBe('string');
    expect(newVal!.length).toBe(64);
    expect(newVal).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses the injected generator when provided', async () => {
    const backend = makeBackend({ DB_PASSWORD: 'old' });
    let called = false;

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        allowlist: ALLOWLIST,
        backend,
        approval_id: 'tok-08b',
        approvalManager: makeApprovalManager(),
        generateValue: () => {
          called = true;
          return 'injected-value';
        },
      },
    );

    expect(called).toBe(true);
    expect(backend.get('DB_PASSWORD')).toBe('injected-value');
  });
});

// ─── TC-ROT-09: agentId and channel propagation ───────────────────────────────

describe('TC-ROT-09: agentId and channel propagated to log entries', () => {
  it('propagates agentId and channel to all log entries', async () => {
    const { logger, entries } = makeLogger();

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        agentId: 'agent-rot',
        channel: 'ops-slack',
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'old' }),
        approval_id: 'tok-09a',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['agentId']).toBe('agent-rot');
      expect(entry['channel']).toBe('ops-slack');
    }
  });

  it('defaults agentId and channel to "unknown" when not provided', async () => {
    const { logger, entries } = makeLogger();

    await rotateSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'old' }),
        approval_id: 'tok-09b',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['agentId']).toBe('unknown');
      expect(entry['channel']).toBe('unknown');
    }
  });
});

/**
 * Unit tests for the read_secret tool.
 *
 * Test IDs:
 *   TC-RSC-01: Successful read — returns value from backend
 *   TC-RSC-02: Allowlist gate — key-denied when key not in allowlist
 *   TC-RSC-03: Allowlist gate — key-denied when allowlist is empty
 *   TC-RSC-04: HITL gate — hitl-required when approval_id is absent
 *   TC-RSC-05: Replay protection — token-replayed when token is consumed
 *   TC-RSC-06: Not-found — throws when key absent from store
 *   TC-RSC-07: Audit logging — events recorded without exposing value
 *   TC-RSC-08: Result shape — value field present and correct type
 *   TC-RSC-09: agentId and channel propagated to log entries
 */

import { describe, it, expect } from 'vitest';
import { readSecret, ReadSecretError } from './read-secret.js';
import type { ReadSecretLogger, ReadSecretApprovalManager } from './read-secret.js';
import { MemorySecretBackend } from '../secrets/secret-backend.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger(): { logger: ReadSecretLogger; entries: Array<Record<string, unknown>> } {
  const entries: Array<Record<string, unknown>> = [];
  const logger: ReadSecretLogger = {
    log: async (entry) => {
      entries.push(entry);
    },
  };
  return { logger, entries };
}

function makeApprovalManager(): ReadSecretApprovalManager {
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

// ─── TC-RSC-01: Successful read ───────────────────────────────────────────────

describe('TC-RSC-01: successful read — returns value from backend', () => {
  it('returns the stored value for an allowed key', async () => {
    const result = await readSecret(
      { key: 'DB_PASSWORD' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'hunter2' }),
        approval_id: 'tok-01a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.value).toBe('hunter2');
  });

  it('returns a different value for a different allowed key', async () => {
    const result = await readSecret(
      { key: 'API_KEY' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ API_KEY: 'sk-test-abc123' }),
        approval_id: 'tok-01b',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.value).toBe('sk-test-abc123');
  });

  it('works with store parameter when backend is injected', async () => {
    const result = await readSecret(
      { key: 'SECRET_TOKEN', store: 'vault' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ SECRET_TOKEN: 'vault-val' }),
        approval_id: 'tok-01c',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.value).toBe('vault-val');
  });
});

// ─── TC-RSC-02: Allowlist gate — key not in allowlist ─────────────────────────

describe('TC-RSC-02: allowlist gate — key-denied when key not in allowlist', () => {
  it('throws ReadSecretError with code key-denied', async () => {
    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'FORBIDDEN_KEY' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend({ FORBIDDEN_KEY: 'secret' }),
          approval_id: 'tok-02a',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err).toBeInstanceOf(ReadSecretError);
    expect(err!.code).toBe('key-denied');
  });

  it('error name is ReadSecretError', async () => {
    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'FORBIDDEN_KEY' },
        { allowlist: ALLOWLIST, approval_id: 'tok-02b', approvalManager: makeApprovalManager() },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err!.name).toBe('ReadSecretError');
  });

  it('error message includes the denied key name', async () => {
    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'BAD_KEY' },
        { allowlist: ALLOWLIST, approval_id: 'tok-02c', approvalManager: makeApprovalManager() },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err!.message).toContain('BAD_KEY');
  });

  it('logs a key-denied event', async () => {
    const { logger, entries } = makeLogger();
    try {
      await readSecret(
        { key: 'FORBIDDEN_KEY' },
        { logger, allowlist: ALLOWLIST, approval_id: 'tok-02d' },
      );
    } catch {
      // expected
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'read-secret', event: 'key-denied', key: 'FORBIDDEN_KEY' });
  });
});

// ─── TC-RSC-03: Allowlist gate — empty allowlist ──────────────────────────────

describe('TC-RSC-03: allowlist gate — key-denied when allowlist is empty', () => {
  it('throws key-denied when allowlist is an empty array', async () => {
    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'DB_PASSWORD' },
        {
          allowlist: [],
          backend: makeBackend({ DB_PASSWORD: 'val' }),
          approval_id: 'tok-03a',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err).toBeInstanceOf(ReadSecretError);
    expect(err!.code).toBe('key-denied');
  });

  it('throws key-denied when allowlist is an empty Set', async () => {
    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'DB_PASSWORD' },
        {
          allowlist: new Set<string>(),
          backend: makeBackend({ DB_PASSWORD: 'val' }),
          approval_id: 'tok-03b',
        },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err!.code).toBe('key-denied');
  });
});

// ─── TC-RSC-04: HITL gate — hitl-required ────────────────────────────────────

describe('TC-RSC-04: HITL gate — hitl-required when approval_id is absent', () => {
  it('throws ReadSecretError with code hitl-required', async () => {
    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'DB_PASSWORD' },
        { allowlist: ALLOWLIST, backend: makeBackend({ DB_PASSWORD: 'val' }) },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err).toBeInstanceOf(ReadSecretError);
    expect(err!.code).toBe('hitl-required');
  });

  it('error message references approval_id', async () => {
    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'DB_PASSWORD' },
        { allowlist: ALLOWLIST, backend: makeBackend({ DB_PASSWORD: 'val' }) },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err!.message).toContain('approval_id');
  });

  it('logs a hitl-required event', async () => {
    const { logger, entries } = makeLogger();
    try {
      await readSecret({ key: 'DB_PASSWORD' }, { logger, allowlist: ALLOWLIST });
    } catch {
      // expected
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'read-secret', event: 'hitl-required' });
  });

  it('succeeds when a valid approval_id is provided', async () => {
    const result = await readSecret(
      { key: 'DB_PASSWORD' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-04d',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.value).toBe('val');
  });
});

// ─── TC-RSC-05: Replay protection — token-replayed ───────────────────────────

describe('TC-RSC-05: replay protection — token-replayed when token is consumed', () => {
  it('throws token-replayed when token was consumed before the call', async () => {
    const manager = makeApprovalManager();
    manager.resolveApproval('pre-consumed', 'approved');

    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'DB_PASSWORD' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend({ DB_PASSWORD: 'val' }),
          approval_id: 'pre-consumed',
          approvalManager: manager,
        },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err).toBeInstanceOf(ReadSecretError);
    expect(err!.code).toBe('token-replayed');
  });

  it('token is consumed after a successful read, preventing replay', async () => {
    const manager = makeApprovalManager();
    const backend = makeBackend({ DB_PASSWORD: 'val' });

    await readSecret(
      { key: 'DB_PASSWORD' },
      { allowlist: ALLOWLIST, backend, approval_id: 'one-time', approvalManager: manager },
    );

    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'DB_PASSWORD' },
        { allowlist: ALLOWLIST, backend, approval_id: 'one-time', approvalManager: manager },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err!.code).toBe('token-replayed');
  });

  it('logs a token-replayed event with the approvalId', async () => {
    const { logger, entries } = makeLogger();
    const manager = makeApprovalManager();
    manager.resolveApproval('replay-tok', 'approved');

    try {
      await readSecret(
        { key: 'DB_PASSWORD' },
        {
          logger,
          allowlist: ALLOWLIST,
          backend: makeBackend({ DB_PASSWORD: 'val' }),
          approval_id: 'replay-tok',
          approvalManager: manager,
        },
      );
    } catch {
      // expected
    }
    expect(entries[0]).toMatchObject({
      type: 'read-secret',
      event: 'token-replayed',
      approvalId: 'replay-tok',
    });
  });

  it('different tokens are independent', async () => {
    const manager = makeApprovalManager();
    const backend = makeBackend({ DB_PASSWORD: 'val' });

    await readSecret(
      { key: 'DB_PASSWORD' },
      { allowlist: ALLOWLIST, backend, approval_id: 'token-A', approvalManager: manager },
    );

    const result = await readSecret(
      { key: 'DB_PASSWORD' },
      { allowlist: ALLOWLIST, backend, approval_id: 'token-B', approvalManager: manager },
    );
    expect(result.value).toBe('val');
  });
});

// ─── TC-RSC-06: Not-found ─────────────────────────────────────────────────────

describe('TC-RSC-06: not-found — throws when key absent from store', () => {
  it('throws ReadSecretError with code not-found', async () => {
    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'DB_PASSWORD' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend({}),
          approval_id: 'tok-06a',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err).toBeInstanceOf(ReadSecretError);
    expect(err!.code).toBe('not-found');
  });

  it('error message includes the missing key', async () => {
    let err: ReadSecretError | undefined;
    try {
      await readSecret(
        { key: 'DB_PASSWORD' },
        {
          allowlist: ALLOWLIST,
          backend: makeBackend({}),
          approval_id: 'tok-06b',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch (e) {
      err = e as ReadSecretError;
    }
    expect(err!.message).toContain('DB_PASSWORD');
  });

  it('logs a not-found event', async () => {
    const { logger, entries } = makeLogger();
    try {
      await readSecret(
        { key: 'DB_PASSWORD' },
        {
          logger,
          allowlist: ALLOWLIST,
          backend: makeBackend({}),
          approval_id: 'tok-06c',
          approvalManager: makeApprovalManager(),
        },
      );
    } catch {
      // expected
    }
    const notFound = entries.find((e) => e['event'] === 'not-found');
    expect(notFound).toBeDefined();
    expect(notFound!['key']).toBe('DB_PASSWORD');
  });
});

// ─── TC-RSC-07: Audit logging — value never exposed ──────────────────────────

describe('TC-RSC-07: audit logging — value never exposed in log entries', () => {
  it('logs read-attempt and read-complete on success', async () => {
    const { logger, entries } = makeLogger();

    await readSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'super-secret' }),
        approval_id: 'tok-07a',
        approvalManager: makeApprovalManager(),
      },
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'read-secret', event: 'read-attempt' });
    expect(entries[1]).toMatchObject({ type: 'read-secret', event: 'read-complete' });
  });

  it('no log entry contains the secret value', async () => {
    const { logger, entries } = makeLogger();
    const secretValue = 'super-secret-value-12345';

    await readSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: secretValue }),
        approval_id: 'tok-07b',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(secretValue);
    }
  });

  it('read-complete entry includes valueLength but not the value', async () => {
    const { logger, entries } = makeLogger();
    const secretValue = 'password123';

    await readSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: secretValue }),
        approval_id: 'tok-07c',
        approvalManager: makeApprovalManager(),
      },
    );

    const complete = entries.find((e) => e['event'] === 'read-complete');
    expect(complete!['valueLength']).toBe(secretValue.length);
    expect(complete!['value']).toBeUndefined();
  });

  it('all entries include toolName read_secret', async () => {
    const { logger, entries } = makeLogger();

    await readSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-07d',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['toolName']).toBe('read_secret');
    }
  });

  it('all entries include a ts timestamp', async () => {
    const { logger, entries } = makeLogger();

    await readSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-07e',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(typeof entry['ts']).toBe('string');
      expect((entry['ts'] as string).length).toBeGreaterThan(0);
    }
  });

  it('read-attempt entry includes the key and approvalId', async () => {
    const { logger, entries } = makeLogger();

    await readSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-07f',
        approvalManager: makeApprovalManager(),
      },
    );

    const attempt = entries.find((e) => e['event'] === 'read-attempt');
    expect(attempt!['key']).toBe('DB_PASSWORD');
    expect(attempt!['approvalId']).toBe('tok-07f');
  });
});

// ─── TC-RSC-08: Result shape ──────────────────────────────────────────────────

describe('TC-RSC-08: result shape', () => {
  it('result has a value field', async () => {
    const result = await readSecret(
      { key: 'DB_PASSWORD' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-08a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result).toHaveProperty('value');
  });

  it('value field is a string', async () => {
    const result = await readSecret(
      { key: 'DB_PASSWORD' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-08b',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(typeof result.value).toBe('string');
  });
});

// ─── TC-RSC-09: agentId and channel propagation ───────────────────────────────

describe('TC-RSC-09: agentId and channel propagated to log entries', () => {
  it('propagates agentId and channel to all log entries', async () => {
    const { logger, entries } = makeLogger();

    await readSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        agentId: 'agent-rsc',
        channel: 'ops-slack',
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-09a',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['agentId']).toBe('agent-rsc');
      expect(entry['channel']).toBe('ops-slack');
    }
  });

  it('defaults agentId and channel to "unknown" when not provided', async () => {
    const { logger, entries } = makeLogger();

    await readSecret(
      { key: 'DB_PASSWORD' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
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

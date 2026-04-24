/**
 * Unit tests for the list_secrets tool.
 *
 * Test IDs:
 *   TC-LSC-01: Successful list — returns keys present in backend from allowlist
 *   TC-LSC-02: Empty allowlist — returns empty key list (fail-closed)
 *   TC-LSC-03: Allowlist filtering — only returns keys that exist in backend
 *   TC-LSC-04: HITL gate — hitl-required when approval_id is absent
 *   TC-LSC-05: Replay protection — token-replayed when token is consumed
 *   TC-LSC-06: Audit logging — values never exposed; key names logged on complete
 *   TC-LSC-07: Result shape — keys field is an array of strings
 *   TC-LSC-08: agentId and channel propagated to log entries
 *   TC-LSC-09: store parameter — backendName included in log entries
 */

import { describe, it, expect } from 'vitest';
import { listSecrets, ListSecretsError } from './list-secrets.js';
import type { ListSecretsLogger, ListSecretsApprovalManager } from './list-secrets.js';
import { MemorySecretBackend } from '../secrets/secret-backend.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger(): { logger: ListSecretsLogger; entries: Array<Record<string, unknown>> } {
  const entries: Array<Record<string, unknown>> = [];
  const logger: ListSecretsLogger = {
    log: async (entry) => {
      entries.push(entry);
    },
  };
  return { logger, entries };
}

function makeApprovalManager(): ListSecretsApprovalManager {
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

// ─── TC-LSC-01: Successful list ───────────────────────────────────────────────

describe('TC-LSC-01: successful list — returns keys present in backend from allowlist', () => {
  it('returns keys that exist in the backend', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'hunter2', API_KEY: 'sk-abc' }),
        approval_id: 'tok-01a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.keys).toContain('DB_PASSWORD');
    expect(result.keys).toContain('API_KEY');
    expect(result.keys).not.toContain('SECRET_TOKEN');
  });

  it('returns all allowlisted keys when all are present', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'a', API_KEY: 'b', SECRET_TOKEN: 'c' }),
        approval_id: 'tok-01b',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.keys.sort()).toEqual(['API_KEY', 'DB_PASSWORD', 'SECRET_TOKEN'].sort());
  });

  it('returns empty array when no allowlisted keys are in backend', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ OTHER_KEY: 'val' }),
        approval_id: 'tok-01c',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.keys).toEqual([]);
  });
});

// ─── TC-LSC-02: Empty allowlist ───────────────────────────────────────────────

describe('TC-LSC-02: empty allowlist — returns empty key list (fail-closed)', () => {
  it('returns empty array when allowlist is an empty array', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: [],
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-02a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.keys).toEqual([]);
  });

  it('returns empty array when allowlist is an empty Set', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: new Set<string>(),
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-02b',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.keys).toEqual([]);
  });
});

// ─── TC-LSC-03: Allowlist filtering ──────────────────────────────────────────

describe('TC-LSC-03: allowlist filtering — only returns keys that exist in backend', () => {
  it('excludes backend keys not in the allowlist', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: ['DB_PASSWORD'],
        backend: makeBackend({ DB_PASSWORD: 'val', UNALLOWED_KEY: 'secret' }),
        approval_id: 'tok-03a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.keys).toEqual(['DB_PASSWORD']);
    expect(result.keys).not.toContain('UNALLOWED_KEY');
  });

  it('excludes allowlist keys that are absent from the backend', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: ['DB_PASSWORD', 'MISSING_KEY'],
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-03b',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.keys).toEqual(['DB_PASSWORD']);
    expect(result.keys).not.toContain('MISSING_KEY');
  });
});

// ─── TC-LSC-04: HITL gate — hitl-required ────────────────────────────────────

describe('TC-LSC-04: HITL gate — hitl-required when approval_id is absent', () => {
  it('throws ListSecretsError with code hitl-required', async () => {
    let err: ListSecretsError | undefined;
    try {
      await listSecrets(
        {},
        { allowlist: ALLOWLIST, backend: makeBackend({ DB_PASSWORD: 'val' }) },
      );
    } catch (e) {
      err = e as ListSecretsError;
    }
    expect(err).toBeInstanceOf(ListSecretsError);
    expect(err!.code).toBe('hitl-required');
  });

  it('error name is ListSecretsError', async () => {
    let err: ListSecretsError | undefined;
    try {
      await listSecrets({}, { allowlist: ALLOWLIST });
    } catch (e) {
      err = e as ListSecretsError;
    }
    expect(err!.name).toBe('ListSecretsError');
  });

  it('error message references approval_id', async () => {
    let err: ListSecretsError | undefined;
    try {
      await listSecrets({}, { allowlist: ALLOWLIST });
    } catch (e) {
      err = e as ListSecretsError;
    }
    expect(err!.message).toContain('approval_id');
  });

  it('logs a hitl-required event', async () => {
    const { logger, entries } = makeLogger();
    try {
      await listSecrets({}, { logger, allowlist: ALLOWLIST });
    } catch {
      // expected
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'list-secrets', event: 'hitl-required' });
  });

  it('succeeds when a valid approval_id is provided', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-04e',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(Array.isArray(result.keys)).toBe(true);
  });
});

// ─── TC-LSC-05: Replay protection — token-replayed ───────────────────────────

describe('TC-LSC-05: replay protection — token-replayed when token is consumed', () => {
  it('throws token-replayed when token was consumed before the call', async () => {
    const manager = makeApprovalManager();
    manager.resolveApproval('pre-consumed', 'approved');

    let err: ListSecretsError | undefined;
    try {
      await listSecrets(
        {},
        {
          allowlist: ALLOWLIST,
          backend: makeBackend({ DB_PASSWORD: 'val' }),
          approval_id: 'pre-consumed',
          approvalManager: manager,
        },
      );
    } catch (e) {
      err = e as ListSecretsError;
    }
    expect(err).toBeInstanceOf(ListSecretsError);
    expect(err!.code).toBe('token-replayed');
  });

  it('token is consumed after a successful list, preventing replay', async () => {
    const manager = makeApprovalManager();
    const backend = makeBackend({ DB_PASSWORD: 'val' });

    await listSecrets(
      {},
      { allowlist: ALLOWLIST, backend, approval_id: 'one-time', approvalManager: manager },
    );

    let err: ListSecretsError | undefined;
    try {
      await listSecrets(
        {},
        { allowlist: ALLOWLIST, backend, approval_id: 'one-time', approvalManager: manager },
      );
    } catch (e) {
      err = e as ListSecretsError;
    }
    expect(err!.code).toBe('token-replayed');
  });

  it('logs a token-replayed event with the approvalId', async () => {
    const { logger, entries } = makeLogger();
    const manager = makeApprovalManager();
    manager.resolveApproval('replay-tok', 'approved');

    try {
      await listSecrets(
        {},
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
      type: 'list-secrets',
      event: 'token-replayed',
      approvalId: 'replay-tok',
    });
  });

  it('different tokens are independent', async () => {
    const manager = makeApprovalManager();
    const backend = makeBackend({ DB_PASSWORD: 'val' });

    await listSecrets(
      {},
      { allowlist: ALLOWLIST, backend, approval_id: 'token-A', approvalManager: manager },
    );

    const result = await listSecrets(
      {},
      { allowlist: ALLOWLIST, backend, approval_id: 'token-B', approvalManager: manager },
    );
    expect(Array.isArray(result.keys)).toBe(true);
  });
});

// ─── TC-LSC-06: Audit logging ─────────────────────────────────────────────────

describe('TC-LSC-06: audit logging — values never exposed; key names logged on complete', () => {
  it('logs list-attempt and list-complete on success', async () => {
    const { logger, entries } = makeLogger();

    await listSecrets(
      {},
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'super-secret' }),
        approval_id: 'tok-06a',
        approvalManager: makeApprovalManager(),
      },
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'list-secrets', event: 'list-attempt' });
    expect(entries[1]).toMatchObject({ type: 'list-secrets', event: 'list-complete' });
  });

  it('no log entry contains any secret value', async () => {
    const { logger, entries } = makeLogger();
    const secretValue = 'super-secret-value-9999';

    await listSecrets(
      {},
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: secretValue }),
        approval_id: 'tok-06b',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(secretValue);
    }
  });

  it('list-complete entry includes keyCount', async () => {
    const { logger, entries } = makeLogger();

    await listSecrets(
      {},
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val', API_KEY: 'val2' }),
        approval_id: 'tok-06c',
        approvalManager: makeApprovalManager(),
      },
    );

    const complete = entries.find((e) => e['event'] === 'list-complete');
    expect(complete!['keyCount']).toBe(2);
  });

  it('list-attempt entry includes allowlistSize', async () => {
    const { logger, entries } = makeLogger();

    await listSecrets(
      {},
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-06d',
        approvalManager: makeApprovalManager(),
      },
    );

    const attempt = entries.find((e) => e['event'] === 'list-attempt');
    expect(attempt!['allowlistSize']).toBe(ALLOWLIST.length);
  });

  it('all entries include toolName list_secrets', async () => {
    const { logger, entries } = makeLogger();

    await listSecrets(
      {},
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-06e',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['toolName']).toBe('list_secrets');
    }
  });

  it('all entries include a ts timestamp', async () => {
    const { logger, entries } = makeLogger();

    await listSecrets(
      {},
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-06f',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(typeof entry['ts']).toBe('string');
      expect((entry['ts'] as string).length).toBeGreaterThan(0);
    }
  });
});

// ─── TC-LSC-07: Result shape ──────────────────────────────────────────────────

describe('TC-LSC-07: result shape', () => {
  it('result has a keys field', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-07a',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result).toHaveProperty('keys');
  });

  it('keys field is an array', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-07b',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(Array.isArray(result.keys)).toBe(true);
  });

  it('keys are strings', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val', API_KEY: 'val2' }),
        approval_id: 'tok-07c',
        approvalManager: makeApprovalManager(),
      },
    );
    for (const key of result.keys) {
      expect(typeof key).toBe('string');
    }
  });

  it('result contains no value fields', async () => {
    const result = await listSecrets(
      {},
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-07d',
        approvalManager: makeApprovalManager(),
      },
    );
    expect((result as Record<string, unknown>)['value']).toBeUndefined();
    expect((result as Record<string, unknown>)['values']).toBeUndefined();
  });
});

// ─── TC-LSC-08: agentId and channel propagation ───────────────────────────────

describe('TC-LSC-08: agentId and channel propagated to log entries', () => {
  it('propagates agentId and channel to all log entries', async () => {
    const { logger, entries } = makeLogger();

    await listSecrets(
      {},
      {
        logger,
        agentId: 'agent-lsc',
        channel: 'ops-slack',
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-08a',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['agentId']).toBe('agent-lsc');
      expect(entry['channel']).toBe('ops-slack');
    }
  });

  it('defaults agentId and channel to "unknown" when not provided', async () => {
    const { logger, entries } = makeLogger();

    await listSecrets(
      {},
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
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

// ─── TC-LSC-09: store parameter ───────────────────────────────────────────────

describe('TC-LSC-09: store parameter — backendName included in log entries', () => {
  it('includes store identifier in all log entries', async () => {
    const { logger, entries } = makeLogger();

    await listSecrets(
      { store: 'env' },
      {
        logger,
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val' }),
        approval_id: 'tok-09a',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(typeof entry['store']).toBe('string');
    }
  });

  it('works with store parameter when backend is injected', async () => {
    const result = await listSecrets(
      { store: 'vault' },
      {
        allowlist: ALLOWLIST,
        backend: makeBackend({ DB_PASSWORD: 'val', API_KEY: 'val2' }),
        approval_id: 'tok-09b',
        approvalManager: makeApprovalManager(),
      },
    );
    expect(result.keys.sort()).toEqual(['API_KEY', 'DB_PASSWORD'].sort());
  });
});

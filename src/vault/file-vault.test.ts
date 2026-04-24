/**
 * Unit tests for FileCredentialVault.
 *
 * Test IDs:
 *   TC-FCV-01: load — succeeds on a valid credential JSON file
 *   TC-FCV-02: get  — returns the stored value for an existing key
 *   TC-FCV-03: get  — returns undefined for a missing key
 *   TC-FCV-04: has  — returns true for an existing key
 *   TC-FCV-05: has  — returns false for a missing key
 *   TC-FCV-06: keys — returns all keys from the file
 *   TC-FCV-07: load — throws CredentialVaultError('file-not-found') when file is missing
 *   TC-FCV-08: load — throws CredentialVaultError('invalid-json') on malformed JSON
 *   TC-FCV-09: load — throws CredentialVaultError('invalid-schema') on wrong value types
 *   TC-FCV-10: set  — throws CredentialVaultError('read-only') on every call
 *   TC-FCV-11: implements SecretBackend (get/has/set are present and typed correctly)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FileCredentialVault } from './file-vault.js';
import { CredentialVaultError } from './types.js';
import type { SecretBackend } from '../tools/secrets/secret-backend.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const CREDS_PATH = '/tmp/test-credentials.json';

const validCredentials = {
  DB_PASSWORD: 'secret-db-pass',
  API_KEY: 'key-abc123',
  STRIPE_SECRET: 'sk_test_xyz',
};
const validCredentialsJson = JSON.stringify(validCredentials);

async function loadWithContent(content: string): Promise<FileCredentialVault> {
  const { readFile } = await import('node:fs/promises');
  (readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(content);
  return FileCredentialVault.load({ credentialsPath: CREDS_PATH });
}

afterEach(() => {
  vi.clearAllMocks();
});

// ─── TC-FCV-01: load succeeds on valid file ───────────────────────────────────

describe('FileCredentialVault.load', () => {
  it('TC-FCV-01: resolves with a vault instance on a valid credential file', async () => {
    const vault = await loadWithContent(validCredentialsJson);
    expect(vault).toBeInstanceOf(FileCredentialVault);
  });

  // ─── TC-FCV-07: file-not-found ────────────────────────────────────────────

  it('TC-FCV-07: throws CredentialVaultError with code file-not-found when file is missing', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }),
    );

    await expect(
      FileCredentialVault.load({ credentialsPath: CREDS_PATH }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CredentialVaultError && err.code === 'file-not-found',
    );
  });

  // ─── TC-FCV-08: invalid-json ─────────────────────────────────────────────

  it('TC-FCV-08: throws CredentialVaultError with code invalid-json on malformed JSON', async () => {
    await expect(
      loadWithContent('{ not valid json '),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CredentialVaultError && err.code === 'invalid-json',
    );
  });

  // ─── TC-FCV-09: invalid-schema ───────────────────────────────────────────

  it('TC-FCV-09: throws CredentialVaultError with code invalid-schema when values are not strings', async () => {
    const badContent = JSON.stringify({ DB_PASSWORD: 12345, API_KEY: null });
    await expect(
      loadWithContent(badContent),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CredentialVaultError && err.code === 'invalid-schema',
    );
  });

  it('TC-FCV-09b: throws CredentialVaultError with code invalid-schema when root is an array', async () => {
    await expect(
      loadWithContent(JSON.stringify(['DB_PASSWORD', 'API_KEY'])),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CredentialVaultError && err.code === 'invalid-schema',
    );
  });
});

// ─── TC-FCV-02/03: get ────────────────────────────────────────────────────────

describe('FileCredentialVault.get', () => {
  it('TC-FCV-02: returns the stored value for an existing key', async () => {
    const vault = await loadWithContent(validCredentialsJson);
    expect(vault.get('DB_PASSWORD')).toBe('secret-db-pass');
    expect(vault.get('API_KEY')).toBe('key-abc123');
  });

  it('TC-FCV-03: returns undefined for a key that is not in the file', async () => {
    const vault = await loadWithContent(validCredentialsJson);
    expect(vault.get('MISSING_KEY')).toBeUndefined();
  });
});

// ─── TC-FCV-04/05: has ───────────────────────────────────────────────────────

describe('FileCredentialVault.has', () => {
  it('TC-FCV-04: returns true for a key present in the file', async () => {
    const vault = await loadWithContent(validCredentialsJson);
    expect(vault.has('STRIPE_SECRET')).toBe(true);
  });

  it('TC-FCV-05: returns false for a key absent from the file', async () => {
    const vault = await loadWithContent(validCredentialsJson);
    expect(vault.has('NONEXISTENT')).toBe(false);
  });
});

// ─── TC-FCV-06: keys ─────────────────────────────────────────────────────────

describe('FileCredentialVault.keys', () => {
  it('TC-FCV-06: returns all keys from the credential file', async () => {
    const vault = await loadWithContent(validCredentialsJson);
    const keys = vault.keys();
    expect(keys).toHaveLength(3);
    expect(keys).toContain('DB_PASSWORD');
    expect(keys).toContain('API_KEY');
    expect(keys).toContain('STRIPE_SECRET');
  });

  it('returns an empty array for an empty credential file', async () => {
    const vault = await loadWithContent('{}');
    expect(vault.keys()).toHaveLength(0);
  });
});

// ─── TC-FCV-10: set is read-only ─────────────────────────────────────────────

describe('FileCredentialVault.set', () => {
  it('TC-FCV-10: throws CredentialVaultError with code read-only on every call', async () => {
    const vault = await loadWithContent(validCredentialsJson);
    expect(() => vault.set('NEW_KEY', 'value')).toThrow(CredentialVaultError);
    expect(() => vault.set('NEW_KEY', 'value')).toSatisfy(
      () => {
        try {
          vault.set('NEW_KEY', 'value');
          return false;
        } catch (err) {
          return err instanceof CredentialVaultError && err.code === 'read-only';
        }
      },
    );
  });
});

// ─── TC-FCV-11: SecretBackend compatibility ──────────────────────────────────

describe('FileCredentialVault SecretBackend compatibility', () => {
  it('TC-FCV-11: satisfies the SecretBackend interface (get/has/set present)', async () => {
    const vault = await loadWithContent(validCredentialsJson);
    // Type-check: assigning to SecretBackend should compile without errors.
    const backend: SecretBackend = vault;
    expect(backend.get('DB_PASSWORD')).toBe('secret-db-pass');
    expect(backend.has('DB_PASSWORD')).toBe(true);
    expect(() => backend.set('KEY', 'val')).toThrow(CredentialVaultError);
  });
});

/**
 * Unit tests for EnvCredentialVault.
 *
 * Test IDs:
 *   TC-ECV-01: get  — returns the env var value for a key that is set
 *   TC-ECV-02: get  — returns undefined for a key that is not set
 *   TC-ECV-03: has  — returns true for a key that is set
 *   TC-ECV-04: has  — returns false for a key that is not set
 *   TC-ECV-05: has  — returns true for a key set to an empty string
 *   TC-ECV-06: keys — includes a key after it is set via set()
 *   TC-ECV-07: set  — writes value to process.env and is retrievable via get()
 *   TC-ECV-08: set  — overwrites an existing value
 *   TC-ECV-09: implements ICredentialVault (get/has/keys typed correctly)
 *   TC-ECV-10: implements SecretBackend (get/has/set typed correctly)
 *   TC-ECV-11: envVault singleton is an EnvCredentialVault instance
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvCredentialVault, envVault } from './env-vault.js';
import type { ICredentialVault } from './types.js';
import type { SecretBackend } from '../tools/secrets/secret-backend.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Unique key prefix to avoid collisions with real env vars in the test env. */
const PREFIX = '__TC_ECV_TEST__';

function testKey(suffix: string): string {
  return `${PREFIX}${suffix}`;
}

// Clean up any keys written during tests to avoid cross-test contamination.
const writtenKeys = new Set<string>();

function setEnv(key: string, value: string): void {
  writtenKeys.add(key);
  process.env[key] = value;
}

beforeEach(() => {
  writtenKeys.clear();
});

afterEach(() => {
  for (const key of writtenKeys) {
    delete process.env[key]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
  }
  writtenKeys.clear();
});

// ─── TC-ECV-01: get — returns value for existing key ─────────────────────────

describe('TC-ECV-01: get — returns env var value for a key that is set', () => {
  it('returns the correct value', () => {
    const vault = new EnvCredentialVault();
    const key = testKey('01');
    setEnv(key, 'secret-value-01');
    expect(vault.get(key)).toBe('secret-value-01');
  });

  it('reflects the current value if process.env is updated externally', () => {
    const vault = new EnvCredentialVault();
    const key = testKey('01b');
    setEnv(key, 'first');
    expect(vault.get(key)).toBe('first');
    process.env[key] = 'second';
    expect(vault.get(key)).toBe('second');
  });
});

// ─── TC-ECV-02: get — returns undefined for missing key ──────────────────────

describe('TC-ECV-02: get — returns undefined for a key that is not set', () => {
  it('returns undefined for an absent key', () => {
    const vault = new EnvCredentialVault();
    expect(vault.get(testKey('02-absent'))).toBeUndefined();
  });
});

// ─── TC-ECV-03: has — returns true for existing key ──────────────────────────

describe('TC-ECV-03: has — returns true for a key that is set', () => {
  it('returns true when the key exists', () => {
    const vault = new EnvCredentialVault();
    const key = testKey('03');
    setEnv(key, 'val');
    expect(vault.has(key)).toBe(true);
  });
});

// ─── TC-ECV-04: has — returns false for missing key ──────────────────────────

describe('TC-ECV-04: has — returns false for a key that is not set', () => {
  it('returns false for an absent key', () => {
    const vault = new EnvCredentialVault();
    expect(vault.has(testKey('04-absent'))).toBe(false);
  });
});

// ─── TC-ECV-05: has — returns true for empty string ──────────────────────────

describe('TC-ECV-05: has — returns true for a key set to an empty string', () => {
  it('returns true even when the value is an empty string', () => {
    const vault = new EnvCredentialVault();
    const key = testKey('05');
    setEnv(key, '');
    expect(vault.has(key)).toBe(true);
  });

  it('get returns empty string for such a key', () => {
    const vault = new EnvCredentialVault();
    const key = testKey('05b');
    setEnv(key, '');
    expect(vault.get(key)).toBe('');
  });
});

// ─── TC-ECV-06: keys — includes set keys ─────────────────────────────────────

describe('TC-ECV-06: keys — includes a key after it is set', () => {
  it('contains a key that was written via set()', () => {
    const vault = new EnvCredentialVault();
    const key = testKey('06');
    vault.set(key, 'val');
    writtenKeys.add(key);
    expect(vault.keys()).toContain(key);
  });

  it('does not contain a key that was never set', () => {
    const vault = new EnvCredentialVault();
    expect(vault.keys()).not.toContain(testKey('06-never-set'));
  });

  it('returns a ReadonlyArray', () => {
    const vault = new EnvCredentialVault();
    const keys: ReadonlyArray<string> = vault.keys();
    expect(Array.isArray(keys)).toBe(true);
  });
});

// ─── TC-ECV-07: set — writes to process.env ──────────────────────────────────

describe('TC-ECV-07: set — writes value to process.env and is retrievable', () => {
  it('sets the env var so get() returns it', () => {
    const vault = new EnvCredentialVault();
    const key = testKey('07');
    vault.set(key, 'written-by-vault');
    writtenKeys.add(key);
    expect(vault.get(key)).toBe('written-by-vault');
  });

  it('value is visible in process.env directly', () => {
    const vault = new EnvCredentialVault();
    const key = testKey('07b');
    vault.set(key, 'raw-env-check');
    writtenKeys.add(key);
    expect(process.env[key]).toBe('raw-env-check');
  });
});

// ─── TC-ECV-08: set — overwrites existing value ──────────────────────────────

describe('TC-ECV-08: set — overwrites an existing value', () => {
  it('replaces the previous value on a second call', () => {
    const vault = new EnvCredentialVault();
    const key = testKey('08');
    vault.set(key, 'first');
    writtenKeys.add(key);
    vault.set(key, 'second');
    expect(vault.get(key)).toBe('second');
  });
});

// ─── TC-ECV-09: ICredentialVault compatibility ───────────────────────────────

describe('TC-ECV-09: implements ICredentialVault (get/has/keys typed correctly)', () => {
  it('satisfies the ICredentialVault interface', () => {
    const vault = new EnvCredentialVault();
    // Type-check: assigning to ICredentialVault should compile without errors.
    const iface: ICredentialVault = vault;
    const key = testKey('09');
    setEnv(key, 'iface-val');
    expect(iface.get(key)).toBe('iface-val');
    expect(iface.has(key)).toBe(true);
    expect(iface.keys()).toContain(key);
  });
});

// ─── TC-ECV-10: SecretBackend compatibility ──────────────────────────────────

describe('TC-ECV-10: implements SecretBackend (get/has/set typed correctly)', () => {
  it('satisfies the SecretBackend interface', () => {
    const vault = new EnvCredentialVault();
    // Type-check: assigning to SecretBackend should compile without errors.
    const backend: SecretBackend = vault;
    const key = testKey('10');
    backend.set(key, 'backend-val');
    writtenKeys.add(key);
    expect(backend.get(key)).toBe('backend-val');
    expect(backend.has(key)).toBe(true);
  });
});

// ─── TC-ECV-11: envVault singleton ───────────────────────────────────────────

describe('TC-ECV-11: envVault singleton is an EnvCredentialVault instance', () => {
  it('envVault is an instance of EnvCredentialVault', () => {
    expect(envVault).toBeInstanceOf(EnvCredentialVault);
  });

  it('envVault reads from process.env', () => {
    const key = testKey('11');
    setEnv(key, 'singleton-check');
    expect(envVault.get(key)).toBe('singleton-check');
  });
});

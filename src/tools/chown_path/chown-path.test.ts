/**
 * Unit tests for the chown_path tool.
 *
 * Test IDs:
 *   TC-CHO-01: validateOwner — owner-spec validation
 *   TC-CHO-02: validatePath  — path validation
 *   TC-CHO-03: chownPath     — pre-flight rejects bad paths
 *   TC-CHO-04: chownPath     — pre-flight rejects bad owners
 *   TC-CHO-05: manifest      — F-05 manifest is well-formed
 *
 * No execution-success test: chown almost always requires root on real
 * files, so a CI-portable success test is brittle. The shared spawn
 * pattern is exercised by the sibling chmod_path test.
 */

import { describe, it, expect } from 'vitest';
import {
  validateOwner,
  validatePath,
  chownPath,
  ChownPathError,
} from './chown-path.js';
import { chownPathManifest } from './manifest.js';

// ─── TC-CHO-01: validateOwner ────────────────────────────────────────────────

describe('TC-CHO-01: validateOwner — owner-spec validation', () => {
  it('accepts a bare username', () => {
    expect(validateOwner('alice')).toBe(true);
  });

  it('accepts user:group', () => {
    expect(validateOwner('alice:staff')).toBe(true);
  });

  it('accepts user: (group reset to primary)', () => {
    expect(validateOwner('alice:')).toBe(true);
  });

  it('accepts :group (group only)', () => {
    expect(validateOwner(':staff')).toBe(true);
  });

  it('accepts numeric uid', () => {
    expect(validateOwner('1000')).toBe(true);
  });

  it('accepts numeric uid:gid', () => {
    expect(validateOwner('1000:1000')).toBe(true);
  });

  it('accepts a name with hyphen', () => {
    expect(validateOwner('build-bot')).toBe(true);
  });

  it('accepts an underscore-prefixed name', () => {
    expect(validateOwner('_systemuser')).toBe(true);
  });

  it('rejects a Samba/Windows machine account ending in $ (operators must use numeric uid)', () => {
    expect(validateOwner('machine$')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validateOwner('')).toBe(false);
  });

  it('rejects shell injection', () => {
    expect(validateOwner('alice; rm -rf /')).toBe(false);
  });

  it('rejects a name starting with a digit (POSIX-portable)', () => {
    expect(validateOwner('1user')).toBe(false);
  });

  it('rejects a name with uppercase (POSIX-portable case)', () => {
    expect(validateOwner('Alice')).toBe(false);
  });

  it('rejects a backtick command-substitution attempt', () => {
    expect(validateOwner('`whoami`')).toBe(false);
  });

  it('rejects double-colon owner spec', () => {
    expect(validateOwner('alice::staff')).toBe(false);
  });
});

// ─── TC-CHO-02: validatePath ─────────────────────────────────────────────────

describe('TC-CHO-02: validatePath — path validation', () => {
  it('accepts an absolute path', () => {
    expect(validatePath('/etc/nginx/nginx.conf')).toBe(true);
  });

  it('accepts a relative path', () => {
    expect(validatePath('./build/output')).toBe(true);
  });

  it('rejects an empty path', () => {
    expect(validatePath('')).toBe(false);
  });

  it('rejects a path with shell injection', () => {
    expect(validatePath('/tmp/foo; rm -rf /')).toBe(false);
  });
});

// ─── TC-CHO-03: pre-flight rejects bad paths ─────────────────────────────────

describe('TC-CHO-03: chownPath — pre-flight rejects bad paths', () => {
  it('throws invalid-path for shell injection in path', () => {
    let err: ChownPathError | undefined;
    try {
      chownPath({ path: '/tmp/x; rm -rf /', owner: 'alice' });
    } catch (e) {
      err = e as ChownPathError;
    }
    expect(err).toBeInstanceOf(ChownPathError);
    expect(err!.code).toBe('invalid-path');
  });
});

// ─── TC-CHO-04: pre-flight rejects bad owners ────────────────────────────────

describe('TC-CHO-04: chownPath — pre-flight rejects bad owners', () => {
  it('throws invalid-owner for shell injection in owner', () => {
    let err: ChownPathError | undefined;
    try {
      chownPath({ path: '/tmp/x', owner: 'alice; rm -rf /' });
    } catch (e) {
      err = e as ChownPathError;
    }
    expect(err).toBeInstanceOf(ChownPathError);
    expect(err!.code).toBe('invalid-owner');
  });

  it('path validation runs before owner validation', () => {
    let err: ChownPathError | undefined;
    try {
      chownPath({ path: '`bad`', owner: 'bad owner' });
    } catch (e) {
      err = e as ChownPathError;
    }
    expect(err!.code).toBe('invalid-path');
  });
});

// ─── TC-CHO-05: manifest sanity ──────────────────────────────────────────────

describe('TC-CHO-05: manifest is a well-formed F-05 manifest', () => {
  it('declares the permissions.modify action class', () => {
    expect(chownPathManifest.action_class).toBe('permissions.modify');
  });

  it('declares risk_tier high', () => {
    expect(chownPathManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(chownPathManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares path as the target_field', () => {
    expect(chownPathManifest.target_field).toBe('path');
  });

  it('marks path and owner as required', () => {
    expect(chownPathManifest.params['required']).toEqual(['path', 'owner']);
  });

  it('forbids additional properties on the params schema', () => {
    expect(chownPathManifest.params['additionalProperties']).toBe(false);
  });
});

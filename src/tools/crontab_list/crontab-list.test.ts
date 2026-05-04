/**
 * Unit tests for the crontab_list tool.
 *
 * Test IDs:
 *   TC-CTL-01: validateUser  — username validation
 *   TC-CTL-02: crontabList   — pre-flight rejects bad users
 *   TC-CTL-03: manifest      — F-05 manifest is well-formed
 */

import { describe, it, expect } from 'vitest';
import {
  validateUser,
  crontabList,
  CrontabListError,
} from './crontab-list.js';
import { crontabListManifest } from './manifest.js';

// ─── TC-CTL-01: validateUser ─────────────────────────────────────────────────

describe('TC-CTL-01: validateUser — username validation', () => {
  it('accepts a simple username', () => {
    expect(validateUser('alice')).toBe(true);
  });

  it('accepts an underscore-prefixed username', () => {
    expect(validateUser('_systemuser')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateUser('')).toBe(false);
  });

  it('rejects shell injection', () => {
    expect(validateUser('alice; rm -rf /')).toBe(false);
  });

  it('rejects uppercase (not POSIX-portable)', () => {
    expect(validateUser('Alice')).toBe(false);
  });

  it('rejects a name longer than 32 chars', () => {
    expect(validateUser('a'.repeat(33))).toBe(false);
  });
});

// ─── TC-CTL-02: pre-flight rejects bad users ─────────────────────────────────

describe('TC-CTL-02: crontabList — pre-flight rejects bad users', () => {
  it('throws invalid-user for shell injection in user', () => {
    let err: CrontabListError | undefined;
    try {
      crontabList({ user: 'alice; rm' });
    } catch (e) {
      err = e as CrontabListError;
    }
    expect(err).toBeInstanceOf(CrontabListError);
    expect(err!.code).toBe('invalid-user');
  });
});

// ─── TC-CTL-03: manifest sanity ──────────────────────────────────────────────

describe('TC-CTL-03: manifest is a well-formed F-05 manifest', () => {
  it('declares the scheduling.persist action class', () => {
    expect(crontabListManifest.action_class).toBe('scheduling.persist');
  });

  it('declares risk_tier high', () => {
    expect(crontabListManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(crontabListManifest.default_hitl_mode).toBe('per_request');
  });

  it('marks no fields as required (user is optional)', () => {
    expect(crontabListManifest.params['required']).toEqual([]);
  });

  it('forbids additional properties on the params schema', () => {
    expect(crontabListManifest.params['additionalProperties']).toBe(false);
  });
});

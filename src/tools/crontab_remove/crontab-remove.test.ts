/**
 * Unit tests for the crontab_remove tool.
 *
 * Test IDs:
 *   TC-CTR-01: validateUser  — username validation
 *   TC-CTR-02: crontabRemove — pre-flight rejects bad users
 *   TC-CTR-03: manifest      — F-05 manifest is well-formed
 */

import { describe, it, expect } from 'vitest';
import {
  validateUser,
  crontabRemove,
  CrontabRemoveError,
} from './crontab-remove.js';
import { crontabRemoveManifest } from './manifest.js';

// ─── TC-CTR-01: validateUser ─────────────────────────────────────────────────

describe('TC-CTR-01: validateUser — username validation', () => {
  it('accepts a simple username', () => {
    expect(validateUser('alice')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateUser('')).toBe(false);
  });

  it('rejects shell injection', () => {
    expect(validateUser('alice; rm -rf /')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(validateUser('Alice')).toBe(false);
  });
});

// ─── TC-CTR-02: pre-flight rejects bad users ─────────────────────────────────

describe('TC-CTR-02: crontabRemove — pre-flight rejects bad users', () => {
  it('throws invalid-user for shell injection in user', () => {
    let err: CrontabRemoveError | undefined;
    try {
      crontabRemove({ user: 'alice; rm' });
    } catch (e) {
      err = e as CrontabRemoveError;
    }
    expect(err).toBeInstanceOf(CrontabRemoveError);
    expect(err!.code).toBe('invalid-user');
  });
});

// ─── TC-CTR-03: manifest sanity ──────────────────────────────────────────────

describe('TC-CTR-03: manifest is a well-formed F-05 manifest', () => {
  it('declares the scheduling.persist action class', () => {
    expect(crontabRemoveManifest.action_class).toBe('scheduling.persist');
  });

  it('declares risk_tier high', () => {
    expect(crontabRemoveManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(crontabRemoveManifest.default_hitl_mode).toBe('per_request');
  });

  it('marks no fields as required (user is optional)', () => {
    expect(crontabRemoveManifest.params['required']).toEqual([]);
  });

  it('forbids additional properties on the params schema', () => {
    expect(crontabRemoveManifest.params['additionalProperties']).toBe(false);
  });
});

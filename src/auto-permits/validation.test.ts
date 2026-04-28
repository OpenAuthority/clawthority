// ─── Auto-permit file format validation — unit tests (T48) ───────────────────
//
// TC-APV-01  validateAutoPermitContent: valid versioned envelope → envelopeValid true, rules loaded
// TC-APV-02  validateAutoPermitContent: missing version field → envelopeValid false, envelopeErrors non-empty
// TC-APV-03  validateAutoPermitContent: wrong version type (string) → envelopeValid false
// TC-APV-04  validateAutoPermitContent: missing rules field → envelopeValid false
// TC-APV-05  validateAutoPermitContent: null → envelopeValid false with envelope errors
// TC-APV-06  validateAutoPermitContent: legacy flat-array → isLegacy true, version 0, envelopeValid true
// TC-APV-07  validateAutoPermitContent: empty flat-array → isLegacy true, rules empty
// TC-APV-08  validateAutoPermitContent: valid entry in versioned envelope → appears in rules
// TC-APV-09  validateAutoPermitContent: invalid entry → entryErrors with index and messages
// TC-APV-10  validateAutoPermitContent: mixed entries → valid in rules, invalid in entryErrors
// TC-APV-11  validateAutoPermitContent: checksum present and correct → checksumMismatch false
// TC-APV-12  validateAutoPermitContent: checksum present but wrong → checksumMismatch true
// TC-APV-13  validateAutoPermitContent: checksum absent → checksumMismatch false, checksum undefined
// TC-APV-14  validateAutoPermitContent: envelope errors contain path and message
// TC-APV-15  validateAutoPermitContent: entry errors contain index and TypeBox messages
// TC-APV-16  validateAutoPermitContent: skipped count equals number of invalid entries
// TC-APV-17  validateAutoPermitContent: plain object (no version, no rules) → envelopeValid false

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { validateAutoPermitContent, AutoPermitLoadError, AutoPermitFileSchema } from './validation.js';
import { Value } from '@sinclair/typebox/value';
import type { AutoPermit } from '../models/auto-permit.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<AutoPermit> & { pattern: string }): AutoPermit {
  return {
    method: 'default',
    createdAt: 1_700_000_000_000,
    originalCommand: 'git commit -m "msg"',
    ...overrides,
  };
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ── validateAutoPermitContent ─────────────────────────────────────────────────

describe('validateAutoPermitContent', () => {
  // TC-APV-01
  it('returns envelopeValid:true and loaded rules for a valid versioned envelope', () => {
    const rule = makeRule({ pattern: 'git commit *' });
    const result = validateAutoPermitContent({ version: 1, rules: [rule] });
    expect(result.envelopeValid).toBe(true);
    expect(result.envelopeErrors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.pattern).toBe('git commit *');
    expect(result.version).toBe(1);
    expect(result.isLegacy).toBe(false);
  });

  // TC-APV-02
  it('returns envelopeValid:false with errors when version field is absent', () => {
    const result = validateAutoPermitContent({ rules: [] });
    expect(result.envelopeValid).toBe(false);
    expect(result.envelopeErrors.length).toBeGreaterThan(0);
    expect(result.rules).toEqual([]);
  });

  // TC-APV-03
  it('returns envelopeValid:false when version is a string instead of number', () => {
    const result = validateAutoPermitContent({ version: 'one', rules: [] });
    expect(result.envelopeValid).toBe(false);
    expect(result.envelopeErrors.length).toBeGreaterThan(0);
  });

  // TC-APV-04
  it('returns envelopeValid:false when rules field is absent', () => {
    const result = validateAutoPermitContent({ version: 1 });
    expect(result.envelopeValid).toBe(false);
    expect(result.envelopeErrors.length).toBeGreaterThan(0);
  });

  // TC-APV-05
  it('returns envelopeValid:false for null input', () => {
    const result = validateAutoPermitContent(null);
    expect(result.envelopeValid).toBe(false);
    expect(result.envelopeErrors.length).toBeGreaterThan(0);
    expect(result.rules).toEqual([]);
  });

  // TC-APV-06
  it('treats a flat JSON array as legacy format: isLegacy true, version 0, envelopeValid true', () => {
    const rule = makeRule({ pattern: 'npm install *' });
    const result = validateAutoPermitContent([rule]);
    expect(result.envelopeValid).toBe(true);
    expect(result.isLegacy).toBe(true);
    expect(result.version).toBe(0);
    expect(result.rules).toHaveLength(1);
  });

  // TC-APV-07
  it('handles an empty flat-array: isLegacy true, rules empty', () => {
    const result = validateAutoPermitContent([]);
    expect(result.envelopeValid).toBe(true);
    expect(result.isLegacy).toBe(true);
    expect(result.rules).toEqual([]);
    expect(result.skipped).toBe(0);
  });

  // TC-APV-08
  it('includes a valid entry in rules', () => {
    const rule = makeRule({ pattern: 'docker build *' });
    const result = validateAutoPermitContent({ version: 2, rules: [rule] });
    expect(result.rules).toHaveLength(1);
    expect(result.entryErrors).toEqual([]);
    expect(result.skipped).toBe(0);
  });

  // TC-APV-09
  it('records an invalid entry in entryErrors with its index and TypeBox messages', () => {
    const invalid = { pattern: 123, method: 'unknown', createdAt: -1, originalCommand: '' };
    const result = validateAutoPermitContent({ version: 1, rules: [invalid] });
    expect(result.rules).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(result.entryErrors).toHaveLength(1);
    expect(result.entryErrors[0]!.index).toBe(0);
    expect(result.entryErrors[0]!.errors.length).toBeGreaterThan(0);
  });

  // TC-APV-10
  it('separates valid and invalid entries across rules and entryErrors', () => {
    const valid = makeRule({ pattern: 'git push *' });
    const invalid = { pattern: 456 };
    const result = validateAutoPermitContent({ version: 1, rules: [valid, invalid] });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.pattern).toBe('git push *');
    expect(result.skipped).toBe(1);
    expect(result.entryErrors).toHaveLength(1);
    expect(result.entryErrors[0]!.index).toBe(1);
  });

  // TC-APV-11
  it('sets checksumMismatch:false when checksum matches SHA-256(JSON.stringify(rules))', () => {
    const rules = [makeRule({ pattern: 'git commit *' })];
    const checksum = sha256(JSON.stringify(rules));
    const result = validateAutoPermitContent({ version: 1, rules, checksum });
    expect(result.checksumMismatch).toBe(false);
    expect(result.checksum).toBe(checksum);
  });

  // TC-APV-12
  it('sets checksumMismatch:true when the stored checksum does not match computed value', () => {
    const rules = [makeRule({ pattern: 'git commit *' })];
    const result = validateAutoPermitContent({ version: 1, rules, checksum: 'deadbeef' });
    expect(result.checksumMismatch).toBe(true);
  });

  // TC-APV-13
  it('sets checksumMismatch:false and checksum undefined when no checksum field is present', () => {
    const rules = [makeRule({ pattern: 'git commit *' })];
    const result = validateAutoPermitContent({ version: 1, rules });
    expect(result.checksumMismatch).toBe(false);
    expect(result.checksum).toBeUndefined();
  });

  // TC-APV-14
  it('includes path and message in envelope error strings', () => {
    const result = validateAutoPermitContent({ version: 'bad', rules: [] });
    expect(result.envelopeErrors.length).toBeGreaterThan(0);
    // Each error should contain ': ' separating path and message
    for (const err of result.envelopeErrors) {
      expect(err).toContain(': ');
    }
  });

  // TC-APV-15
  it('includes index and TypeBox messages in entry error objects', () => {
    const invalid = { notAPattern: true };
    const result = validateAutoPermitContent({ version: 1, rules: [invalid] });
    expect(result.entryErrors[0]!.index).toBe(0);
    expect(result.entryErrors[0]!.errors.length).toBeGreaterThan(0);
    for (const err of result.entryErrors[0]!.errors) {
      expect(typeof err).toBe('string');
      expect(err.length).toBeGreaterThan(0);
    }
  });

  // TC-APV-16
  it('skipped count equals the number of invalid entries', () => {
    const valid = makeRule({ pattern: 'git commit *' });
    const invalid1 = { x: 1 };
    const invalid2 = { y: 2 };
    const result = validateAutoPermitContent({ version: 1, rules: [valid, invalid1, invalid2] });
    expect(result.skipped).toBe(2);
    expect(result.entryErrors).toHaveLength(2);
  });

  // TC-APV-17
  it('returns envelopeValid:false for a plain object with no version and no rules', () => {
    const result = validateAutoPermitContent({ foo: 'bar' });
    expect(result.envelopeValid).toBe(false);
    expect(result.envelopeErrors.length).toBeGreaterThan(0);
    expect(result.version).toBe(0);
  });
});

// ── AutoPermitLoadError ───────────────────────────────────────────────────────

describe('AutoPermitLoadError', () => {
  it('has name AutoPermitLoadError and preserves message', () => {
    const err = new AutoPermitLoadError('test error');
    expect(err.name).toBe('AutoPermitLoadError');
    expect(err.message).toBe('test error');
  });

  it('preserves cause when provided', () => {
    const cause = new Error('root cause');
    const err = new AutoPermitLoadError('wrapper', cause);
    expect(err.cause).toBe(cause);
  });
});

// ── AutoPermitFileSchema ──────────────────────────────────────────────────────

describe('AutoPermitFileSchema', () => {
  it('accepts a valid versioned envelope', () => {
    expect(Value.Check(AutoPermitFileSchema, { version: 1, rules: [] })).toBe(true);
  });

  it('accepts a versioned envelope with an optional checksum', () => {
    expect(Value.Check(AutoPermitFileSchema, { version: 1, rules: [], checksum: 'abc' })).toBe(true);
  });

  it('rejects an envelope missing the version field', () => {
    expect(Value.Check(AutoPermitFileSchema, { rules: [] })).toBe(false);
  });

  it('rejects an envelope missing the rules field', () => {
    expect(Value.Check(AutoPermitFileSchema, { version: 1 })).toBe(false);
  });

  it('rejects an envelope where rules is not an array', () => {
    expect(Value.Check(AutoPermitFileSchema, { version: 1, rules: 'not-array' })).toBe(false);
  });
});

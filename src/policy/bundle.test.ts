import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { validateBundle } from './bundle.js';
import type { BundleValidationResult, BundleRule, ValidBundle } from './bundle.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function makeBundle(
  rules: BundleRule[],
  version: number,
  checksumOverride?: string,
): ValidBundle {
  const checksum = checksumOverride ?? sha256(JSON.stringify(rules));
  return { version, rules, checksum };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('validateBundle', () => {
  const currentVersion = 1;

  it('returns valid: true for a well-formed bundle with resource', () => {
    const rules: BundleRule[] = [{ effect: 'permit', resource: 'tool' }];
    const result = validateBundle(makeBundle(rules, 2), currentVersion);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid: true for a rule with action_class instead of resource', () => {
    const rules: BundleRule[] = [{ effect: 'forbid', action_class: 'file_write' }];
    const result = validateBundle(makeBundle(rules, 2), currentVersion);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid: true for a rule that has both action_class and resource', () => {
    const rules: BundleRule[] = [{ effect: 'permit', resource: 'tool', action_class: 'read' }];
    const result = validateBundle(makeBundle(rules, 2), currentVersion);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid: true for an empty rules array', () => {
    const rules: BundleRule[] = [];
    const result = validateBundle(makeBundle(rules, 2), currentVersion);
    expect(result).toEqual({ valid: true });
  });

  it('accepts optional rule fields (match, reason, tags, rateLimit)', () => {
    const rules: BundleRule[] = [{
      effect: 'permit',
      resource: 'tool',
      match: 'read_*',
      reason: 'allow reads',
      tags: ['readonly'],
      rateLimit: { maxCalls: 10, windowSeconds: 60 },
    }];
    const result = validateBundle(makeBundle(rules, 2), currentVersion);
    expect(result).toEqual({ valid: true });
  });

  // ── Schema validation failures ────────────────────────────────────────────

  it('returns valid: false when bundle is null', () => {
    const result = validateBundle(null, currentVersion);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation failed/i);
  });

  it('returns valid: false when version is missing', () => {
    const rules: BundleRule[] = [{ effect: 'permit', resource: 'tool' }];
    const bundle = { rules, checksum: sha256(JSON.stringify(rules)) };
    const result = validateBundle(bundle, 0);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation failed/i);
  });

  it('returns valid: false when rules is missing', () => {
    const bundle = { version: 2, checksum: 'abc' };
    const result = validateBundle(bundle, currentVersion);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation failed/i);
  });

  it('returns valid: false when checksum field is missing', () => {
    const rules: BundleRule[] = [{ effect: 'permit', resource: 'tool' }];
    const bundle = { version: 2, rules };
    const result = validateBundle(bundle, currentVersion);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation failed/i);
  });

  it('returns valid: false when a rule has an invalid effect', () => {
    const rules = [{ effect: 'allow', resource: 'tool' }];
    const bundle = { version: 2, rules, checksum: sha256(JSON.stringify(rules)) };
    const result = validateBundle(bundle, currentVersion);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation failed/i);
  });

  it('returns valid: false when a rule has an empty resource string', () => {
    const rules = [{ effect: 'permit', resource: '' }];
    const bundle = { version: 2, rules, checksum: sha256(JSON.stringify(rules)) };
    const result = validateBundle(bundle, currentVersion);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/schema validation failed/i);
  });

  // ── Per-rule semantic check ───────────────────────────────────────────────

  it('returns valid: false when a rule has neither action_class, resource, nor intent_group', () => {
    const rules: BundleRule[] = [{ effect: 'permit' }];
    const bundle = { version: 2, rules, checksum: sha256(JSON.stringify(rules)) };
    const result = validateBundle(bundle, currentVersion);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/action_class.*resource.*intent_group/i);
  });

  it('returns valid: true for a rule with only intent_group', () => {
    const rules: BundleRule[] = [{ effect: 'forbid', intent_group: 'destructive_fs' }];
    const result = validateBundle(makeBundle(rules, 2), currentVersion);
    expect(result).toEqual({ valid: true });
  });

  it('includes the rule index in the error message for the semantic check', () => {
    const rules: BundleRule[] = [
      { effect: 'permit', resource: 'tool' },
      { effect: 'forbid' }, // missing action_class and resource
    ];
    const bundle = { version: 2, rules, checksum: sha256(JSON.stringify(rules)) };
    const result = validateBundle(bundle, currentVersion);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('index 1');
  });

  // ── Version monotonicity ──────────────────────────────────────────────────

  it('returns valid: false when bundle version equals currentVersion', () => {
    const rules: BundleRule[] = [{ effect: 'permit', resource: 'tool' }];
    const result = validateBundle(makeBundle(rules, 1), 1);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/must be greater than current version/i);
  });

  it('returns valid: false when bundle version is less than currentVersion', () => {
    const rules: BundleRule[] = [{ effect: 'permit', resource: 'tool' }];
    const result = validateBundle(makeBundle(rules, 1), 5);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/must be greater than current version/i);
  });

  it('includes both versions in the monotonicity error message', () => {
    const rules: BundleRule[] = [{ effect: 'permit', resource: 'tool' }];
    const result = validateBundle(makeBundle(rules, 3), 5);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('3');
    expect(result.error).toContain('5');
  });

  it('accepts currentVersion 0 so the first bundle (version 1) is always valid', () => {
    const rules: BundleRule[] = [{ effect: 'permit', resource: 'tool' }];
    const result = validateBundle(makeBundle(rules, 1), 0);
    expect(result).toEqual({ valid: true });
  });

  // ── Checksum verification ─────────────────────────────────────────────────

  it('returns valid: false when checksum does not match', () => {
    const rules: BundleRule[] = [{ effect: 'permit', resource: 'tool' }];
    const result = validateBundle(makeBundle(rules, 2, 'deadbeef'), currentVersion);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/checksum mismatch/i);
  });

  it('includes both expected and actual checksums in the error message', () => {
    const rules: BundleRule[] = [{ effect: 'permit', resource: 'tool' }];
    const expected = sha256(JSON.stringify(rules));
    const result = validateBundle(makeBundle(rules, 2, 'deadbeef'), currentVersion);
    expect(result.valid).toBe(false);
    expect(result.error).toContain(expected);
    expect(result.error).toContain('deadbeef');
  });

  it('checksum is computed over JSON.stringify(bundle.rules)', () => {
    const rules: BundleRule[] = [
      { effect: 'permit', resource: 'tool', action_class: 'read' },
      { effect: 'forbid', resource: 'file' },
    ];
    const correctChecksum = sha256(JSON.stringify(rules));
    const bundle = makeBundle(rules, 2, correctChecksum);
    expect(validateBundle(bundle, currentVersion)).toEqual({ valid: true });
  });
});

// ─── Type sentinels ───────────────────────────────────────────────────────────

void validateBundle;
void ({} as BundleValidationResult);
void ({} as BundleRule);
void ({} as ValidBundle);

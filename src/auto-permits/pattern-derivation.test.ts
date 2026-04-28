// ─── Pattern Derivation Engine — unit tests (T48) ────────────────────────────
//
// TC-PDE-01  default: binary + positional → `{binary} {positional} *`
// TC-PDE-02  default: binary only (no args) → `{binary}`
// TC-PDE-03  default: binary + flags only → `{binary} *`
// TC-PDE-04  default: flag before positional — first positional skips flags
// TC-PDE-05  default: method omitted → behaves as 'default'
// TC-PDE-06  default: quoted arg produces correct positional extraction
// TC-PDE-07  default: metadata fields are correctly populated
// TC-PDE-08  exact: normalised token join returned as pattern
// TC-PDE-09  exact: no wildcard in pattern
// TC-PDE-10  exact: quoted args join correctly
// TC-PDE-11  throws PatternDerivationError for empty command string
// TC-PDE-12  throws PatternDerivationError for whitespace-only command
// TC-PDE-13  derivedAt is a recent Unix-ms timestamp
// TC-PDE-14  tokenCount reflects actual parsed token count
// TC-PDE-15  validatePattern: valid simple binary pattern
// TC-PDE-16  validatePattern: valid `binary *`
// TC-PDE-17  validatePattern: valid `binary positional *`
// TC-PDE-18  validatePattern: invalid — empty string
// TC-PDE-19  validatePattern: invalid — leading whitespace
// TC-PDE-20  validatePattern: invalid — trailing whitespace
// TC-PDE-21  validatePattern: invalid — consecutive spaces
// TC-PDE-22  validatePattern: invalid — wildcard not at end
// TC-PDE-23  validatePattern: invalid — binary contains wildcard
// TC-PDE-24  isDerivedPattern: returns true for a valid DerivedPattern
// TC-PDE-25  isDerivedPattern: returns false for a missing required field

import { describe, it, expect } from 'vitest';
import {
  derivePattern,
  validatePattern,
  isDerivedPattern,
  PatternDerivationError,
} from './pattern-derivation.js';

// ─── derivePattern — default method ──────────────────────────────────────────

describe('derivePattern — default method', () => {
  // TC-PDE-01
  it('produces binary + first-positional + * for a command with positional arg', () => {
    const result = derivePattern({ command: 'git commit -m "initial commit"' });
    expect(result.pattern).toBe('git commit *');
  });

  // TC-PDE-02
  it('produces binary alone for a command with no arguments', () => {
    const result = derivePattern({ command: 'ls' });
    expect(result.pattern).toBe('ls');
  });

  // TC-PDE-03
  it('produces binary + * for a command with flags but no positional arg', () => {
    const result = derivePattern({ command: 'ls -la' });
    expect(result.pattern).toBe('ls *');
  });

  // TC-PDE-04
  it('skips flag arguments when identifying the first positional', () => {
    const result = derivePattern({ command: 'npm --prefix /app install --save-dev vitest' });
    // First non-flag after binary is 'install' (skipping --prefix /app? No — /app is positional!)
    // Actually: tokens = ['npm', '--prefix', '/app', 'install', '--save-dev', 'vitest']
    // /app does not start with '-' so it is the first positional
    expect(result.pattern).toBe('npm /app *');
  });

  // TC-PDE-05
  it('defaults to the default method when method is omitted', () => {
    const withMethod = derivePattern({ command: 'git push origin main', method: 'default' });
    const withoutMethod = derivePattern({ command: 'git push origin main' });
    expect(withMethod.pattern).toBe(withoutMethod.pattern);
    expect(withMethod.method).toBe('default');
    expect(withoutMethod.method).toBe('default');
  });

  // TC-PDE-06
  it('extracts the correct positional when the first arg is a quoted string', () => {
    // tokens: ['bash', '-c', 'echo hello']  → first positional is 'echo hello'
    const result = derivePattern({ command: 'bash -c "echo hello"' });
    expect(result.pattern).toBe('bash echo hello *');
  });

  // TC-PDE-07
  it('populates all metadata fields correctly', () => {
    const before = Date.now();
    const result = derivePattern({ command: 'git commit -m "msg"' });
    const after = Date.now();

    expect(result.binary).toBe('git');
    expect(result.firstPositional).toBe('commit');
    expect(result.originalCommand).toBe('git commit -m "msg"');
    expect(result.tokenCount).toBe(4); // git, commit, -m, msg
    expect(result.method).toBe('default');
    expect(result.derivedAt).toBeGreaterThanOrEqual(before);
    expect(result.derivedAt).toBeLessThanOrEqual(after);
  });
});

// ─── derivePattern — exact method ────────────────────────────────────────────

describe('derivePattern — exact method', () => {
  // TC-PDE-08
  it('returns the normalised token join as the pattern', () => {
    const result = derivePattern({ command: 'git commit -m "initial"', method: 'exact' });
    expect(result.pattern).toBe('git commit -m initial');
  });

  // TC-PDE-09
  it('produces no wildcard in the pattern', () => {
    const result = derivePattern({ command: 'docker run --rm alpine', method: 'exact' });
    expect(result.pattern).not.toContain('*');
  });

  // TC-PDE-10
  it('strips quotes and joins tokens correctly', () => {
    const result = derivePattern({ command: "git tag -a v1 -m 'release'", method: 'exact' });
    expect(result.pattern).toBe('git tag -a v1 -m release');
  });
});

// ─── derivePattern — edge cases ──────────────────────────────────────────────

describe('derivePattern — edge cases', () => {
  // TC-PDE-11
  it('throws PatternDerivationError for an empty command string', () => {
    expect(() => derivePattern({ command: '   ' })).toThrow(PatternDerivationError);
  });

  // TC-PDE-12
  it('throws PatternDerivationError with a descriptive message for empty input', () => {
    expect(() => derivePattern({ command: '   ' })).toThrowError(
      /empty after tokenisation/i,
    );
  });

  // TC-PDE-13 (derivedAt is a recent timestamp)
  it('sets derivedAt to a current Unix-ms timestamp', () => {
    const before = Date.now();
    const result = derivePattern({ command: 'pwd' });
    const after = Date.now();
    expect(result.derivedAt).toBeGreaterThanOrEqual(before);
    expect(result.derivedAt).toBeLessThanOrEqual(after);
  });

  // TC-PDE-14
  it('reports tokenCount equal to the number of parsed tokens', () => {
    expect(derivePattern({ command: 'git' }).tokenCount).toBe(1);
    expect(derivePattern({ command: 'git commit' }).tokenCount).toBe(2);
    expect(derivePattern({ command: 'git commit -m "msg"' }).tokenCount).toBe(4);
  });
});

// ─── validatePattern ─────────────────────────────────────────────────────────

describe('validatePattern', () => {
  // TC-PDE-15
  it('returns valid for a simple binary-only pattern', () => {
    expect(validatePattern('ls').valid).toBe(true);
  });

  // TC-PDE-16
  it('returns valid for a `binary *` pattern', () => {
    expect(validatePattern('ls *').valid).toBe(true);
  });

  // TC-PDE-17
  it('returns valid for a `binary positional *` pattern', () => {
    expect(validatePattern('git commit *').valid).toBe(true);
  });

  // TC-PDE-18
  it('returns invalid for an empty string', () => {
    const result = validatePattern('');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // TC-PDE-19
  it('returns invalid for a pattern with leading whitespace', () => {
    const result = validatePattern(' git commit *');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /leading or trailing/i.test(e))).toBe(true);
  });

  // TC-PDE-20
  it('returns invalid for a pattern with trailing whitespace', () => {
    const result = validatePattern('git commit * ');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /leading or trailing/i.test(e))).toBe(true);
  });

  // TC-PDE-21
  it('returns invalid for a pattern with consecutive spaces', () => {
    const result = validatePattern('git  commit *');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /consecutive/i.test(e))).toBe(true);
  });

  // TC-PDE-22
  it('returns invalid when wildcard appears before the last token', () => {
    const result = validatePattern('git * commit');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /last token/i.test(e))).toBe(true);
  });

  // TC-PDE-23
  it('returns invalid when the binary (first token) is a wildcard', () => {
    const result = validatePattern('*');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /binary.*wildcard/i.test(e))).toBe(true);
  });
});

// ─── isDerivedPattern ─────────────────────────────────────────────────────────

describe('isDerivedPattern', () => {
  // TC-PDE-24
  it('returns true for a value produced by derivePattern', () => {
    const derived = derivePattern({ command: 'git commit -m "msg"' });
    expect(isDerivedPattern(derived)).toBe(true);
  });

  // TC-PDE-25
  it('returns false when a required field is missing', () => {
    const derived = derivePattern({ command: 'git commit' });
    const { pattern: _p, ...withoutPattern } = derived;
    expect(isDerivedPattern(withoutPattern)).toBe(false);
  });
});

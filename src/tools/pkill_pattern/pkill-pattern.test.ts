/**
 * Unit tests for the pkill_pattern tool.
 *
 * Test IDs:
 *   TC-PKL-01: validatePattern — pattern validation
 *   TC-PKL-02: pkillPattern    — pre-flight rejects bad patterns
 *   TC-PKL-03: pkillPattern    — pre-flight rejects bad signals
 *   TC-PKL-04: manifest        — F-05 manifest is well-formed
 *
 * No execution test: pkill is racy against the system process table
 * and we don't want to depend on a known-named external process. The
 * shared spawn pattern is exercised by the kill_process success test.
 */

import { describe, it, expect } from 'vitest';
import {
  validatePattern,
  pkillPattern,
  PkillPatternError,
  KILL_SIGNALS,
} from './pkill-pattern.js';
import { pkillPatternManifest } from './manifest.js';

// ─── TC-PKL-01: validatePattern ──────────────────────────────────────────────

describe('TC-PKL-01: validatePattern — pattern validation', () => {
  it('accepts a literal process name', () => {
    expect(validatePattern('nginx')).toBe(true);
  });

  it('accepts a regex with anchors', () => {
    expect(validatePattern('^my-app$')).toBe(true);
  });

  it('accepts a regex with character class', () => {
    expect(validatePattern('[a-z]+')).toBe(true);
  });

  it('accepts a regex with alternation', () => {
    expect(validatePattern('foo|bar')).toBe(true);
  });

  it('accepts a regex with quantifier', () => {
    expect(validatePattern('worker.*')).toBe(true);
  });

  it('accepts a path-like pattern', () => {
    expect(validatePattern('/usr/bin/myapp')).toBe(true);
  });

  it('rejects an empty pattern', () => {
    expect(validatePattern('')).toBe(false);
  });

  it('rejects a pattern with semicolon (shell injection)', () => {
    expect(validatePattern('foo; rm -rf /')).toBe(false);
  });

  it('rejects a pattern with backtick', () => {
    expect(validatePattern('`whoami`')).toBe(false);
  });

  it('rejects a pattern with backslash', () => {
    expect(validatePattern('foo\\nbar')).toBe(false);
  });

  it('rejects a pattern with single-quote', () => {
    expect(validatePattern("foo'bar")).toBe(false);
  });

  it('rejects a pattern with double-quote', () => {
    expect(validatePattern('foo"bar')).toBe(false);
  });

  it('rejects a pattern longer than 256 chars', () => {
    expect(validatePattern('a'.repeat(257))).toBe(false);
  });
});

// ─── TC-PKL-02: pre-flight rejects bad patterns ──────────────────────────────

describe('TC-PKL-02: pkillPattern — pre-flight rejects bad patterns', () => {
  it('throws invalid-pattern for shell injection', () => {
    let err: PkillPatternError | undefined;
    try {
      pkillPattern({ pattern: 'foo; rm -rf /' });
    } catch (e) {
      err = e as PkillPatternError;
    }
    expect(err).toBeInstanceOf(PkillPatternError);
    expect(err!.code).toBe('invalid-pattern');
  });

  it('throws invalid-pattern for empty string', () => {
    let err: PkillPatternError | undefined;
    try {
      pkillPattern({ pattern: '' });
    } catch (e) {
      err = e as PkillPatternError;
    }
    expect(err!.code).toBe('invalid-pattern');
  });
});

// ─── TC-PKL-03: pre-flight rejects bad signals ───────────────────────────────

describe('TC-PKL-03: pkillPattern — pre-flight rejects bad signals', () => {
  it('throws invalid-signal for unknown signal', () => {
    let err: PkillPatternError | undefined;
    try {
      pkillPattern({ pattern: 'foo', signal: 'SEGV' as never });
    } catch (e) {
      err = e as PkillPatternError;
    }
    expect(err).toBeInstanceOf(PkillPatternError);
    expect(err!.code).toBe('invalid-signal');
  });

  it('pattern validation runs before signal validation', () => {
    let err: PkillPatternError | undefined;
    try {
      pkillPattern({ pattern: 'bad;pattern', signal: 'BOGUS' as never });
    } catch (e) {
      err = e as PkillPatternError;
    }
    expect(err!.code).toBe('invalid-pattern');
  });
});

// ─── TC-PKL-04: manifest sanity ──────────────────────────────────────────────

describe('TC-PKL-04: manifest is a well-formed F-05 manifest', () => {
  it('declares the process.signal action class', () => {
    expect(pkillPatternManifest.action_class).toBe('process.signal');
  });

  it('declares risk_tier high', () => {
    expect(pkillPatternManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(pkillPatternManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares pattern as the target_field', () => {
    expect(pkillPatternManifest.target_field).toBe('pattern');
  });

  it('marks pattern as required (signal and full_match are optional)', () => {
    expect(pkillPatternManifest.params['required']).toEqual(['pattern']);
  });

  it('forbids additional properties on the params schema', () => {
    expect(pkillPatternManifest.params['additionalProperties']).toBe(false);
  });

  it('shares the same signal enum as kill_process', () => {
    const props = pkillPatternManifest.params['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(props['signal']?.['enum']).toEqual([...KILL_SIGNALS]);
  });
});

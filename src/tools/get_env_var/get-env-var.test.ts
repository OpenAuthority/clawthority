/**
 * Unit tests for the get_env_var tool.
 *
 * Test IDs:
 *   TC-GEV-01: Successful environment variable reads
 *   TC-GEV-02: Error handling (invalid names)
 *   TC-GEV-03: Result shape validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEnvVar, GetEnvVarError } from './get-env-var.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_VAR = 'OPENCLAW_TEST_ENV_VAR_12345';

function setVar(value: string): void {
  process.env[TEST_VAR] = value;
}

function clearVar(): void {
  delete process.env[TEST_VAR];
}

// ─── TC-GEV-01: Successful environment variable reads ────────────────────────

describe('TC-GEV-01: successful environment variable reads', () => {
  beforeEach(() => clearVar());
  afterEach(() => clearVar());

  it('returns found: true and the value when the variable is set', () => {
    setVar('hello');
    const result = getEnvVar({ variable_name: TEST_VAR });
    expect(result.found).toBe(true);
    expect(result.value).toBe('hello');
  });

  it('returns found: false and value: null when the variable is not set', () => {
    const result = getEnvVar({ variable_name: TEST_VAR });
    expect(result.found).toBe(false);
    expect(result.value).toBeNull();
  });

  it('returns the correct variable_name in the result', () => {
    setVar('test');
    const result = getEnvVar({ variable_name: TEST_VAR });
    expect(result.variable_name).toBe(TEST_VAR);
  });

  it('returns found: false without throwing for a missing variable', () => {
    expect(() => getEnvVar({ variable_name: TEST_VAR })).not.toThrow();
  });

  it('reads an empty string value when the variable is set to empty string', () => {
    setVar('');
    const result = getEnvVar({ variable_name: TEST_VAR });
    expect(result.found).toBe(true);
    expect(result.value).toBe('');
  });

  it('reads a value containing spaces', () => {
    setVar('hello world');
    const result = getEnvVar({ variable_name: TEST_VAR });
    expect(result.found).toBe(true);
    expect(result.value).toBe('hello world');
  });

  it('accepts lowercase variable names', () => {
    const lowerVar = 'openclaw_test_lower_var';
    process.env[lowerVar] = 'lower';
    try {
      const result = getEnvVar({ variable_name: lowerVar });
      expect(result.found).toBe(true);
      expect(result.value).toBe('lower');
    } finally {
      delete process.env[lowerVar];
    }
  });

  it('reads PATH without throwing', () => {
    const result = getEnvVar({ variable_name: 'PATH' });
    expect(result.variable_name).toBe('PATH');
    expect(typeof result.found).toBe('boolean');
  });
});

// ─── TC-GEV-02: Error handling (invalid names) ───────────────────────────────

describe('TC-GEV-02: error handling for invalid variable names', () => {
  it('throws GetEnvVarError with code invalid-name for an empty name', () => {
    expect(() => getEnvVar({ variable_name: '' })).toThrow(
      expect.objectContaining({ code: 'invalid-name' }),
    );
  });

  it('throws GetEnvVarError with code invalid-name for a name starting with a digit', () => {
    expect(() => getEnvVar({ variable_name: '1_INVALID' })).toThrow(
      expect.objectContaining({ code: 'invalid-name' }),
    );
  });

  it('throws GetEnvVarError with code invalid-name for a name containing =', () => {
    expect(() => getEnvVar({ variable_name: 'VAR=BAD' })).toThrow(
      expect.objectContaining({ code: 'invalid-name' }),
    );
  });

  it('throws GetEnvVarError with code invalid-name for a name containing spaces', () => {
    expect(() => getEnvVar({ variable_name: 'MY VAR' })).toThrow(
      expect.objectContaining({ code: 'invalid-name' }),
    );
  });

  it('throws GetEnvVarError with code invalid-name for a name containing a dot', () => {
    expect(() => getEnvVar({ variable_name: 'MY.VAR' })).toThrow(
      expect.objectContaining({ code: 'invalid-name' }),
    );
  });

  it('thrown error is an instance of GetEnvVarError', () => {
    expect(() => getEnvVar({ variable_name: '' })).toThrow(GetEnvVarError);
  });

  it('thrown error has a descriptive message', () => {
    expect(() => getEnvVar({ variable_name: 'BAD=NAME' })).toThrow(
      expect.objectContaining({ message: expect.stringContaining('Invalid environment variable name') }),
    );
  });
});

// ─── TC-GEV-03: Result shape validation ──────────────────────────────────────

describe('TC-GEV-03: result shape validation', () => {
  afterEach(() => clearVar());

  it('result has variable_name, found, and value keys when variable is set', () => {
    setVar('shape-test');
    const result = getEnvVar({ variable_name: TEST_VAR });
    expect(Object.keys(result).sort()).toEqual(['found', 'value', 'variable_name']);
  });

  it('result has variable_name, found, and value keys when variable is not set', () => {
    const result = getEnvVar({ variable_name: TEST_VAR });
    expect(Object.keys(result).sort()).toEqual(['found', 'value', 'variable_name']);
  });

  it('found is always a boolean', () => {
    setVar('x');
    expect(typeof getEnvVar({ variable_name: TEST_VAR }).found).toBe('boolean');
    clearVar();
    expect(typeof getEnvVar({ variable_name: TEST_VAR }).found).toBe('boolean');
  });

  it('value is a string when found, null when not found', () => {
    setVar('y');
    expect(typeof getEnvVar({ variable_name: TEST_VAR }).value).toBe('string');
    clearVar();
    expect(getEnvVar({ variable_name: TEST_VAR }).value).toBeNull();
  });
});

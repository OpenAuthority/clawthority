import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modeToDefaultEffect, resolveMode } from './mode.js';

/**
 * Save and restore `CLAWTHORITY_MODE` around each test so cross-test leakage
 * is impossible. `delete process.env.X` is the canonical way to produce an
 * `undefined` lookup (setting `= undefined` stringifies to `"undefined"`).
 */
const ENV_KEY = 'CLAWTHORITY_MODE';
let originalMode: string | undefined;

beforeEach(() => {
  originalMode = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalMode;
  }
  vi.restoreAllMocks();
});

describe('resolveMode', () => {
  it('defaults to "open" when CLAWTHORITY_MODE is unset', () => {
    expect(resolveMode()).toBe('open');
  });

  it('defaults to "open" when CLAWTHORITY_MODE is empty', () => {
    process.env[ENV_KEY] = '';
    expect(resolveMode()).toBe('open');
  });

  it('resolves "open"', () => {
    process.env[ENV_KEY] = 'open';
    expect(resolveMode()).toBe('open');
  });

  it('resolves "closed"', () => {
    process.env[ENV_KEY] = 'closed';
    expect(resolveMode()).toBe('closed');
  });

  it('is case-insensitive', () => {
    process.env[ENV_KEY] = 'CLOSED';
    expect(resolveMode()).toBe('closed');

    process.env[ENV_KEY] = 'Open';
    expect(resolveMode()).toBe('open');
  });

  it('trims whitespace', () => {
    process.env[ENV_KEY] = '  closed  ';
    expect(resolveMode()).toBe('closed');
  });

  it('falls back to "open" and warns on an unrecognised value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[ENV_KEY] = 'strict';
    expect(resolveMode()).toBe('open');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('invalid CLAWTHORITY_MODE="strict"');
  });
});

describe('modeToDefaultEffect', () => {
  it('maps "open" to "permit"', () => {
    expect(modeToDefaultEffect('open')).toBe('permit');
  });

  it('maps "closed" to "forbid"', () => {
    expect(modeToDefaultEffect('closed')).toBe('forbid');
  });
});

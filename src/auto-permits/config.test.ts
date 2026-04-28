/**
 * Auto-permit storage configuration resolver — test suite (T54)
 *
 * Covers all resolution paths for resolveAutoPermitStoreConfig:
 *   TC-APC-01  No env var → default path and 'separate' mode
 *   TC-APC-02  CLAWTHORITY_AUTO_PERMIT_STORE=data/rules.json → 'rules' mode
 *   TC-APC-03  Custom path → 'separate' mode with custom path
 *   TC-APC-04  Whitespace in env var is trimmed before resolution
 *   TC-APC-05  Empty env var → falls back to default path
 *   TC-APC-06  Resolved path is exposed verbatim in the returned config
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveAutoPermitStoreConfig,
  DEFAULT_AUTO_PERMIT_STORE_PATH,
  RULES_FILE_PATH,
} from './config.js';

describe('resolveAutoPermitStoreConfig', () => {
  const ENV_KEY = 'CLAWTHORITY_AUTO_PERMIT_STORE';

  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedEnv;
    }
  });

  // TC-APC-01: No env var → default path and 'separate' mode ─────────────────

  it('TC-APC-01: returns default path when env var is not set', () => {
    delete process.env[ENV_KEY];
    const config = resolveAutoPermitStoreConfig();
    expect(config.path).toBe(DEFAULT_AUTO_PERMIT_STORE_PATH);
  });

  it('TC-APC-01b: returns separate mode when env var is not set', () => {
    delete process.env[ENV_KEY];
    const config = resolveAutoPermitStoreConfig();
    expect(config.mode).toBe('separate');
  });

  // TC-APC-02: data/rules.json → 'rules' mode ─────────────────────────────────

  it('TC-APC-02: returns rules mode when path is data/rules.json', () => {
    process.env[ENV_KEY] = RULES_FILE_PATH;
    const config = resolveAutoPermitStoreConfig();
    expect(config.mode).toBe('rules');
  });

  it('TC-APC-02b: returns data/rules.json as path in rules mode', () => {
    process.env[ENV_KEY] = RULES_FILE_PATH;
    const config = resolveAutoPermitStoreConfig();
    expect(config.path).toBe(RULES_FILE_PATH);
  });

  // TC-APC-03: Custom path → 'separate' mode ──────────────────────────────────

  it('TC-APC-03: custom path resolves to separate mode', () => {
    process.env[ENV_KEY] = '/var/clawthority/auto-permits.json';
    const config = resolveAutoPermitStoreConfig();
    expect(config.mode).toBe('separate');
  });

  it('TC-APC-03b: custom path is preserved in the returned config', () => {
    process.env[ENV_KEY] = '/var/clawthority/auto-permits.json';
    const config = resolveAutoPermitStoreConfig();
    expect(config.path).toBe('/var/clawthority/auto-permits.json');
  });

  it('TC-APC-03c: relative custom path resolves to separate mode', () => {
    process.env[ENV_KEY] = 'config/my-permits.json';
    const config = resolveAutoPermitStoreConfig();
    expect(config.mode).toBe('separate');
    expect(config.path).toBe('config/my-permits.json');
  });

  // TC-APC-04: Whitespace trimming ─────────────────────────────────────────────

  it('TC-APC-04: trims leading/trailing whitespace from env var value', () => {
    process.env[ENV_KEY] = '  data/rules.json  ';
    const config = resolveAutoPermitStoreConfig();
    expect(config.path).toBe(RULES_FILE_PATH);
    expect(config.mode).toBe('rules');
  });

  it('TC-APC-04b: trims whitespace around a custom path', () => {
    process.env[ENV_KEY] = '  /custom/path.json  ';
    const config = resolveAutoPermitStoreConfig();
    expect(config.path).toBe('/custom/path.json');
    expect(config.mode).toBe('separate');
  });

  // TC-APC-05: Empty env var → default ─────────────────────────────────────────

  it('TC-APC-05: empty string env var falls back to default path', () => {
    process.env[ENV_KEY] = '';
    const config = resolveAutoPermitStoreConfig();
    expect(config.path).toBe(DEFAULT_AUTO_PERMIT_STORE_PATH);
  });

  it('TC-APC-05b: whitespace-only env var falls back to default path', () => {
    process.env[ENV_KEY] = '   ';
    const config = resolveAutoPermitStoreConfig();
    expect(config.path).toBe(DEFAULT_AUTO_PERMIT_STORE_PATH);
    expect(config.mode).toBe('separate');
  });

  // TC-APC-06: Path value exposed verbatim ─────────────────────────────────────

  it('TC-APC-06: returned config contains both mode and path fields', () => {
    delete process.env[ENV_KEY];
    const config = resolveAutoPermitStoreConfig();
    expect(config).toHaveProperty('mode');
    expect(config).toHaveProperty('path');
  });

  it('TC-APC-06b: DEFAULT_AUTO_PERMIT_STORE_PATH constant is data/auto-permits.json', () => {
    expect(DEFAULT_AUTO_PERMIT_STORE_PATH).toBe('data/auto-permits.json');
  });

  it('TC-APC-06c: RULES_FILE_PATH constant is data/rules.json', () => {
    expect(RULES_FILE_PATH).toBe('data/rules.json');
  });
});

/**
 * Definition of Done – test-requirement unit tests
 *
 * Validates that:
 *   1. `npm test` can be invoked correctly (mocked child_process)
 *   2. `npm run test:e2e` can be invoked correctly (mocked child_process)
 *   3. Coverage thresholds are declared in vitest.config.ts
 *
 * Run independently with:  npm run test:dod
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpmTest, runNpmTestE2e } from './runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

// ─── Mock child_process ───────────────────────────────────────────────────────
// vi.hoisted ensures the mock variable is available inside the vi.mock factory.

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

// ─── npm test ────────────────────────────────────────────────────────────────

describe('DoD: npm test command execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes npm test with pipe stdio and project root cwd', () => {
    mockExecSync.mockReturnValue(Buffer.from('All tests passed'));

    const result = runNpmTest(ROOT);

    expect(mockExecSync).toHaveBeenCalledWith('npm test', { stdio: 'pipe', cwd: ROOT });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('captures stdout from a successful test run', () => {
    mockExecSync.mockReturnValue(Buffer.from('✓ 42 tests passed'));

    const result = runNpmTest(ROOT);

    expect(result.output).toContain('42 tests passed');
  });

  it('returns failure and preserves stderr when npm test exits non-zero', () => {
    const err = Object.assign(new Error('Command failed'), {
      stdout: Buffer.from(''),
      stderr: Buffer.from('2 tests failed'),
      status: 1,
    });
    mockExecSync.mockImplementation(() => { throw err; });

    const result = runNpmTest(ROOT);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('2 tests failed');
  });
});

// ─── npm run test:e2e ─────────────────────────────────────────────────────────

describe('DoD: npm run test:e2e command execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes npm run test:e2e with pipe stdio and project root cwd', () => {
    mockExecSync.mockReturnValue(Buffer.from('E2E tests passed'));

    const result = runNpmTestE2e(ROOT);

    expect(mockExecSync).toHaveBeenCalledWith('npm run test:e2e', { stdio: 'pipe', cwd: ROOT });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('captures stdout from a successful e2e run', () => {
    mockExecSync.mockReturnValue(Buffer.from('✓ scenario: plugin lifecycle'));

    const result = runNpmTestE2e(ROOT);

    expect(result.output).toContain('plugin lifecycle');
  });

  it('returns failure and preserves stderr when npm run test:e2e exits non-zero', () => {
    const err = Object.assign(new Error('Command failed'), {
      stdout: Buffer.from(''),
      stderr: Buffer.from('e2e scenario failed: bundle-hot-reload'),
      status: 1,
    });
    mockExecSync.mockImplementation(() => { throw err; });

    const result = runNpmTestE2e(ROOT);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('bundle-hot-reload');
  });
});

// ─── Coverage thresholds ──────────────────────────────────────────────────────

describe('DoD: coverage thresholds enforced', () => {
  const cfg = readFileSync(resolve(ROOT, 'vitest.config.ts'), 'utf-8');

  it('vitest.config.ts declares a thresholds block', () => {
    expect(cfg).toContain('thresholds');
  });

  it('enforces 95% line coverage on src/enforcement/**', () => {
    const idx = cfg.indexOf("'src/enforcement/**'");
    expect(idx).toBeGreaterThan(-1);
    expect(cfg.slice(idx, idx + 60)).toMatch(/lines:\s*95/);
  });

  it('enforces 88% line coverage on src/hitl/**', () => {
    const idx = cfg.indexOf("'src/hitl/**'");
    expect(idx).toBeGreaterThan(-1);
    expect(cfg.slice(idx, idx + 50)).toMatch(/lines:\s*88/);
  });

  it('enforces 90% line coverage on src/policy/**', () => {
    const idx = cfg.indexOf("'src/policy/**'");
    expect(idx).toBeGreaterThan(-1);
    expect(cfg.slice(idx, idx + 50)).toMatch(/lines:\s*90/);
  });

  it('enforces 85% line coverage on src/adapter/**', () => {
    const idx = cfg.indexOf("'src/adapter/**'");
    expect(idx).toBeGreaterThan(-1);
    expect(cfg.slice(idx, idx + 50)).toMatch(/lines:\s*85/);
  });

  it('e2e config omits threshold gates (coverage is informational only)', () => {
    const e2eCfg = readFileSync(resolve(ROOT, 'vitest.e2e.config.ts'), 'utf-8');
    expect(e2eCfg).not.toContain('thresholds');
  });
});

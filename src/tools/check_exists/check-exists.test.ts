/**
 * Unit tests for the check_exists tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-CE-01: Existing paths
 *   TC-CE-02: Non-existing paths
 *   TC-CE-03: Result shape
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkExists } from './check-exists.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'check-exists-'));
}

// ─── TC-CE-01: Existing paths ─────────────────────────────────────────────────

describe('TC-CE-01: existing paths', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns exists: true for an existing file', () => {
    const filePath = join(dir, 'test.txt');
    writeFileSync(filePath, 'content');

    const result = checkExists({ path: filePath });

    expect(result.exists).toBe(true);
  });

  it('returns exists: true for an existing directory', () => {
    const result = checkExists({ path: dir });

    expect(result.exists).toBe(true);
  });

  it('returns exists: true for a nested file', () => {
    mkdirSync(join(dir, 'sub'));
    const filePath = join(dir, 'sub', 'nested.txt');
    writeFileSync(filePath, '');

    const result = checkExists({ path: filePath });

    expect(result.exists).toBe(true);
  });

  it('returns exists: true for a nested directory', () => {
    const subDir = join(dir, 'a', 'b', 'c');
    mkdirSync(subDir, { recursive: true });

    const result = checkExists({ path: subDir });

    expect(result.exists).toBe(true);
  });
});

// ─── TC-CE-02: Non-existing paths ────────────────────────────────────────────

describe('TC-CE-02: non-existing paths', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns exists: false for a non-existent file path', () => {
    const filePath = join(dir, 'does-not-exist.txt');

    const result = checkExists({ path: filePath });

    expect(result.exists).toBe(false);
  });

  it('returns exists: false for a non-existent directory path', () => {
    const missingDir = join(dir, 'missing-subdir');

    const result = checkExists({ path: missingDir });

    expect(result.exists).toBe(false);
  });

  it('does not throw for a non-existent path', () => {
    const nonExistent = join(tmpdir(), `check-exists-nf-${Date.now()}`);

    expect(() => checkExists({ path: nonExistent })).not.toThrow();
  });

  it('returns exists: false for a deeply nested non-existent path', () => {
    const missingPath = join(dir, 'a', 'b', 'c', 'missing.ts');

    const result = checkExists({ path: missingPath });

    expect(result.exists).toBe(false);
  });
});

// ─── TC-CE-03: Result shape ───────────────────────────────────────────────────

describe('TC-CE-03: result shape', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('result has an exists boolean field when path exists', () => {
    const result = checkExists({ path: dir });

    expect(typeof result.exists).toBe('boolean');
  });

  it('result has an exists boolean field when path does not exist', () => {
    const nonExistent = join(dir, 'missing.txt');

    const result = checkExists({ path: nonExistent });

    expect(typeof result.exists).toBe('boolean');
  });
});

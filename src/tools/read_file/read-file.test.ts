/**
 * Unit tests for the read_file tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-RFT-01: Successful read operations
 *   TC-RFT-02: Content fidelity operations
 *   TC-RFT-03: Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile, ReadFileError } from './read-file.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a temp directory for a test group. */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'read-file-'));
}

// ─── TC-RFT-01: Successful read operations ────────────────────────────────────

describe('TC-RFT-01: successful read operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the content of an existing file', () => {
    const filePath = join(dir, 'hello.txt');
    writeFileSync(filePath, 'hello world');

    const result = readFile({ path: filePath });

    expect(result.content).toBe('hello world');
  });

  it('returns an empty string for an empty file', () => {
    const filePath = join(dir, 'empty.txt');
    writeFileSync(filePath, '');

    const result = readFile({ path: filePath });

    expect(result.content).toBe('');
  });

  it('result has a content string field', () => {
    const filePath = join(dir, 'check.txt');
    writeFileSync(filePath, 'data');

    const result = readFile({ path: filePath });

    expect(typeof result.content).toBe('string');
  });

  it('reads a file in a nested subdirectory', () => {
    const subDir = join(dir, 'sub', 'nested');
    mkdirSync(subDir, { recursive: true });
    const filePath = join(subDir, 'deep.txt');
    writeFileSync(filePath, 'deep content');

    const result = readFile({ path: filePath });

    expect(result.content).toBe('deep content');
  });

  it('reads a file with multiple lines', () => {
    const filePath = join(dir, 'multi.txt');
    const lines = 'line1\nline2\nline3';
    writeFileSync(filePath, lines);

    const result = readFile({ path: filePath });

    expect(result.content).toBe(lines);
  });
});

// ─── TC-RFT-02: Content fidelity operations ───────────────────────────────────

describe('TC-RFT-02: content fidelity operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('preserves trailing newline', () => {
    const filePath = join(dir, 'newline.txt');
    writeFileSync(filePath, 'content\n');

    const result = readFile({ path: filePath });

    expect(result.content).toBe('content\n');
  });

  it('preserves unicode characters', () => {
    const filePath = join(dir, 'unicode.txt');
    const unicode = 'café résumé naïve';
    writeFileSync(filePath, unicode, 'utf-8');

    const result = readFile({ path: filePath });

    expect(result.content).toBe(unicode);
  });

  it('preserves whitespace and indentation', () => {
    const filePath = join(dir, 'indent.txt');
    const indented = '  indented\n\ttabbed\n';
    writeFileSync(filePath, indented);

    const result = readFile({ path: filePath });

    expect(result.content).toBe(indented);
  });

  it('reads the full content of a larger text file', () => {
    const filePath = join(dir, 'large.txt');
    const content = 'x'.repeat(10_000);
    writeFileSync(filePath, content);

    const result = readFile({ path: filePath });

    expect(result.content).toHaveLength(10_000);
    expect(result.content).toBe(content);
  });
});

// ─── TC-RFT-03: Error handling ────────────────────────────────────────────────

describe('TC-RFT-03: error handling', () => {
  it('throws ReadFileError with code not-found for a non-existent path', () => {
    const nonExistent = join(tmpdir(), 'read-file-nonexistent-' + Date.now());
    let err: ReadFileError | undefined;

    try {
      readFile({ path: nonExistent });
    } catch (e) {
      err = e as ReadFileError;
    }

    expect(err).toBeInstanceOf(ReadFileError);
    expect(err!.code).toBe('not-found');
  });

  it('throws ReadFileError with code not-a-file when path is a directory', () => {
    const tempDir = makeTempDir();
    let err: ReadFileError | undefined;

    try {
      readFile({ path: tempDir });
    } catch (e) {
      err = e as ReadFileError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(ReadFileError);
    expect(err!.code).toBe('not-a-file');
  });

  it('thrown ReadFileError has name "ReadFileError"', () => {
    const nonExistent = join(tmpdir(), 'read-file-name-' + Date.now());
    let err: ReadFileError | undefined;

    try {
      readFile({ path: nonExistent });
    } catch (e) {
      err = e as ReadFileError;
    }

    expect(err!.name).toBe('ReadFileError');
  });

  it('error message includes the path for not-found errors', () => {
    const nonExistent = join(tmpdir(), 'read-file-msg-' + Date.now());
    let err: ReadFileError | undefined;

    try {
      readFile({ path: nonExistent });
    } catch (e) {
      err = e as ReadFileError;
    }

    expect(err!.message).toContain(nonExistent);
  });

  it('not-found code is the typed discriminant', () => {
    const nonExistent = join(tmpdir(), 'read-file-disc-' + Date.now());
    let err: ReadFileError | undefined;

    try {
      readFile({ path: nonExistent });
    } catch (e) {
      err = e as ReadFileError;
    }

    const validCodes: Array<'not-found' | 'not-a-file' | 'fs-error'> = [
      'not-found',
      'not-a-file',
      'fs-error',
    ];
    expect(validCodes).toContain(err!.code);
  });

  it('error message includes the path for not-a-file errors', () => {
    const tempDir = makeTempDir();
    let err: ReadFileError | undefined;

    try {
      readFile({ path: tempDir });
    } catch (e) {
      err = e as ReadFileError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err!.message).toContain(tempDir);
  });
});

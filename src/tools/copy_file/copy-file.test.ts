/**
 * Unit tests for the copy_file tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-CF-01: Successful copy operations
 *   TC-CF-02: Source file validation
 *   TC-CF-03: Error handling for missing and invalid sources
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyFile, CopyFileError } from './copy-file.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'copy-file-'));
}

// ─── TC-CF-01: Successful copy operations ────────────────────────────────────

describe('TC-CF-01: successful copy operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('copies a file to the destination path', () => {
    const src = join(dir, 'source.txt');
    const dst = join(dir, 'dest.txt');
    writeFileSync(src, 'hello world');

    copyFile({ from: src, to: dst });

    expect(existsSync(dst)).toBe(true);
  });

  it('destination receives exact copy of source content', () => {
    const content = 'exact content to copy';
    const src = join(dir, 'source.txt');
    const dst = join(dir, 'dest.txt');
    writeFileSync(src, content);

    copyFile({ from: src, to: dst });

    expect(readFileSync(dst, 'utf8')).toBe(content);
  });

  it('source file remains unchanged after copy', () => {
    const content = 'original source content';
    const src = join(dir, 'source.txt');
    const dst = join(dir, 'dest.txt');
    writeFileSync(src, content);

    copyFile({ from: src, to: dst });

    expect(readFileSync(src, 'utf8')).toBe(content);
  });

  it('returns resolved from and to paths', () => {
    const src = join(dir, 'source.txt');
    const dst = join(dir, 'dest.txt');
    writeFileSync(src, 'data');

    const result = copyFile({ from: src, to: dst });

    expect(result.from).toBe(src);
    expect(result.to).toBe(dst);
  });

  it('copies an empty file', () => {
    const src = join(dir, 'empty.txt');
    const dst = join(dir, 'empty-copy.txt');
    writeFileSync(src, '');

    copyFile({ from: src, to: dst });

    expect(readFileSync(dst, 'utf8')).toBe('');
  });

  it('copies binary-like content faithfully', () => {
    const content = 'binary\x00data\xff\xfe';
    const src = join(dir, 'binary.bin');
    const dst = join(dir, 'binary-copy.bin');
    writeFileSync(src, content, 'binary');

    copyFile({ from: src, to: dst });

    expect(readFileSync(dst, 'binary')).toBe(content);
  });

  it('overwrites an existing destination file', () => {
    const src = join(dir, 'new-source.txt');
    const dst = join(dir, 'existing-dest.txt');
    writeFileSync(src, 'new content');
    writeFileSync(dst, 'old content');

    copyFile({ from: src, to: dst });

    expect(readFileSync(dst, 'utf8')).toBe('new content');
  });

  it('copies to a destination in a subdirectory', () => {
    const subDir = join(dir, 'sub');
    mkdirSync(subDir);
    const src = join(dir, 'source.txt');
    const dst = join(subDir, 'dest.txt');
    writeFileSync(src, 'subdir content');

    copyFile({ from: src, to: dst });

    expect(readFileSync(dst, 'utf8')).toBe('subdir content');
  });
});

// ─── TC-CF-02: Source file validation ────────────────────────────────────────

describe('TC-CF-02: source file validation', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws CopyFileError with code not-found for missing source', () => {
    const src = join(dir, 'does-not-exist.txt');
    const dst = join(dir, 'dest.txt');

    let err: CopyFileError | undefined;
    try {
      copyFile({ from: src, to: dst });
    } catch (e) {
      err = e as CopyFileError;
    }

    expect(err).toBeInstanceOf(CopyFileError);
    expect(err!.code).toBe('not-found');
  });

  it('throws CopyFileError with code not-a-file when source is a directory', () => {
    const src = join(dir, 'source-dir');
    mkdirSync(src);
    const dst = join(dir, 'dest.txt');

    let err: CopyFileError | undefined;
    try {
      copyFile({ from: src, to: dst });
    } catch (e) {
      err = e as CopyFileError;
    }

    expect(err).toBeInstanceOf(CopyFileError);
    expect(err!.code).toBe('not-a-file');
  });

  it('not-found error message includes source path', () => {
    const src = join(dir, 'missing.txt');
    const dst = join(dir, 'dest.txt');

    let err: CopyFileError | undefined;
    try {
      copyFile({ from: src, to: dst });
    } catch (e) {
      err = e as CopyFileError;
    }

    expect(err!.message).toContain(src);
  });

  it('not-a-file error message includes source path', () => {
    const src = join(dir, 'a-directory');
    mkdirSync(src);
    const dst = join(dir, 'dest.txt');

    let err: CopyFileError | undefined;
    try {
      copyFile({ from: src, to: dst });
    } catch (e) {
      err = e as CopyFileError;
    }

    expect(err!.message).toContain(src);
  });

  it('thrown CopyFileError has name "CopyFileError"', () => {
    const src = join(dir, 'no-such-file.txt');
    const dst = join(dir, 'dest.txt');

    let err: CopyFileError | undefined;
    try {
      copyFile({ from: src, to: dst });
    } catch (e) {
      err = e as CopyFileError;
    }

    expect(err!.name).toBe('CopyFileError');
  });
});

// ─── TC-CF-03: Result shape ───────────────────────────────────────────────────

describe('TC-CF-03: result shape', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('result has from and to fields', () => {
    const src = join(dir, 'source.txt');
    const dst = join(dir, 'dest.txt');
    writeFileSync(src, 'content');

    const result = copyFile({ from: src, to: dst });

    expect(result).toHaveProperty('from');
    expect(result).toHaveProperty('to');
  });

  it('from and to fields are strings', () => {
    const src = join(dir, 'source.txt');
    const dst = join(dir, 'dest.txt');
    writeFileSync(src, 'content');

    const result = copyFile({ from: src, to: dst });

    expect(typeof result.from).toBe('string');
    expect(typeof result.to).toBe('string');
  });
});

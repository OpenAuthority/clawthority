/**
 * Unit tests for the list_dir tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-LDT-01: Flat listing operations
 *   TC-LDT-02: Recursive listing operations
 *   TC-LDT-03: Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listDir, ListDirError } from './list-dir.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a temp directory for a test group. */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'list-dir-'));
}

// ─── TC-LDT-01: Flat listing operations ───────────────────────────────────────

describe('TC-LDT-01: flat listing operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty entries array for an empty directory', () => {
    const result = listDir({ path: dir });
    expect(result.entries).toEqual([]);
  });

  it('returns a single file name', () => {
    writeFileSync(join(dir, 'hello.txt'), 'hello');

    const result = listDir({ path: dir });

    expect(result.entries).toContain('hello.txt');
    expect(result.entries).toHaveLength(1);
  });

  it('returns multiple file names', () => {
    writeFileSync(join(dir, 'alpha.txt'), 'a');
    writeFileSync(join(dir, 'beta.txt'), 'b');
    writeFileSync(join(dir, 'gamma.txt'), 'c');

    const result = listDir({ path: dir });

    expect(result.entries).toContain('alpha.txt');
    expect(result.entries).toContain('beta.txt');
    expect(result.entries).toContain('gamma.txt');
    expect(result.entries).toHaveLength(3);
  });

  it('includes subdirectory names in the flat listing', () => {
    writeFileSync(join(dir, 'file.txt'), 'content');
    mkdirSync(join(dir, 'subdir'));

    const result = listDir({ path: dir });

    expect(result.entries).toContain('file.txt');
    expect(result.entries).toContain('subdir');
    expect(result.entries).toHaveLength(2);
  });

  it('result has an entries array field', () => {
    const result = listDir({ path: dir });
    expect(Array.isArray(result.entries)).toBe(true);
  });

  it('does not descend into subdirectories when recursive is false', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'deep.txt'), 'deep');

    const result = listDir({ path: dir, recursive: false });

    expect(result.entries).toContain('sub');
    expect(result.entries).not.toContain('deep.txt');
    expect(result.entries).not.toContain('sub/deep.txt');
    expect(result.entries).toHaveLength(1);
  });

  it('does not descend into subdirectories when recursive is omitted', () => {
    mkdirSync(join(dir, 'inner'));
    writeFileSync(join(dir, 'inner', 'nested.txt'), 'nested');

    const result = listDir({ path: dir });

    expect(result.entries).toContain('inner');
    expect(result.entries).not.toContain('nested.txt');
    expect(result.entries).toHaveLength(1);
  });
});

// ─── TC-LDT-02: Recursive listing operations ──────────────────────────────────

describe('TC-LDT-02: recursive listing operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty entries array for an empty directory in recursive mode', () => {
    const result = listDir({ path: dir, recursive: true });
    expect(result.entries).toEqual([]);
  });

  it('returns top-level files in recursive mode', () => {
    writeFileSync(join(dir, 'root.txt'), 'root');

    const result = listDir({ path: dir, recursive: true });

    expect(result.entries).toContain('root.txt');
  });

  it('includes subdirectory name and its children as relative paths', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'child.txt'), 'child');

    const result = listDir({ path: dir, recursive: true });

    expect(result.entries).toContain('sub');
    expect(result.entries).toContain('sub/child.txt');
  });

  it('traverses multiple levels of nesting', () => {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'a', 'b'));
    writeFileSync(join(dir, 'a', 'b', 'deep.txt'), 'deep');

    const result = listDir({ path: dir, recursive: true });

    expect(result.entries).toContain('a');
    expect(result.entries).toContain('a/b');
    expect(result.entries).toContain('a/b/deep.txt');
  });

  it('includes all files across sibling subdirectories', () => {
    mkdirSync(join(dir, 'x'));
    mkdirSync(join(dir, 'y'));
    writeFileSync(join(dir, 'x', 'one.txt'), '1');
    writeFileSync(join(dir, 'y', 'two.txt'), '2');

    const result = listDir({ path: dir, recursive: true });

    expect(result.entries).toContain('x/one.txt');
    expect(result.entries).toContain('y/two.txt');
  });

  it('total entry count reflects all files and directories recursively', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'root.txt'), 'root');
    writeFileSync(join(dir, 'sub', 'child.txt'), 'child');

    const result = listDir({ path: dir, recursive: true });

    // Expect: root.txt, sub, sub/child.txt = 3 entries
    expect(result.entries).toHaveLength(3);
  });
});

// ─── TC-LDT-03: Error handling ───────────────────────────────────────────────

describe('TC-LDT-03: error handling', () => {
  it('throws ListDirError with code not-found for a non-existent path', () => {
    const nonExistent = join(tmpdir(), 'list-dir-nonexistent-' + Date.now());
    let err: ListDirError | undefined;

    try {
      listDir({ path: nonExistent });
    } catch (e) {
      err = e as ListDirError;
    }

    expect(err).toBeInstanceOf(ListDirError);
    expect(err!.code).toBe('not-found');
  });

  it('throws ListDirError with code not-a-dir when path is a file', () => {
    const tempDir = makeTempDir();
    const filePath = join(tempDir, 'file.txt');
    writeFileSync(filePath, 'content');

    let err: ListDirError | undefined;

    try {
      listDir({ path: filePath });
    } catch (e) {
      err = e as ListDirError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(ListDirError);
    expect(err!.code).toBe('not-a-dir');
  });

  it('thrown ListDirError has name "ListDirError"', () => {
    const nonExistent = join(tmpdir(), 'list-dir-name-' + Date.now());
    let err: ListDirError | undefined;

    try {
      listDir({ path: nonExistent });
    } catch (e) {
      err = e as ListDirError;
    }

    expect(err!.name).toBe('ListDirError');
  });

  it('error message includes the path for not-found errors', () => {
    const nonExistent = join(tmpdir(), 'list-dir-msg-' + Date.now());
    let err: ListDirError | undefined;

    try {
      listDir({ path: nonExistent });
    } catch (e) {
      err = e as ListDirError;
    }

    expect(err!.message).toContain(nonExistent);
  });

  it('not-found code is the typed discriminant', () => {
    const nonExistent = join(tmpdir(), 'list-dir-disc-' + Date.now());
    let err: ListDirError | undefined;

    try {
      listDir({ path: nonExistent });
    } catch (e) {
      err = e as ListDirError;
    }

    const validCodes: Array<'not-found' | 'not-a-dir' | 'fs-error'> = [
      'not-found',
      'not-a-dir',
      'fs-error',
    ];
    expect(validCodes).toContain(err!.code);
  });

  it('also throws not-found in recursive mode for a non-existent path', () => {
    const nonExistent = join(tmpdir(), 'list-dir-rec-err-' + Date.now());
    let err: ListDirError | undefined;

    try {
      listDir({ path: nonExistent, recursive: true });
    } catch (e) {
      err = e as ListDirError;
    }

    expect(err).toBeInstanceOf(ListDirError);
    expect(err!.code).toBe('not-found');
  });
});

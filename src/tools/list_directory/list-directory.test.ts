/**
 * Unit tests for the list_directory tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-LD-01: Successful listing operations
 *   TC-LD-02: File metadata verification
 *   TC-LD-03: Error handling (forbidden, not-found, not-a-dir, fs-error)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listDirectory, ListDirectoryError } from './list-directory.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'list-directory-'));
}

// ─── TC-LD-01: Successful listing operations ──────────────────────────────────

describe('TC-LD-01: successful listing operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the absolute path of the listed directory', () => {
    const result = listDirectory({ path: dir });

    expect(result.path).toBe(dir);
  });

  it('returns an empty entries array for an empty directory', () => {
    const result = listDirectory({ path: dir });

    expect(result.entries).toEqual([]);
  });

  it('returns one entry for a directory with a single file', () => {
    writeFileSync(join(dir, 'file.txt'), 'hello');

    const result = listDirectory({ path: dir });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe('file.txt');
  });

  it('returns an entry for each file in the directory', () => {
    writeFileSync(join(dir, 'a.txt'), 'a');
    writeFileSync(join(dir, 'b.txt'), 'b');
    writeFileSync(join(dir, 'c.txt'), 'c');

    const result = listDirectory({ path: dir });

    const names = result.entries.map((e) => e.name).sort();
    expect(names).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('returns an entry for subdirectories', () => {
    mkdirSync(join(dir, 'subdir'));

    const result = listDirectory({ path: dir });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe('subdir');
  });

  it('returns entries for mixed files and subdirectories', () => {
    writeFileSync(join(dir, 'file.txt'), 'data');
    mkdirSync(join(dir, 'subdir'));

    const result = listDirectory({ path: dir });
    const names = result.entries.map((e) => e.name).sort();

    expect(names).toEqual(['file.txt', 'subdir']);
  });

  it('does not recurse into subdirectories', () => {
    mkdirSync(join(dir, 'subdir'));
    writeFileSync(join(dir, 'subdir', 'nested.txt'), 'nested');

    const result = listDirectory({ path: dir });
    const names = result.entries.map((e) => e.name);

    expect(names).not.toContain('nested.txt');
    expect(result.entries).toHaveLength(1);
  });

  it('resolves a relative path to an absolute path in the result', () => {
    const result = listDirectory({ path: dir });

    expect(result.path).toMatch(/^\//);
  });
});

// ─── TC-LD-02: File metadata verification ────────────────────────────────────

describe('TC-LD-02: file metadata verification', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('file entry has type "file"', () => {
    writeFileSync(join(dir, 'file.txt'), 'hello');

    const result = listDirectory({ path: dir });
    const entry = result.entries.find((e) => e.name === 'file.txt');

    expect(entry?.type).toBe('file');
  });

  it('directory entry has type "directory"', () => {
    mkdirSync(join(dir, 'subdir'));

    const result = listDirectory({ path: dir });
    const entry = result.entries.find((e) => e.name === 'subdir');

    expect(entry?.type).toBe('directory');
  });

  it('file entry has a non-negative numeric size', () => {
    writeFileSync(join(dir, 'file.txt'), 'hello');

    const result = listDirectory({ path: dir });
    const entry = result.entries.find((e) => e.name === 'file.txt');

    expect(typeof entry?.size).toBe('number');
    expect(entry!.size).toBeGreaterThanOrEqual(0);
  });

  it('file size matches the byte length of the content written', () => {
    const content = 'hello world';
    writeFileSync(join(dir, 'sized.txt'), content);

    const result = listDirectory({ path: dir });
    const entry = result.entries.find((e) => e.name === 'sized.txt');

    expect(entry?.size).toBe(Buffer.byteLength(content));
  });

  it('file entry has a modified field that is a valid ISO 8601 string', () => {
    writeFileSync(join(dir, 'ts.txt'), 'data');

    const result = listDirectory({ path: dir });
    const entry = result.entries.find((e) => e.name === 'ts.txt');

    expect(() => new Date(entry!.modified)).not.toThrow();
    expect(new Date(entry!.modified).toISOString()).toBe(entry!.modified);
  });

  it('directory entry has a modified field that is a valid ISO 8601 string', () => {
    mkdirSync(join(dir, 'subdir'));

    const result = listDirectory({ path: dir });
    const entry = result.entries.find((e) => e.name === 'subdir');

    expect(new Date(entry!.modified).toISOString()).toBe(entry!.modified);
  });

  it('each entry object has name, type, size, and modified fields', () => {
    writeFileSync(join(dir, 'full.txt'), 'data');

    const result = listDirectory({ path: dir });
    const entry = result.entries[0];

    expect(entry).toHaveProperty('name');
    expect(entry).toHaveProperty('type');
    expect(entry).toHaveProperty('size');
    expect(entry).toHaveProperty('modified');
  });
});

// ─── TC-LD-03: Error handling ─────────────────────────────────────────────────

describe('TC-LD-03: error handling', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws ListDirectoryError with code forbidden for root path', () => {
    let err: ListDirectoryError | undefined;
    try {
      listDirectory({ path: '/' });
    } catch (e) {
      err = e as ListDirectoryError;
    }

    expect(err).toBeInstanceOf(ListDirectoryError);
    expect(err!.code).toBe('forbidden');
  });

  it('throws ListDirectoryError with code forbidden for /etc', () => {
    let err: ListDirectoryError | undefined;
    try {
      listDirectory({ path: '/etc' });
    } catch (e) {
      err = e as ListDirectoryError;
    }

    expect(err).toBeInstanceOf(ListDirectoryError);
    expect(err!.code).toBe('forbidden');
  });

  it('throws ListDirectoryError with code forbidden for /usr/bin', () => {
    let err: ListDirectoryError | undefined;
    try {
      listDirectory({ path: '/usr/bin' });
    } catch (e) {
      err = e as ListDirectoryError;
    }

    expect(err).toBeInstanceOf(ListDirectoryError);
    expect(err!.code).toBe('forbidden');
  });

  it('forbidden error message includes the path', () => {
    let err: ListDirectoryError | undefined;
    try {
      listDirectory({ path: '/etc' });
    } catch (e) {
      err = e as ListDirectoryError;
    }

    expect(err!.message).toContain('/etc');
  });

  it('forbidden check runs before filesystem access for protected paths', () => {
    let err: ListDirectoryError | undefined;
    try {
      listDirectory({ path: '/etc' });
    } catch (e) {
      err = e as ListDirectoryError;
    }

    // Must be forbidden, not not-found or fs-error
    expect(err!.code).toBe('forbidden');
  });

  it('throws ListDirectoryError with code not-found for a missing path', () => {
    let err: ListDirectoryError | undefined;
    try {
      listDirectory({ path: join(dir, 'does-not-exist') });
    } catch (e) {
      err = e as ListDirectoryError;
    }

    expect(err).toBeInstanceOf(ListDirectoryError);
    expect(err!.code).toBe('not-found');
  });

  it('not-found error message includes the path', () => {
    const missing = join(dir, 'missing');
    let err: ListDirectoryError | undefined;
    try {
      listDirectory({ path: missing });
    } catch (e) {
      err = e as ListDirectoryError;
    }

    expect(err!.message).toContain(missing);
  });

  it('throws ListDirectoryError with code not-a-dir when path is a file', () => {
    const filePath = join(dir, 'i-am-a-file.txt');
    writeFileSync(filePath, 'content');

    let err: ListDirectoryError | undefined;
    try {
      listDirectory({ path: filePath });
    } catch (e) {
      err = e as ListDirectoryError;
    }

    expect(err).toBeInstanceOf(ListDirectoryError);
    expect(err!.code).toBe('not-a-dir');
  });

  it('not-a-dir error message includes the path', () => {
    const filePath = join(dir, 'blocker.txt');
    writeFileSync(filePath, 'content');

    let err: ListDirectoryError | undefined;
    try {
      listDirectory({ path: filePath });
    } catch (e) {
      err = e as ListDirectoryError;
    }

    expect(err!.message).toContain(filePath);
  });

  it('thrown ListDirectoryError has name "ListDirectoryError"', () => {
    let err: ListDirectoryError | undefined;
    try {
      listDirectory({ path: '/' });
    } catch (e) {
      err = e as ListDirectoryError;
    }

    expect(err!.name).toBe('ListDirectoryError');
  });
});

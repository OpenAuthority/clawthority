/**
 * Unit tests for the create_directory tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-CD-01: Successful directory creation operations
 *   TC-CD-02: Existing directory handling
 *   TC-CD-03: Error handling (forbidden, not-a-dir, fs-error)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  existsSync,
  writeFileSync,
  statSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDirectory, CreateDirectoryError } from './create-directory.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'create-directory-'));
}

// ─── TC-CD-01: Successful directory creation operations ───────────────────────

describe('TC-CD-01: successful directory creation operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a new directory and returns its absolute path', () => {
    const target = join(dir, 'new-dir');

    const result = createDirectory({ path: target });

    expect(result.path).toBe(target);
  });

  it('the created path is an actual directory on disk', () => {
    const target = join(dir, 'created');

    createDirectory({ path: target });

    expect(statSync(target).isDirectory()).toBe(true);
  });

  it('creates nested directories in a single call', () => {
    const target = join(dir, 'a', 'b', 'c');

    createDirectory({ path: target });

    expect(existsSync(target)).toBe(true);
    expect(statSync(target).isDirectory()).toBe(true);
  });

  it('creates deeply nested directories', () => {
    const target = join(dir, 'x', 'y', 'z', 'w', 'v');

    createDirectory({ path: target });

    expect(existsSync(target)).toBe(true);
  });

  it('result has a path field matching the resolved input path', () => {
    const target = join(dir, 'result-shape');

    const result = createDirectory({ path: target });

    expect(result).toHaveProperty('path', target);
  });

  it('creates a directory with spaces in the name', () => {
    const target = join(dir, 'dir with spaces');

    createDirectory({ path: target });

    expect(statSync(target).isDirectory()).toBe(true);
  });
});

// ─── TC-CD-02: Existing directory handling ────────────────────────────────────

describe('TC-CD-02: existing directory handling', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not throw when the directory already exists', () => {
    const target = join(dir, 'existing');
    mkdirSync(target);

    expect(() => createDirectory({ path: target })).not.toThrow();
  });

  it('returns the path when the directory already exists', () => {
    const target = join(dir, 'pre-existing');
    mkdirSync(target);

    const result = createDirectory({ path: target });

    expect(result.path).toBe(target);
  });

  it('does not modify directory contents when called on an existing directory', () => {
    const target = join(dir, 'with-contents');
    mkdirSync(target);
    writeFileSync(join(target, 'file.txt'), 'data');

    createDirectory({ path: target });

    expect(existsSync(join(target, 'file.txt'))).toBe(true);
  });
});

// ─── TC-CD-03: Error handling ─────────────────────────────────────────────────

describe('TC-CD-03: error handling', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws CreateDirectoryError with code forbidden for root path', () => {
    let err: CreateDirectoryError | undefined;
    try {
      createDirectory({ path: '/' });
    } catch (e) {
      err = e as CreateDirectoryError;
    }

    expect(err).toBeInstanceOf(CreateDirectoryError);
    expect(err!.code).toBe('forbidden');
  });

  it('throws CreateDirectoryError with code forbidden for /etc', () => {
    let err: CreateDirectoryError | undefined;
    try {
      createDirectory({ path: '/etc' });
    } catch (e) {
      err = e as CreateDirectoryError;
    }

    expect(err).toBeInstanceOf(CreateDirectoryError);
    expect(err!.code).toBe('forbidden');
  });

  it('throws CreateDirectoryError with code forbidden for /usr/bin', () => {
    let err: CreateDirectoryError | undefined;
    try {
      createDirectory({ path: '/usr/bin' });
    } catch (e) {
      err = e as CreateDirectoryError;
    }

    expect(err).toBeInstanceOf(CreateDirectoryError);
    expect(err!.code).toBe('forbidden');
  });

  it('forbidden error message includes the path', () => {
    let err: CreateDirectoryError | undefined;
    try {
      createDirectory({ path: '/etc' });
    } catch (e) {
      err = e as CreateDirectoryError;
    }

    expect(err!.message).toContain('/etc');
  });

  it('forbidden check runs before filesystem access for protected paths', () => {
    let err: CreateDirectoryError | undefined;
    try {
      createDirectory({ path: '/etc' });
    } catch (e) {
      err = e as CreateDirectoryError;
    }

    // Must be forbidden, not not-a-dir or fs-error
    expect(err!.code).toBe('forbidden');
  });

  it('throws CreateDirectoryError with code not-a-dir when path is an existing file', () => {
    const filePath = join(dir, 'i-am-a-file.txt');
    writeFileSync(filePath, 'content');

    let err: CreateDirectoryError | undefined;
    try {
      createDirectory({ path: filePath });
    } catch (e) {
      err = e as CreateDirectoryError;
    }

    expect(err).toBeInstanceOf(CreateDirectoryError);
    expect(err!.code).toBe('not-a-dir');
  });

  it('not-a-dir error message includes the path', () => {
    const filePath = join(dir, 'blocker.txt');
    writeFileSync(filePath, 'content');

    let err: CreateDirectoryError | undefined;
    try {
      createDirectory({ path: filePath });
    } catch (e) {
      err = e as CreateDirectoryError;
    }

    expect(err!.message).toContain(filePath);
  });

  it('throws CreateDirectoryError with code fs-error when an intermediate path component is a file', () => {
    const blockingFile = join(dir, 'blocker');
    writeFileSync(blockingFile, 'i am a file');

    let err: CreateDirectoryError | undefined;
    try {
      createDirectory({ path: join(blockingFile, 'child') });
    } catch (e) {
      err = e as CreateDirectoryError;
    }

    expect(err).toBeInstanceOf(CreateDirectoryError);
    expect(err!.code).toBe('fs-error');
  });

  it('thrown CreateDirectoryError has name "CreateDirectoryError"', () => {
    let err: CreateDirectoryError | undefined;
    try {
      createDirectory({ path: '/' });
    } catch (e) {
      err = e as CreateDirectoryError;
    }

    expect(err!.name).toBe('CreateDirectoryError');
  });
});

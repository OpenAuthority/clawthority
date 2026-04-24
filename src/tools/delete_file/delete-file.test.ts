/**
 * Unit tests for the delete_file tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-DF-01: Successful delete operations
 *   TC-DF-02: Error handling (not-found, not-empty, forbidden)
 *   TC-DF-03: Result shape
 *   TC-DF-04: Recursive deletion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deleteFile, DeleteFileError } from './delete-file.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'delete-file-'));
}

// ─── TC-DF-01: Successful delete operations ───────────────────────────────────

describe('TC-DF-01: successful delete operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('deletes an existing file', () => {
    const target = join(dir, 'file.txt');
    writeFileSync(target, 'content');

    deleteFile({ path: target });

    expect(existsSync(target)).toBe(false);
  });

  it('deletes an empty directory', () => {
    const target = join(dir, 'empty-dir');
    mkdirSync(target);

    deleteFile({ path: target });

    expect(existsSync(target)).toBe(false);
  });

  it('deletes a file with no content', () => {
    const target = join(dir, 'empty.txt');
    writeFileSync(target, '');

    deleteFile({ path: target });

    expect(existsSync(target)).toBe(false);
  });

  it('returns resolved absolute path of deleted file', () => {
    const target = join(dir, 'file.txt');
    writeFileSync(target, 'data');

    const result = deleteFile({ path: target });

    expect(result.path).toBe(target);
  });

  it('returns resolved absolute path of deleted directory', () => {
    const target = join(dir, 'empty-dir');
    mkdirSync(target);

    const result = deleteFile({ path: target });

    expect(result.path).toBe(target);
  });

  it('deletes a file inside a subdirectory', () => {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const target = join(sub, 'nested.txt');
    writeFileSync(target, 'nested content');

    deleteFile({ path: target });

    expect(existsSync(target)).toBe(false);
    expect(existsSync(sub)).toBe(true);
  });

  it('deletes a file with special characters in name', () => {
    const target = join(dir, 'file with spaces.txt');
    writeFileSync(target, 'data');

    deleteFile({ path: target });

    expect(existsSync(target)).toBe(false);
  });
});

// ─── TC-DF-02: Error handling ─────────────────────────────────────────────────

describe('TC-DF-02: error handling', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws DeleteFileError with code not-found for missing path', () => {
    const target = join(dir, 'does-not-exist.txt');

    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: target });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err).toBeInstanceOf(DeleteFileError);
    expect(err!.code).toBe('not-found');
  });

  it('not-found error message includes the path', () => {
    const target = join(dir, 'missing.txt');

    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: target });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err!.message).toContain(target);
  });

  it('throws DeleteFileError with code not-empty for non-empty directory', () => {
    const target = join(dir, 'non-empty-dir');
    mkdirSync(target);
    writeFileSync(join(target, 'child.txt'), 'content');

    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: target });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err).toBeInstanceOf(DeleteFileError);
    expect(err!.code).toBe('not-empty');
  });

  it('not-empty error message includes the path', () => {
    const target = join(dir, 'non-empty-dir');
    mkdirSync(target);
    writeFileSync(join(target, 'child.txt'), 'content');

    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: target });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err!.message).toContain(target);
  });

  it('does not delete non-empty directory — directory still exists after error', () => {
    const target = join(dir, 'non-empty-dir');
    mkdirSync(target);
    writeFileSync(join(target, 'child.txt'), 'content');

    try {
      deleteFile({ path: target });
    } catch {
      // expected
    }

    expect(existsSync(target)).toBe(true);
  });

  it('throws DeleteFileError with code forbidden for root path', () => {
    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: '/' });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err).toBeInstanceOf(DeleteFileError);
    expect(err!.code).toBe('forbidden');
  });

  it('throws DeleteFileError with code forbidden for /etc', () => {
    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: '/etc' });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err).toBeInstanceOf(DeleteFileError);
    expect(err!.code).toBe('forbidden');
  });

  it('throws DeleteFileError with code forbidden for /usr/bin', () => {
    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: '/usr/bin' });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err).toBeInstanceOf(DeleteFileError);
    expect(err!.code).toBe('forbidden');
  });

  it('forbidden error message includes the path', () => {
    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: '/etc' });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err!.message).toContain('/etc');
  });

  it('thrown DeleteFileError has name "DeleteFileError"', () => {
    const target = join(dir, 'missing.txt');

    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: target });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err!.name).toBe('DeleteFileError');
  });

  it('forbidden check runs before filesystem access for protected paths', () => {
    // /etc is protected even if it technically exists on the system
    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: '/etc' });
    } catch (e) {
      err = e as DeleteFileError;
    }

    // Must be forbidden, not not-found or fs-error
    expect(err!.code).toBe('forbidden');
  });
});

// ─── TC-DF-04: Recursive deletion ────────────────────────────────────────────

describe('TC-DF-04: recursive deletion', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('deletes a non-empty directory when recursive: true', () => {
    const target = join(dir, 'non-empty-dir');
    mkdirSync(target);
    writeFileSync(join(target, 'child.txt'), 'content');

    deleteFile({ path: target, recursive: true });

    expect(existsSync(target)).toBe(false);
  });

  it('returns resolved absolute path of recursively deleted directory', () => {
    const target = join(dir, 'non-empty-dir');
    mkdirSync(target);
    writeFileSync(join(target, 'child.txt'), 'content');

    const result = deleteFile({ path: target, recursive: true });

    expect(result.path).toBe(target);
  });

  it('deletes deeply nested directory tree when recursive: true', () => {
    const target = join(dir, 'level1');
    mkdirSync(join(target, 'level2', 'level3'), { recursive: true });
    writeFileSync(join(target, 'level2', 'level3', 'deep.txt'), 'deep');
    writeFileSync(join(target, 'level2', 'mid.txt'), 'mid');
    writeFileSync(join(target, 'top.txt'), 'top');

    deleteFile({ path: target, recursive: true });

    expect(existsSync(target)).toBe(false);
  });

  it('deletes empty directory when recursive: true (still works)', () => {
    const target = join(dir, 'empty-dir');
    mkdirSync(target);

    deleteFile({ path: target, recursive: true });

    expect(existsSync(target)).toBe(false);
  });

  it('still throws not-empty when recursive is false', () => {
    const target = join(dir, 'non-empty-dir');
    mkdirSync(target);
    writeFileSync(join(target, 'child.txt'), 'content');

    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: target, recursive: false });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err).toBeInstanceOf(DeleteFileError);
    expect(err!.code).toBe('not-empty');
  });

  it('still throws not-empty when recursive is omitted', () => {
    const target = join(dir, 'non-empty-dir');
    mkdirSync(target);
    writeFileSync(join(target, 'child.txt'), 'content');

    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: target });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err).toBeInstanceOf(DeleteFileError);
    expect(err!.code).toBe('not-empty');
  });

  it('forbidden check still applies when recursive: true', () => {
    let err: DeleteFileError | undefined;
    try {
      deleteFile({ path: '/etc', recursive: true });
    } catch (e) {
      err = e as DeleteFileError;
    }

    expect(err).toBeInstanceOf(DeleteFileError);
    expect(err!.code).toBe('forbidden');
  });
});

// ─── TC-DF-03: Result shape ───────────────────────────────────────────────────

describe('TC-DF-03: result shape', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('result has a path field', () => {
    const target = join(dir, 'file.txt');
    writeFileSync(target, 'content');

    const result = deleteFile({ path: target });

    expect(result).toHaveProperty('path');
  });

  it('result path field is a string', () => {
    const target = join(dir, 'file.txt');
    writeFileSync(target, 'content');

    const result = deleteFile({ path: target });

    expect(typeof result.path).toBe('string');
  });

  it('result path is the resolved absolute path', () => {
    const target = join(dir, 'file.txt');
    writeFileSync(target, 'content');

    const result = deleteFile({ path: target });

    expect(result.path).toBe(target);
  });
});

/**
 * Unit tests for the edit_file tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-EFT-01: Single replacement operations
 *   TC-EFT-02: Multiple occurrence replacement
 *   TC-EFT-03: Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { editFile, EditFileError } from './edit-file.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a temp directory for a test group. */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'edit-file-'));
}

// ─── TC-EFT-01: Single replacement operations ─────────────────────────────────

describe('TC-EFT-01: single replacement operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces a string and returns the file path', () => {
    const filePath = join(dir, 'hello.txt');
    writeFileSync(filePath, 'hello world');

    const result = editFile({ path: filePath, old_string: 'world', new_string: 'earth' });

    expect(result.path).toBe(filePath);
  });

  it('writes the replacement content to the file', () => {
    const filePath = join(dir, 'greet.txt');
    writeFileSync(filePath, 'hello world');

    editFile({ path: filePath, old_string: 'world', new_string: 'earth' });

    expect(readFileSync(filePath, 'utf8')).toBe('hello earth');
  });

  it('replaces at the start of the file', () => {
    const filePath = join(dir, 'start.txt');
    writeFileSync(filePath, 'foo bar baz');

    editFile({ path: filePath, old_string: 'foo', new_string: 'qux' });

    expect(readFileSync(filePath, 'utf8')).toBe('qux bar baz');
  });

  it('replaces at the end of the file', () => {
    const filePath = join(dir, 'end.txt');
    writeFileSync(filePath, 'foo bar baz');

    editFile({ path: filePath, old_string: 'baz', new_string: 'qux' });

    expect(readFileSync(filePath, 'utf8')).toBe('foo bar qux');
  });

  it('replaces a multi-line string', () => {
    const filePath = join(dir, 'multi.txt');
    writeFileSync(filePath, 'line one\nline two\nline three');

    editFile({ path: filePath, old_string: 'line two\n', new_string: 'LINE TWO\n' });

    expect(readFileSync(filePath, 'utf8')).toBe('line one\nLINE TWO\nline three');
  });

  it('can replace old_string with an empty string', () => {
    const filePath = join(dir, 'delete.txt');
    writeFileSync(filePath, 'remove this text');

    editFile({ path: filePath, old_string: ' this', new_string: '' });

    expect(readFileSync(filePath, 'utf8')).toBe('remove text');
  });

  it('result has a path field matching the input path', () => {
    const filePath = join(dir, 'check.txt');
    writeFileSync(filePath, 'some content');

    const result = editFile({ path: filePath, old_string: 'some', new_string: 'new' });

    expect(result).toHaveProperty('path', filePath);
  });
});

// ─── TC-EFT-02: Multiple occurrence replacement ───────────────────────────────

describe('TC-EFT-02: multiple occurrence replacement', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces only the first occurrence when old_string appears multiple times', () => {
    const filePath = join(dir, 'multi-occur.txt');
    writeFileSync(filePath, 'cat cat cat');

    editFile({ path: filePath, old_string: 'cat', new_string: 'dog' });

    expect(readFileSync(filePath, 'utf8')).toBe('dog cat cat');
  });

  it('leaves subsequent occurrences unchanged', () => {
    const filePath = join(dir, 'second.txt');
    writeFileSync(filePath, 'aaa bbb aaa');

    editFile({ path: filePath, old_string: 'aaa', new_string: 'zzz' });

    const content = readFileSync(filePath, 'utf8');
    expect(content).toBe('zzz bbb aaa');
    expect(content.split('aaa')).toHaveLength(2); // one 'aaa' remains
  });
});

// ─── TC-EFT-03: Error handling ────────────────────────────────────────────────

describe('TC-EFT-03: error handling', () => {
  it('throws EditFileError with code not-found for a non-existent path', () => {
    const nonExistent = join(tmpdir(), 'edit-file-nonexistent-' + Date.now());
    let err: EditFileError | undefined;

    try {
      editFile({ path: nonExistent, old_string: 'x', new_string: 'y' });
    } catch (e) {
      err = e as EditFileError;
    }

    expect(err).toBeInstanceOf(EditFileError);
    expect(err!.code).toBe('not-found');
  });

  it('throws EditFileError with code not-a-file when path is a directory', () => {
    const tempDir = makeTempDir();

    let err: EditFileError | undefined;

    try {
      editFile({ path: tempDir, old_string: 'x', new_string: 'y' });
    } catch (e) {
      err = e as EditFileError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(EditFileError);
    expect(err!.code).toBe('not-a-file');
  });

  it('throws EditFileError with code string-not-found when old_string is absent', () => {
    const tempDir = makeTempDir();
    const filePath = join(tempDir, 'content.txt');
    writeFileSync(filePath, 'hello world');

    let err: EditFileError | undefined;

    try {
      editFile({ path: filePath, old_string: 'missing string', new_string: 'y' });
    } catch (e) {
      err = e as EditFileError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(EditFileError);
    expect(err!.code).toBe('string-not-found');
  });

  it('thrown EditFileError has name "EditFileError"', () => {
    const nonExistent = join(tmpdir(), 'edit-file-name-' + Date.now());
    let err: EditFileError | undefined;

    try {
      editFile({ path: nonExistent, old_string: 'x', new_string: 'y' });
    } catch (e) {
      err = e as EditFileError;
    }

    expect(err!.name).toBe('EditFileError');
  });

  it('error message includes the path for not-found errors', () => {
    const nonExistent = join(tmpdir(), 'edit-file-msg-' + Date.now());
    let err: EditFileError | undefined;

    try {
      editFile({ path: nonExistent, old_string: 'x', new_string: 'y' });
    } catch (e) {
      err = e as EditFileError;
    }

    expect(err!.message).toContain(nonExistent);
  });

  it('does not modify the file when old_string is not found', () => {
    const tempDir = makeTempDir();
    const filePath = join(tempDir, 'unchanged.txt');
    const original = 'original content';
    writeFileSync(filePath, original);

    try {
      editFile({ path: filePath, old_string: 'no match', new_string: 'replacement' });
    } catch {
      // expected to throw
    } finally {
      expect(readFileSync(filePath, 'utf8')).toBe(original);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

/**
 * Unit tests for the append_file tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-AF-01: Append scenarios (append to existing, create new, multiple appends)
 *   TC-AF-02: Error conditions (forbidden, not-a-file, fs-error)
 *   TC-AF-03: Result shape
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendFile, AppendFileError } from './append-file.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'append-file-'));
}

// ─── TC-AF-01: Append scenarios ───────────────────────────────────────────────

describe('TC-AF-01: append scenarios', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends content to an existing file', () => {
    const target = join(dir, 'file.txt');
    writeFileSync(target, 'hello');

    appendFile({ path: target, content: ' world' });

    expect(readFileSync(target, 'utf8')).toBe('hello world');
  });

  it('creates a new file when it does not exist', () => {
    const target = join(dir, 'new.txt');

    appendFile({ path: target, content: 'created' });

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('created');
  });

  it('creates parent directories when they do not exist', () => {
    const target = join(dir, 'nested', 'deep', 'file.txt');

    appendFile({ path: target, content: 'deep content' });

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('deep content');
  });

  it('appends empty string without modifying existing content', () => {
    const target = join(dir, 'file.txt');
    writeFileSync(target, 'original');

    appendFile({ path: target, content: '' });

    expect(readFileSync(target, 'utf8')).toBe('original');
  });

  it('appends content multiple times in sequence', () => {
    const target = join(dir, 'log.txt');

    appendFile({ path: target, content: 'line1\n' });
    appendFile({ path: target, content: 'line2\n' });
    appendFile({ path: target, content: 'line3\n' });

    expect(readFileSync(target, 'utf8')).toBe('line1\nline2\nline3\n');
  });

  it('appends to an empty file', () => {
    const target = join(dir, 'empty.txt');
    writeFileSync(target, '');

    appendFile({ path: target, content: 'appended' });

    expect(readFileSync(target, 'utf8')).toBe('appended');
  });

  it('appends content with special characters', () => {
    const target = join(dir, 'unicode.txt');
    writeFileSync(target, '');

    appendFile({ path: target, content: 'café résumé 日本語' });

    expect(readFileSync(target, 'utf8')).toBe('café résumé 日本語');
  });

  it('appends to a file with spaces in its name', () => {
    const target = join(dir, 'my file.txt');
    writeFileSync(target, 'start');

    appendFile({ path: target, content: ' end' });

    expect(readFileSync(target, 'utf8')).toBe('start end');
  });
});

// ─── TC-AF-02: Error conditions ───────────────────────────────────────────────

describe('TC-AF-02: error conditions', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws AppendFileError with code forbidden for root path', () => {
    let err: AppendFileError | undefined;
    try {
      appendFile({ path: '/', content: 'data' });
    } catch (e) {
      err = e as AppendFileError;
    }

    expect(err).toBeInstanceOf(AppendFileError);
    expect(err!.code).toBe('forbidden');
  });

  it('throws AppendFileError with code forbidden for /etc', () => {
    let err: AppendFileError | undefined;
    try {
      appendFile({ path: '/etc', content: 'data' });
    } catch (e) {
      err = e as AppendFileError;
    }

    expect(err).toBeInstanceOf(AppendFileError);
    expect(err!.code).toBe('forbidden');
  });

  it('throws AppendFileError with code forbidden for /usr/bin', () => {
    let err: AppendFileError | undefined;
    try {
      appendFile({ path: '/usr/bin', content: 'data' });
    } catch (e) {
      err = e as AppendFileError;
    }

    expect(err).toBeInstanceOf(AppendFileError);
    expect(err!.code).toBe('forbidden');
  });

  it('forbidden error message includes the path', () => {
    let err: AppendFileError | undefined;
    try {
      appendFile({ path: '/etc', content: 'data' });
    } catch (e) {
      err = e as AppendFileError;
    }

    expect(err!.message).toContain('/etc');
  });

  it('forbidden check runs before filesystem access for protected paths', () => {
    let err: AppendFileError | undefined;
    try {
      appendFile({ path: '/etc', content: 'data' });
    } catch (e) {
      err = e as AppendFileError;
    }

    // Must be forbidden, not not-a-file or fs-error
    expect(err!.code).toBe('forbidden');
  });

  it('throws AppendFileError with code not-a-file when path is an existing directory', () => {
    const target = join(dir, 'a-directory');
    mkdirSync(target);

    let err: AppendFileError | undefined;
    try {
      appendFile({ path: target, content: 'data' });
    } catch (e) {
      err = e as AppendFileError;
    }

    expect(err).toBeInstanceOf(AppendFileError);
    expect(err!.code).toBe('not-a-file');
  });

  it('not-a-file error message includes the path', () => {
    const target = join(dir, 'a-directory');
    mkdirSync(target);

    let err: AppendFileError | undefined;
    try {
      appendFile({ path: target, content: 'data' });
    } catch (e) {
      err = e as AppendFileError;
    }

    expect(err!.message).toContain(target);
  });

  it('thrown AppendFileError has name "AppendFileError"', () => {
    let err: AppendFileError | undefined;
    try {
      appendFile({ path: '/', content: 'data' });
    } catch (e) {
      err = e as AppendFileError;
    }

    expect(err!.name).toBe('AppendFileError');
  });

  it('does not modify the file when an error is thrown', () => {
    const target = join(dir, 'a-directory');
    mkdirSync(target);

    try {
      appendFile({ path: target, content: 'should not appear' });
    } catch {
      // expected
    }

    // Directory still exists and has not been replaced
    expect(existsSync(target)).toBe(true);
  });
});

// ─── TC-AF-03: Result shape ───────────────────────────────────────────────────

describe('TC-AF-03: result shape', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('result has a path field', () => {
    const target = join(dir, 'file.txt');

    const result = appendFile({ path: target, content: 'data' });

    expect(result).toHaveProperty('path');
  });

  it('result path field is a string', () => {
    const target = join(dir, 'file.txt');

    const result = appendFile({ path: target, content: 'data' });

    expect(typeof result.path).toBe('string');
  });

  it('result path is the resolved absolute path', () => {
    const target = join(dir, 'file.txt');

    const result = appendFile({ path: target, content: 'data' });

    expect(result.path).toBe(target);
  });

  it('result path matches the file that was written', () => {
    const target = join(dir, 'file.txt');

    const result = appendFile({ path: target, content: 'hello' });

    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path, 'utf8')).toBe('hello');
  });
});

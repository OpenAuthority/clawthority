/**
 * Unit tests for the write_file tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-WFT-01: File creation operations
 *   TC-WFT-02: File overwrite operations
 *   TC-WFT-03: Error conditions (forbidden, not-a-file, fs-error)
 *   TC-WFT-04: Result shape
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, WriteFileError } from './write-file.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a temp directory for a test group. */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'write-file-'));
}

// ─── TC-WFT-01: File creation operations ─────────────────────────────────────

describe('TC-WFT-01: file creation operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a new file and returns the file path', () => {
    const filePath = join(dir, 'new.txt');

    const result = writeFile({ path: filePath, content: 'hello world' });

    expect(result.path).toBe(filePath);
  });

  it('writes the content to the new file', () => {
    const filePath = join(dir, 'content.txt');

    writeFile({ path: filePath, content: 'hello world' });

    expect(readFileSync(filePath, 'utf8')).toBe('hello world');
  });

  it('creates parent directories if they do not exist', () => {
    const filePath = join(dir, 'a', 'b', 'c', 'nested.txt');

    writeFile({ path: filePath, content: 'deep content' });

    expect(readFileSync(filePath, 'utf8')).toBe('deep content');
  });

  it('creates a file with empty content', () => {
    const filePath = join(dir, 'empty.txt');

    writeFile({ path: filePath, content: '' });

    expect(readFileSync(filePath, 'utf8')).toBe('');
  });

  it('creates a file with multi-line content', () => {
    const filePath = join(dir, 'multi.txt');
    const content = 'line one\nline two\nline three';

    writeFile({ path: filePath, content });

    expect(readFileSync(filePath, 'utf8')).toBe(content);
  });

  it('result has a path field matching the input path', () => {
    const filePath = join(dir, 'check.txt');

    const result = writeFile({ path: filePath, content: 'data' });

    expect(result).toHaveProperty('path', filePath);
  });
});

// ─── TC-WFT-02: File overwrite operations ─────────────────────────────────────

describe('TC-WFT-02: file overwrite operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('overwrites an existing file with new content', () => {
    const filePath = join(dir, 'overwrite.txt');
    writeFile({ path: filePath, content: 'original content' });

    writeFile({ path: filePath, content: 'new content' });

    expect(readFileSync(filePath, 'utf8')).toBe('new content');
  });

  it('overwrites an existing file with empty content', () => {
    const filePath = join(dir, 'clear.txt');
    writeFile({ path: filePath, content: 'some data' });

    writeFile({ path: filePath, content: '' });

    expect(readFileSync(filePath, 'utf8')).toBe('');
  });

  it('returns the correct path when overwriting', () => {
    const filePath = join(dir, 'return-path.txt');
    writeFile({ path: filePath, content: 'first' });

    const result = writeFile({ path: filePath, content: 'second' });

    expect(result.path).toBe(filePath);
  });

  it('replaces shorter content with longer content', () => {
    const filePath = join(dir, 'expand.txt');
    writeFile({ path: filePath, content: 'short' });

    writeFile({ path: filePath, content: 'much longer content than before' });

    expect(readFileSync(filePath, 'utf8')).toBe('much longer content than before');
  });

  it('replaces longer content with shorter content', () => {
    const filePath = join(dir, 'shrink.txt');
    writeFile({ path: filePath, content: 'much longer content than after' });

    writeFile({ path: filePath, content: 'short' });

    expect(readFileSync(filePath, 'utf8')).toBe('short');
  });
});

// ─── TC-WFT-03: Error conditions ─────────────────────────────────────────────

describe('TC-WFT-03: error conditions', () => {
  it('throws WriteFileError with code forbidden for root path', () => {
    expect(() => writeFile({ path: '/', content: 'data' })).toThrow(WriteFileError);
    try {
      writeFile({ path: '/', content: 'data' });
    } catch (e) {
      expect((e as WriteFileError).code).toBe('forbidden');
    }
  });

  it('throws WriteFileError with code forbidden for /etc', () => {
    expect(() => writeFile({ path: '/etc', content: 'data' })).toThrow(WriteFileError);
    try {
      writeFile({ path: '/etc', content: 'data' });
    } catch (e) {
      expect((e as WriteFileError).code).toBe('forbidden');
    }
  });

  it('throws WriteFileError with code forbidden for /usr/bin', () => {
    expect(() => writeFile({ path: '/usr/bin', content: 'data' })).toThrow(WriteFileError);
    try {
      writeFile({ path: '/usr/bin', content: 'data' });
    } catch (e) {
      expect((e as WriteFileError).code).toBe('forbidden');
    }
  });

  it('forbidden error message includes the path', () => {
    try {
      writeFile({ path: '/etc', content: 'data' });
    } catch (e) {
      expect((e as WriteFileError).message).toContain('/etc');
    }
  });

  it('forbidden check runs before filesystem access for protected paths', () => {
    // /etc exists on disk but the forbidden check must reject it before any stat call
    let err: WriteFileError | undefined;
    try {
      writeFile({ path: '/etc', content: 'data' });
    } catch (e) {
      err = e as WriteFileError;
    }
    expect(err).toBeInstanceOf(WriteFileError);
    expect(err!.code).toBe('forbidden');
  });

  it('throws WriteFileError with code not-a-file when path is a directory', () => {
    const tempDir = makeTempDir();

    let err: WriteFileError | undefined;

    try {
      writeFile({ path: tempDir, content: 'data' });
    } catch (e) {
      err = e as WriteFileError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(WriteFileError);
    expect(err!.code).toBe('not-a-file');
  });

  it('thrown WriteFileError has name "WriteFileError"', () => {
    const tempDir = makeTempDir();

    let err: WriteFileError | undefined;

    try {
      writeFile({ path: tempDir, content: 'data' });
    } catch (e) {
      err = e as WriteFileError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err!.name).toBe('WriteFileError');
  });

  it('error message includes the path for not-a-file errors', () => {
    const tempDir = makeTempDir();

    let err: WriteFileError | undefined;

    try {
      writeFile({ path: tempDir, content: 'data' });
    } catch (e) {
      err = e as WriteFileError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err!.message).toContain(tempDir);
  });

  it('does not throw when writing to a new file in an existing directory', () => {
    const tempDir = makeTempDir();
    const filePath = join(tempDir, 'valid.txt');

    let threw = false;
    try {
      writeFile({ path: filePath, content: 'ok' });
    } catch {
      threw = true;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(threw).toBe(false);
  });

  it('creates nested directories without throwing', () => {
    const tempDir = makeTempDir();
    const filePath = join(tempDir, 'x', 'y', 'z', 'file.txt');

    let threw = false;
    try {
      writeFile({ path: filePath, content: 'nested' });
    } catch {
      threw = true;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(threw).toBe(false);
  });

  it('throws WriteFileError when an intermediate path component is a file', () => {
    const tempDir = makeTempDir();
    // Create a file where a directory is expected in the path
    const blockingFile = join(tempDir, 'blocker');
    mkdirSync(tempDir, { recursive: true });
    // writeFile a file at 'blocker', then try to write to 'blocker/file.txt'
    writeFile({ path: blockingFile, content: 'i am a file' });

    let err: WriteFileError | undefined;

    try {
      writeFile({ path: join(blockingFile, 'child.txt'), content: 'data' });
    } catch (e) {
      err = e as WriteFileError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(WriteFileError);
    expect(err!.code).toBe('fs-error');
  });
});

// ─── TC-WFT-04: Result shape ──────────────────────────────────────────────────

describe('TC-WFT-04: result shape', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('result has a path field', () => {
    const filePath = join(dir, 'shape.txt');

    const result = writeFile({ path: filePath, content: 'data' });

    expect(result).toHaveProperty('path');
  });

  it('result path field is a string', () => {
    const filePath = join(dir, 'type.txt');

    const result = writeFile({ path: filePath, content: 'data' });

    expect(typeof result.path).toBe('string');
  });

  it('result path is the resolved absolute path', () => {
    const filePath = join(dir, 'resolved.txt');

    const result = writeFile({ path: filePath, content: 'data' });

    expect(result.path).toBe(resolve(filePath));
  });

  it('result path matches the file that was written', () => {
    const filePath = join(dir, 'match.txt');

    const result = writeFile({ path: filePath, content: 'content' });

    expect(readFileSync(result.path, 'utf8')).toBe('content');
  });
});

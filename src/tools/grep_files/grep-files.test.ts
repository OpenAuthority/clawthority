/**
 * Unit tests for the grep_files tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-GF-01: Pattern matching and basic search
 *   TC-GF-02: Glob filter behaviour
 *   TC-GF-03: Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { grepFiles, GrepFilesError } from './grep-files.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'grep-files-'));
}

// ─── TC-GF-01: Pattern matching and basic search ──────────────────────────────

describe('TC-GF-01: pattern matching and basic search', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty array when no files match the pattern', () => {
    writeFileSync(join(dir, 'readme.md'), 'hello world\n');

    const result = grepFiles({ pattern: 'nothere', path: dir });

    expect(result.matches).toEqual([]);
  });

  it('returns empty array for an empty directory', () => {
    const result = grepFiles({ pattern: 'anything', path: dir });

    expect(result.matches).toEqual([]);
  });

  it('finds a matching line in a single file', () => {
    writeFileSync(join(dir, 'index.ts'), 'export const foo = 1;\n');

    const result = grepFiles({ pattern: 'foo', path: dir });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.file).toBe(join(dir, 'index.ts'));
    expect(result.matches[0]!.line).toBe(1);
    expect(result.matches[0]!.content).toBe('export const foo = 1;');
  });

  it('returns correct 1-based line numbers', () => {
    writeFileSync(join(dir, 'file.ts'), 'line one\nline two\nline three\n');

    const result = grepFiles({ pattern: 'two', path: dir });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.line).toBe(2);
  });

  it('finds multiple matches across multiple lines in the same file', () => {
    writeFileSync(join(dir, 'file.ts'), 'foo bar\nbaz\nfoo qux\n');

    const result = grepFiles({ pattern: 'foo', path: dir });

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]!.line).toBe(1);
    expect(result.matches[1]!.line).toBe(3);
  });

  it('finds matches across multiple files', () => {
    writeFileSync(join(dir, 'a.ts'), 'needle here\n');
    writeFileSync(join(dir, 'b.ts'), 'no match\n');
    writeFileSync(join(dir, 'c.ts'), 'another needle\n');

    const result = grepFiles({ pattern: 'needle', path: dir });

    expect(result.matches).toHaveLength(2);
    const files = result.matches.map((m) => m.file);
    expect(files).toContain(join(dir, 'a.ts'));
    expect(files).toContain(join(dir, 'c.ts'));
  });

  it('finds matches in nested subdirectories', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'helper.ts'), 'export function helper() {}\n');

    const result = grepFiles({ pattern: 'helper', path: dir });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.file).toBe(join(dir, 'src', 'helper.ts'));
  });

  it('supports basic regex patterns', () => {
    writeFileSync(join(dir, 'file.ts'), 'foo123\nbar456\nfoo789\n');

    const result = grepFiles({ pattern: 'foo\\d+', path: dir });

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]!.content).toBe('foo123');
    expect(result.matches[1]!.content).toBe('foo789');
  });

  it('supports anchored regex patterns', () => {
    writeFileSync(join(dir, 'file.ts'), 'import foo\nexport foo\nimport bar\n');

    const result = grepFiles({ pattern: '^import', path: dir });

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]!.content).toBe('import foo');
    expect(result.matches[1]!.content).toBe('import bar');
  });

  it('result has a matches array field', () => {
    const result = grepFiles({ pattern: 'x', path: dir });

    expect(Array.isArray(result.matches)).toBe(true);
  });

  it('each match has file, line, and content fields', () => {
    writeFileSync(join(dir, 'file.ts'), 'hello\n');

    const result = grepFiles({ pattern: 'hello', path: dir });

    expect(result.matches[0]).toHaveProperty('file');
    expect(result.matches[0]).toHaveProperty('line');
    expect(result.matches[0]).toHaveProperty('content');
  });

  it('file path in match is absolute', () => {
    writeFileSync(join(dir, 'file.ts'), 'hello\n');

    const result = grepFiles({ pattern: 'hello', path: dir });

    expect(result.matches[0]!.file).toMatch(/^\//);
  });

  it('uses cwd when path is omitted', () => {
    // Should not throw — just exercises the default path branch.
    expect(() => grepFiles({ pattern: 'anything' })).not.toThrow();
  });
});

// ─── TC-GF-02: Glob filter behaviour ─────────────────────────────────────────

describe('TC-GF-02: glob filter behaviour', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('glob filter restricts search to matching files only', () => {
    writeFileSync(join(dir, 'index.ts'), 'needle\n');
    writeFileSync(join(dir, 'readme.md'), 'needle\n');

    const result = grepFiles({ pattern: 'needle', path: dir, glob: '*.ts' });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.file).toBe(join(dir, 'index.ts'));
  });

  it('**/*.ts glob matches files in subdirectories', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'needle\n');
    writeFileSync(join(dir, 'src', 'style.css'), 'needle\n');

    const result = grepFiles({ pattern: 'needle', path: dir, glob: '**/*.ts' });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.file).toBe(join(dir, 'src', 'index.ts'));
  });

  it('? glob matches exactly one character', () => {
    writeFileSync(join(dir, 'a.ts'), 'needle\n');
    writeFileSync(join(dir, 'ab.ts'), 'needle\n');

    const result = grepFiles({ pattern: 'needle', path: dir, glob: '?.ts' });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.file).toBe(join(dir, 'a.ts'));
  });

  it('{ts,tsx} alternation in glob matches both extensions', () => {
    writeFileSync(join(dir, 'comp.ts'), 'needle\n');
    writeFileSync(join(dir, 'comp.tsx'), 'needle\n');
    writeFileSync(join(dir, 'style.css'), 'needle\n');

    const result = grepFiles({ pattern: 'needle', path: dir, glob: '*.{ts,tsx}' });

    expect(result.matches).toHaveLength(2);
    const files = result.matches.map((m) => m.file);
    expect(files).toContain(join(dir, 'comp.ts'));
    expect(files).toContain(join(dir, 'comp.tsx'));
  });

  it('without glob, all files are searched', () => {
    writeFileSync(join(dir, 'index.ts'), 'needle\n');
    writeFileSync(join(dir, 'readme.md'), 'needle\n');

    const result = grepFiles({ pattern: 'needle', path: dir });

    expect(result.matches).toHaveLength(2);
  });
});

// ─── TC-GF-03: Error handling ─────────────────────────────────────────────────

describe('TC-GF-03: error handling', () => {
  it('throws GrepFilesError with code not-found for a non-existent path', () => {
    const nonExistent = join(tmpdir(), `grep-files-nf-${Date.now()}`);
    let err: GrepFilesError | undefined;

    try {
      grepFiles({ pattern: 'x', path: nonExistent });
    } catch (e) {
      err = e as GrepFilesError;
    }

    expect(err).toBeInstanceOf(GrepFilesError);
    expect(err!.code).toBe('not-found');
  });

  it('throws GrepFilesError with code not-a-dir when path is a file', () => {
    const tempDir = makeTempDir();
    const filePath = join(tempDir, 'file.txt');
    writeFileSync(filePath, 'content');
    let err: GrepFilesError | undefined;

    try {
      grepFiles({ pattern: 'x', path: filePath });
    } catch (e) {
      err = e as GrepFilesError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(GrepFilesError);
    expect(err!.code).toBe('not-a-dir');
  });

  it('throws GrepFilesError with code invalid-regex for a bad pattern', () => {
    const tempDir = makeTempDir();
    let err: GrepFilesError | undefined;

    try {
      grepFiles({ pattern: '[invalid(', path: tempDir });
    } catch (e) {
      err = e as GrepFilesError;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(GrepFilesError);
    expect(err!.code).toBe('invalid-regex');
  });

  it('thrown GrepFilesError has name "GrepFilesError"', () => {
    const nonExistent = join(tmpdir(), `grep-files-name-${Date.now()}`);
    let err: GrepFilesError | undefined;

    try {
      grepFiles({ pattern: 'x', path: nonExistent });
    } catch (e) {
      err = e as GrepFilesError;
    }

    expect(err!.name).toBe('GrepFilesError');
  });

  it('error message includes the path', () => {
    const nonExistent = join(tmpdir(), `grep-files-msg-${Date.now()}`);
    let err: GrepFilesError | undefined;

    try {
      grepFiles({ pattern: 'x', path: nonExistent });
    } catch (e) {
      err = e as GrepFilesError;
    }

    expect(err!.message).toContain(nonExistent);
  });
});

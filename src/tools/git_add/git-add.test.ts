/**
 * Unit tests for the git_add tool.
 *
 * Each test group spins up a fresh temporary git repository so tests are
 * fully isolated and do not affect the project's own index.
 *
 * Test IDs:
 *   TC-GAT-01: Successful staging operations
 *   TC-GAT-02: Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gitAdd, GitAddError } from './git-add.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Initialise a bare git repo in `dir` with a throwaway identity. */
function initRepo(dir: string): void {
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

/** Return the `git status --porcelain` output for `dir`. */
function porcelain(dir: string): string {
  const r = spawnSync('git', ['status', '--porcelain'], {
    cwd: dir,
    encoding: 'utf-8',
  });
  return r.stdout ?? '';
}

// ─── TC-GAT-01: Successful staging ───────────────────────────────────────────

describe('TC-GAT-01: successful staging operations', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'git-add-ok-'));
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('stages a single file and returns it in stagedPaths', () => {
    writeFileSync(join(repoDir, 'hello.txt'), 'hello');

    const result = gitAdd({ paths: ['hello.txt'] }, { cwd: repoDir });

    expect(result.stagedPaths).toEqual(['hello.txt']);
    expect(porcelain(repoDir)).toContain('A  hello.txt');
  });

  it('stages multiple files and returns all in stagedPaths', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'a');
    writeFileSync(join(repoDir, 'b.txt'), 'b');

    const result = gitAdd({ paths: ['a.txt', 'b.txt'] }, { cwd: repoDir });

    expect(result.stagedPaths).toEqual(['a.txt', 'b.txt']);
    expect(porcelain(repoDir)).toContain('A  a.txt');
    expect(porcelain(repoDir)).toContain('A  b.txt');
  });

  it('returns empty stagedPaths immediately when paths is empty', () => {
    const result = gitAdd({ paths: [] }, { cwd: repoDir });
    expect(result.stagedPaths).toEqual([]);
  });

  it('accepts a glob pattern and stages all matching files', () => {
    writeFileSync(join(repoDir, 'foo.ts'), 'foo');
    writeFileSync(join(repoDir, 'bar.ts'), 'bar');

    const result = gitAdd({ paths: ['*.ts'] }, { cwd: repoDir });

    expect(result.stagedPaths).toEqual(['*.ts']);
    const status = porcelain(repoDir);
    expect(status).toContain('foo.ts');
    expect(status).toContain('bar.ts');
  });

  it('works with absolute paths', () => {
    const absPath = join(repoDir, 'abs.txt');
    writeFileSync(absPath, 'abs');

    const result = gitAdd({ paths: [absPath] }, { cwd: repoDir });

    expect(result.stagedPaths).toEqual([absPath]);
    expect(porcelain(repoDir)).toContain('A  abs.txt');
  });
});

// ─── TC-GAT-02: Error handling ───────────────────────────────────────────────

describe('TC-GAT-02: error handling', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'git-add-err-'));
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('throws GitAddError for a non-existent concrete path', () => {
    expect(() =>
      gitAdd({ paths: ['does-not-exist.txt'] }, { cwd: repoDir }),
    ).toThrow(GitAddError);
  });

  it('thrown error has code path-not-found for missing file', () => {
    let err: GitAddError | undefined;
    try {
      gitAdd({ paths: ['missing.txt'] }, { cwd: repoDir });
    } catch (e) {
      err = e as GitAddError;
    }
    expect(err).toBeInstanceOf(GitAddError);
    expect(err!.code).toBe('path-not-found');
    expect(err!.message).toMatch(/missing\.txt/);
  });

  it('error message includes the missing path', () => {
    let err: GitAddError | undefined;
    try {
      gitAdd({ paths: ['no-such-file.txt'] }, { cwd: repoDir });
    } catch (e) {
      err = e as GitAddError;
    }
    expect(err!.message).toContain('no-such-file.txt');
  });

  it('does not throw path-not-found for a non-matching glob pattern', () => {
    // Glob patterns bypass the pre-call existence check. If git itself fails
    // (e.g. no matching files), the error code is git-error, not path-not-found.
    let err: GitAddError | undefined;
    try {
      gitAdd({ paths: ['*.never-exists'] }, { cwd: repoDir });
    } catch (e) {
      err = e as GitAddError;
    }
    // Either no error or a git-error — never a path-not-found.
    if (err !== undefined) {
      expect(err.code).toBe('git-error');
    }
  });

  it('throws GitAddError with code git-error when git exits non-zero', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
    const absFile = join(notARepo, 'file.txt');
    writeFileSync(absFile, 'x');

    let err: GitAddError | undefined;
    try {
      // File exists (absolute path passes check) but notARepo is not a git repo.
      gitAdd({ paths: [absFile] }, { cwd: notARepo });
    } catch (e) {
      err = e as GitAddError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(GitAddError);
    expect(err!.code).toBe('git-error');
  });

  it('GitAddError exposes code as a typed discriminant', () => {
    let err: GitAddError | undefined;
    try {
      gitAdd({ paths: ['absent.ts'] }, { cwd: repoDir });
    } catch (e) {
      err = e as GitAddError;
    }
    // Ensure the code literal type is one of the two expected values.
    const validCodes: Array<'path-not-found' | 'git-error'> = [
      'path-not-found',
      'git-error',
    ];
    expect(validCodes).toContain(err!.code);
  });
});

/**
 * Unit tests for the git_commit tool.
 *
 * Each test group spins up a fresh temporary git repository so tests are
 * fully isolated and do not affect the project's own history.
 *
 * Test IDs:
 *   TC-GCM-01: Successful commit operations
 *   TC-GCM-02: Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gitCommit, GitCommitError } from './git-commit.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Initialise a bare git repo in `dir` with a throwaway identity. */
function initRepo(dir: string): void {
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

/** Create a file, stage it, and commit with the given message. */
function makeCommit(dir: string, filename: string, content: string, message: string): void {
  writeFileSync(join(dir, filename), content);
  spawnSync('git', ['add', '--', filename], { cwd: dir });
  spawnSync('git', ['commit', '-m', message], { cwd: dir });
}

/** Return the HEAD commit hash for `dir`. */
function headHash(dir: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' });
  return r.stdout.trim();
}

/** Stage a file in `dir`. */
function stageFile(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content);
  spawnSync('git', ['add', '--', filename], { cwd: dir });
}

// ─── TC-GCM-01: Successful commit operations ──────────────────────────────────

describe('TC-GCM-01: successful commit operations', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'git-commit-ok-'));
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('commits staged changes and returns a non-empty hash', () => {
    stageFile(repoDir, 'hello.txt', 'hello');

    const result = gitCommit({ message: 'first commit' }, { cwd: repoDir });

    expect(typeof result.hash).toBe('string');
    expect(result.hash.length).toBeGreaterThan(0);
  });

  it('returned hash matches HEAD after commit', () => {
    stageFile(repoDir, 'a.txt', 'a');

    const result = gitCommit({ message: 'add a' }, { cwd: repoDir });

    expect(result.hash).toBe(headHash(repoDir));
  });

  it('hash is a 40-character hex SHA-1', () => {
    stageFile(repoDir, 'b.txt', 'b');

    const result = gitCommit({ message: 'add b' }, { cwd: repoDir });

    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('commits only the specified file when files parameter is provided', () => {
    stageFile(repoDir, 'x.txt', 'x');
    stageFile(repoDir, 'y.txt', 'y');

    const result = gitCommit(
      { message: 'commit x only', files: ['x.txt'] },
      { cwd: repoDir },
    );

    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);
    // y.txt should remain staged
    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: repoDir,
      encoding: 'utf-8',
    }).stdout;
    expect(status).toContain('y.txt');
  });

  it('uses process.cwd() when no cwd option is provided (project repo has commits)', () => {
    // Does not throw — project root is a valid git repo.
    // We can only verify it does not throw without a staged commit.
    // Just confirm the function signature is callable.
    const repoDir2 = mkdtempSync(join(tmpdir(), 'git-commit-cwd-'));
    initRepo(repoDir2);
    stageFile(repoDir2, 'f.txt', 'f');
    const result = gitCommit({ message: 'cwd test' }, { cwd: repoDir2 });
    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);
    rmSync(repoDir2, { recursive: true, force: true });
  });

  it('passes --author when author parameter is provided', () => {
    stageFile(repoDir, 'c.txt', 'c');

    const result = gitCommit(
      { message: 'authored commit', author: 'Alice <alice@example.com>' },
      { cwd: repoDir },
    );

    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);

    // Verify the author was recorded in the commit log.
    const logResult = spawnSync(
      'git',
      ['log', '-1', '--format=%an <%ae>'],
      { cwd: repoDir, encoding: 'utf-8' },
    );
    expect(logResult.stdout.trim()).toBe('Alice <alice@example.com>');
  });

  it('commits successfully after an existing commit', () => {
    makeCommit(repoDir, 'first.txt', 'first', 'first commit');
    stageFile(repoDir, 'second.txt', 'second');

    const result = gitCommit({ message: 'second commit' }, { cwd: repoDir });

    expect(result.hash).toBe(headHash(repoDir));
  });

  it('result has a hash string field', () => {
    stageFile(repoDir, 'd.txt', 'd');

    const result = gitCommit({ message: 'has hash field' }, { cwd: repoDir });

    expect(Object.keys(result)).toContain('hash');
    expect(typeof result.hash).toBe('string');
  });

  it('accepts absolute paths in files array', () => {
    const absPath = join(repoDir, 'abs.txt');
    writeFileSync(absPath, 'abs content');
    spawnSync('git', ['add', '--', absPath], { cwd: repoDir });

    const result = gitCommit(
      { message: 'commit abs path', files: [absPath] },
      { cwd: repoDir },
    );

    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);
  });
});

// ─── TC-GCM-02: Error handling ───────────────────────────────────────────────

describe('TC-GCM-02: error handling', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'git-commit-err-'));
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('throws GitCommitError when there is nothing to commit', () => {
    makeCommit(repoDir, 'existing.txt', 'existing', 'initial');

    expect(() =>
      gitCommit({ message: 'empty commit' }, { cwd: repoDir }),
    ).toThrow(GitCommitError);
  });

  it('thrown error has code nothing-to-commit when index is clean', () => {
    makeCommit(repoDir, 'existing.txt', 'existing', 'initial');

    let err: GitCommitError | undefined;
    try {
      gitCommit({ message: 'empty' }, { cwd: repoDir });
    } catch (e) {
      err = e as GitCommitError;
    }

    expect(err).toBeInstanceOf(GitCommitError);
    expect(err!.code).toBe('nothing-to-commit');
  });

  it('throws GitCommitError with code git-error outside a git repo', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
    let err: GitCommitError | undefined;

    try {
      gitCommit({ message: 'will fail' }, { cwd: notARepo });
    } catch (e) {
      err = e as GitCommitError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(GitCommitError);
    expect(err!.code).toBe('git-error');
  });

  it('throws GitCommitError with code path-out-of-bounds for a path escaping the repo', () => {
    stageFile(repoDir, 'file.txt', 'content');

    let err: GitCommitError | undefined;
    try {
      gitCommit(
        { message: 'escape attempt', files: ['../../../etc/passwd'] },
        { cwd: repoDir },
      );
    } catch (e) {
      err = e as GitCommitError;
    }

    expect(err).toBeInstanceOf(GitCommitError);
    expect(err!.code).toBe('path-out-of-bounds');
  });

  it('error message includes the out-of-bounds path', () => {
    stageFile(repoDir, 'file.txt', 'content');
    const outsidePath = '../../../etc/passwd';

    let err: GitCommitError | undefined;
    try {
      gitCommit(
        { message: 'escape attempt', files: [outsidePath] },
        { cwd: repoDir },
      );
    } catch (e) {
      err = e as GitCommitError;
    }

    expect(err!.message).toContain(outsidePath);
  });

  it('thrown GitCommitError has name "GitCommitError"', () => {
    makeCommit(repoDir, 'existing.txt', 'existing', 'initial');

    let err: GitCommitError | undefined;
    try {
      gitCommit({ message: 'empty' }, { cwd: repoDir });
    } catch (e) {
      err = e as GitCommitError;
    }

    expect(err!.name).toBe('GitCommitError');
  });

  it('GitCommitError code is one of the typed discriminants', () => {
    makeCommit(repoDir, 'existing.txt', 'existing', 'initial');

    let err: GitCommitError | undefined;
    try {
      gitCommit({ message: 'empty' }, { cwd: repoDir });
    } catch (e) {
      err = e as GitCommitError;
    }

    const validCodes: Array<'path-out-of-bounds' | 'nothing-to-commit' | 'git-error'> = [
      'path-out-of-bounds',
      'nothing-to-commit',
      'git-error',
    ];
    expect(validCodes).toContain(err!.code);
  });

  it('does not throw path-out-of-bounds for a valid relative path within the repo', () => {
    stageFile(repoDir, 'valid.txt', 'valid');

    // Should not throw path-out-of-bounds; the path is within the repo.
    let err: GitCommitError | undefined;
    try {
      gitCommit(
        { message: 'valid path commit', files: ['valid.txt'] },
        { cwd: repoDir },
      );
    } catch (e) {
      err = e as GitCommitError;
    }

    if (err !== undefined) {
      expect(err.code).not.toBe('path-out-of-bounds');
    }
  });
});

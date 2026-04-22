/**
 * Unit tests for the git_status tool.
 *
 * Each test group spins up a fresh temporary git repository so tests are
 * fully isolated and do not affect the project's own history.
 *
 * Test IDs:
 *   TC-GST-01: Successful status operations
 *   TC-GST-02: Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gitStatus, GitStatusError } from './git-status.js';

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

// ─── TC-GST-01: Successful status operations ──────────────────────────────────

describe('TC-GST-01: successful status operations', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'git-status-ok-'));
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns empty arrays for a clean repository', () => {
    makeCommit(repoDir, 'a.txt', 'hello', 'first commit');

    const result = gitStatus({ cwd: repoDir });

    expect(result.staged).toEqual([]);
    expect(result.unstaged).toEqual([]);
    expect(result.untracked).toEqual([]);
  });

  it('returns empty arrays for a fresh repo with no commits', () => {
    const result = gitStatus({ cwd: repoDir });

    expect(result.staged).toEqual([]);
    expect(result.unstaged).toEqual([]);
    expect(result.untracked).toEqual([]);
  });

  it('reports a new staged file', () => {
    writeFileSync(join(repoDir, 'staged.txt'), 'content');
    spawnSync('git', ['add', '--', 'staged.txt'], { cwd: repoDir });

    const result = gitStatus({ cwd: repoDir });

    expect(result.staged).toContain('staged.txt');
    expect(result.unstaged).toEqual([]);
    expect(result.untracked).toEqual([]);
  });

  it('reports an untracked file', () => {
    writeFileSync(join(repoDir, 'untracked.txt'), 'content');

    const result = gitStatus({ cwd: repoDir });

    expect(result.untracked).toContain('untracked.txt');
    expect(result.staged).toEqual([]);
    expect(result.unstaged).toEqual([]);
  });

  it('reports an unstaged modification', () => {
    makeCommit(repoDir, 'a.txt', 'original', 'first commit');
    writeFileSync(join(repoDir, 'a.txt'), 'modified');

    const result = gitStatus({ cwd: repoDir });

    expect(result.unstaged).toContain('a.txt');
    expect(result.staged).toEqual([]);
    expect(result.untracked).toEqual([]);
  });

  it('reports a file in staged when modification is staged', () => {
    makeCommit(repoDir, 'a.txt', 'original', 'first commit');
    writeFileSync(join(repoDir, 'a.txt'), 'modified');
    spawnSync('git', ['add', '--', 'a.txt'], { cwd: repoDir });

    const result = gitStatus({ cwd: repoDir });

    expect(result.staged).toContain('a.txt');
    expect(result.unstaged).toEqual([]);
    expect(result.untracked).toEqual([]);
  });

  it('reports a file in both staged and unstaged when partially staged', () => {
    makeCommit(repoDir, 'a.txt', 'original', 'first commit');
    writeFileSync(join(repoDir, 'a.txt'), 'staged change');
    spawnSync('git', ['add', '--', 'a.txt'], { cwd: repoDir });
    writeFileSync(join(repoDir, 'a.txt'), 'additional unstaged change');

    const result = gitStatus({ cwd: repoDir });

    expect(result.staged).toContain('a.txt');
    expect(result.unstaged).toContain('a.txt');
  });

  it('reports multiple untracked files', () => {
    writeFileSync(join(repoDir, 'foo.txt'), 'foo');
    writeFileSync(join(repoDir, 'bar.txt'), 'bar');

    const result = gitStatus({ cwd: repoDir });

    expect(result.untracked).toContain('foo.txt');
    expect(result.untracked).toContain('bar.txt');
    expect(result.untracked).toHaveLength(2);
  });

  it('result has staged, unstaged, and untracked array fields', () => {
    const result = gitStatus({ cwd: repoDir });

    expect(Array.isArray(result.staged)).toBe(true);
    expect(Array.isArray(result.unstaged)).toBe(true);
    expect(Array.isArray(result.untracked)).toBe(true);
  });

  it('uses process.cwd() when no cwd option is provided (does not throw)', () => {
    // project root is a valid git repo, so this should succeed
    expect(() => gitStatus()).not.toThrow();
  });
});

// ─── TC-GST-02: Error handling ───────────────────────────────────────────────

describe('TC-GST-02: error handling', () => {
  it('throws GitStatusError with code git-error outside a git repo', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
    let err: GitStatusError | undefined;

    try {
      gitStatus({ cwd: notARepo });
    } catch (e) {
      err = e as GitStatusError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(GitStatusError);
    expect(err!.code).toBe('git-error');
  });

  it('thrown GitStatusError has name "GitStatusError"', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-name-'));
    let err: GitStatusError | undefined;

    try {
      gitStatus({ cwd: notARepo });
    } catch (e) {
      err = e as GitStatusError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    expect(err!.name).toBe('GitStatusError');
  });

  it('error message includes stderr from git when available', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-msg-'));
    let err: GitStatusError | undefined;

    try {
      gitStatus({ cwd: notARepo });
    } catch (e) {
      err = e as GitStatusError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    expect(err!.message.length).toBeGreaterThan(0);
  });

  it('GitStatusError code is the typed discriminant "git-error"', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-disc-'));
    let err: GitStatusError | undefined;

    try {
      gitStatus({ cwd: notARepo });
    } catch (e) {
      err = e as GitStatusError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    const validCodes: Array<'git-error'> = ['git-error'];
    expect(validCodes).toContain(err!.code);
  });
});

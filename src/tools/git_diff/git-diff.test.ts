/**
 * Unit tests for the git_diff tool.
 *
 * Each test group spins up a fresh temporary git repository so tests are
 * fully isolated and do not affect the project's own history.
 *
 * Test IDs:
 *   TC-GDT-01: Successful diff operations
 *   TC-GDT-02: Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gitDiff, GitDiffError } from './git-diff.js';

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

/** Returns the HEAD commit hash for the repo at `dir`. */
function headHash(dir: string): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' });
  return result.stdout.trim();
}

// ─── TC-GDT-01: Successful diff operations ────────────────────────────────────

describe('TC-GDT-01: successful diff operations', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'git-diff-ok-'));
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns an empty diff string when working tree matches index', () => {
    makeCommit(repoDir, 'a.txt', 'hello', 'first commit');

    const result = gitDiff({}, { cwd: repoDir });

    expect(result.diff).toBe('');
  });

  it('returns non-empty diff string for unstaged modifications', () => {
    makeCommit(repoDir, 'a.txt', 'hello\n', 'first commit');
    writeFileSync(join(repoDir, 'a.txt'), 'hello world\n');

    const result = gitDiff({}, { cwd: repoDir });

    expect(result.diff.length).toBeGreaterThan(0);
    expect(result.diff).toContain('hello world');
  });

  it('diff string is in unified format (contains --- and +++ headers)', () => {
    makeCommit(repoDir, 'a.txt', 'hello\n', 'first commit');
    writeFileSync(join(repoDir, 'a.txt'), 'hello world\n');

    const { diff } = gitDiff({}, { cwd: repoDir });

    expect(diff).toContain('---');
    expect(diff).toContain('+++');
  });

  it('returns diff against specific commit ref', () => {
    makeCommit(repoDir, 'a.txt', 'version one\n', 'first commit');
    const firstHash = headHash(repoDir);
    makeCommit(repoDir, 'a.txt', 'version two\n', 'second commit');

    const result = gitDiff({ ref: firstHash }, { cwd: repoDir });

    expect(result.diff).toContain('version one');
    expect(result.diff).toContain('version two');
  });

  it('returns empty diff when ref matches current working tree state', () => {
    makeCommit(repoDir, 'a.txt', 'hello\n', 'first commit');
    const hash = headHash(repoDir);

    const result = gitDiff({ ref: hash }, { cwd: repoDir });

    expect(result.diff).toBe('');
  });

  it('filters diff by file path', () => {
    makeCommit(repoDir, 'alpha.txt', 'alpha\n', 'first commit');
    makeCommit(repoDir, 'beta.txt', 'beta\n', 'second commit');
    const firstHash = spawnSync(
      'git', ['rev-parse', 'HEAD~1'], { cwd: repoDir, encoding: 'utf-8' }
    ).stdout.trim();

    const result = gitDiff({ ref: firstHash, path: 'beta.txt' }, { cwd: repoDir });

    expect(result.diff).toContain('beta');
    expect(result.diff).not.toContain('alpha');
  });

  it('path filter returns empty diff when path has no changes vs ref', () => {
    makeCommit(repoDir, 'alpha.txt', 'alpha\n', 'first commit');
    makeCommit(repoDir, 'beta.txt', 'beta\n', 'second commit');
    const secondHash = headHash(repoDir);

    // alpha.txt did not change between secondHash and working tree
    const result = gitDiff({ ref: secondHash, path: 'alpha.txt' }, { cwd: repoDir });

    expect(result.diff).toBe('');
  });

  it('result object has a diff property', () => {
    makeCommit(repoDir, 'a.txt', 'a\n', 'first commit');

    const result = gitDiff({}, { cwd: repoDir });

    expect(result).toHaveProperty('diff');
    expect(typeof result.diff).toBe('string');
  });

  it('returns empty diff when params is omitted and working tree is clean', () => {
    makeCommit(repoDir, 'a.txt', 'a\n', 'first commit');

    const result = gitDiff(undefined, { cwd: repoDir });

    expect(result.diff).toBe('');
  });

  it('diff against ref includes added file contents', () => {
    makeCommit(repoDir, 'base.txt', 'base\n', 'base commit');
    const baseHash = headHash(repoDir);
    makeCommit(repoDir, 'new.txt', 'new file content\n', 'add new file');

    const result = gitDiff({ ref: baseHash }, { cwd: repoDir });

    expect(result.diff).toContain('new file content');
  });
});

// ─── TC-GDT-02: Error handling ───────────────────────────────────────────────

describe('TC-GDT-02: error handling', () => {
  it('throws GitDiffError with code git-error outside a git repo', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
    let err: GitDiffError | undefined;

    try {
      gitDiff({}, { cwd: notARepo });
    } catch (e) {
      err = e as GitDiffError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(GitDiffError);
    expect(err!.code).toBe('git-error');
  });

  it('thrown GitDiffError has name "GitDiffError"', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-name-'));
    let err: GitDiffError | undefined;

    try {
      gitDiff({}, { cwd: notARepo });
    } catch (e) {
      err = e as GitDiffError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    expect(err!.name).toBe('GitDiffError');
  });

  it('error message includes stderr from git when available', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-msg-'));
    let err: GitDiffError | undefined;

    try {
      gitDiff({}, { cwd: notARepo });
    } catch (e) {
      err = e as GitDiffError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    expect(err!.message.length).toBeGreaterThan(0);
  });

  it('throws GitDiffError when ref is an invalid commit', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'git-diff-bad-ref-'));
    let err: GitDiffError | undefined;

    try {
      initRepo(repoDir);
      writeFileSync(join(repoDir, 'a.txt'), 'a');
      spawnSync('git', ['add', 'a.txt'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

      gitDiff({ ref: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }, { cwd: repoDir });
    } catch (e) {
      err = e as GitDiffError;
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(GitDiffError);
    expect(err!.code).toBe('git-error');
  });

  it('GitDiffError code is the typed discriminant "git-error"', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-disc-'));
    let err: GitDiffError | undefined;

    try {
      gitDiff({}, { cwd: notARepo });
    } catch (e) {
      err = e as GitDiffError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    const validCodes: Array<'git-error'> = ['git-error'];
    expect(validCodes).toContain(err!.code);
  });
});

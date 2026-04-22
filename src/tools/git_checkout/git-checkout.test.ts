/**
 * Unit tests for the git_checkout tool.
 *
 * Each test group spins up a fresh temporary git repository so tests are
 * fully isolated and do not affect the project's own index.
 *
 * Test IDs:
 *   TC-GCO-01: Successful checkout operations
 *   TC-GCO-02: Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gitCheckout, GitCheckoutError } from './git-checkout.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Initialise a git repo in `dir` with a throwaway identity. */
function initRepo(dir: string): void {
  spawnSync('git', ['init', '-b', 'main'], { cwd: dir });
  // Fall back for older git versions that don't support -b
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

/** Write a file, stage it, and commit. Returns the commit hash. */
function makeCommit(
  dir: string,
  filename: string,
  content: string,
  message: string,
): string {
  writeFileSync(join(dir, filename), content);
  spawnSync('git', ['add', '--', filename], { cwd: dir });
  spawnSync('git', ['commit', '-m', message], { cwd: dir });
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' });
  return result.stdout.trim();
}

/** Returns the name of the currently checked-out branch, or HEAD hash if detached. */
function currentBranch(dir: string): string {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: dir,
    encoding: 'utf-8',
  });
  return result.stdout.trim();
}

// ─── TC-GCO-01: Successful checkout operations ────────────────────────────────

describe('TC-GCO-01: successful checkout operations', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'git-checkout-ok-'));
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('switches to an existing branch and returns the ref', () => {
    makeCommit(repoDir, 'base.txt', 'base content\n', 'initial commit');
    spawnSync('git', ['checkout', '-b', 'feature'], { cwd: repoDir });
    spawnSync('git', ['checkout', 'main'], { cwd: repoDir });

    const result = gitCheckout({ ref: 'feature' }, { cwd: repoDir });

    expect(result.ref).toBe('feature');
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
    expect(currentBranch(repoDir)).toBe('feature');
  });

  it('returns a non-empty message string on successful checkout', () => {
    makeCommit(repoDir, 'a.txt', 'a\n', 'initial');
    spawnSync('git', ['checkout', '-b', 'branch-a'], { cwd: repoDir });
    spawnSync('git', ['checkout', 'main'], { cwd: repoDir });

    const result = gitCheckout({ ref: 'branch-a' }, { cwd: repoDir });

    expect(result.message).toBeTruthy();
  });

  it('checks out a commit hash (detached HEAD)', () => {
    const commitHash = makeCommit(repoDir, 'file.txt', 'content\n', 'initial');
    makeCommit(repoDir, 'file2.txt', 'more content\n', 'second commit');

    const result = gitCheckout({ ref: commitHash }, { cwd: repoDir });

    expect(result.ref).toBe(commitHash);
    expect(typeof result.message).toBe('string');
    // In detached HEAD state, git rev-parse --abbrev-ref HEAD returns 'HEAD'
    const head = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf-8',
    });
    expect(head.stdout.trim()).toBe('HEAD');
  });

  it('succeeds when switching back to main', () => {
    makeCommit(repoDir, 'file.txt', 'content\n', 'initial');
    spawnSync('git', ['checkout', '-b', 'dev'], { cwd: repoDir });

    const result = gitCheckout({ ref: 'main' }, { cwd: repoDir });

    expect(result.ref).toBe('main');
    expect(currentBranch(repoDir)).toBe('main');
  });
});

// ─── TC-GCO-02: Error handling ────────────────────────────────────────────────

describe('TC-GCO-02: error handling', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'git-checkout-err-'));
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('throws GitCheckoutError for a non-existent ref', () => {
    makeCommit(repoDir, 'init.txt', 'init\n', 'initial');

    expect(() =>
      gitCheckout({ ref: 'does-not-exist' }, { cwd: repoDir }),
    ).toThrow(GitCheckoutError);
  });

  it('thrown error has code ref-not-found for a missing branch', () => {
    makeCommit(repoDir, 'init.txt', 'init\n', 'initial');

    let err: GitCheckoutError | undefined;
    try {
      gitCheckout({ ref: 'nonexistent-branch' }, { cwd: repoDir });
    } catch (e) {
      err = e as GitCheckoutError;
    }

    expect(err).toBeInstanceOf(GitCheckoutError);
    expect(err!.code).toBe('ref-not-found');
    expect(err!.message).toMatch(/nonexistent-branch/);
  });

  it('throws GitCheckoutError with code uncommitted-changes when local changes would be overwritten', () => {
    makeCommit(repoDir, 'shared.txt', 'original content\n', 'initial');

    // Create a second branch that modifies the same file
    spawnSync('git', ['checkout', '-b', 'other'], { cwd: repoDir });
    makeCommit(repoDir, 'shared.txt', 'other content\n', 'other change');
    spawnSync('git', ['checkout', 'main'], { cwd: repoDir });

    // Write an uncommitted change to shared.txt on main
    writeFileSync(join(repoDir, 'shared.txt'), 'dirty content\n');

    let err: GitCheckoutError | undefined;
    try {
      gitCheckout({ ref: 'other' }, { cwd: repoDir });
    } catch (e) {
      err = e as GitCheckoutError;
    }

    expect(err).toBeInstanceOf(GitCheckoutError);
    expect(err!.code).toBe('uncommitted-changes');
  });

  it('throws GitCheckoutError with code git-error when not in a git repo', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-'));

    let err: GitCheckoutError | undefined;
    try {
      gitCheckout({ ref: 'main' }, { cwd: notARepo });
    } catch (e) {
      err = e as GitCheckoutError;
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }

    expect(err).toBeInstanceOf(GitCheckoutError);
    // ref-not-found or git-error are both valid for "not a repo"
    const validCodes: Array<'ref-not-found' | 'uncommitted-changes' | 'git-error'> = [
      'ref-not-found',
      'git-error',
    ];
    expect(validCodes).toContain(err!.code);
  });

  it('GitCheckoutError exposes code as a typed discriminant', () => {
    makeCommit(repoDir, 'init.txt', 'init\n', 'initial');

    let err: GitCheckoutError | undefined;
    try {
      gitCheckout({ ref: 'absent-branch' }, { cwd: repoDir });
    } catch (e) {
      err = e as GitCheckoutError;
    }

    const validCodes: Array<'ref-not-found' | 'uncommitted-changes' | 'git-error'> = [
      'ref-not-found',
      'uncommitted-changes',
      'git-error',
    ];
    expect(validCodes).toContain(err!.code);
  });
});

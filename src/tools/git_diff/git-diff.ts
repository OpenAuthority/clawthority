/**
 * git_diff tool implementation.
 *
 * Returns unified diff output for a git repository by invoking
 * `git diff [ref] [-- path]` via `spawnSync`. Arguments are passed directly
 * to the child process — no shell interpolation occurs.
 *
 * Action class: vcs.read
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the git_diff tool. */
export interface GitDiffParams {
  /** Commit ref to diff against. Omit to diff working tree against the index. */
  ref?: string;
  /** Restrict diff output to this file path. */
  path?: string;
}

/** Successful result from the git_diff tool. */
export interface GitDiffResult {
  /** Unified diff output. Empty string when there are no differences. */
  diff: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `gitDiff`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `git-error` — `git diff` exited with a non-zero status.
 */
export class GitDiffError extends Error {
  constructor(
    message: string,
    public readonly code: 'git-error',
  ) {
    super(message);
    this.name = 'GitDiffError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns unified diff output from the git repository rooted at `options.cwd`.
 *
 * When `params.ref` is provided, diffs the working tree against that commit.
 * When omitted, diffs the working tree against the index (unstaged changes).
 * When `params.path` is provided, restricts the diff to that file path.
 *
 * Uses `spawnSync` with an explicit argument array — no shell is involved,
 * so path and ref strings containing spaces or special characters are safe.
 *
 * @param params          `{ ref?, path? }` — optional constraints.
 * @param options.cwd     Working directory for `git diff`. Defaults to
 *                        `process.cwd()` when omitted.
 * @returns               `{ diff }` — unified diff string, empty when no changes.
 *
 * @throws {GitDiffError}  code `git-error` when git exits non-zero.
 */
export function gitDiff(
  params: GitDiffParams = {},
  options: { cwd?: string } = {},
): GitDiffResult {
  const { ref, path } = params;
  const effectiveCwd = options.cwd ?? process.cwd();

  const args: string[] = ['diff'];

  if (ref !== undefined && ref !== '') {
    args.push(ref);
  }

  if (path !== undefined && path !== '') {
    args.push('--', path);
  }

  const result = spawnSync('git', args, {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    const stderr =
      typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new GitDiffError(
      stderr !== ''
        ? `git diff failed: ${stderr}`
        : 'git diff exited with a non-zero status.',
      'git-error',
    );
  }

  const diff = typeof result.stdout === 'string' ? result.stdout : '';
  return { diff };
}

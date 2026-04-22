/**
 * git_checkout tool implementation.
 *
 * Switches the working directory to a specified branch or commit in a git
 * repository by invoking `git checkout <ref>` via `spawnSync`. Arguments are
 * passed directly to the child process — no shell interpolation occurs.
 *
 * Action class: vcs.write
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the git_checkout tool. */
export interface GitCheckoutParams {
  /** Branch name or commit hash to check out. */
  ref: string;
}

/** Successful result from the git_checkout tool. */
export interface GitCheckoutResult {
  /** The ref that was checked out. */
  ref: string;
  /** Human-readable status message from git checkout. */
  message: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `gitCheckout`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `ref-not-found`        — the specified branch or commit does not exist.
 * - `uncommitted-changes`  — uncommitted changes would be overwritten by checkout.
 * - `git-error`            — `git checkout` exited with a non-zero status for another reason.
 */
export class GitCheckoutError extends Error {
  constructor(
    message: string,
    public readonly code: 'ref-not-found' | 'uncommitted-changes' | 'git-error',
  ) {
    super(message);
    this.name = 'GitCheckoutError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks out the specified branch or commit via `git checkout <ref>`.
 *
 * Uses `spawnSync` with an explicit argument array — no shell is involved,
 * so ref names containing special characters are safe.
 *
 * @param params          `{ ref }` — branch name or commit hash to check out.
 * @param options.cwd     Working directory for `git checkout`. Defaults to
 *                        `process.cwd()` when omitted.
 * @returns               `{ ref, message }` on a successful checkout.
 *
 * @throws {GitCheckoutError}  code `ref-not-found` when the ref does not exist.
 * @throws {GitCheckoutError}  code `uncommitted-changes` when local changes would be overwritten.
 * @throws {GitCheckoutError}  code `git-error` when git exits non-zero for another reason.
 */
export function gitCheckout(
  params: GitCheckoutParams,
  options: { cwd?: string } = {},
): GitCheckoutResult {
  const { ref } = params;
  const effectiveCwd = options.cwd ?? process.cwd();

  const result = spawnSync('git', ['checkout', ref], {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  if (result.status === 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const message =
      stderr !== ''
        ? stderr
        : typeof result.stdout === 'string' && result.stdout.trim() !== ''
          ? result.stdout.trim()
          : `Switched to '${ref}'.`;
    return { ref, message };
  }

  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';

  // Uncommitted changes would be overwritten.
  if (
    stderr.includes('Your local changes to the following files would be overwritten') ||
    stderr.includes('local changes would be overwritten') ||
    stderr.includes('Please commit your changes or stash them')
  ) {
    throw new GitCheckoutError(
      `Cannot switch to '${ref}': uncommitted changes would be overwritten. Commit or stash them first.`,
      'uncommitted-changes',
    );
  }

  // Ref not found: pathspec did not match any known ref.
  if (
    stderr.includes('did not match any') ||
    stderr.includes('pathspec') ||
    (result.status === 128 && (stderr.includes('unknown revision') || stderr.includes('not found')))
  ) {
    throw new GitCheckoutError(`Ref not found: '${ref}'`, 'ref-not-found');
  }

  // Generic git error.
  throw new GitCheckoutError(
    stderr !== ''
      ? `git checkout failed: ${stderr}`
      : 'git checkout exited with a non-zero status.',
    'git-error',
  );
}

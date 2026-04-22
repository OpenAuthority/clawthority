/**
 * git_status tool — reports the current state of the git working tree.
 *
 * Executes `git status --porcelain` and parses the XY status codes into
 * three disjoint lists: staged, unstaged, and untracked files.
 *
 * Action class: vcs.read
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Successful result from the git_status tool. */
export interface GitStatusResult {
  /** Files with changes staged for the next commit. */
  staged: string[];
  /** Files with changes in the working tree not yet staged. */
  unstaged: string[];
  /** Files not tracked by git. */
  untracked: string[];
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `gitStatus`.
 * The `code` discriminant lets callers branch on error type without string-matching.
 */
export class GitStatusError extends Error {
  constructor(
    message: string,
    public readonly code: 'git-error',
  ) {
    super(message);
    this.name = 'GitStatusError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the current git repository status from the repo rooted at `options.cwd`.
 *
 * Parses `git status --porcelain` XY codes:
 * - X (index column): staged changes
 * - Y (working-tree column): unstaged changes
 * - `??`: untracked files
 *
 * A file that is both staged and has additional unstaged changes appears in
 * both the `staged` and `unstaged` lists.
 */
export function gitStatus(options: { cwd?: string } = {}): GitStatusResult {
  const effectiveCwd = options.cwd ?? process.cwd();

  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    const stderr =
      typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new GitStatusError(
      stderr !== ''
        ? `git status failed: ${stderr}`
        : 'git status exited with a non-zero status.',
      'git-error',
    );
  }

  const output = typeof result.stdout === 'string' ? result.stdout : '';

  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of output.split('\n')) {
    if (line.length < 3) continue;

    const x = line[0]; // index (staged) status
    const y = line[1]; // working-tree (unstaged) status
    const file = line.slice(3); // filename starts at column 3

    if (x === '?' && y === '?') {
      untracked.push(file);
      continue;
    }

    if (x !== ' ' && x !== '?') {
      staged.push(file);
    }

    if (y !== ' ' && y !== '?') {
      unstaged.push(file);
    }
  }

  return { staged, unstaged, untracked };
}

/**
 * git_commit tool implementation.
 *
 * Creates a commit in the current git repository by invoking
 * `git commit -m <message>` via `spawnSync`. Arguments are passed directly
 * to the child process — no shell interpolation occurs.
 *
 * Supports optional per-file path specs, custom author identity, and GPG
 * signing. All supplied file paths are validated to lie within the
 * repository root before git is invoked.
 *
 * Action class: vcs.write
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve, isAbsolute, sep } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the git_commit tool. */
export interface GitCommitParams {
  /** Commit message. */
  message: string;
  /** Specific files to commit. When omitted, commits all staged changes. */
  files?: string[];
  /**
   * Override the commit author in `Name <email>` format.
   * Passed as `--author=<author>` to git.
   */
  author?: string;
  /** When true, GPG-sign the commit via the `-S` flag. */
  sign?: boolean;
}

/** Successful result from the git_commit tool. */
export interface GitCommitResult {
  /** SHA-1 hash of the newly created commit. */
  hash: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `gitCommit`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `path-out-of-bounds` — a file path escapes the repository root.
 * - `nothing-to-commit`  — no staged changes exist to commit.
 * - `git-error`          — `git commit` exited with a non-zero status for another reason.
 */
export class GitCommitError extends Error {
  constructor(
    message: string,
    public readonly code: 'path-out-of-bounds' | 'nothing-to-commit' | 'git-error',
  ) {
    super(message);
    this.name = 'GitCommitError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns the canonical (symlink-resolved) absolute path of the repository
 * root from `cwd`, or `null` when `cwd` is not inside a git repository.
 */
function getRepoRoot(cwd: string): string | null {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf-8',
  });
  if (result.status !== 0) return null;
  const raw = result.stdout.trim();
  try {
    return realpathSync(raw);
  } catch {
    return resolve(raw);
  }
}

/**
 * Resolves `p` to an absolute path relative to `cwd`, then canonicalises
 * it via `realpathSync` so that symlinks (e.g. macOS `/var` → `/private/var`)
 * do not cause false out-of-bounds rejections.
 */
function resolveCanonical(p: string, cwd: string): string {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  try {
    return realpathSync(abs);
  } catch {
    // File may not exist on disk yet; fall back to lexical resolution.
    return resolve(abs);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a git commit in the repository rooted at `options.cwd`.
 *
 * When `params.files` is non-empty each path is validated to lie within the
 * repository root before being forwarded to git as a path spec. Absolute and
 * relative paths are both accepted.
 *
 * Uses `spawnSync` with an explicit argument array — no shell is involved,
 * so strings containing spaces or special characters are safe.
 *
 * @param params               Tool parameters (see {@link GitCommitParams}).
 * @param options.cwd          Working directory for git. Defaults to `process.cwd()`.
 * @returns                    `{ hash }` — the SHA-1 of the new commit.
 *
 * @throws {GitCommitError}  code `path-out-of-bounds` when a file escapes the repo root.
 * @throws {GitCommitError}  code `nothing-to-commit` when there is nothing staged.
 * @throws {GitCommitError}  code `git-error` when git exits non-zero for another reason.
 */
export function gitCommit(
  params: GitCommitParams,
  options: { cwd?: string } = {},
): GitCommitResult {
  const { message, files = [], author, sign = false } = params;
  const effectiveCwd = options.cwd ?? process.cwd();

  // Validate all file paths are within the repository root.
  if (files.length > 0) {
    const repoRoot = getRepoRoot(effectiveCwd);
    if (repoRoot === null) {
      throw new GitCommitError(
        'Not a git repository (or git rev-parse failed).',
        'git-error',
      );
    }
    const rootPrefix = repoRoot + sep;
    for (const file of files) {
      const abs = resolveCanonical(file, effectiveCwd);
      if (abs !== repoRoot && !abs.startsWith(rootPrefix)) {
        throw new GitCommitError(
          `Path is outside the repository root: ${file}`,
          'path-out-of-bounds',
        );
      }
    }
  }

  // Build the git argument list.
  const args: string[] = ['commit'];
  if (sign) args.push('-S');
  args.push('-m', message);
  if (author !== undefined) args.push(`--author=${author}`);
  if (files.length > 0) args.push('--', ...files);

  const result = spawnSync('git', args, {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const combined = stdout + stderr;

    if (
      combined.includes('nothing to commit') ||
      combined.includes('nothing added to commit')
    ) {
      throw new GitCommitError('Nothing to commit.', 'nothing-to-commit');
    }

    throw new GitCommitError(
      stderr !== ''
        ? `git commit failed: ${stderr}`
        : 'git commit exited with a non-zero status.',
      'git-error',
    );
  }

  // Retrieve the hash of the commit that was just created.
  const hashResult = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  const hash =
    typeof hashResult.stdout === 'string' ? hashResult.stdout.trim() : '';

  return { hash };
}

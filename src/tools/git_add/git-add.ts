/**
 * git_add tool implementation.
 *
 * Stages specified file paths or glob patterns for commit in a git repository
 * by invoking `git add -- <paths>` via `spawnSync`. Arguments are passed
 * directly to the child process — no shell interpolation occurs.
 *
 * Action class: vcs.write
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the git_add tool. */
export interface GitAddParams {
  /** File paths or glob patterns to stage for commit. */
  paths: string[];
}

/** Successful result from the git_add tool. */
export interface GitAddResult {
  /** The paths that were passed to `git add`. */
  stagedPaths: string[];
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `gitAdd`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `path-not-found` — a non-glob path does not exist on the filesystem.
 * - `git-error`      — `git add` exited with a non-zero status.
 */
export class GitAddError extends Error {
  constructor(
    message: string,
    public readonly code: 'path-not-found' | 'git-error',
  ) {
    super(message);
    this.name = 'GitAddError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Returns true when the path string contains glob metacharacters. */
function isGlobPattern(p: string): boolean {
  return p.includes('*') || p.includes('?') || p.includes('[');
}

/**
 * Resolves a path for the existence check, honouring the effective `cwd`.
 * Absolute paths are returned as-is.
 */
function resolveForCheck(p: string, cwd: string): string {
  return isAbsolute(p) ? p : resolve(cwd, p);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Stages the specified paths for commit via `git add -- <paths>`.
 *
 * Non-glob paths are validated for existence (relative to `options.cwd`)
 * before invoking git. Glob patterns bypass the existence check because
 * their resolution is delegated to git.
 *
 * Uses `spawnSync` with an explicit argument array — no shell is involved,
 * so path strings containing spaces or special characters are safe.
 *
 * @param params          `{ paths }` — paths or globs to stage.
 * @param options.cwd     Working directory for `git add`. Defaults to
 *                        `process.cwd()` when omitted.
 * @returns               `{ stagedPaths }` equal to the input `paths`.
 *
 * @throws {GitAddError}  code `path-not-found` when a concrete path is absent.
 * @throws {GitAddError}  code `git-error` when git exits non-zero.
 */
export function gitAdd(
  params: GitAddParams,
  options: { cwd?: string } = {},
): GitAddResult {
  const { paths } = params;

  if (paths.length === 0) {
    return { stagedPaths: [] };
  }

  const effectiveCwd = options.cwd ?? process.cwd();

  // Validate existence for concrete (non-glob) paths before touching git.
  for (const p of paths) {
    if (!isGlobPattern(p) && !existsSync(resolveForCheck(p, effectiveCwd))) {
      throw new GitAddError(`Path not found: ${p}`, 'path-not-found');
    }
  }

  const result = spawnSync('git', ['add', '--', ...paths], {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    const stderr =
      typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new GitAddError(
      stderr !== ''
        ? `git add failed: ${stderr}`
        : 'git add exited with a non-zero status.',
      'git-error',
    );
  }

  return { stagedPaths: paths };
}

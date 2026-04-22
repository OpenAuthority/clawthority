/**
 * list_dir tool implementation.
 *
 * Returns an array of file and directory names in the specified path.
 * Supports optional recursive traversal of subdirectories.
 *
 * Action class: filesystem.list
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the list_dir tool. */
export interface ListDirParams {
  /** Directory path to list. */
  path: string;
  /** When true, recursively list subdirectories. Defaults to false. */
  recursive?: boolean;
}

/** Successful result from the list_dir tool. */
export interface ListDirResult {
  /** Array of file and directory names (or relative paths when recursive). */
  entries: string[];
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `listDir`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `not-found`   — the specified path does not exist.
 * - `not-a-dir`   — the specified path exists but is not a directory.
 * - `fs-error`    — an unexpected filesystem error occurred.
 */
export class ListDirError extends Error {
  constructor(
    message: string,
    public readonly code: 'not-found' | 'not-a-dir' | 'fs-error',
  ) {
    super(message);
    this.name = 'ListDirError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Recursively collects entries relative to `base`, appending to `results`.
 * Each subdirectory entry is included alongside its children.
 */
function collectRecursive(base: string, prefix: string, results: string[]): void {
  const names = readdirSync(join(base, prefix));
  for (const name of names) {
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    results.push(rel);
    try {
      const st = statSync(join(base, rel));
      if (st.isDirectory()) {
        collectRecursive(base, rel, results);
      }
    } catch {
      // If stat fails for an entry, skip recursion into it but keep the entry.
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Lists the contents of a directory.
 *
 * - Flat mode (default): returns the immediate children of `params.path`.
 * - Recursive mode: returns all descendants as relative paths (e.g. `"sub/file.txt"`).
 *
 * Uses `readdirSync` — no shell is involved, so paths with spaces or special
 * characters are safe.
 *
 * @param params          `{ path, recursive? }` — directory to list.
 * @returns               `{ entries }` — array of names or relative paths.
 *
 * @throws {ListDirError} code `not-found` when `path` does not exist.
 * @throws {ListDirError} code `not-a-dir` when `path` is not a directory.
 * @throws {ListDirError} code `fs-error` for unexpected filesystem errors.
 */
export function listDir(params: ListDirParams): ListDirResult {
  const { path, recursive = false } = params;

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ListDirError(`Directory not found: ${path}`, 'not-found');
    }
    throw new ListDirError(
      `Failed to access path: ${path}`,
      'fs-error',
    );
  }

  if (!stat.isDirectory()) {
    throw new ListDirError(`Path is not a directory: ${path}`, 'not-a-dir');
  }

  try {
    if (!recursive) {
      const entries = readdirSync(path);
      return { entries };
    }

    const entries: string[] = [];
    collectRecursive(path, '', entries);
    return { entries };
  } catch (err: unknown) {
    if (err instanceof ListDirError) throw err;
    throw new ListDirError(
      `Failed to read directory: ${path}`,
      'fs-error',
    );
  }
}

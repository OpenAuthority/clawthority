/**
 * check_exists tool implementation.
 *
 * Checks whether a given path exists in the filesystem, returning a boolean
 * result for both files and directories without throwing for missing paths.
 *
 * Action class: filesystem.read
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the check_exists tool. */
export interface CheckExistsParams {
  /** Absolute path to check for existence. */
  path: string;
}

/** Successful result from the check_exists tool. */
export interface CheckExistsResult {
  /** Whether the path exists in the filesystem. */
  exists: boolean;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `checkExists`.
 *
 * - `fs-error` — an unexpected filesystem error occurred.
 */
export class CheckExistsError extends Error {
  constructor(
    message: string,
    public readonly code: 'fs-error',
  ) {
    super(message);
    this.name = 'CheckExistsError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether a path exists in the filesystem.
 *
 * Returns `{ exists: true }` for any existing path (file or directory) and
 * `{ exists: false }` for any path that does not exist. Does not throw for
 * missing paths.
 *
 * @param params  `{ path }` — absolute path to check.
 * @returns       `{ exists }` — whether the path exists.
 *
 * @throws {CheckExistsError} code `fs-error` for unexpected filesystem errors.
 */
export function checkExists(params: CheckExistsParams): CheckExistsResult {
  const resolvedPath = resolve(params.path);

  try {
    const exists = existsSync(resolvedPath);
    return { exists };
  } catch (err: unknown) {
    throw new CheckExistsError(
      `Failed to access path: ${resolvedPath}`,
      'fs-error',
    );
  }
}

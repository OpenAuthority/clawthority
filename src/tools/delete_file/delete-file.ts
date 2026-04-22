/**
 * delete_file tool implementation.
 *
 * Removes a file or empty directory at the specified path.
 * Recursive deletion and trash/recycle-bin moves are out of scope.
 *
 * Action class: filesystem.delete
 */

import { statSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, normalize } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the delete_file tool. */
export interface DeleteFileParams {
  /** Path of the file or empty directory to delete. */
  path: string;
}

/** Successful result from the delete_file tool. */
export interface DeleteFileResult {
  /** Absolute path of the deleted file or directory. */
  path: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `deleteFile`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `not-found`  — the path does not exist.
 * - `forbidden`  — the path is a protected critical system path.
 * - `not-empty`  — the path is a non-empty directory.
 * - `fs-error`   — an unexpected filesystem error occurred during deletion.
 */
export class DeleteFileError extends Error {
  constructor(
    message: string,
    public readonly code: 'not-found' | 'forbidden' | 'not-empty' | 'fs-error',
  ) {
    super(message);
    this.name = 'DeleteFileError';
  }
}

// ─── Safety ───────────────────────────────────────────────────────────────────

/**
 * Set of resolved absolute paths that must never be deleted.
 * Covers root, core OS directories, and macOS-specific system paths.
 */
const FORBIDDEN_PATHS = new Set<string>([
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/home',
  '/lib',
  '/lib64',
  '/opt',
  '/proc',
  '/root',
  '/run',
  '/sbin',
  '/srv',
  '/sys',
  '/tmp',
  '/usr',
  '/usr/bin',
  '/usr/lib',
  '/usr/local',
  '/usr/local/bin',
  '/usr/sbin',
  '/var',
  // macOS
  '/Applications',
  '/Library',
  '/Network',
  '/System',
  '/Users',
  '/Volumes',
  '/private',
  '/private/etc',
  '/private/tmp',
  '/private/var',
  // Windows (normalised to forward-slash form won't match, but keep for clarity)
  'C:\\',
  'C:\\Windows',
  'C:\\Windows\\System32',
]);

/**
 * Returns true if `resolvedPath` is a protected system path that must not
 * be deleted.
 */
function isForbidden(resolvedPath: string): boolean {
  return FORBIDDEN_PATHS.has(normalize(resolvedPath));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Deletes the file or empty directory at `path`.
 *
 * Uses `unlinkSync` for regular files and `rmdirSync` for directories.
 * Recursive deletion is not supported — non-empty directories will cause a
 * `not-empty` error to be thrown rather than silently deleting content.
 *
 * @param params                `{ path }` — path to the target to delete.
 * @returns                     `{ path }` — absolute path of the deleted target.
 *
 * @throws {DeleteFileError}    code `not-found`  when the path does not exist.
 * @throws {DeleteFileError}    code `forbidden`  when the path is a protected system path.
 * @throws {DeleteFileError}    code `not-empty`  when the path is a non-empty directory.
 * @throws {DeleteFileError}    code `fs-error`   for unexpected filesystem errors.
 */
export function deleteFile(params: DeleteFileParams): DeleteFileResult {
  const resolvedPath = resolve(params.path);

  // Safety check: reject protected system paths before touching the filesystem.
  if (isForbidden(resolvedPath)) {
    throw new DeleteFileError(
      `Deletion of protected system path is not allowed: ${resolvedPath}`,
      'forbidden',
    );
  }

  // Stat the path to determine whether it exists and what type it is.
  let isDirectory: boolean;
  try {
    const stat = statSync(resolvedPath);
    isDirectory = stat.isDirectory();
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new DeleteFileError(
        `Path not found: ${resolvedPath}`,
        'not-found',
      );
    }
    throw new DeleteFileError(
      `Failed to access path: ${resolvedPath}`,
      'fs-error',
    );
  }

  if (isDirectory) {
    // Delete the empty directory.
    try {
      rmdirSync(resolvedPath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOTEMPTY' || code === 'EEXIST') {
        throw new DeleteFileError(
          `Directory is not empty: ${resolvedPath}`,
          'not-empty',
        );
      }
      throw new DeleteFileError(
        `Failed to delete directory: ${resolvedPath}`,
        'fs-error',
      );
    }
  } else {
    // Delete the file.
    try {
      unlinkSync(resolvedPath);
    } catch {
      throw new DeleteFileError(
        `Failed to delete file: ${resolvedPath}`,
        'fs-error',
      );
    }
  }

  return { path: resolvedPath };
}

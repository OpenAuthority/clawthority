/**
 * copy_file tool implementation.
 *
 * Copies a file from a source path to a destination path.
 * The source file remains unchanged after the operation.
 *
 * Action class: filesystem.write
 */

import { copyFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the copy_file tool. */
export interface CopyFileParams {
  /** Path of the source file to copy. */
  from: string;
  /** Path of the destination file. */
  to: string;
}

/** Successful result from the copy_file tool. */
export interface CopyFileResult {
  /** Absolute path of the source file. */
  from: string;
  /** Absolute path of the destination file. */
  to: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `copyFile`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `not-found`  — the source path does not exist.
 * - `not-a-file` — the source path exists but is a directory, not a file.
 * - `fs-error`   — an unexpected filesystem error occurred during the copy.
 */
export class CopyFileError extends Error {
  constructor(
    message: string,
    public readonly code: 'not-found' | 'not-a-file' | 'fs-error',
  ) {
    super(message);
    this.name = 'CopyFileError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Copies a file from `from` to `to`.
 *
 * Uses `copyFileSync` for an atomic, OS-optimized copy. The source file is
 * left unchanged. The destination file is created or overwritten.
 *
 * @param params             `{ from, to }` — source and destination paths.
 * @returns                  `{ from, to }` — resolved absolute paths.
 *
 * @throws {CopyFileError}   code `not-found`  when the source path does not exist.
 * @throws {CopyFileError}   code `not-a-file` when the source path is a directory.
 * @throws {CopyFileError}   code `fs-error`   for unexpected filesystem errors.
 */
export function copyFile(params: CopyFileParams): CopyFileResult {
  const resolvedFrom = resolve(params.from);
  const resolvedTo = resolve(params.to);

  // Validate source path exists and is a file.
  try {
    const stat = statSync(resolvedFrom);
    if (!stat.isFile()) {
      throw new CopyFileError(
        `Source path exists but is not a file: ${resolvedFrom}`,
        'not-a-file',
      );
    }
  } catch (err: unknown) {
    if (err instanceof CopyFileError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new CopyFileError(
        `Source file not found: ${resolvedFrom}`,
        'not-found',
      );
    }
    throw new CopyFileError(
      `Failed to access source path: ${resolvedFrom}`,
      'fs-error',
    );
  }

  // Perform the copy.
  try {
    copyFileSync(resolvedFrom, resolvedTo);
  } catch {
    throw new CopyFileError(
      `Failed to copy file from ${resolvedFrom} to ${resolvedTo}`,
      'fs-error',
    );
  }

  return { from: resolvedFrom, to: resolvedTo };
}

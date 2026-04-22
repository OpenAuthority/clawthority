/**
 * write_file tool implementation.
 *
 * Writes UTF-8 text content to a file, creating the file (and any missing
 * parent directories) if it does not exist, or overwriting it if it does.
 *
 * Action class: filesystem.write
 */

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the write_file tool. */
export interface WriteFileParams {
  /** Path to the file to write. */
  path: string;
  /** UTF-8 text content to write to the file. */
  content: string;
}

/** Successful result from the write_file tool. */
export interface WriteFileResult {
  /** Absolute path of the written file. */
  path: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `writeFile`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `not-a-file` — the specified path exists but is a directory.
 * - `fs-error`   — an unexpected filesystem error occurred while writing.
 */
export class WriteFileError extends Error {
  constructor(
    message: string,
    public readonly code: 'not-a-file' | 'fs-error',
  ) {
    super(message);
    this.name = 'WriteFileError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Writes UTF-8 text content to a file.
 *
 * Creates the file and any missing parent directories if they do not exist.
 * Overwrites the file if it already exists.
 *
 * Uses `writeFileSync` — no shell is involved, so paths with spaces or special
 * characters are safe.
 *
 * @param params              `{ path, content }` — path and content to write.
 * @returns                   `{ path }` — path of the written file.
 *
 * @throws {WriteFileError}   code `not-a-file` when `path` is an existing directory.
 * @throws {WriteFileError}   code `fs-error` for unexpected filesystem errors.
 */
export function writeFile(params: WriteFileParams): WriteFileResult {
  const { path, content } = params;

  // Check whether the path is an existing directory before attempting to write.
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      throw new WriteFileError(`Path is not a file: ${path}`, 'not-a-file');
    }
  } catch (err: unknown) {
    if (err instanceof WriteFileError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is expected — the file does not exist yet; proceed to create it.
    if (code !== 'ENOENT') {
      throw new WriteFileError(`Failed to access path: ${path}`, 'fs-error');
    }
  }

  // Ensure the parent directory exists.
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    throw new WriteFileError(`Failed to create parent directory for: ${path}`, 'fs-error');
  }

  // Write the content to the file.
  try {
    writeFileSync(path, content, 'utf8');
  } catch {
    throw new WriteFileError(`Failed to write file: ${path}`, 'fs-error');
  }

  return { path };
}

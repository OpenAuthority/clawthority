/**
 * edit_file tool implementation.
 *
 * Performs a string replacement in a file: reads the file, replaces the first
 * occurrence of `old_string` with `new_string`, and writes the result back.
 *
 * Action class: filesystem.write
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the edit_file tool. */
export interface EditFileParams {
  /** Path to the file to edit. */
  path: string;
  /** The string to find in the file. */
  old_string: string;
  /** The string to replace it with. */
  new_string: string;
}

/** Successful result from the edit_file tool. */
export interface EditFileResult {
  /** Absolute path of the modified file. */
  path: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `editFile`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `not-found`        — the specified path does not exist.
 * - `not-a-file`       — the specified path exists but is not a file.
 * - `string-not-found` — `old_string` was not found in the file content.
 * - `fs-error`         — an unexpected filesystem error occurred.
 */
export class EditFileError extends Error {
  constructor(
    message: string,
    public readonly code: 'not-found' | 'not-a-file' | 'string-not-found' | 'fs-error',
  ) {
    super(message);
    this.name = 'EditFileError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Replaces the first occurrence of `old_string` with `new_string` in a file.
 *
 * Reads the file at `params.path`, performs a single string replacement, and
 * writes the modified content back to the same path.
 *
 * @param params             `{ path, old_string, new_string }`.
 * @returns                  `{ path }` — path of the modified file.
 *
 * @throws {EditFileError}   code `not-found` when `path` does not exist.
 * @throws {EditFileError}   code `not-a-file` when `path` is not a file.
 * @throws {EditFileError}   code `string-not-found` when `old_string` is absent.
 * @throws {EditFileError}   code `fs-error` for unexpected filesystem errors.
 */
export function editFile(params: EditFileParams): EditFileResult {
  const { path, old_string, new_string } = params;

  // Verify the path exists and is a regular file.
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new EditFileError(`File not found: ${path}`, 'not-found');
    }
    throw new EditFileError(`Failed to access path: ${path}`, 'fs-error');
  }

  if (!stat.isFile()) {
    throw new EditFileError(`Path is not a file: ${path}`, 'not-a-file');
  }

  // Read, replace, write.
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    throw new EditFileError(`Failed to read file: ${path}`, 'fs-error');
  }

  if (!content.includes(old_string)) {
    throw new EditFileError(
      `String not found in file: ${path}`,
      'string-not-found',
    );
  }

  const updated = content.replace(old_string, new_string);

  try {
    writeFileSync(path, updated, 'utf8');
  } catch {
    throw new EditFileError(`Failed to write file: ${path}`, 'fs-error');
  }

  return { path };
}

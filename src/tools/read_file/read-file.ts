/**
 * read_file tool implementation.
 *
 * Reads the UTF-8 text content of a file and returns it as a string.
 *
 * Action class: filesystem.read
 */

import { readFileSync, statSync } from 'node:fs';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the read_file tool. */
export interface ReadFileParams {
  /** Path to the file to read. */
  path: string;
}

/** Successful result from the read_file tool. */
export interface ReadFileResult {
  /** UTF-8 text content of the file. */
  content: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `readFile`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `not-found`  — the specified path does not exist.
 * - `not-a-file` — the specified path exists but is not a regular file.
 * - `fs-error`   — an unexpected filesystem error occurred.
 */
export class ReadFileError extends Error {
  constructor(
    message: string,
    public readonly code: 'not-found' | 'not-a-file' | 'fs-error',
  ) {
    super(message);
    this.name = 'ReadFileError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads the UTF-8 text content of a file.
 *
 * Uses `readFileSync` with `'utf-8'` encoding — no shell is involved, so paths
 * with spaces or special characters are safe.
 *
 * @param params          `{ path }` — path to the file to read.
 * @returns               `{ content }` — the file contents as a UTF-8 string.
 *
 * @throws {ReadFileError} code `not-found` when `path` does not exist.
 * @throws {ReadFileError} code `not-a-file` when `path` is a directory.
 * @throws {ReadFileError} code `fs-error` for unexpected filesystem errors.
 */
export function readFile(params: ReadFileParams): ReadFileResult {
  const { path } = params;

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ReadFileError(`File not found: ${path}`, 'not-found');
    }
    throw new ReadFileError(`Failed to access path: ${path}`, 'fs-error');
  }

  if (!stat.isFile()) {
    throw new ReadFileError(`Path is not a file: ${path}`, 'not-a-file');
  }

  try {
    const content = readFileSync(path, 'utf-8');
    return { content };
  } catch (err: unknown) {
    throw new ReadFileError(`Failed to read file: ${path}`, 'fs-error');
  }
}

/**
 * read_file tool implementation.
 *
 * Reads the UTF-8 text content of a file and returns it as a string.
 *
 * Action class: filesystem.read
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve, normalize } from 'node:path';

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
 * - `forbidden`  — the path is a protected critical system path.
 * - `not-found`  — the specified path does not exist.
 * - `not-a-file` — the specified path exists but is not a regular file.
 * - `fs-error`   — an unexpected filesystem error occurred.
 */
export class ReadFileError extends Error {
  constructor(
    message: string,
    public readonly code: 'forbidden' | 'not-found' | 'not-a-file' | 'fs-error',
  ) {
    super(message);
    this.name = 'ReadFileError';
  }
}

// ─── Safety ───────────────────────────────────────────────────────────────────

/**
 * Set of resolved absolute paths that must never be read from.
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
 * be read from.
 */
function isForbidden(resolvedPath: string): boolean {
  return FORBIDDEN_PATHS.has(normalize(resolvedPath));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads the UTF-8 text content of a file.
 *
 * Uses `readFileSync` with `'utf-8'` encoding — no shell is involved, so paths
 * with spaces or special characters are safe.
 *
 * @param params              `{ path }` — path to the file to read.
 * @returns                   `{ content }` — the file contents as a UTF-8 string.
 *
 * @throws {ReadFileError}    code `forbidden`  when `path` is a protected system path.
 * @throws {ReadFileError}    code `not-found`  when `path` does not exist.
 * @throws {ReadFileError}    code `not-a-file` when `path` is a directory.
 * @throws {ReadFileError}    code `fs-error`   for unexpected filesystem errors.
 */
export function readFile(params: ReadFileParams): ReadFileResult {
  const resolvedPath = resolve(params.path);

  // Safety check: reject protected system paths before touching the filesystem.
  if (isForbidden(resolvedPath)) {
    throw new ReadFileError(
      `Reading from protected system path is not allowed: ${resolvedPath}`,
      'forbidden',
    );
  }

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(resolvedPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ReadFileError(`File not found: ${resolvedPath}`, 'not-found');
    }
    throw new ReadFileError(`Failed to access path: ${resolvedPath}`, 'fs-error');
  }

  if (!stat.isFile()) {
    throw new ReadFileError(`Path is not a file: ${resolvedPath}`, 'not-a-file');
  }

  try {
    const content = readFileSync(resolvedPath, 'utf-8');
    return { content };
  } catch {
    throw new ReadFileError(`Failed to read file: ${resolvedPath}`, 'fs-error');
  }
}

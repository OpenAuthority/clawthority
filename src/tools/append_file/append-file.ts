/**
 * append_file tool implementation.
 *
 * Appends UTF-8 text content to a file, creating the file (and any missing
 * parent directories) if it does not exist.
 *
 * Action class: filesystem.write
 */

import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, normalize } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the append_file tool. */
export interface AppendFileParams {
  /** Path to the file to append to. */
  path: string;
  /** UTF-8 text content to append to the file. */
  content: string;
}

/** Successful result from the append_file tool. */
export interface AppendFileResult {
  /** Absolute path of the file that was appended to. */
  path: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `appendFile`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `forbidden`  — the path is a protected critical system path.
 * - `not-a-file` — the specified path exists but is a directory.
 * - `fs-error`   — an unexpected filesystem error occurred while appending.
 */
export class AppendFileError extends Error {
  constructor(
    message: string,
    public readonly code: 'forbidden' | 'not-a-file' | 'fs-error',
  ) {
    super(message);
    this.name = 'AppendFileError';
  }
}

// ─── Safety ───────────────────────────────────────────────────────────────────

/**
 * Set of resolved absolute paths that must never be written to.
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
 * be written to.
 */
function isForbidden(resolvedPath: string): boolean {
  return FORBIDDEN_PATHS.has(normalize(resolvedPath));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Appends UTF-8 text content to a file.
 *
 * Creates the file and any missing parent directories if they do not exist.
 * If the file already exists, content is appended after the existing content.
 *
 * Uses `appendFileSync` — no shell is involved, so paths with spaces or special
 * characters are safe.
 *
 * @param params              `{ path, content }` — path and content to append.
 * @returns                   `{ path }` — absolute path of the file.
 *
 * @throws {AppendFileError}  code `forbidden`  when `path` is a protected system path.
 * @throws {AppendFileError}  code `not-a-file` when `path` is an existing directory.
 * @throws {AppendFileError}  code `fs-error`   for unexpected filesystem errors.
 */
export function appendFile(params: AppendFileParams): AppendFileResult {
  const resolvedPath = resolve(params.path);
  const { content } = params;

  // Safety check: reject protected system paths before touching the filesystem.
  if (isForbidden(resolvedPath)) {
    throw new AppendFileError(
      `Appending to protected system path is not allowed: ${resolvedPath}`,
      'forbidden',
    );
  }

  // Check whether the path is an existing directory before attempting to append.
  try {
    const stat = statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new AppendFileError(`Path is not a file: ${resolvedPath}`, 'not-a-file');
    }
  } catch (err: unknown) {
    if (err instanceof AppendFileError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is expected — the file does not exist yet; proceed to create it.
    if (code !== 'ENOENT') {
      throw new AppendFileError(`Failed to access path: ${resolvedPath}`, 'fs-error');
    }
  }

  // Ensure the parent directory exists.
  try {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  } catch {
    throw new AppendFileError(
      `Failed to create parent directory for: ${resolvedPath}`,
      'fs-error',
    );
  }

  // Append the content to the file.
  try {
    appendFileSync(resolvedPath, content, 'utf8');
  } catch {
    throw new AppendFileError(`Failed to append to file: ${resolvedPath}`, 'fs-error');
  }

  return { path: resolvedPath };
}

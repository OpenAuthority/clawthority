/**
 * write_file tool implementation.
 *
 * Writes UTF-8 text content to a file, creating the file (and any missing
 * parent directories) if it does not exist, or overwriting it if it does.
 *
 * Action class: filesystem.write
 */

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, normalize } from 'node:path';

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
 * - `forbidden`  — the path is a protected critical system path.
 * - `not-a-file` — the specified path exists but is a directory.
 * - `fs-error`   — an unexpected filesystem error occurred while writing.
 */
export class WriteFileError extends Error {
  constructor(
    message: string,
    public readonly code: 'forbidden' | 'not-a-file' | 'fs-error',
  ) {
    super(message);
    this.name = 'WriteFileError';
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
 * Writes UTF-8 text content to a file.
 *
 * Creates the file and any missing parent directories if they do not exist.
 * Overwrites the file if it already exists.
 *
 * Uses `writeFileSync` — no shell is involved, so paths with spaces or special
 * characters are safe.
 *
 * @param params              `{ path, content }` — path and content to write.
 * @returns                   `{ path }` — absolute path of the written file.
 *
 * @throws {WriteFileError}   code `forbidden`  when `path` is a protected system path.
 * @throws {WriteFileError}   code `not-a-file` when `path` is an existing directory.
 * @throws {WriteFileError}   code `fs-error`   for unexpected filesystem errors.
 */
export function writeFile(params: WriteFileParams): WriteFileResult {
  const resolvedPath = resolve(params.path);
  const { content } = params;

  // Safety check: reject protected system paths before touching the filesystem.
  if (isForbidden(resolvedPath)) {
    throw new WriteFileError(
      `Writing to protected system path is not allowed: ${resolvedPath}`,
      'forbidden',
    );
  }

  // Check whether the path is an existing directory before attempting to write.
  try {
    const stat = statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new WriteFileError(`Path is not a file: ${resolvedPath}`, 'not-a-file');
    }
  } catch (err: unknown) {
    if (err instanceof WriteFileError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is expected — the file does not exist yet; proceed to create it.
    if (code !== 'ENOENT') {
      throw new WriteFileError(`Failed to access path: ${resolvedPath}`, 'fs-error');
    }
  }

  // Ensure the parent directory exists.
  try {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  } catch {
    throw new WriteFileError(
      `Failed to create parent directory for: ${resolvedPath}`,
      'fs-error',
    );
  }

  // Write the content to the file.
  try {
    writeFileSync(resolvedPath, content, 'utf8');
  } catch {
    throw new WriteFileError(`Failed to write file: ${resolvedPath}`, 'fs-error');
  }

  return { path: resolvedPath };
}

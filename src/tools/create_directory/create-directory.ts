/**
 * create_directory tool implementation.
 *
 * Creates a directory at the specified path, including any missing parent
 * directories (mkdir -p behaviour). Returns gracefully if the directory
 * already exists.
 *
 * Action class: filesystem.write
 */

import { mkdirSync, statSync } from 'node:fs';
import { resolve, normalize } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the create_directory tool. */
export interface CreateDirectoryParams {
  /** Path of the directory to create. */
  path: string;
}

/** Successful result from the create_directory tool. */
export interface CreateDirectoryResult {
  /** Absolute path of the created (or already existing) directory. */
  path: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `createDirectory`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `forbidden` — the path is a protected critical system path.
 * - `not-a-dir` — the specified path exists but is a file, not a directory.
 * - `fs-error`  — an unexpected filesystem error occurred (e.g. permission denied).
 */
export class CreateDirectoryError extends Error {
  constructor(
    message: string,
    public readonly code: 'forbidden' | 'not-a-dir' | 'fs-error',
  ) {
    super(message);
    this.name = 'CreateDirectoryError';
  }
}

// ─── Safety ───────────────────────────────────────────────────────────────────

/**
 * Set of resolved absolute paths that must never be targeted.
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
 * be targeted.
 */
function isForbidden(resolvedPath: string): boolean {
  return FORBIDDEN_PATHS.has(normalize(resolvedPath));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a directory at the specified path.
 *
 * Creates all missing parent directories automatically (mkdir -p behaviour).
 * If the directory already exists, returns successfully without modification.
 *
 * Uses `mkdirSync` with `{ recursive: true }` — no shell is involved, so
 * paths with spaces or special characters are safe.
 *
 * @param params                    `{ path }` — path of the directory to create.
 * @returns                         `{ path }` — absolute path of the created directory.
 *
 * @throws {CreateDirectoryError}   code `forbidden`  when the path is a protected system path.
 * @throws {CreateDirectoryError}   code `not-a-dir`  when `path` exists but is a file.
 * @throws {CreateDirectoryError}   code `fs-error`   for unexpected filesystem errors.
 */
export function createDirectory(params: CreateDirectoryParams): CreateDirectoryResult {
  const resolvedPath = resolve(params.path);

  // Safety check: reject protected system paths before touching the filesystem.
  if (isForbidden(resolvedPath)) {
    throw new CreateDirectoryError(
      `Creation at protected system path is not allowed: ${resolvedPath}`,
      'forbidden',
    );
  }

  // Check whether the path already exists.
  try {
    const stat = statSync(resolvedPath);
    if (!stat.isDirectory()) {
      throw new CreateDirectoryError(
        `Path exists but is not a directory: ${resolvedPath}`,
        'not-a-dir',
      );
    }
    // Already a directory — return gracefully without modification.
    return { path: resolvedPath };
  } catch (err: unknown) {
    if (err instanceof CreateDirectoryError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is expected — the directory does not exist yet; proceed to create it.
    if (code !== 'ENOENT') {
      throw new CreateDirectoryError(`Failed to access path: ${resolvedPath}`, 'fs-error');
    }
  }

  // Create the directory and all missing parent directories.
  try {
    mkdirSync(resolvedPath, { recursive: true });
  } catch {
    throw new CreateDirectoryError(`Failed to create directory: ${resolvedPath}`, 'fs-error');
  }

  return { path: resolvedPath };
}

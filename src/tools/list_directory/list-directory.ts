/**
 * list_directory tool implementation.
 *
 * Returns an array of entries in the specified directory, each with basic
 * file metadata (name, type, size, modified time). Does not recurse into
 * subdirectories.
 *
 * Action class: filesystem.list
 */

import { readdirSync, statSync } from 'node:fs';
import { resolve, normalize, join } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the list_directory tool. */
export interface ListDirectoryParams {
  /** Directory path to list. */
  path: string;
}

/** Metadata for a single entry returned by list_directory. */
export interface DirectoryEntry {
  /** Name of the file or directory (not a full path). */
  name: string;
  /** Whether the entry is a file or a directory. */
  type: 'file' | 'directory';
  /** Size in bytes as reported by the filesystem. Directories may report 0 or an OS-specific block size. */
  size: number;
  /** Last modification time as an ISO 8601 string. */
  modified: string;
}

/** Successful result from the list_directory tool. */
export interface ListDirectoryResult {
  /** Absolute path of the directory that was listed. */
  path: string;
  /** Immediate children of the directory with basic metadata. */
  entries: DirectoryEntry[];
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `listDirectory`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `forbidden`  — the path is a protected critical system path.
 * - `not-found`  — the specified path does not exist.
 * - `not-a-dir`  — the specified path exists but is not a directory.
 * - `fs-error`   — an unexpected filesystem error occurred.
 */
export class ListDirectoryError extends Error {
  constructor(
    message: string,
    public readonly code: 'forbidden' | 'not-found' | 'not-a-dir' | 'fs-error',
  ) {
    super(message);
    this.name = 'ListDirectoryError';
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
 * Lists the immediate contents of a directory with basic file metadata.
 *
 * Returns each child entry with its name, type (file or directory), size in
 * bytes, and last modification time as an ISO 8601 string. Does not recurse
 * into subdirectories.
 *
 * Uses `readdirSync` and `statSync` — no shell is involved, so paths with
 * spaces or special characters are safe.
 *
 * @param params                       `{ path }` — directory to list.
 * @returns                            `{ path, entries }` — absolute path and entry list.
 *
 * @throws {ListDirectoryError}        code `forbidden`  when the path is a protected system path.
 * @throws {ListDirectoryError}        code `not-found`  when `path` does not exist.
 * @throws {ListDirectoryError}        code `not-a-dir`  when `path` is not a directory.
 * @throws {ListDirectoryError}        code `fs-error`   for unexpected filesystem errors.
 */
export function listDirectory(params: ListDirectoryParams): ListDirectoryResult {
  const resolvedPath = resolve(params.path);

  // Safety check: reject protected system paths before touching the filesystem.
  if (isForbidden(resolvedPath)) {
    throw new ListDirectoryError(
      `Listing protected system path is not allowed: ${resolvedPath}`,
      'forbidden',
    );
  }

  // Verify the path exists and is a directory.
  let dirStat: ReturnType<typeof statSync>;
  try {
    dirStat = statSync(resolvedPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ListDirectoryError(`Directory not found: ${resolvedPath}`, 'not-found');
    }
    throw new ListDirectoryError(`Failed to access path: ${resolvedPath}`, 'fs-error');
  }

  if (!dirStat.isDirectory()) {
    throw new ListDirectoryError(`Path is not a directory: ${resolvedPath}`, 'not-a-dir');
  }

  // Read directory contents and collect metadata for each entry.
  let names: string[];
  try {
    names = readdirSync(resolvedPath);
  } catch {
    throw new ListDirectoryError(`Failed to read directory: ${resolvedPath}`, 'fs-error');
  }

  const entries: DirectoryEntry[] = [];
  for (const name of names) {
    try {
      const entryStat = statSync(join(resolvedPath, name));
      entries.push({
        name,
        type: entryStat.isDirectory() ? 'directory' : 'file',
        size: entryStat.size,
        modified: entryStat.mtime.toISOString(),
      });
    } catch {
      // If stat fails for an individual entry, skip it rather than aborting the whole listing.
    }
  }

  return { path: resolvedPath, entries };
}

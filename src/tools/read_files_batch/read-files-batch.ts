/**
 * read_files_batch tool implementation.
 *
 * Reads the UTF-8 text content of multiple files concurrently in a single
 * operation, returning a mapping of paths to their content or error status.
 *
 * Action class: filesystem.read
 */

import { readFile as fsReadFile, stat } from 'node:fs/promises';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the read_files_batch tool. */
export interface ReadFilesBatchParams {
  /** List of file paths to read. */
  paths: string[];
}

/** Successful per-file result. */
export interface FileReadOk {
  status: 'ok';
  /** UTF-8 text content of the file. */
  content: string;
}

/** Failed per-file result. */
export interface FileReadError {
  status: 'error';
  /**
   * Error code discriminant:
   * - `not-found`  — the path does not exist.
   * - `not-a-file` — the path exists but is not a regular file.
   * - `fs-error`   — an unexpected filesystem error occurred.
   */
  code: 'not-found' | 'not-a-file' | 'fs-error';
  /** Human-readable error description. */
  message: string;
}

/** Union of possible per-file outcomes. */
export type FileReadResult = FileReadOk | FileReadError;

/** Successful result from the read_files_batch tool. */
export interface ReadFilesBatchResult {
  /** Mapping of each requested path to its read result. */
  results: Record<string, FileReadResult>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function readOnePath(path: string): Promise<FileReadResult> {
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(path);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { status: 'error', code: 'not-found', message: `File not found: ${path}` };
    }
    return { status: 'error', code: 'fs-error', message: `Failed to access path: ${path}` };
  }

  if (!fileStat.isFile()) {
    return { status: 'error', code: 'not-a-file', message: `Path is not a file: ${path}` };
  }

  try {
    const content = await fsReadFile(path, 'utf-8');
    return { status: 'ok', content };
  } catch {
    return { status: 'error', code: 'fs-error', message: `Failed to read file: ${path}` };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads the UTF-8 text content of multiple files concurrently.
 *
 * Uses `Promise.allSettled` so that a failure on one path does not prevent
 * the remaining paths from being read. Each path in the result map is keyed
 * by the original path string and holds either `{ status: 'ok', content }`
 * or `{ status: 'error', code, message }`.
 *
 * No shell is involved, so paths with spaces or special characters are safe.
 *
 * @param params `{ paths }` — array of file paths to read.
 * @returns      `{ results }` — mapping of path to per-file outcome.
 */
export async function readFilesBatch(
  params: ReadFilesBatchParams,
): Promise<ReadFilesBatchResult> {
  const { paths } = params;

  const settled = await Promise.allSettled(paths.map((p) => readOnePath(p)));

  const results: Record<string, FileReadResult> = {};
  for (let i = 0; i < paths.length; i++) {
    const outcome = settled[i]!;
    if (outcome.status === 'fulfilled') {
      results[paths[i]!] = outcome.value;
    } else {
      // readOnePath itself never rejects (it catches internally), but
      // TypeScript requires us to handle the rejected branch defensively.
      results[paths[i]!] = {
        status: 'error',
        code: 'fs-error',
        message: `Unexpected error reading ${paths[i]}: ${String(outcome.reason)}`,
      };
    }
  }

  return { results };
}

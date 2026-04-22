/**
 * grep_files tool implementation.
 *
 * Searches for a regex pattern across files in a directory, returning an
 * array of matches with file paths, line numbers, and matched line content.
 *
 * Action class: filesystem.read
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the grep_files tool. */
export interface GrepFilesParams {
  /** Regex pattern to search for in file contents. */
  pattern: string;
  /**
   * Absolute path of the directory to search. Defaults to `process.cwd()`
   * when omitted.
   */
  path?: string;
  /**
   * Optional glob pattern to filter which files are searched.
   * Supports * (any chars except /), ** (any path depth),
   * ? (single char except /), and {a,b} alternation.
   * When omitted, all files are searched.
   */
  glob?: string;
}

/** A single match found in a file. */
export interface GrepMatch {
  /** Absolute path of the file containing the match. */
  file: string;
  /** 1-based line number of the matching line. */
  line: number;
  /** The full text of the matching line (with newline stripped). */
  content: string;
}

/** Successful result from the grep_files tool. */
export interface GrepFilesResult {
  /** Array of matches found across all searched files. */
  matches: GrepMatch[];
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `grepFiles`.
 *
 * - `not-found`      — the specified path does not exist.
 * - `not-a-dir`      — the specified path exists but is not a directory.
 * - `invalid-regex`  — the supplied pattern is not a valid regular expression.
 * - `fs-error`       — an unexpected filesystem error occurred.
 */
export class GrepFilesError extends Error {
  constructor(
    message: string,
    public readonly code: 'not-found' | 'not-a-dir' | 'invalid-regex' | 'fs-error',
  ) {
    super(message);
    this.name = 'GrepFilesError';
  }
}

// ─── Glob pattern matching ────────────────────────────────────────────────────

/**
 * Escapes all regex metacharacters in a literal string segment.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts a glob pattern to a RegExp that matches relative file paths.
 *
 * Supported syntax:
 *   *      — zero or more characters, excluding /
 *   **     — zero or more path segments (used as "**\/" prefix or at end)
 *   ?      — exactly one character, excluding /
 *   {a,b}  — alternation; each alternative is treated as a literal segment
 */
function globToRegex(pattern: string): RegExp {
  let src = '';
  let i = 0;

  while (i < pattern.length) {
    const c = pattern[i]!;

    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i += 2;
        if (pattern[i] === '/') {
          // **/ → zero or more path segments (each ending with /)
          src += '(?:.*/)?';
          i++;
        } else {
          // ** at end of pattern → matches anything including slashes
          src += '.*';
        }
      } else {
        // * → zero or more chars, not crossing directory boundary
        src += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      src += '[^/]';
      i++;
    } else if (c === '{') {
      const end = pattern.indexOf('}', i + 1);
      if (end === -1) {
        // Malformed brace — treat as literal
        src += escapeRegex(c);
        i++;
      } else {
        const alts = pattern.slice(i + 1, end).split(',').map(escapeRegex);
        src += `(?:${alts.join('|')})`;
        i = end + 1;
      }
    } else {
      src += escapeRegex(c);
      i++;
    }
  }

  return new RegExp(`^${src}$`);
}

// ─── Directory traversal ──────────────────────────────────────────────────────

/**
 * Recursively walks base/rel, collecting file absolute paths.
 * When globRegex is provided, only files whose relative path matches are
 * included. Errors on individual entries are silently skipped.
 */
function walkDir(
  base: string,
  rel: string,
  globRegex: RegExp | null,
  results: string[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(rel === '' ? base : join(base, rel));
  } catch {
    return;
  }

  for (const name of entries) {
    const relPath = rel === '' ? name : `${rel}/${name}`;
    const absPath = join(base, relPath);

    let isDir = false;
    try {
      isDir = statSync(absPath).isDirectory();
    } catch {
      continue;
    }

    if (isDir) {
      walkDir(base, relPath, globRegex, results);
    } else if (globRegex === null || globRegex.test(relPath)) {
      results.push(absPath);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Searches for a regex pattern across files in a directory tree.
 *
 * Each file that passes the optional glob filter is read as UTF-8 text and
 * its lines are tested against the compiled regex. Non-text (binary) files
 * that cannot be decoded are silently skipped.
 *
 * @param params  `{ pattern, path?, glob? }` — regex, optional search root, optional glob filter.
 * @returns       `{ matches }` — array of matching lines with file path, line number, and content.
 *
 * @throws {GrepFilesError} code `not-found` when `path` does not exist.
 * @throws {GrepFilesError} code `not-a-dir` when `path` is not a directory.
 * @throws {GrepFilesError} code `invalid-regex` when `pattern` is not valid regex.
 * @throws {GrepFilesError} code `fs-error` for unexpected filesystem errors.
 */
export function grepFiles(params: GrepFilesParams): GrepFilesResult {
  const { pattern, path: searchPath, glob } = params;
  const root = resolve(searchPath ?? process.cwd());

  // Compile the search regex.
  let searchRegex: RegExp;
  try {
    searchRegex = new RegExp(pattern);
  } catch {
    throw new GrepFilesError(`Invalid regex pattern: ${pattern}`, 'invalid-regex');
  }

  // Validate root path exists and is a directory.
  let rootStat: ReturnType<typeof statSync>;
  try {
    rootStat = statSync(root);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new GrepFilesError(`Directory not found: ${root}`, 'not-found');
    }
    throw new GrepFilesError(`Failed to access path: ${root}`, 'fs-error');
  }

  if (!rootStat.isDirectory()) {
    throw new GrepFilesError(`Path is not a directory: ${root}`, 'not-a-dir');
  }

  // Build glob regex when a filter pattern is provided.
  const globRegex = glob != null ? globToRegex(glob) : null;

  // Collect candidate files.
  const files: string[] = [];
  walkDir(root, '', globRegex, files);

  // Search each file for matching lines.
  const matches: GrepMatch[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf-8');
    } catch {
      // Skip files that cannot be read as UTF-8.
      continue;
    }

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineContent = lines[i]!;
      if (searchRegex.test(lineContent)) {
        matches.push({ file, line: i + 1, content: lineContent });
      }
    }
  }

  return { matches };
}

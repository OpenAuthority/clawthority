/**
 * chmod_path tool implementation.
 *
 * Wraps `chmod [-R] <mode> <path>` with a typed parameter schema.
 *
 * Action class: permissions.modify
 *
 * Both numeric (`0755`, `755`) and symbolic (`u+x`, `g-w,o=r`) mode
 * forms are accepted. The validators reject shell metacharacters and
 * any mode form that does not match the documented grammar.
 *
 * The `path` argument is passed verbatim to chmod via spawnSync with
 * an explicit argv array — no shell expansion. The wrapper does not
 * resolve relative paths or apply path-policy checks; that lives at
 * the enforcement layer (filesystem.* policy rules), where the typed
 * tool's payload is inspected.
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the chmod_path tool. */
export interface ChmodPathParams {
  /** Path to chmod. Passed verbatim to chmod with spawnSync. */
  path: string;
  /**
   * Mode in either numeric (`0755` / `755`) or symbolic
   * (`u+x` / `go-w` / `a=r,u+x`) form.
   */
  mode: string;
  /** When `true`, pass `-R` to chmod for recursive application. */
  recursive?: boolean;
}

/** Result returned by the chmod_path tool. */
export interface ChmodPathResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * - `invalid-path` — path is empty or contains shell metacharacters.
 * - `invalid-mode` — mode does not match the numeric or symbolic grammar.
 */
export class ChmodPathError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-path' | 'invalid-mode',
  ) {
    super(message);
    this.name = 'ChmodPathError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Shell metacharacters rejected in path values. Same set used in the
 * docker_run typed tool — defense-in-depth even though spawnSync with
 * `shell: false` does not interpret them.
 */
const SHELL_METACHARACTERS = /[;&|`$(){}\\'"]/;

/**
 * Numeric mode pattern. 3 or 4 octal digits.
 */
const NUMERIC_MODE = /^[0-7]{3,4}$/;

/**
 * Symbolic mode pattern. One or more `[ugoa]*[+-=][rwxXst]+` clauses
 * separated by commas. Examples: `u+x`, `go-w`, `a=r,u+x`, `g+rw,o-rwx`.
 */
const SYMBOLIC_MODE = /^[ugoa]*[+\-=][rwxXst]+(,[ugoa]*[+\-=][rwxXst]+)*$/;

/** Validates a chmod mode string. */
export function validateMode(mode: string): boolean {
  if (typeof mode !== 'string') return false;
  const trimmed = mode.trim();
  if (trimmed.length === 0) return false;
  return NUMERIC_MODE.test(trimmed) || SYMBOLIC_MODE.test(trimmed);
}

/** Validates a target path. */
export function validatePath(path: string): boolean {
  if (typeof path !== 'string') return false;
  const trimmed = path.trim();
  if (trimmed.length === 0) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs `chmod [-R] <mode> <path>`.
 *
 * @throws {ChmodPathError} code `invalid-path` — path empty or has shell metacharacters.
 * @throws {ChmodPathError} code `invalid-mode` — mode does not match the grammar.
 */
export function chmodPath(params: ChmodPathParams): ChmodPathResult {
  const { path, mode, recursive } = params;

  if (!validatePath(path)) {
    throw new ChmodPathError(
      `Invalid path for chmod: "${path}". ` +
        'Path must be a non-empty string with no shell metacharacters.',
      'invalid-path',
    );
  }

  if (!validateMode(mode)) {
    throw new ChmodPathError(
      `Invalid chmod mode: "${mode}". ` +
        'Mode must be numeric (e.g. "755", "0644") or symbolic (e.g. "u+x", "go-w", "a=r,u+x").',
      'invalid-mode',
    );
  }

  const args: string[] = [];
  if (recursive) args.push('-R');
  args.push(mode, path);

  const result = spawnSync('chmod', args, {
    encoding: 'utf-8',
    shell: false,
  });

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    exit_code: result.status ?? 1,
  };
}

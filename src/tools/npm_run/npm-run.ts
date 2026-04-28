/**
 * npm_run tool implementation.
 *
 * Executes a script defined in package.json by invoking
 * `npm run <script> [--silent] [-- <args>]` via `spawnSync`. Arguments are passed
 * directly to the child process — no shell interpolation occurs.
 *
 * Supports script validation by parsing package.json to verify the script
 * exists before invoking npm. Handles missing package.json gracefully.
 *
 * Supported flags: --silent (suppress npm lifecycle output), -- (pass-through args).
 *
 * Action class: package.run
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the npm_run tool. */
export interface NpmRunParams {
  /** Name of the npm script to execute. Must be defined in package.json "scripts". */
  script: string;
  /**
   * Directory to run the script in. Defaults to the current working directory.
   * Must contain a package.json with the specified script.
   */
  working_dir?: string;
  /**
   * Additional arguments to pass after `--` to the script.
   * e.g. `["--watch", "--coverage"]` produces `npm run <script> -- --watch --coverage`.
   */
  args?: string[];
  /**
   * When true, pass `--silent` to suppress npm lifecycle output (e.g. "npm run build").
   */
  silent?: boolean;
}

/** Successful result from the npm_run tool. */
export interface NpmRunResult {
  /** Standard output captured from the script. */
  stdout: string;
  /** Standard error captured from the script. */
  stderr: string;
  /** Process exit code. Non-zero indicates the script failed. */
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `npmRun` during pre-flight validation.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `package-json-not-found` — no package.json exists in the resolved directory.
 * - `script-not-found`       — the specified script is not declared in package.json.
 */
export class NpmRunError extends Error {
  constructor(
    message: string,
    public readonly code: 'package-json-not-found' | 'script-not-found',
  ) {
    super(message);
    this.name = 'NpmRunError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parses a package.json string and returns the set of declared script names.
 *
 * Returns an empty Set when the content is not valid JSON or has no "scripts"
 * property. Never throws.
 *
 * @param packageJsonContent - Raw text content of a package.json file.
 * @returns Set of script names found in the "scripts" object.
 */
export function parsePackageJsonScripts(packageJsonContent: string): Set<string> {
  try {
    const parsed = JSON.parse(packageJsonContent) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('scripts' in parsed) ||
      typeof (parsed as Record<string, unknown>).scripts !== 'object' ||
      (parsed as Record<string, unknown>).scripts === null
    ) {
      return new Set<string>();
    }
    const scripts = (parsed as Record<string, unknown>).scripts as Record<string, unknown>;
    return new Set<string>(Object.keys(scripts));
  } catch {
    return new Set<string>();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Executes an npm script defined in package.json.
 *
 * Reads and parses package.json from the resolved working directory to verify
 * the script exists before invoking npm. Throws `NpmRunError` for missing
 * package.json or missing script.
 *
 * Uses `spawnSync` with an explicit argument array — no shell is involved,
 * so script names or pass-through args with special characters are safe.
 *
 * Non-zero exit codes from npm are **not** thrown — they are returned in
 * `result.exit_code` so the caller can decide how to handle them.
 *
 * @param params               Tool parameters (see {@link NpmRunParams}).
 * @param options.cwd          Working directory base. Defaults to `process.cwd()`.
 * @returns                    `{ stdout, stderr, exit_code }`.
 *
 * @throws {NpmRunError}  code `package-json-not-found` when no package.json exists.
 * @throws {NpmRunError}  code `script-not-found` when the script is not declared.
 */
export function npmRun(
  params: NpmRunParams,
  options: { cwd?: string } = {},
): NpmRunResult {
  const { script, working_dir, args, silent } = params;

  // Resolve the effective working directory.
  const baseCwd = options.cwd ?? process.cwd();
  const effectiveCwd =
    working_dir !== undefined
      ? isAbsolute(working_dir)
        ? working_dir
        : resolve(baseCwd, working_dir)
      : baseCwd;

  // Locate and validate package.json.
  const packageJsonPath = join(effectiveCwd, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new NpmRunError(
      `package.json not found: ${packageJsonPath}`,
      'package-json-not-found',
    );
  }

  const content = readFileSync(packageJsonPath, 'utf-8');
  const knownScripts = parsePackageJsonScripts(content);

  if (!knownScripts.has(script)) {
    throw new NpmRunError(
      `Script "${script}" not found in ${packageJsonPath}. ` +
        `Known scripts: ${[...knownScripts].join(', ') || '(none)'}`,
      'script-not-found',
    );
  }

  // Build the npm argument list.
  const npmArgs: string[] = ['run'];

  if (silent) {
    npmArgs.push('--silent');
  }

  npmArgs.push(script);

  if (Array.isArray(args) && args.length > 0) {
    npmArgs.push('--', ...args);
  }

  const result = spawnSync('npm', npmArgs, {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitCode = result.status ?? 1;

  return { stdout, stderr, exit_code: exitCode };
}

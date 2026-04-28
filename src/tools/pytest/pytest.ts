/**
 * pytest tool implementation.
 *
 * Runs Python tests by invoking `pytest [options] [test_paths]` via
 * `spawnSync`. Arguments are passed directly to the child process — no shell
 * interpolation occurs.
 *
 * Supports:
 *   - Specific test file or directory paths (`test_paths`)
 *   - Marker expressions for test selection (`-m`)
 *   - Keyword expressions for test selection (`-k`)
 *   - Verbose output (`-v`)
 *   - Test discovery without execution (`--collect-only`)
 *   - Pass-through extra arguments (`args`)
 *
 * Test paths are validated to exist before invoking pytest.
 * Invalid or missing paths cause a pre-flight PytestError to be thrown.
 *
 * Non-zero exit codes from pytest are **not** thrown — they are returned in
 * `result.exit_code` so the caller can inspect the test outcome.
 *
 * Action class: build.test
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the pytest tool. */
export interface PytestParams {
  /**
   * Paths to test files or directories to collect and run.
   * When omitted, pytest discovers tests from the current directory.
   * Each path is validated to exist before invoking pytest.
   */
  test_paths?: string[];
  /**
   * Directory to run pytest in. Defaults to the current working directory.
   * Resolved relative to `options.cwd` when not absolute.
   */
  working_dir?: string;
  /**
   * Marker expression for test selection, passed as `-m <markers>`.
   * Example: `"unit and not slow"`.
   */
  markers?: string;
  /**
   * Keyword expression for test selection, passed as `-k <keyword>`.
   * Example: `"test_login or test_logout"`.
   */
  keyword?: string;
  /**
   * When true, pass `-v` to increase pytest verbosity.
   */
  verbose?: boolean;
  /**
   * When true, pass `--collect-only` to list discovered tests without executing them.
   */
  collect_only?: boolean;
  /**
   * Additional arguments to pass verbatim to pytest.
   * Appended after all structured flags.
   */
  args?: string[];
}

/** Result returned by the pytest tool. */
export interface PytestResult {
  /** Standard output captured from pytest. */
  stdout: string;
  /** Standard error captured from pytest. */
  stderr: string;
  /**
   * Process exit code.
   * - 0: all tests passed
   * - 1: test failures
   * - 2: interrupted (e.g. Ctrl-C)
   * - 3: internal error
   * - 4: usage error
   * - 5: no tests collected
   */
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `runPytest` during pre-flight validation.
 *
 * - `test-path-not-found` — a specified test path does not exist on disk.
 */
export class PytestError extends Error {
  constructor(
    message: string,
    public readonly code: 'test-path-not-found',
  ) {
    super(message);
    this.name = 'PytestError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs Python tests using `pytest`.
 *
 * Pre-flight validation throws `PytestError` for:
 * - A `test_paths` entry that does not exist on disk (`test-path-not-found`)
 *
 * Non-zero exit codes from pytest are **not** thrown — they are returned in
 * `result.exit_code` so the caller can inspect the test outcome directly.
 *
 * @param params       Tool parameters (see {@link PytestParams}).
 * @param options.cwd  Base working directory. Defaults to `process.cwd()`.
 * @returns            `{ stdout, stderr, exit_code }`.
 *
 * @throws {PytestError} code `test-path-not-found` — a specified path does not exist.
 */
export function runPytest(
  params: PytestParams,
  options: { cwd?: string } = {},
): PytestResult {
  const {
    test_paths,
    working_dir,
    markers,
    keyword,
    verbose,
    collect_only,
    args,
  } = params;

  // Resolve the effective working directory.
  const baseCwd = options.cwd ?? process.cwd();
  const effectiveCwd =
    working_dir !== undefined
      ? isAbsolute(working_dir)
        ? working_dir
        : resolve(baseCwd, working_dir)
      : baseCwd;

  // Validate that each specified test path exists.
  if (Array.isArray(test_paths) && test_paths.length > 0) {
    for (const testPath of test_paths) {
      const resolvedPath = isAbsolute(testPath)
        ? testPath
        : resolve(effectiveCwd, testPath);

      if (!existsSync(resolvedPath)) {
        throw new PytestError(
          `Test path not found: ${resolvedPath}`,
          'test-path-not-found',
        );
      }
    }
  }

  // Build the pytest argument list.
  const pytestArgs: string[] = [];

  if (verbose) {
    pytestArgs.push('-v');
  }

  if (collect_only) {
    pytestArgs.push('--collect-only');
  }

  if (markers !== undefined && markers.trim().length > 0) {
    pytestArgs.push('-m', markers.trim());
  }

  if (keyword !== undefined && keyword.trim().length > 0) {
    pytestArgs.push('-k', keyword.trim());
  }

  if (Array.isArray(args) && args.length > 0) {
    pytestArgs.push(...args);
  }

  if (Array.isArray(test_paths) && test_paths.length > 0) {
    pytestArgs.push(...test_paths);
  }

  const result = spawnSync('pytest', pytestArgs, {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitCode = result.status ?? 1;

  return { stdout, stderr, exit_code: exitCode };
}

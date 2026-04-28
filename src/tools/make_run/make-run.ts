/**
 * make_run tool implementation.
 *
 * Executes a Make target defined in a Makefile by invoking
 * `make [options] [target]` via `spawnSync`. Arguments are passed directly
 * to the child process — no shell interpolation occurs.
 *
 * Supports target validation by parsing the Makefile with a regex to extract
 * declared targets before invoking make. Handles missing Makefiles gracefully.
 *
 * Supported flags: -j (parallel jobs), -C (working directory), -f (Makefile path).
 *
 * Action class: package.run
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the make_run tool. */
export interface MakeRunParams {
  /** Name of the Make target to execute. When omitted, the default target runs. */
  target?: string;
  /**
   * Directory to run make in. Defaults to the current working directory.
   * Equivalent to `make -C <working_dir>`.
   */
  working_dir?: string;
  /**
   * Path to the Makefile to use. Defaults to "Makefile" in the working
   * directory. Passed as `-f <makefile>` to make.
   */
  makefile?: string;
  /**
   * Number of parallel jobs (-j<n>). When 0, runs with unlimited parallelism.
   * When omitted, make decides.
   */
  jobs?: number;
  /**
   * When true (default), verify that the target exists in the Makefile
   * before invoking make. Set to false to skip pre-flight validation.
   */
  validate_target?: boolean;
}

/** Successful result from the make_run tool. */
export interface MakeRunResult {
  /** Standard output captured from make. */
  stdout: string;
  /** Standard error captured from make. */
  stderr: string;
  /** Process exit code. Non-zero indicates the build failed. */
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `makeRun`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `makefile-not-found` — no Makefile exists at the resolved path.
 * - `target-not-found`   — the specified target is not declared in the Makefile.
 * - `make-error`         — `make` exited with a non-zero status.
 */
export class MakeRunError extends Error {
  constructor(
    message: string,
    public readonly code: 'makefile-not-found' | 'target-not-found' | 'make-error',
  ) {
    super(message);
    this.name = 'MakeRunError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns the resolved path to the Makefile given the working directory and
 * an optional explicit path.
 */
function resolveMakefilePath(workingDir: string, makefilePath?: string): string {
  if (makefilePath !== undefined) {
    return isAbsolute(makefilePath) ? makefilePath : resolve(workingDir, makefilePath);
  }
  // Make looks for 'GNUmakefile', 'makefile', 'Makefile' in that order.
  // We check only 'Makefile' and 'makefile' for simplicity.
  for (const candidate of ['GNUmakefile', 'makefile', 'Makefile']) {
    const p = join(workingDir, candidate);
    if (existsSync(p)) return p;
  }
  return join(workingDir, 'Makefile');
}

/**
 * Parses a Makefile and returns the set of declared target names.
 *
 * Only top-level explicit targets are extracted. Pattern rules (%.o),
 * GNU Make built-in targets (.PHONY etc.), and recipe-only lines are ignored.
 *
 * Regex: a target line starts at column 0, ends with a colon, and the
 * first token is the target name. Lines starting with a tab are recipes.
 *
 * @param makefileContent - Raw text content of a Makefile.
 * @returns Set of target names found in the file.
 */
export function parseMakefileTargets(makefileContent: string): Set<string> {
  const targets = new Set<string>();
  // Match lines of the form: <target-name>[<ws>...]: ...
  // The target name may contain letters, digits, underscores, hyphens, dots, slashes.
  // We skip lines that start with a tab (recipes) and comment lines (#).
  const TARGET_LINE = /^([A-Za-z0-9_.\-/][A-Za-z0-9_.\-/\s]*?)(?:\s*):(?!=)/gm;
  let match: RegExpExecArray | null;
  while ((match = TARGET_LINE.exec(makefileContent)) !== null) {
    const raw = match[1]!.trim();
    // A target declaration may list multiple targets separated by spaces.
    // However, a single colon followed by another colon is a double-colon rule
    // (which we still want to capture). Split on whitespace to handle
    // multi-target lines like `foo bar: dep`.
    for (const name of raw.split(/\s+/)) {
      if (name.length > 0 && !name.startsWith('.') && !name.includes('%')) {
        targets.add(name);
      }
    }
  }
  return targets;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Executes a Make target in the directory given by `options.cwd`.
 *
 * When `params.validate_target` is true (the default) and a `target` is
 * specified, the Makefile is parsed and the target is verified to exist
 * before invoking make.
 *
 * Uses `spawnSync` with an explicit argument array — no shell is involved,
 * so target names containing spaces or special characters are safe.
 *
 * @param params               Tool parameters (see {@link MakeRunParams}).
 * @param options.cwd          Working directory for make. Defaults to `process.cwd()`.
 * @returns                    `{ stdout, stderr, exit_code }`.
 *
 * @throws {MakeRunError}  code `makefile-not-found` when no Makefile exists.
 * @throws {MakeRunError}  code `target-not-found` when the target is not declared.
 * @throws {MakeRunError}  code `make-error` when make exits non-zero (only when exit_code is not returned).
 */
export function makeRun(
  params: MakeRunParams,
  options: { cwd?: string } = {},
): MakeRunResult {
  const {
    target,
    working_dir,
    makefile: makefileParam,
    jobs,
    validate_target = true,
  } = params;

  // Resolve the effective working directory.
  const baseCwd = options.cwd ?? process.cwd();
  const effectiveCwd =
    working_dir !== undefined
      ? isAbsolute(working_dir)
        ? working_dir
        : resolve(baseCwd, working_dir)
      : baseCwd;

  // Resolve the Makefile path.
  const makefilePath = resolveMakefilePath(effectiveCwd, makefileParam);

  // Validate the target exists in the Makefile when requested.
  if (validate_target && target !== undefined && target.length > 0) {
    if (!existsSync(makefilePath)) {
      throw new MakeRunError(
        `Makefile not found: ${makefilePath}`,
        'makefile-not-found',
      );
    }

    const content = readFileSync(makefilePath, 'utf-8');
    const knownTargets = parseMakefileTargets(content);

    if (!knownTargets.has(target)) {
      throw new MakeRunError(
        `Target "${target}" not found in ${makefilePath}. ` +
          `Known targets: ${[...knownTargets].join(', ') || '(none)'}`,
        'target-not-found',
      );
    }
  }

  // Build the make argument list.
  const args: string[] = [];

  if (makefileParam !== undefined) {
    args.push('-f', makefilePath);
  }

  if (jobs !== undefined) {
    args.push(jobs === 0 ? '-j' : `-j${jobs}`);
  }

  if (target !== undefined && target.length > 0) {
    args.push(target);
  }

  const result = spawnSync('make', args, {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitCode = result.status ?? 1;

  return { stdout, stderr, exit_code: exitCode };
}

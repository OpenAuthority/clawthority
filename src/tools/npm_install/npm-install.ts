/**
 * npm_install tool implementation.
 *
 * Installs npm packages by invoking `npm install [packages] [flags]` via
 * `spawnSync`. Arguments are passed directly to the child process — no shell
 * interpolation occurs.
 *
 * Supports:
 *   - Bare package names (e.g. "lodash")
 *   - Scoped packages (e.g. "@types/node")
 *   - Package names with version specifiers (e.g. "typescript@5", "express@^4.0.0")
 *   - Bare `npm install` from package.json when no packages are specified
 *   - Common flags: --save-dev, --global, --package-lock-only, --legacy-peer-deps
 *
 * Package names are validated against npm naming rules before invoking npm.
 * Invalid specs cause a pre-flight NpmInstallError to be thrown.
 *
 * When no packages are specified, package.json must exist in the working
 * directory (otherwise NpmInstallError with code `package-json-not-found`
 * is thrown).
 *
 * Action class: package.install
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the npm_install tool. */
export interface NpmInstallParams {
  /**
   * Package specifications to install. Supports bare names ("lodash"),
   * scoped packages ("@types/node"), and version specifiers ("typescript@5",
   * "express@^4.0.0"). When omitted, installs from package.json.
   */
  packages?: string[];
  /**
   * Directory to run npm install in. Resolved relative to `options.cwd` when
   * not absolute. Defaults to the current working directory.
   */
  working_dir?: string;
  /**
   * Additional npm install flags passed verbatim after `install`.
   * Examples: ["--save-dev"], ["--global"], ["--package-lock-only"].
   */
  flags?: string[];
}

/** Result returned by the npm_install tool. */
export interface NpmInstallResult {
  /** Standard output captured from npm. */
  stdout: string;
  /** Standard error captured from npm. */
  stderr: string;
  /** Process exit code. Non-zero indicates npm reported an error. */
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `npmInstall` during pre-flight validation.
 *
 * - `invalid-package-spec`   — a package spec fails npm naming rules.
 * - `package-json-not-found` — no packages specified and package.json is absent.
 */
export class NpmInstallError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-package-spec' | 'package-json-not-found',
  ) {
    super(message);
    this.name = 'NpmInstallError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * npm package name pattern (non-scoped).
 *
 * Matches names that start and end with a letter or digit, and may contain
 * letters, digits, hyphens, underscores, and dots in between. Single-character
 * names (e.g. "n", "q") are accepted.
 */
const NPM_BARE_NAME = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

/**
 * npm scoped package name pattern: `@scope/name`.
 *
 * Both the scope and the name portion follow the same rules as bare names.
 */
const NPM_SCOPED_NAME =
  /^@[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?\/[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

/**
 * Shell metacharacters that must not appear in a version specifier.
 *
 * The semicolon, ampersand, pipe, backtick, dollar sign, parentheses,
 * braces, and quote characters are blocked.
 */
const SHELL_METACHARACTERS = /[;&|`$(){}\\'\"]/;

/**
 * Validates a single npm package specification.
 *
 * Accepts:
 *   - Bare name:              `lodash`
 *   - Single char:            `n`
 *   - Scoped:                 `@types/node`
 *   - With version tag:       `typescript@latest`
 *   - With exact version:     `lodash@4.17.21`
 *   - With semver range:      `express@^4.0.0`, `express@~4.18.0`
 *   - With comparator:        `lodash@>=4.0.0`
 *   - With wildcard:          `lodash@*`
 *   - Scoped with version:    `@types/node@18.0.0`
 *
 * Rejects:
 *   - Empty or whitespace-only strings
 *   - Names with spaces
 *   - Names or versions containing shell metacharacters
 *   - Malformed scoped packages (missing `/`)
 *
 * @param spec - A single package specification string.
 * @returns `true` when the spec is valid, `false` otherwise.
 */
export function validateNpmPackageSpec(spec: string): boolean {
  if (typeof spec !== 'string' || spec.trim().length === 0) return false;

  const trimmed = spec.trim();

  let namePart: string;
  let versionPart: string;

  if (trimmed.startsWith('@')) {
    // Scoped package: @scope/name or @scope/name@version
    const slashIdx = trimmed.indexOf('/');
    if (slashIdx === -1) return false; // Malformed scope — missing "/"

    const afterSlash = trimmed.slice(slashIdx + 1);
    const versionIdx = afterSlash.indexOf('@');

    if (versionIdx === -1) {
      namePart = trimmed;
      versionPart = '';
    } else {
      namePart = trimmed.slice(0, slashIdx + 1 + versionIdx);
      versionPart = afterSlash.slice(versionIdx + 1);
    }

    if (!NPM_SCOPED_NAME.test(namePart)) return false;
  } else {
    // Non-scoped: name or name@version
    const atIdx = trimmed.indexOf('@');

    if (atIdx === -1) {
      namePart = trimmed;
      versionPart = '';
    } else {
      namePart = trimmed.slice(0, atIdx);
      versionPart = trimmed.slice(atIdx + 1);
    }

    if (!NPM_BARE_NAME.test(namePart)) return false;
  }

  // Reject version specifiers containing shell metacharacters.
  if (versionPart.length > 0 && SHELL_METACHARACTERS.test(versionPart)) {
    return false;
  }

  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Installs npm packages using `npm install`.
 *
 * Pre-flight validation throws `NpmInstallError` for:
 * - No packages specified and package.json absent (`package-json-not-found`)
 * - A package spec that fails npm naming rules (`invalid-package-spec`)
 *
 * Non-zero exit codes from npm are **not** thrown — they are returned in
 * `result.exit_code` so the caller can decide how to handle them.
 *
 * @param params      Tool parameters (see {@link NpmInstallParams}).
 * @param options.cwd Base working directory. Defaults to `process.cwd()`.
 * @returns           `{ stdout, stderr, exit_code }`.
 *
 * @throws {NpmInstallError} code `package-json-not-found` — no packages and no package.json.
 * @throws {NpmInstallError} code `invalid-package-spec`   — spec fails npm naming rules.
 */
export function npmInstall(
  params: NpmInstallParams,
  options: { cwd?: string } = {},
): NpmInstallResult {
  const { packages, working_dir, flags } = params;

  const hasPackages = Array.isArray(packages) && packages.length > 0;

  // Resolve the effective working directory.
  const baseCwd = options.cwd ?? process.cwd();
  const effectiveCwd =
    working_dir !== undefined
      ? isAbsolute(working_dir)
        ? working_dir
        : resolve(baseCwd, working_dir)
      : baseCwd;

  // When no packages are specified, package.json must exist.
  if (!hasPackages) {
    const packageJsonPath = join(effectiveCwd, 'package.json');
    if (!existsSync(packageJsonPath)) {
      throw new NpmInstallError(
        `package.json not found: ${packageJsonPath}. ` +
          'Specify package names or run npm install from a directory with package.json.',
        'package-json-not-found',
      );
    }
  }

  // Validate each package spec before invoking npm.
  if (hasPackages) {
    for (const spec of packages!) {
      if (!validateNpmPackageSpec(spec)) {
        throw new NpmInstallError(
          `Invalid npm package specification: "${spec}". ` +
            'Package names must follow npm naming rules (lowercase letters, digits, hyphens, underscores, dots; ' +
            'scoped packages use @scope/name format).',
          'invalid-package-spec',
        );
      }
    }
  }

  // Build the npm argument list.
  const npmArgs: string[] = ['install'];

  if (Array.isArray(flags) && flags.length > 0) {
    npmArgs.push(...flags);
  }

  if (hasPackages) {
    npmArgs.push(...packages!);
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

/**
 * pip_install tool implementation.
 *
 * Installs Python packages via `pip install` using `spawnSync`. Arguments are
 * passed directly to the child process — no shell interpolation occurs.
 *
 * Supports:
 *   - Individual packages with optional version constraints (e.g. "requests==2.28.0")
 *   - Extras (e.g. "requests[security]")
 *   - requirements.txt files via the `requirements` parameter
 *   - Common flags: --user, --upgrade, --index-url, --extra-index-url
 *
 * Package names are validated against PyPI naming rules (PEP 508) before
 * invoking pip. Invalid specs cause a pre-flight PipInstallError to be thrown.
 *
 * Action class: package.install
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the pip_install tool. */
export interface PipInstallParams {
  /**
   * List of package specifications to install.
   * Supports bare names ("requests"), version constraints ("flask>=2.0"),
   * equality pins ("django==4.2.0"), and extras ("requests[security]").
   * At least one of `packages` or `requirements` must be provided.
   */
  packages?: string[];
  /**
   * Path to a requirements.txt file. Resolved relative to `working_dir`
   * (or `options.cwd`) when not absolute. Passed as `-r <path>` to pip.
   */
  requirements?: string;
  /**
   * Directory to run pip install in. Defaults to the current working directory.
   */
  working_dir?: string;
  /**
   * When true, pass `--upgrade` to upgrade already-installed packages to the
   * newest available version.
   */
  upgrade?: boolean;
  /**
   * When true, pass `--user` to install into the user site-packages directory
   * instead of the system directory.
   */
  user?: boolean;
  /**
   * Base URL of the Python Package Index. Passed as `--index-url <url>`.
   * Overrides the default https://pypi.org/simple.
   */
  index_url?: string;
  /**
   * Extra URL(s) of package indexes. Passed as `--extra-index-url <url>`.
   */
  extra_index_url?: string;
}

/** Result returned by the pip_install tool. */
export interface PipInstallResult {
  /** Standard output captured from pip. */
  stdout: string;
  /** Standard error captured from pip. */
  stderr: string;
  /** Process exit code. Non-zero indicates pip reported an error. */
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `pipInstall` during pre-flight validation.
 *
 * - `invalid-package-spec`        — a package spec fails PyPI naming rules.
 * - `requirements-file-not-found` — the specified requirements file does not exist.
 * - `no-packages-specified`       — neither `packages` nor `requirements` was provided.
 */
export class PipInstallError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid-package-spec'
      | 'requirements-file-not-found'
      | 'no-packages-specified',
  ) {
    super(message);
    this.name = 'PipInstallError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * PyPI package name pattern (PEP 508).
 *
 * Matches the normalized name portion: letters, digits, hyphens, underscores,
 * and dots, starting and ending with a letter or digit.
 */
const PYPI_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Optional extras clause, e.g. `[security]` or `[security,socks]`.
 */
const EXTRAS_CLAUSE = /^\[[A-Za-z0-9_,\s-]+\]$/;

/**
 * Version specifier pattern for a single clause (PEP 440).
 * Matches: `==1.0`, `>=1.0`, `<=2.0`, `!=1.5`, `~=1.0`, `>1.0`, `<2.0`, `===1.0`.
 */
const VERSION_CLAUSE = /^(===|~=|==|!=|>=|<=|>|<)[A-Za-z0-9._*+!]+$/;

/**
 * Validates a single package specification against PyPI naming rules.
 *
 * Accepts:
 *   - Bare name:                  `requests`
 *   - Name with extras:           `requests[security,socks]`
 *   - Name with version:          `django==4.2.0`
 *   - Name with extras + version: `requests[security]>=2.28.0`
 *   - Multiple version clauses:   `flask>=2.0,<3.0`
 *
 * @param spec - A single package specification string.
 * @returns `true` when the spec is valid, `false` otherwise.
 */
export function validatePackageSpec(spec: string): boolean {
  if (typeof spec !== 'string' || spec.trim().length === 0) return false;

  const trimmed = spec.trim();

  // Split off version specifier(s). The version part starts at the first
  // operator character (=, !, <, >, ~).
  const versionStart = trimmed.search(/[=!<>~]/);

  let namePart: string;
  let versionPart: string;

  if (versionStart === -1) {
    namePart = trimmed;
    versionPart = '';
  } else {
    namePart = trimmed.slice(0, versionStart);
    versionPart = trimmed.slice(versionStart);
  }

  // Extract optional extras from the name part: `requests[security]`
  const extrasStart = namePart.indexOf('[');
  let coreName: string;
  let extrasPart: string;

  if (extrasStart !== -1) {
    coreName = namePart.slice(0, extrasStart);
    extrasPart = namePart.slice(extrasStart);
  } else {
    coreName = namePart;
    extrasPart = '';
  }

  // Validate the core name.
  if (!PYPI_NAME.test(coreName)) return false;

  // Validate the extras clause if present.
  if (extrasPart.length > 0 && !EXTRAS_CLAUSE.test(extrasPart)) return false;

  // Validate version clauses if present.
  if (versionPart.length > 0) {
    // Multiple clauses are comma-separated: `>=2.0,<3.0`
    const clauses = versionPart.split(',').map(c => c.trim());
    for (const clause of clauses) {
      if (!VERSION_CLAUSE.test(clause)) return false;
    }
  }

  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Installs Python packages using `pip install`.
 *
 * Pre-flight validation throws `PipInstallError` for:
 * - No packages or requirements file specified (`no-packages-specified`)
 * - A package spec that fails PyPI naming rules (`invalid-package-spec`)
 * - A requirements file that does not exist (`requirements-file-not-found`)
 *
 * Non-zero exit codes from pip are **not** thrown — they are returned in
 * `result.exit_code` so the caller can decide how to handle them.
 *
 * @param params       Tool parameters (see {@link PipInstallParams}).
 * @param options.cwd  Base working directory. Defaults to `process.cwd()`.
 * @returns            `{ stdout, stderr, exit_code }`.
 *
 * @throws {PipInstallError} code `no-packages-specified`        — nothing to install.
 * @throws {PipInstallError} code `invalid-package-spec`         — spec fails validation.
 * @throws {PipInstallError} code `requirements-file-not-found`  — file does not exist.
 */
export function pipInstall(
  params: PipInstallParams,
  options: { cwd?: string } = {},
): PipInstallResult {
  const {
    packages,
    requirements,
    working_dir,
    upgrade,
    user,
    index_url,
    extra_index_url,
  } = params;

  const hasPackages = Array.isArray(packages) && packages.length > 0;
  const hasRequirements = typeof requirements === 'string' && requirements.trim().length > 0;

  // Require at least one source.
  if (!hasPackages && !hasRequirements) {
    throw new PipInstallError(
      'At least one of "packages" or "requirements" must be specified.',
      'no-packages-specified',
    );
  }

  // Resolve the effective working directory.
  const baseCwd = options.cwd ?? process.cwd();
  const effectiveCwd =
    working_dir !== undefined
      ? isAbsolute(working_dir)
        ? working_dir
        : resolve(baseCwd, working_dir)
      : baseCwd;

  // Validate each package spec before invoking pip.
  if (hasPackages) {
    for (const spec of packages!) {
      if (!validatePackageSpec(spec)) {
        throw new PipInstallError(
          `Invalid package specification: "${spec}". ` +
            'Package names must follow PyPI naming rules (PEP 508).',
          'invalid-package-spec',
        );
      }
    }
  }

  // Validate the requirements file exists.
  if (hasRequirements) {
    const reqPath = isAbsolute(requirements!)
      ? requirements!
      : resolve(effectiveCwd, requirements!);

    if (!existsSync(reqPath)) {
      throw new PipInstallError(
        `Requirements file not found: ${reqPath}`,
        'requirements-file-not-found',
      );
    }
  }

  // Build the pip argument list.
  const args: string[] = ['install'];

  if (upgrade) args.push('--upgrade');
  if (user) args.push('--user');

  if (index_url !== undefined) {
    args.push('--index-url', index_url);
  }

  if (extra_index_url !== undefined) {
    args.push('--extra-index-url', extra_index_url);
  }

  if (hasRequirements) {
    const reqPath = isAbsolute(requirements!)
      ? requirements!
      : resolve(effectiveCwd, requirements!);
    args.push('-r', reqPath);
  }

  if (hasPackages) {
    args.push(...packages!);
  }

  const result = spawnSync('pip', args, {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitCode = result.status ?? 1;

  return { stdout, stderr, exit_code: exitCode };
}

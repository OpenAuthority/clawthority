/**
 * get_env_var tool implementation.
 *
 * Reads a single environment variable from the current process environment.
 * Returns the value if set, or indicates the variable is not set without
 * throwing. Process control operations are explicitly out of scope.
 *
 * Action class: system.read
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the get_env_var tool. */
export interface GetEnvVarParams {
  /** Name of the environment variable to read. */
  variable_name: string;
}

/** Successful result from the get_env_var tool. */
export interface GetEnvVarResult {
  /** Name of the environment variable that was queried. */
  variable_name: string;
  /** Whether the variable is set in the process environment. */
  found: boolean;
  /** The variable's value, or null if not set. */
  value: string | null;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `getEnvVar`.
 *
 * - `invalid-name` — variable_name is empty or contains illegal characters.
 */
export class GetEnvVarError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-name',
  ) {
    super(message);
    this.name = 'GetEnvVarError';
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * POSIX environment variable names consist of uppercase letters, digits, and
 * underscores, and must not begin with a digit. Windows also accepts lowercase.
 * We accept both cases and reject names containing `=` or null bytes, which
 * are unconditionally illegal in env var names across all platforms.
 */
const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isValidEnvVarName(name: string): boolean {
  return name.length > 0 && ENV_VAR_NAME_RE.test(name);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads a single environment variable from `process.env`.
 *
 * Returns `{ found: true, value: <string> }` when the variable is set, or
 * `{ found: false, value: null }` when it is absent. Does not throw for
 * missing variables.
 *
 * Explicitly excludes process control — this tool cannot modify, delete, or
 * enumerate all environment variables.
 *
 * @param params  `{ variable_name }` — name of the variable to read.
 * @returns       `{ variable_name, found, value }`.
 *
 * @throws {GetEnvVarError} code `invalid-name` when `variable_name` is empty
 *   or contains illegal characters (e.g. `=`, null bytes).
 */
export function getEnvVar(params: GetEnvVarParams): GetEnvVarResult {
  const { variable_name } = params;

  if (!isValidEnvVarName(variable_name)) {
    throw new GetEnvVarError(
      `Invalid environment variable name: ${JSON.stringify(variable_name)}. ` +
        'Names must start with a letter or underscore and contain only letters, digits, and underscores.',
      'invalid-name',
    );
  }

  const raw = process.env[variable_name];
  if (raw === undefined) {
    return { variable_name, found: false, value: null };
  }
  return { variable_name, found: true, value: raw };
}

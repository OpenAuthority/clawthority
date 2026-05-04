/**
 * pkill_pattern tool implementation.
 *
 * Wraps `pkill -<signal> <pattern>` with a typed parameter schema.
 *
 * Action class: process.signal
 *
 * The `pattern` is validated against a strict character set that
 * deliberately excludes shell metacharacters but DOES allow common
 * regex syntax (`.`, `*`, `+`, `?`, `^`, `$`, `[`, `]`, `(`, `)`, `|`)
 * because pkill's `-f` mode treats the pattern as an extended regex.
 *
 * `(`, `)`, `|`, and `$` are normally on our shell-metacharacter list
 * (and they are in the chmod / chown / systemctl tools). Here we keep
 * them in a more permissive allowlist because:
 *   - spawnSync uses `shell: false`, so they are never expanded.
 *   - excluding them would force operators to write trivial regexes
 *     and route real ones through unsafe_admin_exec.
 *   - The validator still rejects `;`, `&`, `` ` ``, `{`, `}`, `\`,
 *     and quote characters which are pure injection-surface tokens
 *     with no extended-regex usefulness.
 */

import { spawnSync } from 'node:child_process';

import { KILL_SIGNALS, type KillSignal } from '../kill_process/kill-process.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export { KILL_SIGNALS, type KillSignal };

export interface PkillPatternParams {
  /**
   * Process-name pattern. Passed verbatim to pkill via spawnSync.
   * Allowed characters: letters, digits, and a curated set of regex
   * metacharacters (see module docstring).
   */
  pattern: string;
  /** Signal to deliver. Defaults to `TERM`. */
  signal?: KillSignal;
  /**
   * When true, pass `-f` so pkill matches against the full command line
   * rather than just the process name.
   */
  full_match?: boolean;
}

export interface PkillPatternResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * - `invalid-pattern` — pattern is empty, too long, or contains rejected characters.
 * - `invalid-signal`  — signal is not in {@link KILL_SIGNALS}.
 */
export class PkillPatternError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-pattern' | 'invalid-signal',
  ) {
    super(message);
    this.name = 'PkillPatternError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const MAX_PATTERN_LENGTH = 256;

/**
 * Allowed-character set for pkill patterns. Letters, digits, hyphens,
 * dots, underscores, slashes, and the regex metacharacters listed in
 * the module docstring. Rejected at the literal level: `;`, `&`,
 * backtick, `{`, `}`, `\`, single-quote, double-quote.
 */
const PKILL_PATTERN = /^[a-zA-Z0-9._\-/^$+*?()|\[\] ]+$/;

/** Validates a pattern. */
export function validatePattern(pattern: string): boolean {
  if (typeof pattern !== 'string') return false;
  const trimmed = pattern.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PATTERN_LENGTH) return false;
  return PKILL_PATTERN.test(trimmed);
}

/** Validates a signal name. Re-exported for convenience. */
export function validateSignal(signal: string): signal is KillSignal {
  return (KILL_SIGNALS as readonly string[]).includes(signal);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends `signal` to all processes matching `pattern` via pkill.
 *
 * @throws {PkillPatternError} code `invalid-pattern` — pattern fails validation.
 * @throws {PkillPatternError} code `invalid-signal`  — signal not in the allowlist.
 */
export function pkillPattern(params: PkillPatternParams): PkillPatternResult {
  const { pattern, signal = 'TERM', full_match } = params;

  if (!validatePattern(pattern)) {
    throw new PkillPatternError(
      `Invalid pkill pattern: "${pattern}". ` +
        'Pattern must be a non-empty string ≤256 chars containing only ' +
        'letters, digits, and a curated set of regex metacharacters.',
      'invalid-pattern',
    );
  }

  if (!validateSignal(signal)) {
    throw new PkillPatternError(
      `Invalid signal: "${signal}". ` +
        `Signal must be one of: ${KILL_SIGNALS.join(', ')}.`,
      'invalid-signal',
    );
  }

  const args: string[] = [`-${signal}`];
  if (full_match) args.push('-f');
  args.push(pattern);

  const result = spawnSync('pkill', args, {
    encoding: 'utf-8',
    shell: false,
  });

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    exit_code: result.status ?? 1,
  };
}

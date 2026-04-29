/**
 * shutdown tool implementation.
 *
 * Wraps the `shutdown` binary with a typed parameter schema. Three modes
 * are supported:
 *
 *   - `poweroff` — power off the host (`shutdown -P <time>`).
 *   - `reboot`   — reboot the host  (`shutdown -r <time>`).
 *   - `cancel`   — cancel a pending shutdown (`shutdown -c`).
 *
 * Action class: system.service
 *
 * The `time` argument is validated against a tight regex before any
 * subprocess spawns. Three forms are accepted:
 *
 *   - `now`             — immediate
 *   - `+<minutes>`      — relative (e.g. `+5`)
 *   - `HH:MM`           — absolute wall-clock (24-hour)
 *
 * Any other value (including arbitrary `shutdown(8)` syntax such as
 * messages-with-spaces) is rejected. The `cancel` mode must not be
 * combined with a `time` value — the caller's intent is unambiguous.
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export const SHUTDOWN_MODES = ['poweroff', 'reboot', 'cancel'] as const;
export type ShutdownMode = (typeof SHUTDOWN_MODES)[number];

/** Input parameters for the shutdown tool. */
export interface ShutdownParams {
  /** Shutdown mode — what the binary should do. */
  mode: ShutdownMode;
  /**
   * Schedule expression for `poweroff` / `reboot` modes. Must be one of:
   *   - `now`        — immediate
   *   - `+<minutes>` — relative offset in minutes (e.g. `+5`)
   *   - `HH:MM`      — absolute wall-clock, 24-hour
   *
   * Defaults to `now` when omitted. Must not be set when `mode` is `cancel`.
   */
  time?: string;
}

/** Result returned by the shutdown tool. */
export interface ShutdownResult {
  /** Standard output captured from the shutdown binary. */
  stdout: string;
  /** Standard error captured from the shutdown binary. */
  stderr: string;
  /** Exit code from the shutdown binary. */
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `shutdown` during pre-flight validation.
 *
 * - `invalid-mode` — `mode` is not in {@link SHUTDOWN_MODES}.
 * - `invalid-time` — `time` does not match the accepted forms.
 * - `time-not-allowed` — `time` was passed with `mode: 'cancel'`.
 */
export class ShutdownError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-mode' | 'invalid-time' | 'time-not-allowed',
  ) {
    super(message);
    this.name = 'ShutdownError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Schedule expression pattern. Accepts `now`, `+<minutes>`, or `HH:MM`.
 *
 * `\d{1,4}` allows up to 4 digits for the relative form (≤9999 minutes,
 * ~6.9 days) which is more than enough for any operator scenario.
 */
const SCHEDULE_PATTERN = /^now$|^\+\d{1,4}$|^([01]?\d|2[0-3]):[0-5]\d$/;

/** Validates a shutdown-mode string. */
export function validateMode(mode: string): mode is ShutdownMode {
  return (SHUTDOWN_MODES as readonly string[]).includes(mode);
}

/** Validates a shutdown schedule expression. */
export function validateTime(time: string): boolean {
  if (typeof time !== 'string') return false;
  const trimmed = time.trim();
  if (trimmed.length === 0) return false;
  return SCHEDULE_PATTERN.test(trimmed);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs `shutdown` against the host.
 *
 * Pre-flight validation throws `ShutdownError` for:
 * - An unrecognised mode (`invalid-mode`)
 * - A malformed time expression (`invalid-time`)
 * - A `time` value passed with `mode: 'cancel'` (`time-not-allowed`)
 *
 * @param params - Tool parameters (see {@link ShutdownParams}).
 * @returns        `{ stdout, stderr, exit_code }`.
 *
 * @throws {ShutdownError} code `invalid-mode`     — mode not in enum.
 * @throws {ShutdownError} code `invalid-time`     — time fails regex.
 * @throws {ShutdownError} code `time-not-allowed` — time passed with cancel mode.
 */
export function shutdown(params: ShutdownParams): ShutdownResult {
  const { mode, time } = params;

  if (!validateMode(mode)) {
    throw new ShutdownError(
      `Invalid shutdown mode: "${mode}". ` +
        `Mode must be one of: ${SHUTDOWN_MODES.join(', ')}.`,
      'invalid-mode',
    );
  }

  if (mode === 'cancel') {
    if (time !== undefined) {
      throw new ShutdownError(
        'shutdown mode "cancel" does not accept a time argument.',
        'time-not-allowed',
      );
    }
    const result = spawnSync('shutdown', ['-c'], {
      encoding: 'utf-8',
      shell: false,
    });
    return {
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      exit_code: result.status ?? 1,
    };
  }

  const effectiveTime = time ?? 'now';
  if (!validateTime(effectiveTime)) {
    throw new ShutdownError(
      `Invalid shutdown time: "${time}". ` +
        'Time must be one of: "now", "+<minutes>", or "HH:MM" (24-hour).',
      'invalid-time',
    );
  }

  const flag = mode === 'poweroff' ? '-P' : '-r';
  const result = spawnSync('shutdown', [flag, effectiveTime], {
    encoding: 'utf-8',
    shell: false,
  });

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    exit_code: result.status ?? 1,
  };
}

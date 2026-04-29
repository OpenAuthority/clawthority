/**
 * kill_process tool implementation.
 *
 * Wraps `kill -<signal> <pid>` with a typed parameter schema.
 *
 * Action class: process.signal
 *
 * The signal is restricted to a curated allowlist (TERM / KILL / HUP /
 * INT / USR1 / USR2). The pid is integer-validated and coerced to a
 * positive integer string for the argv. The default signal is `TERM`;
 * `KILL` requires explicit specification — we never default to a
 * non-recoverable signal.
 *
 * Note: there is no carve-out for pid 1, pid 0, or other "dangerous"
 * pids at this layer. Those decisions belong in the HITL approval
 * message — the typed tool's job is structural input validation only.
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export const KILL_SIGNALS = [
  'TERM',
  'KILL',
  'HUP',
  'INT',
  'USR1',
  'USR2',
] as const;

export type KillSignal = (typeof KILL_SIGNALS)[number];

export interface KillProcessParams {
  /** Target process id. Must be a non-negative integer. */
  pid: number;
  /** Signal to deliver. Defaults to `TERM`. */
  signal?: KillSignal;
}

export interface KillProcessResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * - `invalid-pid`    — pid is not a non-negative safe integer.
 * - `invalid-signal` — signal is not in {@link KILL_SIGNALS}.
 */
export class KillProcessError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-pid' | 'invalid-signal',
  ) {
    super(message);
    this.name = 'KillProcessError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Validates a pid value.
 *
 * Accepts non-negative safe integers. We accept 0 (process group of the
 * caller in some kill(2) implementations) and rely on the kernel to
 * reject sending signals to pids that don't exist.
 */
export function validatePid(pid: unknown): pid is number {
  return (
    typeof pid === 'number' &&
    Number.isInteger(pid) &&
    pid >= 0 &&
    Number.isSafeInteger(pid)
  );
}

/** Validates a signal name. */
export function validateSignal(signal: string): signal is KillSignal {
  return (KILL_SIGNALS as readonly string[]).includes(signal);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends `signal` to `pid` via `kill -<signal> <pid>`.
 *
 * @throws {KillProcessError} code `invalid-pid`    — pid is not a non-negative integer.
 * @throws {KillProcessError} code `invalid-signal` — signal not in the allowlist.
 */
export function killProcess(params: KillProcessParams): KillProcessResult {
  const { pid, signal = 'TERM' } = params;

  if (!validatePid(pid)) {
    throw new KillProcessError(
      `Invalid pid: ${String(pid)}. Pid must be a non-negative safe integer.`,
      'invalid-pid',
    );
  }

  if (!validateSignal(signal)) {
    throw new KillProcessError(
      `Invalid signal: "${signal}". ` +
        `Signal must be one of: ${KILL_SIGNALS.join(', ')}.`,
      'invalid-signal',
    );
  }

  const result = spawnSync('kill', [`-${signal}`, String(pid)], {
    encoding: 'utf-8',
    shell: false,
  });

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    exit_code: result.status ?? 1,
  };
}

/**
 * reboot tool implementation.
 *
 * Triggers an immediate host reboot via `spawnSync('reboot', [], { shell: false })`.
 *
 * Action class: system.service
 *
 * The tool requires `params.confirm === true` as a structural barrier
 * against accidental triggering — the typed-tool layer rejects the call
 * pre-spawn if confirmation is missing, so an agent that forgets the flag
 * cannot reach the binary even with HITL approval. This mirrors the
 * `replace_confirm` pattern used by `crontab_install_from_file` (W7).
 *
 * Non-zero exit codes from `reboot` are returned in `result.exit_code`
 * rather than thrown — though in practice the parent process is rarely
 * around to inspect the result, since reboot signals immediate teardown.
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the reboot tool. */
export interface RebootParams {
  /**
   * Mandatory structural confirmation flag. Must be exactly `true` —
   * any other value (including omitted) is rejected before any spawn.
   */
  confirm: true;
}

/** Result returned by the reboot tool. */
export interface RebootResult {
  /** Standard output captured from the `reboot` binary (often empty). */
  stdout: string;
  /** Standard error captured from the `reboot` binary. */
  stderr: string;
  /** Exit code. May be unobservable in practice — the host is going down. */
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `reboot` during pre-flight validation.
 *
 * - `confirm-required` — `params.confirm` is not exactly `true`.
 */
export class RebootError extends Error {
  constructor(
    message: string,
    public readonly code: 'confirm-required',
  ) {
    super(message);
    this.name = 'RebootError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reboots the host. Pre-flight throws `RebootError` (`confirm-required`)
 * if `params.confirm` is not exactly `true`.
 *
 * @param params - Tool parameters (see {@link RebootParams}).
 * @returns        `{ stdout, stderr, exit_code }` if the spawn returns at all.
 *
 * @throws {RebootError} code `confirm-required` — confirmation flag missing.
 */
export function reboot(params: RebootParams): RebootResult {
  if (params?.confirm !== true) {
    throw new RebootError(
      'reboot requires params.confirm === true. ' +
        'This is a structural barrier against accidental host reboots.',
      'confirm-required',
    );
  }

  const result = spawnSync('reboot', [], {
    encoding: 'utf-8',
    shell: false,
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitCode = result.status ?? 1;

  return { stdout, stderr, exit_code: exitCode };
}

/**
 * systemctl_unit_action tool implementation.
 *
 * Runs a systemd unit lifecycle command by invoking
 * `systemctl <action> <unit>` via `spawnSync`. Arguments are passed directly
 * to the child process — no shell interpolation occurs.
 *
 * Action class: system.service
 *
 * The `unit` and `action` parameters are validated before any spawn:
 *   - `unit` must match the systemd unit-name character set
 *     (letters, digits, `.`, `_`, `@`, `-`); shell metacharacters are
 *     rejected at validation time so a malicious unit string cannot
 *     reach the binary even in the absence of a shell.
 *   - `action` must be one of the lifecycle verbs in `SYSTEMCTL_ACTIONS`.
 *
 * Non-zero exit codes from systemctl are **not** thrown — they are returned
 * in `result.exit_code` so the caller can inspect the outcome (for example,
 * `is-active` / `is-enabled` use exit code semantics instead of stderr).
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Lifecycle verbs supported by this typed tool. */
export const SYSTEMCTL_ACTIONS = [
  'start',
  'stop',
  'restart',
  'reload',
  'enable',
  'disable',
  'mask',
  'unmask',
  'status',
  'is-active',
  'is-enabled',
] as const;

export type SystemctlAction = (typeof SYSTEMCTL_ACTIONS)[number];

/** Input parameters for the systemctl_unit_action tool. */
export interface SystemctlUnitActionParams {
  /**
   * Systemd unit name (e.g. "nginx.service", "user@1000.service").
   * Must match the systemd unit-name character set; shell metacharacters
   * are rejected before invocation.
   */
  unit: string;
  /** Lifecycle verb to apply to the unit. */
  action: SystemctlAction;
}

/** Result returned by the systemctl_unit_action tool. */
export interface SystemctlUnitActionResult {
  /** Standard output captured from systemctl. */
  stdout: string;
  /** Standard error captured from systemctl. */
  stderr: string;
  /**
   * systemctl exit code. Some actions (`is-active`, `is-enabled`) carry
   * meaningful state in the exit code (0 = active/enabled, non-zero
   * otherwise); callers must inspect this even on a successful spawn.
   */
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `systemctlUnitAction` during pre-flight validation.
 *
 * - `invalid-unit`   — the unit name fails the systemd character-set rules.
 * - `invalid-action` — the action verb is not in {@link SYSTEMCTL_ACTIONS}.
 */
export class SystemctlUnitActionError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-unit' | 'invalid-action',
  ) {
    super(message);
    this.name = 'SystemctlUnitActionError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Systemd unit-name pattern.
 *
 * Per `systemd.unit(5)`, unit names consist of letters, digits, and the
 * characters `:`, `-`, `_`, `.`, `\`. We use a stricter conservative subset
 * (no `:` or `\`) because every supported alias in the registry maps to
 * filenames, not template/instance paths. The `@` is permitted to support
 * template instances such as `user@1000.service`.
 *
 * Shell metacharacters are not in the set and so are rejected by definition.
 */
const SYSTEMD_UNIT_NAME = /^[a-zA-Z0-9._@-]+$/;

/** Maximum permitted unit-name length. Conservative cap; real units are <100 chars. */
const MAX_UNIT_LENGTH = 256;

/**
 * Validates a systemd unit name string.
 *
 * @param unit - The unit name to validate.
 * @returns `true` when the name is valid, `false` otherwise.
 */
export function validateUnitName(unit: string): boolean {
  if (typeof unit !== 'string') return false;

  const trimmed = unit.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_UNIT_LENGTH) return false;

  return SYSTEMD_UNIT_NAME.test(trimmed);
}

/**
 * Validates that a string is a recognised systemctl action verb.
 *
 * @param action - The action string to validate.
 * @returns `true` when the verb is in {@link SYSTEMCTL_ACTIONS}, `false` otherwise.
 */
export function validateAction(action: string): action is SystemctlAction {
  return (SYSTEMCTL_ACTIONS as readonly string[]).includes(action);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs `systemctl <action> <unit>` against the host's systemd manager.
 *
 * Pre-flight validation throws `SystemctlUnitActionError` for:
 * - A unit name that fails the character-set check (`invalid-unit`)
 * - An unrecognised action verb (`invalid-action`)
 *
 * Non-zero exit codes from systemctl are **not** thrown — they are returned
 * in `result.exit_code` so the caller can inspect the outcome.
 *
 * @param params - Tool parameters (see {@link SystemctlUnitActionParams}).
 * @returns        `{ stdout, stderr, exit_code }`.
 *
 * @throws {SystemctlUnitActionError} code `invalid-unit`   — unit fails validation.
 * @throws {SystemctlUnitActionError} code `invalid-action` — action verb unknown.
 */
export function systemctlUnitAction(
  params: SystemctlUnitActionParams,
): SystemctlUnitActionResult {
  const { unit, action } = params;

  if (!validateAction(action)) {
    throw new SystemctlUnitActionError(
      `Invalid systemctl action: "${action}". ` +
        `Action must be one of: ${SYSTEMCTL_ACTIONS.join(', ')}.`,
      'invalid-action',
    );
  }

  if (!validateUnitName(unit)) {
    throw new SystemctlUnitActionError(
      `Invalid systemd unit name: "${unit}". ` +
        'Unit names must contain only letters, digits, and the characters ".", "_", "@", "-".',
      'invalid-unit',
    );
  }

  const result = spawnSync('systemctl', [action, unit], {
    encoding: 'utf-8',
    shell: false,
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitCode = result.status ?? 1;

  return { stdout, stderr, exit_code: exitCode };
}

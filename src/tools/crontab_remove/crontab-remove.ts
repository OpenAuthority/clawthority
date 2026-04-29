/**
 * crontab_remove tool implementation.
 *
 * Wraps `crontab -r [-u user]` with a typed parameter schema.
 *
 * Action class: scheduling.persist
 *
 * `crontab -r` removes the entire crontab for the target user.
 * The `user` parameter is required (and explicit) when removing a
 * crontab other than the calling user's own — there is no implicit
 * fallback to root or to a daemon user.
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrontabRemoveParams {
  /**
   * Optional target username (`-u <user>`). When omitted, removes the
   * crontab of the calling user.
   */
  user?: string;
}

export interface CrontabRemoveResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class CrontabRemoveError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-user',
  ) {
    super(message);
    this.name = 'CrontabRemoveError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const SHELL_METACHARACTERS = /[;&|`$(){}\\'"]/;
const POSIX_USERNAME = /^[a-z_][a-z0-9_-]*$/;

export function validateUser(user: string): boolean {
  if (typeof user !== 'string') return false;
  const trimmed = user.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return POSIX_USERNAME.test(trimmed);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function crontabRemove(
  params: CrontabRemoveParams = {},
): CrontabRemoveResult {
  const { user } = params;

  if (user !== undefined && !validateUser(user)) {
    throw new CrontabRemoveError(
      `Invalid crontab user: "${user}".`,
      'invalid-user',
    );
  }

  const args: string[] = ['-r'];
  if (user !== undefined) args.push('-u', user);

  const result = spawnSync('crontab', args, {
    encoding: 'utf-8',
    shell: false,
  });

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    exit_code: result.status ?? 1,
  };
}

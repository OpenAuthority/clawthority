/**
 * crontab_list tool implementation.
 *
 * Wraps `crontab -l [-u user]` with a typed parameter schema.
 *
 * Action class: scheduling.persist
 *
 * Read-only operation; the typed-tool layer keeps it on the
 * scheduling.persist class for policy-targeting consistency
 * (operators frequently want to permit list-only without permitting
 * install or remove). Parameter-level reclassification at the
 * enforcement layer can downgrade this to system.read for read-heavy
 * workflows; that decision belongs to the policy author, not the
 * typed tool.
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrontabListParams {
  /**
   * Optional username. When supplied, runs `crontab -l -u <user>`.
   * Requires elevated privileges in practice; the typed tool does not
   * check that — it lets crontab return the OS-level error.
   */
  user?: string;
}

export interface CrontabListResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class CrontabListError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-user',
  ) {
    super(message);
    this.name = 'CrontabListError';
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

export function crontabList(params: CrontabListParams = {}): CrontabListResult {
  const { user } = params;

  if (user !== undefined && !validateUser(user)) {
    throw new CrontabListError(
      `Invalid crontab user: "${user}". ` +
        'User must be a POSIX-portable name.',
      'invalid-user',
    );
  }

  const args: string[] = ['-l'];
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

/**
 * crontab_install_from_file tool implementation.
 *
 * Wraps `crontab [-u user] <file_path>` with a typed parameter schema.
 *
 * Action class: scheduling.persist
 *
 * `crontab <file>` silently REPLACES the user's entire schedule with
 * the contents of `<file>`. The mandatory `replace_confirm: true`
 * structural barrier mirrors `reboot.confirm` — operators (and HITL
 * approvers) must explicitly acknowledge the destructive replace.
 *
 * Inline edit (`crontab -e`) is **not** supported — that flow is
 * interactive and has no clean structured-input boundary. Operators
 * who need it use unsafe_admin_exec.
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrontabInstallFromFileParams {
  /** Path to the crontab file to install. */
  file_path: string;
  /**
   * Mandatory structural confirmation flag. Must be exactly `true` to
   * acknowledge that this REPLACES the user's existing crontab.
   */
  replace_confirm: true;
  /** Optional target username (`-u <user>`). */
  user?: string;
}

export interface CrontabInstallFromFileResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class CrontabInstallFromFileError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'replace-confirm-required'
      | 'invalid-file-path'
      | 'invalid-user',
  ) {
    super(message);
    this.name = 'CrontabInstallFromFileError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const SHELL_METACHARACTERS = /[;&|`$(){}\\'"]/;
const POSIX_USERNAME = /^[a-z_][a-z0-9_-]*$/;

function validateFilePath(path: string): boolean {
  if (typeof path !== 'string') return false;
  const trimmed = path.trim();
  if (trimmed.length === 0) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return true;
}

function validateUser(user: string): boolean {
  if (typeof user !== 'string') return false;
  const trimmed = user.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return POSIX_USERNAME.test(trimmed);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function crontabInstallFromFile(
  params: CrontabInstallFromFileParams,
): CrontabInstallFromFileResult {
  if (params?.replace_confirm !== true) {
    throw new CrontabInstallFromFileError(
      'crontab_install_from_file requires params.replace_confirm === true. ' +
        'This is a structural barrier acknowledging that the operation ' +
        'replaces the user\'s entire crontab.',
      'replace-confirm-required',
    );
  }

  const { file_path, user } = params;

  if (!validateFilePath(file_path)) {
    throw new CrontabInstallFromFileError(
      `Invalid file_path: "${file_path}".`,
      'invalid-file-path',
    );
  }

  if (user !== undefined && !validateUser(user)) {
    throw new CrontabInstallFromFileError(
      `Invalid crontab user: "${user}".`,
      'invalid-user',
    );
  }

  const args: string[] = [];
  if (user !== undefined) args.push('-u', user);
  args.push(file_path);

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

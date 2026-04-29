/**
 * chown_path tool implementation.
 *
 * Wraps `chown [-R] <owner> <path>` with a typed parameter schema.
 *
 * Action class: permissions.modify
 *
 * Owner spec accepts the canonical chown forms:
 *
 *   - `user`             — change user only
 *   - `user:group`       — change user and group
 *   - `user:`            — change user, group becomes user's primary
 *   - `:group`           — change group only
 *
 * The user/group identifiers are restricted to POSIX-portable name syntax
 * (`[a-z_][a-z0-9_-]*$?`); shell metacharacters are rejected at validation
 * time. Numeric uid/gid forms (e.g. `1000:1000`) are also accepted.
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChownPathParams {
  /** Path to chown. Passed verbatim to chown via spawnSync. */
  path: string;
  /**
   * Owner spec: `user`, `user:group`, `user:`, or `:group`. Names follow
   * POSIX-portable identifier syntax. Numeric uid/gid forms are accepted.
   */
  owner: string;
  /** When `true`, pass `-R` to chown for recursive application. */
  recursive?: boolean;
}

export interface ChownPathResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * - `invalid-path`  — path is empty or contains shell metacharacters.
 * - `invalid-owner` — owner spec does not match the accepted grammar.
 */
export class ChownPathError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-path' | 'invalid-owner',
  ) {
    super(message);
    this.name = 'ChownPathError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const SHELL_METACHARACTERS = /[;&|`$(){}\\'"]/;

/**
 * Owner-spec pattern. Components are either:
 *   - POSIX-portable identifier: `[a-z_][a-z0-9_-]*\$?`
 *   - Numeric (uid/gid): `[0-9]+`
 *
 * The full pattern accepts:
 *   - `<id>`           — user only
 *   - `<id>:<id>`      — user:group
 *   - `<id>:`          — user only, group reset to user's primary
 *   - `:<id>`          — group only
 *
 * Identifiers are case-sensitive lowercase per POSIX recommendation.
 * Samba/Windows machine accounts ending in `$` are rejected because `$`
 * is in the shell-metacharacter denylist; operators with such accounts
 * should fall back to numeric uid/gid.
 */
const ID = '[a-z_][a-z0-9_-]*|[0-9]+';
const OWNER_SPEC = new RegExp(
  `^(?:(?:${ID})(?::(?:${ID})?)?|:(?:${ID}))$`,
);

/** Validates a target path. */
export function validatePath(path: string): boolean {
  if (typeof path !== 'string') return false;
  const trimmed = path.trim();
  if (trimmed.length === 0) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return true;
}

/** Validates an owner spec. */
export function validateOwner(owner: string): boolean {
  if (typeof owner !== 'string') return false;
  const trimmed = owner.trim();
  if (trimmed.length === 0) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return OWNER_SPEC.test(trimmed);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs `chown [-R] <owner> <path>`.
 *
 * @throws {ChownPathError} code `invalid-path`  — path empty or contains shell metacharacters.
 * @throws {ChownPathError} code `invalid-owner` — owner spec malformed.
 */
export function chownPath(params: ChownPathParams): ChownPathResult {
  const { path, owner, recursive } = params;

  if (!validatePath(path)) {
    throw new ChownPathError(
      `Invalid path for chown: "${path}". ` +
        'Path must be a non-empty string with no shell metacharacters.',
      'invalid-path',
    );
  }

  if (!validateOwner(owner)) {
    throw new ChownPathError(
      `Invalid chown owner: "${owner}". ` +
        'Owner must be one of: "user", "user:group", "user:", or ":group" ' +
        'with POSIX-portable identifiers or numeric uid/gid.',
      'invalid-owner',
    );
  }

  const args: string[] = [];
  if (recursive) args.push('-R');
  args.push(owner, path);

  const result = spawnSync('chown', args, {
    encoding: 'utf-8',
    shell: false,
  });

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    exit_code: result.status ?? 1,
  };
}

/**
 * Environment variable-based credential vault.
 *
 * Provides an {@link ICredentialVault} / {@link SecretBackend} implementation
 * backed by `process.env`. Intended for local development and CI environments
 * where secrets are injected as environment variables.
 *
 * Unlike {@link FileCredentialVault}, no async loading step is required — the
 * vault reads from and writes to the live environment at call time, so changes
 * to `process.env` are immediately visible.
 *
 * @experimental This class is subject to change in future releases.
 * Avoid taking hard dependencies on it outside of the W2 workstream.
 */

import type { SecretBackend } from '../tools/secrets/secret-backend.js';
import type { ICredentialVault } from './types.js';

/**
 * Environment variable-based credential vault.
 *
 * Implements both {@link ICredentialVault} and {@link SecretBackend} so it
 * can be used wherever either interface is expected. Credentials are read from
 * and written to `process.env` at call time — no snapshot is taken at
 * construction time.
 *
 * `set()` writes to `process.env` and the change is visible to any subsequent
 * call on this or any other env-backed instance in the same process.
 *
 * @example
 * ```typescript
 * const vault = new EnvCredentialVault();
 * const value = vault.get('DB_PASSWORD'); // process.env['DB_PASSWORD']
 * ```
 *
 * @experimental
 */
export class EnvCredentialVault implements ICredentialVault, SecretBackend {
  /**
   * Returns the value of the environment variable `key`, or `undefined` if
   * the variable is not set.
   */
  get(key: string): string | undefined {
    return process.env[key];
  }

  /**
   * Returns `true` if the environment variable `key` is currently set (even
   * when its value is an empty string).
   */
  has(key: string): boolean {
    return key in process.env;
  }

  /**
   * Returns a snapshot of all environment variable names currently present in
   * `process.env`. The order of keys is not guaranteed.
   */
  keys(): ReadonlyArray<string> {
    return Object.keys(process.env);
  }

  /**
   * Writes `value` to `process.env[key]`.
   *
   * Changes are immediately visible to subsequent `get` / `has` calls on this
   * and any other instance backed by `process.env`.
   */
  set(key: string, value: string): void {
    process.env[key] = value;
  }
}

/**
 * Default singleton {@link EnvCredentialVault} instance.
 *
 * Shared across credential tool invocations that use the env-backed vault
 * interface. Using a singleton avoids repeated instantiation overhead while
 * keeping the vault interface accessible without explicit construction.
 */
export const envVault: EnvCredentialVault = new EnvCredentialVault();

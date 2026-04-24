import { Type } from '@sinclair/typebox';

/**
 * TypeBox schema for a credential JSON file.
 *
 * A credential file is a flat mapping of string keys to string values.
 * Non-string values are rejected during load to prevent silent type coercion.
 *
 * @example
 * ```json
 * {
 *   "DB_PASSWORD": "s3cr3t",
 *   "API_KEY": "key-abc123"
 * }
 * ```
 */
export const CredentialFileSchema = Type.Record(Type.String(), Type.String());

/**
 * Error codes surfaced by {@link CredentialVaultError}.
 *
 * - `file-not-found`: The credential file path does not exist or is not readable.
 * - `invalid-json`: The file contents could not be parsed as JSON.
 * - `invalid-schema`: The parsed JSON does not conform to the expected flat
 *   string-to-string record shape.
 * - `read-only`: A write operation was attempted on a read-only vault.
 */
export type CredentialVaultErrorCode =
  | 'file-not-found'
  | 'invalid-json'
  | 'invalid-schema'
  | 'read-only';

/**
 * Thrown by credential vault implementations when a load or access error occurs.
 *
 * Callers should inspect `code` to distinguish between recoverable and
 * unrecoverable failures (e.g. `file-not-found` may be transient; `read-only`
 * indicates a programming error).
 */
export class CredentialVaultError extends Error {
  constructor(
    message: string,
    public readonly code: CredentialVaultErrorCode,
  ) {
    super(message);
    this.name = 'CredentialVaultError';
  }
}

/**
 * Read-only interface for credential vault providers.
 *
 * Vault implementations supply credentials to secret tools as a pluggable
 * alternative to environment-variable or in-memory backends. Writes and
 * rotations go through the dedicated `write_secret` / `rotate_secret` tools
 * with HITL gates and are not part of this interface.
 *
 * Cloud vault providers (HashiCorp Vault, AWS Secrets Manager, 1Password)
 * are out of scope for this release; see {@link FileCredentialVault} for the
 * file-based implementation.
 *
 * @experimental This interface is subject to change in future releases.
 * Avoid taking hard dependencies on it outside of the W2 workstream.
 */
export interface ICredentialVault {
  /**
   * Returns the credential value for `key`, or `undefined` if the key is
   * not present in the vault.
   */
  get(key: string): string | undefined;

  /**
   * Returns `true` if `key` exists in the vault.
   */
  has(key: string): boolean;

  /**
   * Returns a read-only snapshot of all credential keys present in the vault.
   * The order of keys is not guaranteed.
   */
  keys(): ReadonlyArray<string>;
}

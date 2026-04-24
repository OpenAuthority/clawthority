import { readFile } from 'node:fs/promises';
import { Value } from '@sinclair/typebox/value';
import type { SecretBackend } from '../tools/secrets/secret-backend.js';
import {
  CredentialFileSchema,
  CredentialVaultError,
  type ICredentialVault,
} from './types.js';

/**
 * Configuration for {@link FileCredentialVault}.
 *
 * @experimental
 */
export interface FileCredentialVaultConfig {
  /**
   * Absolute or relative path to the JSON credential file.
   *
   * The file must contain a flat object mapping string keys to string values.
   * Non-string values and nested objects are rejected at load time.
   */
  credentialsPath: string;
}

/**
 * File-based credential vault that reads secrets from a local JSON file.
 *
 * Intended for local development and CI environments where credentials are
 * stored in a project-local JSON file (e.g. `.credentials.json`). Not
 * appropriate for production workloads that require audit trails, versioning,
 * or centrally-managed access control.
 *
 * Credentials are loaded once at construction via {@link FileCredentialVault.load}
 * and held in memory for the lifetime of the instance. The vault is read-only;
 * calling `set()` throws a {@link CredentialVaultError} with code `'read-only'`.
 *
 * To integrate with secret tools that accept a {@link SecretBackend}, pass the
 * vault instance directly — `FileCredentialVault` implements both
 * `ICredentialVault` and `SecretBackend`.
 *
 * @experimental This class is subject to change in future releases.
 * Avoid taking hard dependencies on it outside of the W2 workstream.
 *
 * @example
 * ```typescript
 * const vault = await FileCredentialVault.load({ credentialsPath: '.credentials.json' });
 * const value = vault.get('DB_PASSWORD'); // string | undefined
 * ```
 */
export class FileCredentialVault implements ICredentialVault, SecretBackend {
  private readonly credentials: ReadonlyMap<string, string>;

  private constructor(credentials: Map<string, string>) {
    this.credentials = credentials;
  }

  /**
   * Loads credentials from the JSON file at `config.credentialsPath`.
   *
   * Throws {@link CredentialVaultError} when:
   * - The file does not exist or cannot be read (`'file-not-found'`).
   * - The file contents are not valid JSON (`'invalid-json'`).
   * - The parsed JSON does not match the expected flat string record
   *   schema (`'invalid-schema'`).
   *
   * @param config - Vault configuration specifying the credentials file path.
   * @returns A fully-loaded `FileCredentialVault` instance.
   */
  static async load(config: FileCredentialVaultConfig): Promise<FileCredentialVault> {
    const { credentialsPath } = config;

    let content: string;
    try {
      content = await readFile(credentialsPath, 'utf-8');
    } catch (err) {
      throw new CredentialVaultError(
        `[file-vault] cannot read credential file at ${credentialsPath}: ${String(err)}`,
        'file-not-found',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (err) {
      throw new CredentialVaultError(
        `[file-vault] invalid JSON in credential file at ${credentialsPath}: ${String(err)}`,
        'invalid-json',
      );
    }

    if (!Value.Check(CredentialFileSchema, parsed)) {
      const errors = [...Value.Errors(CredentialFileSchema, parsed)]
        .map((e) => `  ${e.path}: ${e.message}`)
        .join('\n');
      throw new CredentialVaultError(
        `[file-vault] credential file at ${credentialsPath} does not match expected schema:\n${errors}`,
        'invalid-schema',
      );
    }

    const credentials = new Map<string, string>(Object.entries(parsed));
    return new FileCredentialVault(credentials);
  }

  /**
   * Returns the credential value for `key`, or `undefined` if absent.
   */
  get(key: string): string | undefined {
    return this.credentials.get(key);
  }

  /**
   * Returns `true` if `key` exists in the vault.
   */
  has(key: string): boolean {
    return this.credentials.has(key);
  }

  /**
   * Returns a snapshot of all credential keys present in the vault.
   */
  keys(): ReadonlyArray<string> {
    return [...this.credentials.keys()];
  }

  /**
   * Not supported. File-based vaults are read-only.
   *
   * @throws {@link CredentialVaultError} with code `'read-only'` on every call.
   */
  set(_key: string, _value: string): never {
    throw new CredentialVaultError(
      '[file-vault] write operations are not supported on a read-only file vault',
      'read-only',
    );
  }
}

/**
 * Secret backend abstractions shared by read_secret, write_secret, rotate_secret, and store_secret.
 *
 * Backends are injected into each tool function via options, enabling tests to
 * supply lightweight in-memory stubs without touching process.env or external
 * services.
 *
 * Supported built-in backends:
 *   env    — reads/writes process.env; the default when no store is specified.
 *   file   — reads/writes a local JSON credentials file (WritableFileSecretBackend).
 *
 * The allowlist restricts which keys any secret tool may access. When injected
 * via options the supplied value takes precedence; otherwise the implementation
 * falls back to the CLAWTHORITY_SECRET_ALLOWLIST environment variable
 * (comma-separated key names). If neither is present, all key access is denied.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// ─── Backend interface ────────────────────────────────────────────────────────

/**
 * Minimal interface that secret tools accept for pluggable storage.
 *
 * All methods are synchronous to keep the tool API simple. Async backends
 * (e.g. Vault HTTP) must wrap their I/O before implementing this interface.
 */
export interface SecretBackend {
  /** Returns the current value for `key`, or `undefined` if absent. */
  get(key: string): string | undefined;
  /** Stores `value` under `key`. Overwrites any existing entry. */
  set(key: string, value: string): void;
  /** Returns `true` if `key` is present in the store. */
  has(key: string): boolean;
}

// ─── env backend ─────────────────────────────────────────────────────────────

/**
 * Secret backend backed by `process.env`.
 *
 * Suitable for development and CI environments where secrets are passed as
 * environment variables. Not appropriate for production workloads that require
 * audit trails, versioning, or access-controlled storage.
 */
export class EnvSecretBackend implements SecretBackend {
  get(key: string): string | undefined {
    return process.env[key];
  }

  set(key: string, value: string): void {
    process.env[key] = value;
  }

  has(key: string): boolean {
    return key in process.env;
  }
}

/**
 * Default singleton `env` backend.
 * Used when the caller omits `backend` in options and `store` is `'env'`
 * or unset.
 */
export const envBackend: SecretBackend = new EnvSecretBackend();

// ─── In-memory backend (tests) ────────────────────────────────────────────────

/**
 * In-memory secret backend for use in unit tests.
 *
 * Backed by a plain `Map`; changes are isolated to the instance and do not
 * affect `process.env` or any external service.
 */
export class MemorySecretBackend implements SecretBackend {
  private readonly store: Map<string, string>;

  constructor(initial: Record<string, string> = {}) {
    this.store = new Map(Object.entries(initial));
  }

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

// ─── Allowlist helpers ────────────────────────────────────────────────────────

/**
 * Name of the environment variable used to configure the default key allowlist.
 * Value is a comma-separated list of secret key names permitted for access.
 *
 * Example:
 *   CLAWTHORITY_SECRET_ALLOWLIST=DB_PASSWORD,API_KEY,STRIPE_SECRET
 */
export const ALLOWLIST_ENV_VAR = 'CLAWTHORITY_SECRET_ALLOWLIST';

/**
 * Resolves the effective allowlist for a secret tool invocation.
 *
 * Resolution order:
 *   1. `injected` — caller-supplied set/array (highest priority, used in tests).
 *   2. `CLAWTHORITY_SECRET_ALLOWLIST` env var — comma-separated names.
 *   3. Empty set — all access denied (fail-closed default).
 *
 * @param injected  Optional allowlist supplied via tool options.
 * @returns         Resolved `ReadonlySet<string>`.
 */
export function resolveAllowlist(
  injected?: ReadonlySet<string> | ReadonlyArray<string>,
): ReadonlySet<string> {
  if (injected !== undefined) {
    return injected instanceof Set ? injected : new Set(injected);
  }
  const envVal = process.env[ALLOWLIST_ENV_VAR];
  if (typeof envVal === 'string' && envVal.trim().length > 0) {
    return new Set(
      envVal
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0),
    );
  }
  return new Set<string>();
}

/**
 * Returns `true` when `key` is present in `allowlist`.
 * Performs an exact, case-sensitive comparison.
 */
export function isKeyAllowed(key: string, allowlist: ReadonlySet<string>): boolean {
  return allowlist.has(key);
}

// ─── Secure value generation ──────────────────────────────────────────────────

/** Length in bytes for generated secret values before hex-encoding. */
const GENERATED_SECRET_BYTES = 32;

/**
 * Generates a cryptographically-secure random secret value.
 *
 * Returns a 64-character lowercase hex string (256 bits of entropy).
 * Callers that need a different format should derive their preferred
 * representation from this value.
 */
export function generateSecretValue(): string {
  return randomBytes(GENERATED_SECRET_BYTES).toString('hex');
}

// ─── File-based writable backend ─────────────────────────────────────────────

/** Returns true when `obj` is a non-null, non-array object with only string values. */
function isStringRecord(obj: unknown): obj is Record<string, string> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  return Object.values(obj as Record<string, unknown>).every((v) => typeof v === 'string');
}

/**
 * File-based secret backend that persists secrets to a local JSON credentials file.
 *
 * Credentials are loaded into memory at construction and written back to disk on
 * every `set()` call using `writeFileSync`. Use {@link WritableFileSecretBackend.load}
 * to construct an instance from an existing file, or the constructor to create a new
 * empty backend with a given file path.
 *
 * The backing file must contain a flat JSON object mapping string keys to string
 * values. Non-string values are rejected at load time.
 *
 * Used exclusively by `store_secret`. Inject a {@link MemorySecretBackend} in
 * tests to avoid file I/O.
 */
export class WritableFileSecretBackend implements SecretBackend {
  private readonly store: Map<string, string>;
  private readonly filePath: string;

  constructor(filePath: string, initial: Record<string, string> = {}) {
    this.filePath = filePath;
    this.store = new Map(Object.entries(initial));
  }

  /**
   * Loads credentials from a JSON file at `filePath`.
   *
   * If the file does not exist, an empty backend is returned and the file will
   * be created on the first `set()` call.
   *
   * @throws {Error} When the file exists but contains invalid JSON or a
   *   non-flat-string-record value.
   */
  static load(filePath: string): WritableFileSecretBackend {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      // File not found — start empty; created on first write.
      return new WritableFileSecretBackend(filePath);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (err) {
      throw new Error(
        `[file-backend] invalid JSON in credential file at ${filePath}: ${String(err)}`,
      );
    }

    if (!isStringRecord(parsed)) {
      throw new Error(
        `[file-backend] credential file at ${filePath} must be a flat object with string values`,
      );
    }

    return new WritableFileSecretBackend(filePath, parsed);
  }

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  /**
   * Stores `value` under `key` and persists the entire credentials map to disk.
   *
   * @throws {Error} When the file write fails (e.g. permission denied).
   */
  set(key: string, value: string): void {
    this.store.set(key, value);
    const obj = Object.fromEntries(this.store);
    writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

// ─── Backend resolution ───────────────────────────────────────────────────────

/**
 * Resolves the secret backend from the `store` parameter.
 *
 * Currently supported store identifiers:
 *   `env`  — `EnvSecretBackend` (default when store is omitted or `'env'`).
 *
 * All other identifiers fall back to `env` with a warning surfaced via the
 * returned `backendName`. Callers may check `backendName` in audit entries
 * to detect unsupported store identifiers.
 */
export function resolveBackend(
  store: string | undefined,
  injected?: SecretBackend,
): { backend: SecretBackend; backendName: string } {
  if (injected !== undefined) {
    return { backend: injected, backendName: store ?? 'injected' };
  }
  if (store === undefined || store === 'env') {
    return { backend: envBackend, backendName: 'env' };
  }
  // Unknown store — fall back to env backend; callers audit this.
  return { backend: envBackend, backendName: `unknown(${store})→env` };
}

/**
 * store_secret tool implementation.
 *
 * Saves a secret value to a file-based credential store. The file vault is the
 * only supported provider because env is read-only by nature. Access is
 * controlled by an allowlist of permitted key names and a HITL capability token
 * that must be present and unconsumed for every invocation.
 *
 * Security invariants:
 *   - The supplied value is NEVER written to the audit log.
 *   - An absent or empty allowlist causes all key access to be denied.
 *   - The HITL token is consumed before the write so it cannot be replayed
 *     even if the process is killed immediately after the operation.
 *   - Only the file vault provider is supported; env is read-only by nature.
 *
 * Action class: credential.write
 */

import {
  resolveAllowlist,
  isKeyAllowed,
  WritableFileSecretBackend,
} from '../secrets/secret-backend.js';
import type { SecretBackend } from '../secrets/secret-backend.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the store_secret tool. */
export interface StoreSecretParams {
  /** Name or identifier of the secret to store. */
  key: string;
  /** Secret value to persist in the credential file. */
  value: string;
  /**
   * Absolute or relative path to the JSON credential file.
   * Required when no backend is injected via options.
   * The file must contain a flat object mapping string keys to string values.
   * If the file does not exist it will be created on the first write.
   */
  path?: string;
}

/** Successful result from the store_secret tool. */
export interface StoreSecretResult {
  /** Whether the secret was successfully stored in the credential file. */
  stored: boolean;
}

/** Minimal audit logger interface accepted by storeSecret. */
export interface StoreSecretLogger {
  log(entry: Record<string, unknown>): Promise<void>;
}

/**
 * Minimal interface for HITL capability token validation.
 *
 * In production this is satisfied by ApprovalManager from
 * `src/hitl/approval-manager.ts`. Tests may supply a lightweight stub.
 */
export interface StoreSecretApprovalManager {
  /** Returns true if the token has already been resolved or expired. */
  isConsumed(token: string): boolean;
  /**
   * Marks the token as consumed.
   * Returns true when the token was found and resolved, false otherwise.
   */
  resolveApproval(token: string, decision: 'approved' | 'denied'): boolean;
}

/** Contextual options for the storeSecret function. */
export interface StoreSecretOptions {
  /** Optional audit logger for recording all access events. */
  logger?: StoreSecretLogger;
  /** Agent ID included in every audit log entry. */
  agentId?: string;
  /** Channel included in every audit log entry. */
  channel?: string;
  /**
   * HITL capability token issued after human approval.
   * Required for every invocation. Absent → throws 'hitl-required'.
   */
  approval_id?: string;
  /**
   * Approval manager used to validate and consume the capability token.
   * When provided the token is checked for prior consumption (no replay)
   * and consumed before the write is executed.
   */
  approvalManager?: StoreSecretApprovalManager;
  /**
   * Explicit allowlist of permitted key names.
   * When absent, falls back to CLAWTHORITY_SECRET_ALLOWLIST env var.
   * If neither is present, all access is denied.
   */
  allowlist?: ReadonlySet<string> | ReadonlyArray<string>;
  /**
   * Pluggable secret backend. Overrides file resolution when provided.
   * Useful for injecting in-memory stubs in tests.
   */
  backend?: SecretBackend;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `storeSecret`.
 *
 * - `key-denied`      — key is not in the configured allowlist.
 * - `hitl-required`   — approval_id was not provided.
 * - `token-replayed`  — capability token has already been consumed.
 * - `write-error`     — backend write operation failed, or no file path provided.
 */
export class StoreSecretError extends Error {
  constructor(
    message: string,
    public readonly code: 'key-denied' | 'hitl-required' | 'token-replayed' | 'write-error',
  ) {
    super(message);
    this.name = 'StoreSecretError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolves the file backend from params and injected options.
 *
 * Priority:
 *   1. Injected backend (highest — used in tests).
 *   2. params.path — load WritableFileSecretBackend from that path.
 *
 * Returns null when neither is available; caller must treat this as a
 * configuration error.
 */
function resolveFileBackend(
  path: string | undefined,
  injected: SecretBackend | undefined,
): { backend: SecretBackend; backendName: string } | null {
  if (injected !== undefined) {
    const backendName = path !== undefined ? `file:${path}` : 'file:injected';
    return { backend: injected, backendName };
  }
  if (path !== undefined) {
    const backend = WritableFileSecretBackend.load(path);
    return { backend, backendName: `file:${path}` };
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Stores a secret value in the file-based credential store.
 *
 * Gate order:
 *   1. Allowlist check — key must be in the configured allowlist.
 *   2. HITL token      — options.approval_id must be present.
 *   3. Replay check    — token must not have been consumed already.
 *
 * The token is consumed before the write is executed. The value is never
 * written to the audit log — only the key name and backend identifier appear
 * in log entries.
 *
 * @param params   Key, value, and optional file path.
 * @param options  Logger, agent context, HITL token, allowlist, and backend.
 * @returns        `{ stored: true }` on success.
 *
 * @throws {StoreSecretError}  code 'key-denied'     — key not in allowlist.
 * @throws {StoreSecretError}  code 'hitl-required'  — no approval_id.
 * @throws {StoreSecretError}  code 'token-replayed' — token consumed.
 * @throws {StoreSecretError}  code 'write-error'    — backend write failed or no path provided.
 */
export async function storeSecret(
  params: StoreSecretParams,
  options: StoreSecretOptions = {},
): Promise<StoreSecretResult> {
  const {
    logger,
    agentId = 'unknown',
    channel = 'unknown',
    approval_id,
    approvalManager,
    allowlist: allowlistOpt,
    backend: backendOpt,
  } = options;
  const ts = new Date().toISOString();
  const { key, value, path } = params;

  // Resolve the file backend early so configuration errors surface before gates.
  const resolved = resolveFileBackend(path, backendOpt);
  if (resolved === null) {
    await logger?.log({
      ts,
      type: 'store-secret',
      event: 'write-error',
      toolName: 'store_secret',
      key,
      agentId,
      channel,
      reason: 'no file path or injected backend provided',
    });
    throw new StoreSecretError(
      'store_secret requires either a "path" parameter pointing to a credential file or an injected backend.',
      'write-error',
    );
  }
  const { backend, backendName } = resolved;

  // Gate 1: allowlist check.
  const allowlist = resolveAllowlist(allowlistOpt);
  if (!isKeyAllowed(key, allowlist)) {
    await logger?.log({
      ts,
      type: 'store-secret',
      event: 'key-denied',
      toolName: 'store_secret',
      key,
      store: backendName,
      agentId,
      channel,
      reason: 'key is not in the configured allowlist',
    });
    throw new StoreSecretError(
      `store_secret: key '${key}' is not in the configured allowlist.`,
      'key-denied',
    );
  }

  // Gate 2: HITL capability token presence.
  if (!approval_id) {
    await logger?.log({
      ts,
      type: 'store-secret',
      event: 'hitl-required',
      toolName: 'store_secret',
      key,
      store: backendName,
      agentId,
      channel,
      reason: 'HITL approval token is required for every invocation',
    });
    throw new StoreSecretError(
      'store_secret requires a HITL approval token (approval_id) for every invocation.',
      'hitl-required',
    );
  }

  // Gate 3: replay protection — token must not be consumed.
  if (approvalManager?.isConsumed(approval_id)) {
    await logger?.log({
      ts,
      type: 'store-secret',
      event: 'token-replayed',
      toolName: 'store_secret',
      key,
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
      reason: 'capability token has already been consumed',
    });
    throw new StoreSecretError(
      'Capability token has already been consumed and cannot be replayed.',
      'token-replayed',
    );
  }

  // Log the write attempt before consuming the token so the attempt is always
  // recorded even if the process is killed during the write.
  await logger?.log({
    ts,
    type: 'store-secret',
    event: 'store-attempt',
    toolName: 'store_secret',
    key,
    store: backendName,
    agentId,
    channel,
    approvalId: approval_id,
    valueLength: value.length,
  });

  // Consume the token before writing to prevent replay.
  approvalManager?.resolveApproval(approval_id, 'approved');

  try {
    backend.set(key, value);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await logger?.log({
      ts: new Date().toISOString(),
      type: 'store-secret',
      event: 'write-error',
      toolName: 'store_secret',
      key,
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
      error: message,
    });
    throw new StoreSecretError(`store_secret: file write failed: ${message}`, 'write-error');
  }

  await logger?.log({
    ts: new Date().toISOString(),
    type: 'store-secret',
    event: 'store-complete',
    toolName: 'store_secret',
    key,
    store: backendName,
    agentId,
    channel,
    approvalId: approval_id,
    valueLength: value.length,
  });

  return { stored: true };
}

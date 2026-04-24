/**
 * rotate_secret tool implementation.
 *
 * Generates a new cryptographically-random value for an existing secret and
 * writes it to the configured backend store.
 * Access is controlled by an allowlist of permitted key names and a HITL
 * capability token that must be present and unconsumed for every invocation.
 *
 * Security invariants:
 *   - The generated value is NEVER written to the audit log.
 *   - An absent or empty allowlist causes all key access to be denied.
 *   - The key must already exist in the store — rotation does not create new keys.
 *   - The HITL token is consumed before the new value is written so it cannot
 *     be replayed even if the process is killed immediately after the write.
 *
 * Action class: credential.rotate
 */

import {
  resolveAllowlist,
  isKeyAllowed,
  resolveBackend,
  generateSecretValue,
} from '../secrets/secret-backend.js';
import type { SecretBackend } from '../secrets/secret-backend.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the rotate_secret tool. */
export interface RotateSecretParams {
  /** Name or identifier of the secret to rotate. */
  key: string;
  /** Secret store identifier. Defaults to 'env' when omitted. */
  store?: string;
}

/** Successful result from the rotate_secret tool. */
export interface RotateSecretResult {
  /** Whether the secret was successfully rotated. */
  rotated: boolean;
  /** The key whose value was rotated. */
  key: string;
}

/** Minimal audit logger interface accepted by rotateSecret. */
export interface RotateSecretLogger {
  log(entry: Record<string, unknown>): Promise<void>;
}

/**
 * Minimal interface for HITL capability token validation.
 *
 * In production this is satisfied by ApprovalManager from
 * `src/hitl/approval-manager.ts`. Tests may supply a lightweight stub.
 */
export interface RotateSecretApprovalManager {
  /** Returns true if the token has already been resolved or expired. */
  isConsumed(token: string): boolean;
  /**
   * Marks the token as consumed.
   * Returns true when the token was found and resolved, false otherwise.
   */
  resolveApproval(token: string, decision: 'approved' | 'denied'): boolean;
}

/** Contextual options for the rotateSecret function. */
export interface RotateSecretOptions {
  /** Optional audit logger for recording all access events. */
  logger?: RotateSecretLogger;
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
   * and consumed before the rotation write is executed.
   */
  approvalManager?: RotateSecretApprovalManager;
  /**
   * Explicit allowlist of permitted key names.
   * When absent, falls back to CLAWTHORITY_SECRET_ALLOWLIST env var.
   * If neither is present, all access is denied.
   */
  allowlist?: ReadonlySet<string> | ReadonlyArray<string>;
  /**
   * Pluggable secret backend. Overrides the store parameter when provided.
   * Useful for injecting in-memory stubs in tests.
   */
  backend?: SecretBackend;
  /**
   * Injectable value generator for testing.
   * Defaults to `generateSecretValue` (256-bit cryptographic random hex).
   */
  generateValue?: () => string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `rotateSecret`.
 *
 * - `key-denied`      — key is not in the configured allowlist.
 * - `hitl-required`   — approval_id was not provided.
 * - `token-replayed`  — capability token has already been consumed.
 * - `key-not-found`   — key does not exist in the store (rotation requires an existing key).
 * - `write-error`     — backend write operation failed unexpectedly.
 */
export class RotateSecretError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'key-denied'
      | 'hitl-required'
      | 'token-replayed'
      | 'key-not-found'
      | 'write-error',
  ) {
    super(message);
    this.name = 'RotateSecretError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Rotates a secret by generating a new cryptographically-random value and
 * writing it to the configured backend store.
 *
 * Gate order:
 *   1. Allowlist check  — key must be in the configured allowlist.
 *   2. HITL token       — options.approval_id must be present.
 *   3. Replay check     — token must not have been consumed already.
 *   4. Existence check  — key must already exist in the store.
 *
 * The token is consumed before the new value is written to the store. The
 * generated value is never written to the audit log — only the key name,
 * store identifier, and value length appear in log entries.
 *
 * @param params   Key to rotate and optional store identifier.
 * @param options  Logger, agent context, HITL token, allowlist, and backend.
 * @returns        `{ rotated: true, key }` on success.
 *
 * @throws {RotateSecretError}  code 'key-denied'    — key not in allowlist.
 * @throws {RotateSecretError}  code 'hitl-required' — no approval_id.
 * @throws {RotateSecretError}  code 'token-replayed'— token consumed.
 * @throws {RotateSecretError}  code 'key-not-found' — key absent from store.
 * @throws {RotateSecretError}  code 'write-error'   — backend write failed.
 */
export async function rotateSecret(
  params: RotateSecretParams,
  options: RotateSecretOptions = {},
): Promise<RotateSecretResult> {
  const {
    logger,
    agentId = 'unknown',
    channel = 'unknown',
    approval_id,
    approvalManager,
    allowlist: allowlistOpt,
    backend: backendOpt,
    generateValue = generateSecretValue,
  } = options;
  const ts = new Date().toISOString();
  const { key, store } = params;
  const { backend, backendName } = resolveBackend(store, backendOpt);

  // Gate 1: allowlist check.
  const allowlist = resolveAllowlist(allowlistOpt);
  if (!isKeyAllowed(key, allowlist)) {
    await logger?.log({
      ts,
      type: 'rotate-secret',
      event: 'key-denied',
      toolName: 'rotate_secret',
      key,
      store: backendName,
      agentId,
      channel,
      reason: 'key is not in the configured allowlist',
    });
    throw new RotateSecretError(
      `rotate_secret: key '${key}' is not in the configured allowlist.`,
      'key-denied',
    );
  }

  // Gate 2: HITL capability token presence.
  if (!approval_id) {
    await logger?.log({
      ts,
      type: 'rotate-secret',
      event: 'hitl-required',
      toolName: 'rotate_secret',
      key,
      store: backendName,
      agentId,
      channel,
      reason: 'HITL approval token is required for every invocation',
    });
    throw new RotateSecretError(
      'rotate_secret requires a HITL approval token (approval_id) for every invocation.',
      'hitl-required',
    );
  }

  // Gate 3: replay protection — token must not be consumed.
  if (approvalManager?.isConsumed(approval_id)) {
    await logger?.log({
      ts,
      type: 'rotate-secret',
      event: 'token-replayed',
      toolName: 'rotate_secret',
      key,
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
      reason: 'capability token has already been consumed',
    });
    throw new RotateSecretError(
      'Capability token has already been consumed and cannot be replayed.',
      'token-replayed',
    );
  }

  // Gate 4: existence check — rotation requires the key to already be present.
  if (!backend.has(key)) {
    await logger?.log({
      ts,
      type: 'rotate-secret',
      event: 'key-not-found',
      toolName: 'rotate_secret',
      key,
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
      reason: 'key does not exist in the store; rotation requires an existing key',
    });
    throw new RotateSecretError(
      `rotate_secret: key '${key}' does not exist in store '${backendName}'. Rotation requires an existing key.`,
      'key-not-found',
    );
  }

  const newValue = generateValue();

  // Log the rotation attempt before consuming the token so the attempt is
  // always recorded even if the process is killed during the write.
  await logger?.log({
    ts,
    type: 'rotate-secret',
    event: 'rotate-attempt',
    toolName: 'rotate_secret',
    key,
    store: backendName,
    agentId,
    channel,
    approvalId: approval_id,
    newValueLength: newValue.length,
  });

  // Consume the token before writing to prevent replay.
  approvalManager?.resolveApproval(approval_id, 'approved');

  try {
    backend.set(key, newValue);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await logger?.log({
      ts: new Date().toISOString(),
      type: 'rotate-secret',
      event: 'write-error',
      toolName: 'rotate_secret',
      key,
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
      error: message,
    });
    throw new RotateSecretError(`rotate_secret: backend write failed: ${message}`, 'write-error');
  }

  await logger?.log({
    ts: new Date().toISOString(),
    type: 'rotate-secret',
    event: 'rotate-complete',
    toolName: 'rotate_secret',
    key,
    store: backendName,
    agentId,
    channel,
    approvalId: approval_id,
    newValueLength: newValue.length,
  });

  return { rotated: true, key };
}

/**
 * write_secret tool implementation.
 *
 * Stores or updates a secret value in a configured backend store.
 * Access is controlled by an allowlist of permitted key names and a HITL
 * capability token that must be present and unconsumed for every invocation.
 *
 * Security invariants:
 *   - The supplied value is NEVER written to the audit log.
 *   - An absent or empty allowlist causes all key access to be denied.
 *   - The HITL token is consumed before the write so it cannot be replayed
 *     even if the process is killed immediately after the operation.
 *
 * Action class: credential.write
 */

import {
  resolveAllowlist,
  isKeyAllowed,
  resolveBackend,
} from '../secrets/secret-backend.js';
import type { SecretBackend } from '../secrets/secret-backend.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the write_secret tool. */
export interface WriteSecretParams {
  /** Name or identifier of the secret to store. */
  key: string;
  /** Secret value to persist in the store. */
  value: string;
  /** Secret store identifier. Defaults to 'env' when omitted. */
  store?: string;
}

/** Successful result from the write_secret tool. */
export interface WriteSecretResult {
  /** Whether the secret was successfully written to the store. */
  written: boolean;
}

/** Minimal audit logger interface accepted by writeSecret. */
export interface WriteSecretLogger {
  log(entry: Record<string, unknown>): Promise<void>;
}

/**
 * Minimal interface for HITL capability token validation.
 *
 * In production this is satisfied by ApprovalManager from
 * `src/hitl/approval-manager.ts`. Tests may supply a lightweight stub.
 */
export interface WriteSecretApprovalManager {
  /** Returns true if the token has already been resolved or expired. */
  isConsumed(token: string): boolean;
  /**
   * Marks the token as consumed.
   * Returns true when the token was found and resolved, false otherwise.
   */
  resolveApproval(token: string, decision: 'approved' | 'denied'): boolean;
}

/** Contextual options for the writeSecret function. */
export interface WriteSecretOptions {
  /** Optional audit logger for recording all access events. */
  logger?: WriteSecretLogger;
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
  approvalManager?: WriteSecretApprovalManager;
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
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `writeSecret`.
 *
 * - `key-denied`      — key is not in the configured allowlist.
 * - `hitl-required`   — approval_id was not provided.
 * - `token-replayed`  — capability token has already been consumed.
 * - `write-error`     — backend write operation failed unexpectedly.
 */
export class WriteSecretError extends Error {
  constructor(
    message: string,
    public readonly code: 'key-denied' | 'hitl-required' | 'token-replayed' | 'write-error',
  ) {
    super(message);
    this.name = 'WriteSecretError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Writes a secret value to the configured backend store.
 *
 * Gate order:
 *   1. Allowlist check — key must be in the configured allowlist.
 *   2. HITL token      — options.approval_id must be present.
 *   3. Replay check    — token must not have been consumed already.
 *
 * The token is consumed before the write is executed. The value is never
 * written to the audit log — only the key name and store identifier appear
 * in log entries.
 *
 * @param params   Key, value to store, and optional store identifier.
 * @param options  Logger, agent context, HITL token, allowlist, and backend.
 * @returns        `{ written: true }` on success.
 *
 * @throws {WriteSecretError}  code 'key-denied'     — key not in allowlist.
 * @throws {WriteSecretError}  code 'hitl-required'  — no approval_id.
 * @throws {WriteSecretError}  code 'token-replayed' — token consumed.
 * @throws {WriteSecretError}  code 'write-error'    — backend write failed.
 */
export async function writeSecret(
  params: WriteSecretParams,
  options: WriteSecretOptions = {},
): Promise<WriteSecretResult> {
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
  const { key, value, store } = params;
  const { backend, backendName } = resolveBackend(store, backendOpt);

  // Gate 1: allowlist check.
  const allowlist = resolveAllowlist(allowlistOpt);
  if (!isKeyAllowed(key, allowlist)) {
    await logger?.log({
      ts,
      type: 'write-secret',
      event: 'key-denied',
      toolName: 'write_secret',
      key,
      store: backendName,
      agentId,
      channel,
      reason: 'key is not in the configured allowlist',
    });
    throw new WriteSecretError(
      `write_secret: key '${key}' is not in the configured allowlist.`,
      'key-denied',
    );
  }

  // Gate 2: HITL capability token presence.
  if (!approval_id) {
    await logger?.log({
      ts,
      type: 'write-secret',
      event: 'hitl-required',
      toolName: 'write_secret',
      key,
      store: backendName,
      agentId,
      channel,
      reason: 'HITL approval token is required for every invocation',
    });
    throw new WriteSecretError(
      'write_secret requires a HITL approval token (approval_id) for every invocation.',
      'hitl-required',
    );
  }

  // Gate 3: replay protection — token must not be consumed.
  if (approvalManager?.isConsumed(approval_id)) {
    await logger?.log({
      ts,
      type: 'write-secret',
      event: 'token-replayed',
      toolName: 'write_secret',
      key,
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
      reason: 'capability token has already been consumed',
    });
    throw new WriteSecretError(
      'Capability token has already been consumed and cannot be replayed.',
      'token-replayed',
    );
  }

  // Log the write attempt before consuming the token so the attempt is always
  // recorded even if the process is killed during the write.
  await logger?.log({
    ts,
    type: 'write-secret',
    event: 'write-attempt',
    toolName: 'write_secret',
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
      type: 'write-secret',
      event: 'write-error',
      toolName: 'write_secret',
      key,
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
      error: message,
    });
    throw new WriteSecretError(`write_secret: backend write failed: ${message}`, 'write-error');
  }

  await logger?.log({
    ts: new Date().toISOString(),
    type: 'write-secret',
    event: 'write-complete',
    toolName: 'write_secret',
    key,
    store: backendName,
    agentId,
    channel,
    approvalId: approval_id,
    valueLength: value.length,
  });

  return { written: true };
}

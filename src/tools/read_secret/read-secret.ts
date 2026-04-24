/**
 * read_secret tool implementation.
 *
 * Retrieves a secret value from a configured backend store.
 * Access is controlled by an allowlist of permitted key names and a HITL
 * capability token that must be present and unconsumed for every invocation.
 *
 * Security invariants:
 *   - The retrieved value is NEVER written to the audit log.
 *   - An absent or empty allowlist causes all key access to be denied.
 *   - The HITL token is consumed before the value is returned so it cannot
 *     be replayed even if the process is killed immediately after the read.
 *
 * Action class: credential.read
 */

import {
  resolveAllowlist,
  isKeyAllowed,
  resolveBackend,
} from '../secrets/secret-backend.js';
import type { SecretBackend } from '../secrets/secret-backend.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the read_secret tool. */
export interface ReadSecretParams {
  /** Name or identifier of the secret to retrieve. */
  key: string;
  /** Secret store identifier. Defaults to 'env' when omitted. */
  store?: string;
}

/** Successful result from the read_secret tool. */
export interface ReadSecretResult {
  /** The secret value retrieved from the store. */
  value: string;
}

/** Minimal audit logger interface accepted by readSecret. */
export interface ReadSecretLogger {
  log(entry: Record<string, unknown>): Promise<void>;
}

/**
 * Minimal interface for HITL capability token validation.
 *
 * In production this is satisfied by ApprovalManager from
 * `src/hitl/approval-manager.ts`. Tests may supply a lightweight stub.
 */
export interface ReadSecretApprovalManager {
  /** Returns true if the token has already been resolved or expired. */
  isConsumed(token: string): boolean;
  /**
   * Marks the token as consumed.
   * Returns true when the token was found and resolved, false otherwise.
   */
  resolveApproval(token: string, decision: 'approved' | 'denied'): boolean;
}

/** Contextual options for the readSecret function. */
export interface ReadSecretOptions {
  /** Optional audit logger for recording all access events. */
  logger?: ReadSecretLogger;
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
   * and consumed before the value is returned.
   */
  approvalManager?: ReadSecretApprovalManager;
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
 * Typed error thrown by `readSecret`.
 *
 * - `key-denied`      — key is not in the configured allowlist.
 * - `hitl-required`   — approval_id was not provided.
 * - `token-replayed`  — capability token has already been consumed.
 * - `not-found`       — key exists in the allowlist but has no value in the store.
 */
export class ReadSecretError extends Error {
  constructor(
    message: string,
    public readonly code: 'key-denied' | 'hitl-required' | 'token-replayed' | 'not-found',
  ) {
    super(message);
    this.name = 'ReadSecretError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads a secret value from the configured backend store.
 *
 * Gate order:
 *   1. Allowlist check — key must be in the configured allowlist.
 *   2. HITL token      — options.approval_id must be present.
 *   3. Replay check    — token must not have been consumed already.
 *
 * The token is consumed before the value is returned. The value itself is
 * never written to the audit log — only the key name and store identifier
 * appear in log entries.
 *
 * @param params   Key to read and optional store identifier.
 * @param options  Logger, agent context, HITL token, allowlist, and backend.
 * @returns        `{ value }` — the secret value from the store.
 *
 * @throws {ReadSecretError}  code 'key-denied'     — key not in allowlist.
 * @throws {ReadSecretError}  code 'hitl-required'  — no approval_id.
 * @throws {ReadSecretError}  code 'token-replayed' — token consumed.
 * @throws {ReadSecretError}  code 'not-found'      — key absent from store.
 */
export async function readSecret(
  params: ReadSecretParams,
  options: ReadSecretOptions = {},
): Promise<ReadSecretResult> {
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
  const { key, store } = params;
  const { backend, backendName } = resolveBackend(store, backendOpt);

  // Gate 1: allowlist check.
  const allowlist = resolveAllowlist(allowlistOpt);
  if (!isKeyAllowed(key, allowlist)) {
    await logger?.log({
      ts,
      type: 'read-secret',
      event: 'key-denied',
      toolName: 'read_secret',
      key,
      store: backendName,
      agentId,
      channel,
      reason: 'key is not in the configured allowlist',
    });
    throw new ReadSecretError(
      `read_secret: key '${key}' is not in the configured allowlist.`,
      'key-denied',
    );
  }

  // Gate 2: HITL capability token presence.
  if (!approval_id) {
    await logger?.log({
      ts,
      type: 'read-secret',
      event: 'hitl-required',
      toolName: 'read_secret',
      key,
      store: backendName,
      agentId,
      channel,
      reason: 'HITL approval token is required for every invocation',
    });
    throw new ReadSecretError(
      'read_secret requires a HITL approval token (approval_id) for every invocation.',
      'hitl-required',
    );
  }

  // Gate 3: replay protection — token must not be consumed.
  if (approvalManager?.isConsumed(approval_id)) {
    await logger?.log({
      ts,
      type: 'read-secret',
      event: 'token-replayed',
      toolName: 'read_secret',
      key,
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
      reason: 'capability token has already been consumed',
    });
    throw new ReadSecretError(
      'Capability token has already been consumed and cannot be replayed.',
      'token-replayed',
    );
  }

  // Log the access attempt before consuming the token so the attempt is always
  // recorded even if the process is killed during the read.
  await logger?.log({
    ts,
    type: 'read-secret',
    event: 'read-attempt',
    toolName: 'read_secret',
    key,
    store: backendName,
    agentId,
    channel,
    approvalId: approval_id,
  });

  // Consume the token before reading to prevent replay.
  approvalManager?.resolveApproval(approval_id, 'approved');

  const value = backend.get(key);
  if (value === undefined) {
    await logger?.log({
      ts: new Date().toISOString(),
      type: 'read-secret',
      event: 'not-found',
      toolName: 'read_secret',
      key,
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
    });
    throw new ReadSecretError(
      `read_secret: key '${key}' not found in store '${backendName}'.`,
      'not-found',
    );
  }

  // Log success WITHOUT the value — only the key and metadata.
  await logger?.log({
    ts: new Date().toISOString(),
    type: 'read-secret',
    event: 'read-complete',
    toolName: 'read_secret',
    key,
    store: backendName,
    agentId,
    channel,
    approvalId: approval_id,
    valueLength: value.length,
  });

  return { value };
}

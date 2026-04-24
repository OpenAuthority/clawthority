/**
 * list_secrets tool implementation.
 *
 * Enumerates the names of secrets that are present in the configured backend
 * store. Only key names from the configured allowlist that exist in the
 * backend are returned — values are never retrieved or returned.
 *
 * Access is controlled by a HITL capability token that must be present and
 * unconsumed for every invocation. The allowlist restricts enumeration to
 * pre-approved key names.
 *
 * Security invariants:
 *   - Secret values are NEVER retrieved or written to the audit log.
 *   - Only keys that appear in both the allowlist and the backend are returned.
 *   - An absent or empty allowlist results in an empty key list (fail-closed).
 *   - The HITL token is consumed before enumeration begins so it cannot be
 *     replayed even if the process is killed during listing.
 *
 * Action class: credential.list
 */

import {
  resolveAllowlist,
  resolveBackend,
} from '../secrets/secret-backend.js';
import type { SecretBackend } from '../secrets/secret-backend.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the list_secrets tool. */
export interface ListSecretsParams {
  /** Secret store identifier. Defaults to 'env' when omitted. */
  store?: string;
}

/** Successful result from the list_secrets tool. */
export interface ListSecretsResult {
  /** Names of secrets present in the store. Values are never returned. */
  keys: string[];
}

/** Minimal audit logger interface accepted by listSecrets. */
export interface ListSecretsLogger {
  log(entry: Record<string, unknown>): Promise<void>;
}

/**
 * Minimal interface for HITL capability token validation.
 *
 * In production this is satisfied by ApprovalManager from
 * `src/hitl/approval-manager.ts`. Tests may supply a lightweight stub.
 */
export interface ListSecretsApprovalManager {
  /** Returns true if the token has already been resolved or expired. */
  isConsumed(token: string): boolean;
  /**
   * Marks the token as consumed.
   * Returns true when the token was found and resolved, false otherwise.
   */
  resolveApproval(token: string, decision: 'approved' | 'denied'): boolean;
}

/** Contextual options for the listSecrets function. */
export interface ListSecretsOptions {
  /** Optional audit logger for recording all access events. */
  logger?: ListSecretsLogger;
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
   * and consumed before enumeration begins.
   */
  approvalManager?: ListSecretsApprovalManager;
  /**
   * Explicit allowlist of permitted key names.
   * When absent, falls back to CLAWTHORITY_SECRET_ALLOWLIST env var.
   * If neither is present, enumeration returns an empty list (fail-closed).
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
 * Typed error thrown by `listSecrets`.
 *
 * - `hitl-required`   — approval_id was not provided.
 * - `token-replayed`  — capability token has already been consumed.
 * - `vault-error`     — backend threw unexpectedly during enumeration.
 */
export class ListSecretsError extends Error {
  constructor(
    message: string,
    public readonly code: 'hitl-required' | 'token-replayed' | 'vault-error',
  ) {
    super(message);
    this.name = 'ListSecretsError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Lists the names of secrets present in the configured backend store.
 *
 * Gate order:
 *   1. HITL token      — options.approval_id must be present.
 *   2. Replay check    — token must not have been consumed already.
 *   3. Enumeration     — iterate allowlist, return keys present in backend.
 *
 * The token is consumed before enumeration begins. Secret values are never
 * retrieved. Only key names that appear in both the allowlist and the
 * backend are included in the result.
 *
 * @param params   Optional store identifier.
 * @param options  Logger, agent context, HITL token, allowlist, and backend.
 * @returns        `{ keys }` — names of secrets present in the store.
 *
 * @throws {ListSecretsError}  code 'hitl-required'  — no approval_id.
 * @throws {ListSecretsError}  code 'token-replayed' — token consumed.
 * @throws {ListSecretsError}  code 'vault-error'    — backend threw during enumeration.
 */
export async function listSecrets(
  params: ListSecretsParams,
  options: ListSecretsOptions = {},
): Promise<ListSecretsResult> {
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
  const { store } = params;
  const { backend, backendName } = resolveBackend(store, backendOpt);

  // Gate 1: HITL capability token presence.
  if (!approval_id) {
    await logger?.log({
      ts,
      type: 'list-secrets',
      event: 'hitl-required',
      toolName: 'list_secrets',
      store: backendName,
      agentId,
      channel,
      reason: 'HITL approval token is required for every invocation',
    });
    throw new ListSecretsError(
      'list_secrets requires a HITL approval token (approval_id) for every invocation.',
      'hitl-required',
    );
  }

  // Gate 2: replay protection — token must not be consumed.
  if (approvalManager?.isConsumed(approval_id)) {
    await logger?.log({
      ts,
      type: 'list-secrets',
      event: 'token-replayed',
      toolName: 'list_secrets',
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
      reason: 'capability token has already been consumed',
    });
    throw new ListSecretsError(
      'Capability token has already been consumed and cannot be replayed.',
      'token-replayed',
    );
  }

  // Resolve the allowlist — this defines the universe of keys that may be listed.
  const allowlist = resolveAllowlist(allowlistOpt);

  // Log the enumeration attempt before consuming the token so the attempt is
  // always recorded even if the process is killed during enumeration.
  await logger?.log({
    ts,
    type: 'list-secrets',
    event: 'list-attempt',
    toolName: 'list_secrets',
    store: backendName,
    agentId,
    channel,
    approvalId: approval_id,
    allowlistSize: allowlist.size,
  });

  // Consume the token before enumerating to prevent replay.
  approvalManager?.resolveApproval(approval_id, 'approved');

  // Gate 3: enumerate — return allowlisted keys that exist in the backend.
  let keys: string[];
  try {
    keys = [...allowlist].filter((key) => backend.has(key));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await logger?.log({
      ts: new Date().toISOString(),
      type: 'list-secrets',
      event: 'vault-error',
      toolName: 'list_secrets',
      store: backendName,
      agentId,
      channel,
      approvalId: approval_id,
      error: message,
    });
    throw new ListSecretsError(`list_secrets: backend enumeration failed: ${message}`, 'vault-error');
  }

  await logger?.log({
    ts: new Date().toISOString(),
    type: 'list-secrets',
    event: 'list-complete',
    toolName: 'list_secrets',
    store: backendName,
    agentId,
    channel,
    approvalId: approval_id,
    keyCount: keys.length,
    keys,
  });

  return { keys };
}

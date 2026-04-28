import { createHash, randomBytes } from 'node:crypto';
import type { HitlPolicy, HitlFallback } from './types.js';

export type HitlDecision = 'approved' | 'denied' | 'expired';

export interface CreateApprovalOpts {
  toolName: string;
  agentId: string;
  channelId: string;
  policy: HitlPolicy;
  /** SHA-256 (or similar) hash of the tool call payload for binding. */
  payload_hash?: string;
  /** Logical action class (defaults to toolName if omitted). */
  action_class?: string;
  /** Target resource of the action (e.g. email address, file path). */
  target?: string;
  /** Human-readable summary of the requested action. */
  summary?: string;
  /** Session identifier used when mode is 'session_approval'. */
  session_id?: string;
  /** Keying mode: 'per_request' (default) uses a UUID v7 token;
   *  'session_approval' keys by session_id:action_class. */
  mode?: 'per_request' | 'session_approval';
}

export interface ApprovalRequestHandle {
  token: string;
  promise: Promise<HitlDecision>;
}

interface PendingApproval {
  token: string;
  toolName: string;
  agentId: string;
  channelId: string;
  policyName: string;
  fallback: HitlFallback;
  createdAt: number;
  timeoutMs: number;
  payload_hash: string;
  action_class: string;
  target: string;
  summary: string;
  /** SHA-256(action_class + '|' + target + '|' + payload_hash) */
  binding: string;
  resolve: (decision: HitlDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Generates a UUID v7 token.
 *
 * UUID v7 is time-ordered: the first 48 bits encode the Unix timestamp in
 * milliseconds, followed by a 4-bit version (0111), 12 random bits, a 2-bit
 * variant (10), and 62 random bits. This gives strong uniqueness while
 * remaining lexicographically sortable.
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  const now = BigInt(Date.now());

  // 48-bit millisecond timestamp
  bytes[0] = Number((now >> 40n) & 0xffn);
  bytes[1] = Number((now >> 32n) & 0xffn);
  bytes[2] = Number((now >> 24n) & 0xffn);
  bytes[3] = Number((now >> 16n) & 0xffn);
  bytes[4] = Number((now >> 8n) & 0xffn);
  bytes[5] = Number(now & 0xffn);

  // Version 7 (bits 76–79 of byte 6)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // Variant 10xx (bits 78–79 of byte 8)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Computes the SHA-256 payload binding.
 *
 * binding = SHA-256(action_class + '|' + target + '|' + payload_hash)
 */
export function computeBinding(action_class: string, target: string, payload_hash: string): string {
  return createHash('sha256')
    .update(`${action_class}|${target}|${payload_hash}`)
    .digest('hex');
}

/** @deprecated Use uuidv7() instead. Retained for backward compatibility. */
export function generateToken(): string {
  return uuidv7();
}

/**
 * Manages pending HITL approval requests in-memory.
 *
 * Each request is keyed by a unique token and has a TTL timer.
 * When the timer expires, the request is resolved as 'expired'.
 *
 * In `session_approval` mode the key is `session_id:action_class`, allowing
 * one human approval to cover all requests of the same action class within a
 * session.
 *
 * **F-02 — In-Memory Limitation:** Both the `pending` map and the `consumed`
 * set are held entirely in memory. A process restart clears both structures.
 * Any capability token that was issued (and possibly approved) immediately
 * before a restart remains valid and replayable until its TTL expires, because
 * the consumed-token set no longer records it. This is a known, accepted
 * limitation of the file adapter.
 *
 * **Operational impact of restart:**
 * - All pending (unresolved) approvals are lost — operators must re-approve.
 * - All consumed tokens are forgotten — previously-used tokens become replayable
 *   within their remaining TTL window.
 * - All in-flight revocations are lost — a token explicitly revoked before the
 *   restart is treated as unconsumed after the restart.
 *
 * **Mitigations (file adapter):** Keep the capability TTL short (30–60 s) and
 * configure your process manager with a restart backoff of at least the TTL.
 * See `docs/installation.md` § "Known Limits — F-02" for the full impact table
 * and `docs/operator-security-guide.md` § "F-02" for operational procedures.
 *
 * **Forward path:** Migrate to the Firma remote adapter when it ships. The
 * remote adapter persists both consumed-token records and revocations
 * server-side, eliminating this in-memory limitation entirely.
 */
export class ApprovalManager {
  private readonly pending = new Map<string, PendingApproval>();
  /**
   * Tracks tokens that have been consumed (approved, denied, expired, or
   * cancelled). Checked by `isConsumed()` to prevent replay.
   *
   * **F-02:** This set is in-memory only. A process restart clears it,
   * allowing previously-consumed tokens to be replayed within their TTL.
   */
  private readonly consumed = new Set<string>();

  /**
   * Tracks session-scoped auto-approvals keyed by `channelId:action_class`.
   *
   * When an operator clicks 🔁 "Approve Always" in a Slack message or a
   * Telegram inline keyboard, the corresponding key is added here so future
   * requests of the same action class from the same channel are auto-approved
   * without further HITL prompts.
   *
   * In-memory only — cleared on process restart.
   */
  private readonly sessionAutoApprovals = new Set<string>();

  /**
   * Creates a new approval request and returns a handle with a token and
   * a promise that blocks until the request is resolved or expires.
   */
  createApprovalRequest(opts: CreateApprovalOpts): ApprovalRequestHandle {
    const payload_hash = opts.payload_hash ?? '';
    const action_class = opts.action_class ?? opts.toolName;
    const target = opts.target ?? '';
    const summary = opts.summary ?? '';
    const binding = computeBinding(action_class, target, payload_hash);

    // session_approval mode: key by session_id:action_class
    const token =
      opts.mode === 'session_approval' && opts.session_id
        ? `${opts.session_id}:${action_class}`
        : uuidv7();

    const timeoutMs = opts.policy.approval.timeout * 1000;

    let resolve!: (decision: HitlDecision) => void;
    const promise = new Promise<HitlDecision>((res) => {
      resolve = res;
    });

    const timer = setTimeout(() => {
      this.pending.delete(token);
      this.consumed.add(token);
      resolve('expired');
    }, timeoutMs);

    // Prevent the timer from keeping the Node.js process alive.
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    const entry: PendingApproval = {
      token,
      toolName: opts.toolName,
      agentId: opts.agentId,
      channelId: opts.channelId,
      policyName: opts.policy.name,
      fallback: opts.policy.approval.fallback,
      createdAt: Date.now(),
      timeoutMs,
      payload_hash,
      action_class,
      target,
      summary,
      binding,
      resolve,
      timer,
    };

    this.pending.set(token, entry);
    return { token, promise };
  }

  /**
   * Resolves a pending approval request.
   *
   * If `binding` is supplied it must match the stored SHA-256 binding;
   * a mismatch is treated as an unknown token and returns false.
   *
   * @returns `true` if the token was found and resolved, `false` if unknown,
   *          already resolved, or binding mismatch.
   */
  resolveApproval(token: string, decision: 'approved' | 'denied', binding?: string): boolean {
    const entry = this.pending.get(token);
    if (!entry) return false;

    // Validate payload binding when provided
    if (binding !== undefined && binding !== entry.binding) {
      return false;
    }

    clearTimeout(entry.timer);
    this.pending.delete(token);
    this.consumed.add(token);
    entry.resolve(decision);
    return true;
  }

  /**
   * Cancels a pending approval request (resolves as 'expired').
   * Used when the notification channel is unreachable.
   */
  cancel(token: string): void {
    const entry = this.pending.get(token);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(token);
    this.consumed.add(token);
    entry.resolve('expired');
  }

  /** Returns true if the token has already been resolved or expired. */
  isConsumed(token: string): boolean {
    return this.consumed.has(token);
  }

  /** Returns the pending approval entry for a token, or undefined. */
  getPending(token: string): Omit<PendingApproval, 'resolve' | 'timer'> | undefined {
    const entry = this.pending.get(token);
    if (!entry) return undefined;
    const { resolve: _r, timer: _t, ...rest } = entry;
    return rest;
  }

  /** Number of currently pending approval requests. */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Returns a snapshot of all pending approvals, sorted oldest-first.
   *
   * Omits internal fields (resolve, timer) so the result is safe to
   * serialise and pass to UI layers.
   */
  listPending(): Array<Omit<PendingApproval, 'resolve' | 'timer'>> {
    return [...this.pending.values()]
      .map(({ resolve: _r, timer: _t, ...rest }) => rest)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Resolves multiple pending approval requests with the same decision.
   *
   * Skips tokens that are unknown, already consumed, or have a binding
   * mismatch (same semantics as `resolveApproval`). Returns the count
   * of tokens that were successfully resolved.
   */
  batchResolve(tokens: readonly string[], decision: 'approved' | 'denied'): number {
    let count = 0;
    for (const token of tokens) {
      if (this.resolveApproval(token, decision)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Registers a session-scoped auto-approval for the given channel and
   * action class. Once registered, `isSessionAutoApproved()` returns true
   * for that `channelId:action_class` pair until the process restarts.
   *
   * Called by: Slack button clicks, Telegram inline buttons, and the
   * Telegram `/approve_always TOKEN` text command.
   */
  addSessionAutoApproval(channelId: string, actionClass: string): void {
    this.sessionAutoApprovals.add(`${channelId}:${actionClass}`);
  }

  /**
   * Returns true if a session-scoped auto-approval has been registered for
   * the given channel and action class.
   *
   * Used by the HITL dispatch path to skip creating a new approval request
   * when the operator has previously granted "Approve Always" for this
   * channel+action_class combination.
   */
  isSessionAutoApproved(channelId: string, actionClass: string): boolean {
    return this.sessionAutoApprovals.has(`${channelId}:${actionClass}`);
  }

  /** Clears all pending approvals, resolving each as 'expired'. */
  shutdown(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      this.consumed.add(entry.token);
      entry.resolve('expired');
    }
    this.pending.clear();
    this.sessionAutoApprovals.clear();
  }
}

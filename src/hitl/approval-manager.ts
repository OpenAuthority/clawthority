import { randomBytes } from 'node:crypto';
import type { HitlPolicy, HitlFallback } from './types.js';

export type HitlDecision = 'approved' | 'denied' | 'expired';

export interface CreateApprovalOpts {
  toolName: string;
  agentId: string;
  channelId: string;
  policy: HitlPolicy;
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
  resolve: (decision: HitlDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Generates an 8-character alphanumeric token. */
export function generateToken(): string {
  return randomBytes(6).toString('base64url').slice(0, 8);
}

/**
 * Manages pending HITL approval requests in-memory.
 *
 * Each request is keyed by a unique token and has a TTL timer.
 * When the timer expires, the request is resolved as 'expired'.
 */
export class ApprovalManager {
  private readonly pending = new Map<string, PendingApproval>();

  /**
   * Creates a new approval request and returns a handle with a token and
   * a promise that blocks until the request is resolved or expires.
   */
  createApprovalRequest(opts: CreateApprovalOpts): ApprovalRequestHandle {
    const token = generateToken();
    const timeoutMs = opts.policy.approval.timeout * 1000;

    let resolve!: (decision: HitlDecision) => void;
    const promise = new Promise<HitlDecision>((res) => {
      resolve = res;
    });

    const timer = setTimeout(() => {
      this.pending.delete(token);
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
      resolve,
      timer,
    };

    this.pending.set(token, entry);
    return { token, promise };
  }

  /**
   * Resolves a pending approval request.
   *
   * @returns `true` if the token was found and resolved, `false` if unknown or already resolved.
   */
  resolveApproval(token: string, decision: 'approved' | 'denied'): boolean {
    const entry = this.pending.get(token);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(token);
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
    entry.resolve('expired');
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

  /** Clears all pending approvals, resolving each as 'expired'. */
  shutdown(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve('expired');
    }
    this.pending.clear();
  }
}

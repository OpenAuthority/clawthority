/** The effect a rule produces when matched */
export type Effect = 'permit' | 'forbid';

/** The resource type a rule applies to */
export type Resource =
  | 'tool' | 'command' | 'channel' | 'prompt' | 'model'
  | 'file' | 'external' | 'payment' | 'system' | 'credential' | 'web' | 'memory' | 'unknown';

/** Context passed to rule condition functions */
export interface RuleContext {
  /** The ID of the agent making the request */
  agentId: string;
  /** The channel through which the request is made */
  channel: string;
  /**
   * True when the (agentId, channel) pair was verified against the
   * AgentIdentityRegistry. When the registry is empty, every context is
   * treated as verified for backwards compatibility. Rule conditions that
   * trust `agentId` or `channel` (e.g. prefix checks, admin-channel gating)
   * should require `verified === true` before honouring those claims.
   */
  verified?: boolean;
  /** Optional user ID associated with the request */
  userId?: string;
  /** Optional session ID for the current session */
  sessionId?: string;
  /** Arbitrary additional metadata */
  metadata?: Record<string, unknown>;
}

/** Rate limiting configuration for a rule */
export interface RateLimit {
  /** Maximum number of calls allowed within the time window */
  maxCalls: number;
  /** Duration of the time window in seconds */
  windowSeconds: number;
}

export type EvaluationEffect = 'permit' | 'forbid';

/** Rate limit status included in evaluation decisions when a rule carries rateLimit config. */
export interface RateLimitStatus {
  limited: boolean;
  maxCalls: number;
  windowSeconds: number;
  currentCount: number;
  oldestCallExpiresAt?: number;
}

/**
 * Decision returned by {@link CedarEngine.evaluate} and
 * {@link CedarEngine.evaluateByActionClass}.
 */
export interface EvaluationDecision {
  effect: EvaluationEffect;
  reason?: string;
  /** The rule whose effect determined the outcome (absent when using Cedar WASM evaluation). */
  matchedRule?: Rule;
  rateLimit?: RateLimitStatus;
}

/** A policy rule defining access control for a resource */
export interface Rule {
  /** Whether this rule permits or forbids access */
  effect: Effect;
  /** The type of resource this rule applies to; omitted for action_class-based rules */
  resource?: Resource;
  /** Pattern or identifier to match against the resource name; omitted for action_class-based rules */
  match?: string | RegExp;
  /** Optional condition function for fine-grained control */
  condition?: (context: RuleContext) => boolean;
  /** Human-readable reason for the rule */
  reason?: string;
  /** Tags for categorizing or filtering rules */
  tags?: string[];
  /** Optional rate limiting configuration */
  rateLimit?: RateLimit;
  /** Action class for Stage 2 semantic evaluation matching (e.g. 'filesystem.read') */
  action_class?: string;
  /**
   * Evaluation priority. Lower numbers are evaluated first.
   * Tier 10 = permitted baseline, 90 = HITL-gated forbid, 100 = unconditional forbid.
   */
  priority?: number;
}

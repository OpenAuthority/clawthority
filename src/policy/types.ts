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

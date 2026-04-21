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
  /** Intent group for grouping related actions (e.g. 'data_exfiltration') */
  intent_group?: string;
  /**
   * Regex or string pattern matched against the specific target of the action
   * (e.g. an email address, URL, or file path). When set, the rule only applies
   * when the target also matches this pattern. Used alongside `match` or
   * `action_class` to narrow scope to individual targets.
   */
  target_match?: string | RegExp;
  /**
   * Exhaustive list of specific target values this rule applies to.
   * Checked for exact case-insensitive equality against the target.
   * When set, the rule only applies when the target appears in this list.
   */
  target_in?: string[];
  /**
   * Evaluation priority. Lower numbers are evaluated first.
   *
   * Tiers used by Clawthority's handler in `src/index.ts`:
   *   10  — permitted baseline (permit rules)
   *   90  — HITL-gated forbid: the rule's `forbid` is deferred to the HITL
   *         policy. If a matching policy approves, the tool call proceeds;
   *         otherwise the forbid is upheld.
   *   100 — unconditional forbid: always blocks, regardless of HITL config.
   *
   * Rules without an explicit `priority` are treated as unconditional —
   * user-written `forbid` rules fail closed unless they opt in to the HITL
   * tier by setting `priority: 90`.
   */
  priority?: number;
}

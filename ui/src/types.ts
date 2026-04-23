/**
 * UI-side type definitions mirroring the backend policy types.
 *
 * RegExp fields (match, target_match) are represented as strings here
 * since they arrive serialised from the API.
 */

export type Effect = 'permit' | 'forbid';

export type Resource =
  | 'tool'
  | 'command'
  | 'channel'
  | 'prompt'
  | 'model'
  | 'file'
  | 'external'
  | 'payment'
  | 'system'
  | 'credential'
  | 'web'
  | 'memory'
  | 'unknown';

export interface RateLimit {
  maxCalls: number;
  windowSeconds: number;
}

export interface Rule {
  effect: Effect;
  resource?: Resource;
  /** String pattern matched against the resource name. */
  match?: string;
  reason?: string;
  tags?: string[];
  rateLimit?: RateLimit;
  action_class?: string;
  intent_group?: string;
  /** String or regex pattern matched against the specific target of the action. */
  target_match?: string;
  /** Exhaustive list of specific target values this rule applies to. */
  target_in?: string[];
  priority?: number;
}

/**
 * A single record of the rule being triggered in the audit log.
 * Surfaced in the deletion confirmation dialog to show impact.
 */
export interface AuditHit {
  /** ISO 8601 timestamp of when the rule was matched. */
  timestamp: string;
  /** The action or tool call that matched this rule. */
  action: string;
  /** The effect the rule applied. */
  effect: 'permit' | 'forbid';
  /** Optional agent ID that triggered the match. */
  agentId?: string;
}

/** A single labelled field in the formatted rule display. */
export interface RuleField {
  label: string;
  value: string;
  ariaLabel: string;
}

// ─── Batch Approval types ─────────────────────────────────────────────────────

/** A pending HITL approval request, mirroring the backend PendingApproval shape. */
export interface PendingApprovalItem {
  token: string;
  toolName: string;
  agentId: string;
  channelId: string;
  policyName: string;
  /** 'deny' | 'auto-approve' */
  fallback: string;
  /** Unix ms when the request was created. */
  createdAt: number;
  /** Milliseconds until the request expires. */
  timeoutMs: number;
  action_class: string;
  target: string;
  summary: string;
  /** Optional session identifier (present when mode is 'session_approval'). */
  session_id?: string;
}

/**
 * Configures how the batch approval panel groups and batches requests.
 *
 * @field groupBy - Dimension used to cluster similar requests.
 * @field autoGroupThreshold - Minimum group size before bulk actions appear (default 2).
 * @field sessionScope - When non-null, only show items for this session ID.
 * @field maxBatchSize - Cap on how many items may be bulk-actioned at once (0 = unlimited).
 */
export interface BatchingConfig {
  groupBy: 'action_class' | 'agent_id' | 'policy_name';
  autoGroupThreshold: number;
  sessionScope: string | null;
  maxBatchSize: number;
}

// ─── Unclassified Tool Widget types ──────────────────────────────────────────

/** A single bucketed data point for the unclassified tool time series. */
export interface UnclassifiedDataPoint {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  count: number;
}

/** Per-tool breakdown row returned by the audit endpoint. */
export interface UnclassifiedToolBreakdown {
  toolName: string;
  count: number;
  /** Per-date breakdown for this tool name. */
  series: UnclassifiedDataPoint[];
}

/** Response shape from GET /api/audit/unclassified. */
export interface UnclassifiedWidgetData {
  series: UnclassifiedDataPoint[];
  breakdown: UnclassifiedToolBreakdown[];
  totalCount: number;
  dateRange: { from: string; to: string };
}

// ─── Legacy Rules Widget types ────────────────────────────────────────────────

/** A single bucketed data point for the legacy-rules time series. */
export interface LegacyRulesDataPoint {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  count: number;
}

/** Per-rule breakdown row returned by GET /api/audit/legacy-rules. */
export interface LegacyRuleBreakdown {
  /** Rule number (4–8). */
  rule: number;
  count: number;
  /** Per-date breakdown for this rule. */
  series: LegacyRulesDataPoint[];
}

/** Response shape from GET /api/audit/legacy-rules. */
export interface LegacyRulesWidgetData {
  /** Aggregate daily hit counts across all rules 4–8. */
  series: LegacyRulesDataPoint[];
  /** Per-rule breakdown, sorted by count descending. */
  byRule: LegacyRuleBreakdown[];
  totalCount: number;
  dateRange: { from: string; to: string };
  /**
   * Number of trailing days (from `dateRange.to` backwards) with zero hits.
   * Exit criterion: retire rules when this reaches 30.
   */
  consecutiveZeroDays: number;
}

// ─── Unsafe Legacy Tools Widget types ────────────────────────────────────────

/** Urgency classification derived from days remaining until a skill's deadline. */
export type UnsafeLegacyStatus = 'overdue' | 'urgent' | 'ok' | 'no-deadline';

/** A skill carrying an unsafe_legacy exemption. */
export interface UnsafeLegacyTool {
  skillName: string;
  actionClass: string;
  /** ISO date string (YYYY-MM-DD), or null if not specified. */
  deadline: string | null;
  reason: string | null;
  /**
   * Calendar days remaining until the deadline (negative = overdue).
   * Null when no valid deadline is present.
   */
  daysRemaining: number | null;
  status: UnsafeLegacyStatus;
  /** Relative path to the skill's SKILL.md manifest. */
  manifestPath: string;
}

/** Response shape from GET /api/skills/unsafe-legacy. */
export interface UnsafeLegacyToolsData {
  /** All skills with a truthy unsafe_legacy field, sorted by deadline proximity. */
  tools: UnsafeLegacyTool[];
  totalCount: number;
  overdueCount: number;
  urgentCount: number;
}

/** An entry in the audit trail produced by batch approval operations. */
export interface BatchAuditEntry {
  /** ISO 8601 timestamp when the batch decision was made. */
  timestamp: string;
  /** 'approved' | 'denied' */
  decision: 'approved' | 'denied';
  /** Number of requests resolved in this batch operation. */
  count: number;
  /** The dimension value used to group the batch (e.g. the action_class). */
  groupKey: string;
  /** Tokens that were resolved. */
  tokens: string[];
}

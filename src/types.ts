// ---------------------------------------------------------------------------
// Clawthority — semantic authorization runtime core types
// ---------------------------------------------------------------------------

/** Rate limit bounds attached to a CeeDecision. */
export interface RateLimitInfo {
  /** Maximum calls allowed within the window. */
  maxCalls: number;
  /** Duration of the rate limit window in seconds. */
  windowSeconds: number;
}

/** Decision produced by the authorization pipeline. */
export interface CeeDecision {
  /** Authorization effect. */
  effect: 'permit' | 'forbid';
  /** Human-readable explanation of the decision. */
  reason: string;
  /** Identifier of the rule that produced this decision, if any. */
  matchedRule?: string;
  /** Rate limit bounds when the decision includes throttling. */
  rateLimit?: RateLimitInfo;
}

/** Semantic description of what an agent intends to do. */
export interface Intent {
  /** Canonical dot-separated action class (e.g. 'email.send', 'filesystem.delete'). */
  action_class: string;
  /** Target resource of the action (e.g. email address, file path). */
  target: string;
  /** Human-readable summary of the intended action. */
  summary: string;
  /** SHA-256 hex digest of the tool call payload for binding verification. */
  payload_hash: string;
  /** Raw tool call parameters. */
  parameters: Record<string, unknown>;
}

/** Capability token issued after HITL approval, bound to a specific session scope. */
export interface Capability {
  /** UUID v7 identifier of the approval that issued this capability. */
  approval_id: string;
  /** ISO 8601 timestamp when this capability expires. */
  expires_at: string;
  /** Session scope identifier this capability is bound to. */
  session_scope: string;
  /** Additional scope metadata (e.g. allowed targets, action constraints). */
  scope_meta: Record<string, unknown>;
}

/** Runtime metadata attached to every execution envelope. */
export interface Metadata {
  /** Unique session identifier. */
  session_id: string;
  /** UUID v7 of the approval backing this execution. */
  approval_id: string;
  /** ISO 8601 timestamp when the envelope was created. */
  timestamp: string;
  /** Monotonically increasing version of the policy bundle in effect. */
  bundle_version: number;
  /** Distributed trace identifier for observability. */
  trace_id: string;
  /** Trust level of the source issuing the intent (e.g. 'user', 'agent', 'system'). */
  source_trust_level: string;
}

/**
 * Execution envelope wrapping a single agent action through the
 * Clawthority authorization pipeline.
 */
export interface ExecutionEnvelope {
  /** The agent's stated intent. */
  intent: Intent;
  /** Capability token authorizing this action; null when no approval has been granted. */
  capability: Capability | null;
  /** Runtime metadata for tracing and auditing. */
  metadata: Metadata;
  /** Provenance record describing the origin of this envelope. */
  provenance: Record<string, unknown>;
}

/** Discrete event emitted at each stage of the enforcement pipeline. */
export interface ExecutionEvent {
  /** Event type identifier (e.g. 'envelope.received', 'decision.emit'). */
  type: string;
  /** Snapshot of the envelope at the time this event was emitted. */
  envelope: ExecutionEnvelope;
  /** ISO 8601 timestamp when this event occurred. */
  timestamp: string;
  /** Stage that emitted this event, if applicable. */
  stage?: string;
}

/** Final result returned by the enforcement pipeline for an execution envelope. */
export interface PipelineResult {
  /** Authorization decision. */
  decision: CeeDecision;
  /** The envelope that was evaluated. */
  envelope: ExecutionEnvelope;
  /** Pipeline events emitted during evaluation, in order. */
  events: ExecutionEvent[];
}

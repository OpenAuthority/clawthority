import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single Cedar-engine policy decision entry for JSONL logging. */
export interface PolicyDecisionEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Entry type marker. */
  type?: 'policy';
  /** Decision effect. */
  effect: string;
  /** Resource type. */
  resource: string;
  /** Matched name or pattern. */
  match: string;
  /** Decision reason. */
  reason: string;
  /** Agent ID. */
  agentId: string;
  /** Channel. */
  channel: string;
  /**
   * True when the agent identity was verified against the
   * {@link AgentIdentityRegistry}. Absent for entries written before this
   * field was introduced.
   */
  verified?: boolean;
  /** Tool the host actually called (pre-normalisation). */
  toolName?: string;
  /** Normalised action class (e.g. `filesystem.delete`, `credential.read`). */
  actionClass?: string;
  /**
   * Which enforcement stage produced this decision — `stage1-trust` for the
   * source-trust gate, `cedar` for TS defaults, `json-rules` for
   * `data/rules.json`, `hitl-gated` when a priority-90 Cedar/JSON forbid
   * was upheld because no HITL policy matched (or HITL was not configured).
   */
  stage?: 'stage1-trust' | 'cedar' | 'json-rules' | 'hitl-gated';
  /** Priority of the rule that matched, when a rule matched. */
  priority?: number;
  /** Human-readable rule identifier (action_class or resource:match). */
  rule?: string;
  /** Active install mode at the time of the decision. */
  mode?: 'open' | 'closed';
}

/** A HITL decision entry for JSONL logging. */
export interface HitlDecisionEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Entry type marker. */
  type: 'hitl';
  /** HITL decision outcome. */
  decision: 'approved' | 'denied' | 'fallback-deny' | 'fallback-auto-approve' | 'telegram-unreachable' | 'slack-unreachable';
  /** Approval token. */
  token: string;
  /** Tool name that required approval. */
  toolName: string;
  /** Agent ID. */
  agentId: string;
  /** Channel. */
  channel: string;
  /** HITL policy name. */
  policyName: string;
  /** Configured timeout in seconds. */
  timeoutSeconds: number;
  /**
   * True when the agent identity was verified against the
   * {@link AgentIdentityRegistry}. Absent for entries written before this
   * field was introduced.
   */
  verified?: boolean;
}

/**
 * Audit entry emitted when a tool name cannot be resolved to a known action
 * class and falls back to `unknown_sensitive_action`. Used for taxonomy drift
 * detection.
 */
export interface NormalizerUnclassifiedEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Entry type marker. */
  type: 'normalizer-unclassified';
  /** Audit stage identifier for drift detection. */
  stage: 'normalizer-unclassified';
  /** Tool name that could not be classified. */
  toolName: string;
  /** Agent ID. */
  agentId: string;
  /** Channel. */
  channel: string;
  /**
   * True when the agent identity was verified against the
   * {@link AgentIdentityRegistry}. Absent for entries written before this
   * field was introduced.
   */
  verified?: boolean;
}

/**
 * Audit entry emitted when a new auto-permit pattern is persisted to the
 * auto-permit store following an "Approve Always" operator action.
 *
 * Records the derived pattern, the original command that triggered it, the
 * operator identity (when available from the HITL channel), the channel
 * through which the approval was granted, the AI agent that triggered the
 * original HITL request, and the store version after the write.
 */
export interface AutoPermitAddedEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Entry type marker. */
  type: 'auto_permit_added';
  /** The derived permit pattern written to the store (e.g. `"git commit *"`). */
  pattern: string;
  /** Derivation method used to produce the pattern (`'default'` or `'exact'`). */
  method: string;
  /** Verbatim command that triggered pattern derivation. */
  originalCommand: string;
  /**
   * Identity of the operator who clicked "Approve Always", when available.
   *
   * For Telegram: the numeric user ID stringified (e.g. `"123456789"`), with
   * optional `@username` suffix when the user has one set
   * (e.g. `"123456789@alice"`).  Absent for text-command approvals and Slack
   * approvals where the interaction payload does not expose user identity.
   */
  operatorId?: string;
  /** HITL channel through which approval was granted (e.g. `'telegram'`, `'slack'`). */
  channel: string;
  /** Agent ID that triggered the original HITL approval request. */
  agentId: string;
  /** Auto-permit store version number after the new rule was appended. */
  storeVersion: number;
}

/**
 * Audit entry emitted when a stored auto-permit rule matches an incoming
 * command and grants access without requiring human approval.
 *
 * Records the matched pattern, the rule's derivation method, the command
 * (or tool name for non-exec tools) that triggered the match, and the
 * standard agent/channel context fields.
 */
export interface AutoPermitMatchedEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Entry type marker. */
  type: 'auto_permit_matched';
  /** The stored pattern that matched the incoming command (e.g. `"git commit *"`). */
  pattern: string;
  /** Derivation method of the matched rule (`'default'` or `'exact'`). */
  method: string;
  /**
   * The command or tool name that was matched against the stored rules.
   *
   * For exec-type action classes (`shell.exec`, `code.execute`) this is the
   * raw shell command string (e.g. `"git commit -m 'fix'"`).  For registered
   * non-exec tools this is the tool name (e.g. `"read_file"`).
   */
  command: string;
  /** Tool name as reported by the agent (pre-normalisation). */
  toolName: string;
  /** Normalised action class (e.g. `'shell.exec'`, `'filesystem.read'`). */
  actionClass: string;
  /** Agent ID that invoked the tool call. */
  agentId: string;
  /** Channel through which the tool call arrived. */
  channel: string;
  /**
   * True when the agent identity was verified against the
   * {@link AgentIdentityRegistry}. Absent for entries written before this
   * field was introduced.
   */
  verified?: boolean;
  /** Active install mode at the time of the decision. */
  mode?: 'open' | 'closed';
}

/**
 * Audit entry emitted when pattern derivation is attempted during an
 * "Approve Always" action but fails (e.g. because the command contains
 * shell metacharacters that make it unsafe to generalise into a pattern).
 *
 * No auto-permit rule is written to the store in this case; this entry
 * provides visibility into derivation failures so operators can identify
 * commands that cannot be auto-permitted.
 */
export interface AutoPermitDerivationSkippedEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Entry type marker. */
  type: 'auto_permit_derivation_skipped';
  /**
   * Human-readable reason the derivation was skipped
   * (typically the thrown error message).
   */
  reason: string;
  /**
   * The raw command string or tool name that was passed to the derivation
   * engine.  For exec tools this is the shell command; for registered
   * non-exec tools this is the tool name.
   */
  command: string;
  /** Tool name as reported by the agent (pre-normalisation). */
  toolName: string;
  /** Normalised action class (e.g. `'shell.exec'`). */
  actionClass: string;
  /** HITL channel through which the "Approve Always" was initiated. */
  channel: string;
  /** Agent ID that triggered the original HITL approval request. */
  agentId: string;
  /**
   * Identity of the operator who initiated "Approve Always", when available.
   * Same format as {@link AutoPermitAddedEntry.operatorId}.
   */
  operatorId?: string;
}

/** Options for {@link JsonlAuditLogger}. */
export interface JsonlAuditLoggerOptions {
  /** Absolute or relative path to the JSONL log file. */
  logFile: string;
}

// ─── JsonlAuditLogger ────────────────────────────────────────────────────────

/**
 * Appends audit entries as newline-delimited JSON to a configurable log file.
 *
 * Each call to {@link log} serializes the entry as a single JSON line and
 * appends it synchronously. Parent directories of the log file path are
 * created automatically if they do not exist. Write errors are logged to
 * stderr but never thrown, so a failing disk write does not interrupt the
 * enforcement pipeline.
 *
 * @example
 * ```typescript
 * import { JsonlAuditLogger } from './audit.js';
 *
 * const logger = new JsonlAuditLogger({ logFile: './data/audit.jsonl' });
 *
 * await logger.log({
 *   ts: new Date().toISOString(),
 *   effect: 'permit',
 *   resource: 'tool',
 *   match: 'read_file',
 *   reason: 'Read-only access is safe',
 *   agentId: 'agent-1',
 *   channel: 'default',
 * });
 * ```
 */
export class JsonlAuditLogger {
  private readonly filePath: string;

  /**
   * Creates a new `JsonlAuditLogger`.
   *
   * @param options           Configuration options.
   * @param options.logFile   Absolute or relative path to the JSONL log file.
   *                          Parent directories are created on first write if absent.
   */
  constructor(options: JsonlAuditLoggerOptions) {
    this.filePath = options.logFile;
  }

  /**
   * Appends a single audit entry to the log file.
   *
   * The entry is serialized as a single JSON line followed by a newline
   * character (`\n`). Write errors are swallowed and logged to stderr so
   * that a disk failure does not block the enforcement pipeline.
   *
   * @param entry  Audit entry to record. Accepts {@link PolicyDecisionEntry},
   *               {@link HitlDecisionEntry}, or any `Record<string, unknown>`.
   */
  async log(entry: PolicyDecisionEntry | HitlDecisionEntry | NormalizerUnclassifiedEntry | AutoPermitAddedEntry | AutoPermitMatchedEntry | AutoPermitDerivationSkippedEntry | Record<string, unknown>): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, line, { encoding: "utf-8" });
    } catch (err) {
      console.error("[audit] failed to write audit entry:", err);
    }
  }

  /**
   * No-op flush provided for interface compatibility.
   *
   * `JsonlAuditLogger` writes synchronously via `appendFileSync`; there is no
   * internal buffer to drain. This method exists so callers can treat any
   * audit logger implementation uniformly.
   */
  flush(): Promise<void> {
    return Promise.resolve();
  }
}

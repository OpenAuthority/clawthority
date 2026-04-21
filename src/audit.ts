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
  async log(entry: PolicyDecisionEntry | HitlDecisionEntry | Record<string, unknown>): Promise<void> {
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

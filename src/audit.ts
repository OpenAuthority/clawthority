import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { TEvaluationContext, TEvaluationResult, TPolicy } from "./types.js";

export interface AuditEntry {
  timestamp: string;
  policyId: string;
  policyName: string;
  context: TEvaluationContext;
  result: TEvaluationResult;
}

export type AuditHandler = (entry: AuditEntry) => void | Promise<void>;

export class AuditLogger {
  private handlers: AuditHandler[] = [];

  addHandler(handler: AuditHandler): void {
    this.handlers.push(handler);
  }

  removeHandler(handler: AuditHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  async log(
    policy: TPolicy,
    context: TEvaluationContext,
    result: TEvaluationResult
  ): Promise<void> {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      policyId: policy.id,
      policyName: policy.name,
      context,
      result,
    };

    await Promise.all(this.handlers.map((handler) => handler(entry)));
  }
}

export const consoleAuditHandler: AuditHandler = (entry) => {
  const status = entry.result.allowed ? "ALLOW" : "DENY";
  console.log(
    `[audit] ${entry.timestamp} ${status} policy=${entry.policyId} action=${entry.context.action}` +
      (entry.result.matchedRuleId ? ` rule=${entry.result.matchedRuleId}` : "")
  );
};

/** Rate limit snapshot recorded in a policy decision log entry. */
export interface PolicyDecisionRateLimit {
  limited: boolean;
  maxCalls: number;
  windowSeconds: number;
  currentCount: number;
}

/** A single policy decision log entry written to the JSONL audit file. */
export interface PolicyDecisionEntry {
  ts: string;
  effect: string;
  resource: string;
  match: string;
  reason: string;
  agentId: string;
  channel: string;
  /** Present when rate limiting was evaluated for this decision. */
  rateLimit?: PolicyDecisionRateLimit;
}

/** A HITL approval decision log entry written to the JSONL audit file. */
export interface HitlDecisionEntry {
  ts: string;
  type: 'hitl';
  decision:
    | 'approved'
    | 'denied'
    | 'expired'
    | 'fallback-deny'
    | 'fallback-auto-approve'
    | 'telegram-unreachable'
    | 'slack-unreachable';
  token: string;
  toolName: string;
  agentId: string;
  channel: string;
  policyName: string;
  timeoutSeconds: number;
}

export interface JsonlAuditLoggerOptions {
  /** Absolute or relative path to the JSONL log file. Created if it does not exist. */
  logFile: string;
}

/** Appends policy decisions as newline-delimited JSON to a configurable log file. */
export class JsonlAuditLogger {
  private readonly logFile: string;

  constructor(options: JsonlAuditLoggerOptions) {
    this.logFile = options.logFile;
  }

  async log(entry: PolicyDecisionEntry | HitlDecisionEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    try {
      await mkdir(dirname(this.logFile), { recursive: true });
      await appendFile(this.logFile, line, { encoding: "utf-8" });
    } catch (err) {
      console.error("[audit] Failed to write log entry:", err);
    }
  }
}

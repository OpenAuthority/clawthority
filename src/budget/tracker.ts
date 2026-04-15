/**
 * Budget tracker — appends token usage events to `data/budget.jsonl`.
 *
 * Each entry records the timestamp, session ID, model, total tokens, and
 * estimated cost for a single `before_tool_call` hook invocation. The log is
 * append-only JSONL (one JSON object per line), consistent with the audit log
 * format used by `JsonlAuditLogger`.
 *
 * The singleton instance is created in `plugin.activate()` with options
 * derived from `budget.*` plugin config fields (or their env-var overrides).
 *
 * @example
 * ```typescript
 * const tracker = new BudgetTracker({ logFile: 'data/budget.jsonl', model: 'claude-sonnet-4-6' });
 * tracker.append(1_200, 400);
 * ```
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { estimateCost } from './pricing.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single budget usage event written to `data/budget.jsonl`. */
export interface BudgetEntry {
  /** ISO 8601 timestamp of the event. */
  ts: string;
  /** Session identifier — shared across all entries in the same process run. */
  session_id: string;
  /** LLM model identifier (e.g. `'claude-sonnet-4-6'`). */
  model: string;
  /** Total tokens for this event (input + output). */
  tokens: number;
  /** Estimated USD cost for this event. */
  cost: number;
}

/** Construction options for `BudgetTracker`. */
export interface BudgetTrackerOptions {
  /**
   * Absolute or relative path to the JSONL budget log file.
   * Corresponds to `budget.logFile` plugin config.
   * Default: `'data/budget.jsonl'`
   */
  logFile?: string;
  /**
   * Default LLM model identifier used when `append()` is called without an
   * explicit model. Corresponds to plugin config `budget.model`.
   * Default: `'claude-sonnet-4-6'`
   */
  model?: string;
  /**
   * Soft daily token limit. Stored on the tracker for consumption by the
   * token-budget skill. Corresponds to `budget.dailyTokenLimit` plugin config.
   * Default: `100_000`
   */
  dailyTokenLimit?: number;
  /**
   * Token count at which the skill should emit a warning.
   * Corresponds to `budget.warnAt` plugin config.
   * Default: `80_000`
   */
  warnAt?: number;
}

// ─── BudgetTracker ────────────────────────────────────────────────────────────

/**
 * Appends token usage events to a JSONL budget log file.
 *
 * Writes are synchronous (`appendFileSync`) so they never delay or block the
 * async enforcement pipeline. Parent directories are created automatically on
 * the first write. Write errors are swallowed and logged to stderr so a disk
 * failure does not interrupt the hook chain.
 */
export class BudgetTracker {
  private readonly logFile: string;
  /** Session identifier shared by all entries appended by this instance. */
  readonly sessionId: string;
  /** Default model used when `append()` is called without an explicit model. */
  readonly model: string;
  /** Soft daily token limit (used by the token-budget skill). */
  readonly dailyTokenLimit: number;
  /** Warning threshold in tokens (used by the token-budget skill). */
  readonly warnAt: number;

  constructor(opts: BudgetTrackerOptions = {}) {
    this.logFile = opts.logFile ?? 'data/budget.jsonl';
    this.model = opts.model ?? 'claude-sonnet-4-6';
    this.dailyTokenLimit = opts.dailyTokenLimit ?? 100_000;
    this.warnAt = opts.warnAt ?? 80_000;
    this.sessionId = randomUUID();
  }

  /**
   * Appends a single usage event to the budget log.
   *
   * @param inputTokens   Number of input tokens for this event.
   * @param outputTokens  Number of output tokens for this event.
   * @param model         LLM model identifier (falls back to `this.model`).
   */
  append(inputTokens: number, outputTokens: number, model?: string): void {
    const resolvedModel = model ?? this.model;
    const tokens = inputTokens + outputTokens;
    const cost = estimateCost(resolvedModel, inputTokens, outputTokens);

    const entry: BudgetEntry = {
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      model: resolvedModel,
      tokens,
      cost,
    };

    const line = JSON.stringify(entry) + '\n';
    try {
      mkdirSync(dirname(this.logFile), { recursive: true });
      appendFileSync(this.logFile, line, { encoding: 'utf-8' });
    } catch (err) {
      console.error('[budget] failed to write budget entry:', err);
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Constructs a `BudgetTracker` from plugin config env-var overrides and the
 * given plugin root directory.
 *
 * Environment variables (all optional — override plugin config defaults):
 * - `OPENAUTH_BUDGET_LOG_FILE`    — path to the JSONL log file
 * - `OPENAUTH_BUDGET_MODEL`       — default model identifier
 * - `OPENAUTH_BUDGET_DAILY_LIMIT` — `budget.dailyTokenLimit`
 * - `OPENAUTH_BUDGET_WARN_AT`     — `budget.warnAt`
 *
 * @param pluginRoot  Absolute path to the plugin root directory, used to
 *                    resolve the default log file path.
 */
export function createBudgetTracker(pluginRoot: string): BudgetTracker {
  const logFile =
    process.env.OPENAUTH_BUDGET_LOG_FILE ?? join(pluginRoot, 'data', 'budget.jsonl');

  const dailyTokenLimit =
    process.env.OPENAUTH_BUDGET_DAILY_LIMIT !== undefined
      ? parseInt(process.env.OPENAUTH_BUDGET_DAILY_LIMIT, 10)
      : 100_000;

  const warnAt =
    process.env.OPENAUTH_BUDGET_WARN_AT !== undefined
      ? parseInt(process.env.OPENAUTH_BUDGET_WARN_AT, 10)
      : 80_000;

  const model = process.env.OPENAUTH_BUDGET_MODEL ?? 'claude-sonnet-4-6';

  return new BudgetTracker({ logFile, model, dailyTokenLimit, warnAt });
}

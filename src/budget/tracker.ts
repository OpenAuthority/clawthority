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

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
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

/** Result of a budget limit check. */
export interface BudgetCheckResult {
  /** Whether the daily limit has been exceeded. */
  exceeded: boolean;
  /** Total tokens consumed today (across all sessions). */
  dailyTokens: number;
  /** Total estimated cost today in USD. */
  dailyCost: number;
  /** Configured daily token limit. */
  dailyTokenLimit: number;
  /** Configured daily cost limit in USD, or undefined if not set. */
  dailyCostLimit: number | undefined;
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
  /**
   * Hard daily cost limit in USD. When set and `hardLimitEnabled` is true,
   * tool calls are blocked once this threshold is reached.
   * Corresponds to `OPENAUTH_BUDGET_DAILY_COST_LIMIT` env var.
   */
  dailyCostLimit?: number;
  /**
   * Whether to enforce hard budget limits. When false (default), limits are
   * tracked and logged but never block tool calls.
   * Corresponds to `OPENAUTH_BUDGET_HARD_LIMIT=1` env var.
   */
  hardLimitEnabled?: boolean;
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

  /** Hard daily cost limit in USD (undefined = no cost limit). */
  readonly dailyCostLimit: number | undefined;
  /** Whether hard limits are enforced (blocks tool calls when exceeded). */
  readonly hardLimitEnabled: boolean;
  /** In-memory running total of tokens for today (across all sessions). */
  private _dailyTokens: number;
  /** In-memory running total of cost for today in USD. */
  private _dailyCost: number;
  /** UTC date string of the day this tracker was initialised (YYYY-MM-DD). */
  private readonly _trackedDay: string;

  constructor(opts: BudgetTrackerOptions = {}) {
    this.logFile = opts.logFile ?? 'data/budget.jsonl';
    this.model = opts.model ?? 'claude-sonnet-4-6';
    this.dailyTokenLimit = opts.dailyTokenLimit ?? 100_000;
    this.warnAt = opts.warnAt ?? 80_000;
    this.dailyCostLimit = opts.dailyCostLimit;
    this.hardLimitEnabled = opts.hardLimitEnabled ?? false;
    this.sessionId = randomUUID();
    this._trackedDay = new Date().toISOString().slice(0, 10);
    // Seed daily totals from existing log entries for today.
    const { tokens, cost } = this._readTodayTotals();
    this._dailyTokens = tokens;
    this._dailyCost = cost;
  }

  /** Current total tokens consumed today across all sessions. */
  get dailyTokens(): number { return this._dailyTokens; }
  /** Current total estimated cost today in USD. */
  get dailyCost(): number { return this._dailyCost; }

  /**
   * Reads today's token and cost totals from the budget log file.
   * Called once at construction to seed the in-memory accumulators.
   */
  private _readTodayTotals(): { tokens: number; cost: number } {
    let tokens = 0;
    let cost = 0;
    if (!existsSync(this.logFile)) return { tokens, cost };
    try {
      const lines = readFileSync(this.logFile, 'utf-8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as BudgetEntry;
          if (entry.ts?.startsWith(this._trackedDay)) {
            tokens += entry.tokens ?? 0;
            cost += entry.cost ?? 0;
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch (err) {
      console.error('[budget] failed to read budget log for daily totals:', err);
    }
    return { tokens, cost };
  }

  /**
   * Checks whether the daily budget limit has been exceeded.
   *
   * Returns a `BudgetCheckResult` with the current totals and whether
   * enforcement should block the current tool call. Only blocks when
   * `hardLimitEnabled` is true.
   */
  check(): BudgetCheckResult {
    const tokenExceeded = this._dailyTokens >= this.dailyTokenLimit;
    const costExceeded = this.dailyCostLimit !== undefined && this._dailyCost >= this.dailyCostLimit;
    const exceeded = this.hardLimitEnabled && (tokenExceeded || costExceeded);
    return {
      exceeded,
      dailyTokens: this._dailyTokens,
      dailyCost: this._dailyCost,
      dailyTokenLimit: this.dailyTokenLimit,
      dailyCostLimit: this.dailyCostLimit,
    };
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

    // Update in-memory daily accumulators.
    this._dailyTokens += tokens;
    this._dailyCost += cost;

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

  const hardLimitEnabled = process.env.OPENAUTH_BUDGET_HARD_LIMIT === '1';

  const dailyCostLimit =
    process.env.OPENAUTH_BUDGET_DAILY_COST_LIMIT !== undefined
      ? parseFloat(process.env.OPENAUTH_BUDGET_DAILY_COST_LIMIT)
      : undefined;

  return new BudgetTracker({ logFile, model, dailyTokenLimit, warnAt, hardLimitEnabled, ...(dailyCostLimit !== undefined ? { dailyCostLimit } : {}) });
}

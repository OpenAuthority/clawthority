/**
 * Token telemetry — tracks LLM API token usage and costs.
 *
 * Provides `TokenTelemetry` for recording token consumption from LLM API
 * calls, persisting usage history, and reporting session/daily metrics.
 * Data is stored locally at `~/.openclaw/openauthority/budget-state.json`
 * (or a custom path passed to the constructor for testing).
 *
 * Intended to back the `token-budget` skill's live reporting.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single LLM API call token usage record. */
export interface TokenRecord {
  /** LLM model identifier (e.g. 'claude-sonnet-4-6'). */
  model: string;
  /** Number of input (prompt) tokens consumed. */
  inputTokens: number;
  /** Number of output (completion) tokens generated. */
  outputTokens: number;
  /** ISO 8601 timestamp of the API call. */
  timestamp: string;
  /** Session identifier grouping records from the same process run. */
  sessionId: string;
}

/** Daily usage entry stored in the budget state file. */
export interface DailyEntry {
  /** Date in YYYY-MM-DD format. */
  date: string;
  /** Individual token records for this date. */
  records: TokenRecord[];
}

/** Persisted budget state stored at the state file path. */
export interface BudgetState {
  /** Soft daily token threshold (default: 50 000). */
  threshold: number;
  /** Identifier of the most recent session. */
  sessionId: string;
  /** ISO 8601 timestamp when the current session started. */
  sessionStart: string;
  /** Usage records grouped by date (oldest first). */
  entries: DailyEntry[];
}

/** Cost rates for a model, in USD per million tokens. */
export interface ModelPricing {
  /** Cost per million input tokens (USD). */
  inputCostPerMillion: number;
  /** Cost per million output tokens (USD). */
  outputCostPerMillion: number;
}

/** Aggregated usage summary for a single calendar day. */
export interface DailyUsageSummary {
  /** Date in YYYY-MM-DD format. */
  date: string;
  /** Total input tokens consumed on this date. */
  inputTokens: number;
  /** Total output tokens generated on this date. */
  outputTokens: number;
  /** Combined input + output tokens. */
  totalTokens: number;
  /** Estimated USD cost for this date. */
  estimatedCost: number;
}

/** Full usage report for consumption by the token-budget skill. */
export interface UsageReport {
  /** Total tokens in the current session. */
  sessionTokens: number;
  /** Estimated USD cost for the current session. */
  sessionCost: number;
  /** Total tokens today. */
  dailyTokens: number;
  /** Estimated USD cost for today. */
  dailyCost: number;
  /** Configured soft daily threshold. */
  threshold: number;
  /** Percentage of threshold consumed today (0–100+). */
  thresholdPercent: number;
  /** Tokens remaining before the threshold is reached (0 when exceeded). */
  remaining: number;
  /** Estimated token burn rate in tokens/hour for the current session. */
  burnRate: number;
  /** Day-by-day history (oldest first, `historyDays` entries). */
  history: DailyUsageSummary[];
}

// ─── Model pricing ────────────────────────────────────────────────────────────

/**
 * Published per-token pricing for known Claude models (USD per million tokens).
 *
 * Unrecognised models fall back to the `'default'` entry (Sonnet-class pricing).
 * Keys are matched by prefix — `'claude-sonnet-4-6-20251022'` resolves to
 * the `'claude-sonnet-4-6'` entry.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
  'claude-sonnet-4-6': { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  'claude-haiku-4-5': { inputCostPerMillion: 0.8, outputCostPerMillion: 4.0 },
  'claude-3-5-sonnet-20241022': { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  'claude-3-5-haiku-20241022': { inputCostPerMillion: 0.8, outputCostPerMillion: 4.0 },
  'claude-3-opus-20240229': { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
  'claude-3-haiku-20240307': { inputCostPerMillion: 0.25, outputCostPerMillion: 1.25 },
  default: { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
};

// ─── Default path ─────────────────────────────────────────────────────────────

/** Default location for the persisted budget state file. */
export const DEFAULT_STATE_PATH: string = join(
  homedir(),
  '.openclaw',
  'openauthority',
  'budget-state.json',
);

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Resolves pricing for a model identifier, falling back to `'default'`.
 *
 * Matching is first exact, then prefix-based (longest matching key wins).
 */
export function resolvePricing(model: string): ModelPricing {
  const exact = MODEL_PRICING[model];
  if (exact !== undefined) return exact;

  let bestKey: string | undefined;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (key === 'default') continue;
    if (model.startsWith(key) && (bestKey === undefined || key.length > bestKey.length)) {
      bestKey = key;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return bestKey !== undefined ? MODEL_PRICING[bestKey]! : MODEL_PRICING['default']!;
}

/**
 * Calculates the estimated USD cost for an LLM API call.
 *
 * @param model         LLM model identifier.
 * @param inputTokens   Number of input tokens consumed.
 * @param outputTokens  Number of output tokens generated.
 * @returns             Estimated cost in USD.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = resolvePricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputCostPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputCostPerMillion;
  return inputCost + outputCost;
}

/** Returns today's date string in YYYY-MM-DD format (UTC). */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── State I/O ────────────────────────────────────────────────────────────────

function defaultState(sessionId: string, sessionStart: string): BudgetState {
  return { threshold: 50_000, sessionId, sessionStart, entries: [] };
}

async function loadState(
  statePath: string,
  sessionId: string,
  sessionStart: string,
): Promise<BudgetState> {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as BudgetState;
    // Preserve history/threshold from disk; update session metadata for this run.
    return { ...parsed, sessionId, sessionStart };
  } catch {
    return defaultState(sessionId, sessionStart);
  }
}

async function saveState(statePath: string, state: BudgetState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function aggregateDay(entry: DailyEntry): DailyUsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCost = 0;
  for (const r of entry.records) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    estimatedCost += calculateCost(r.model, r.inputTokens, r.outputTokens);
  }
  return {
    date: entry.date,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost,
  };
}

// ─── TokenTelemetry ───────────────────────────────────────────────────────────

/**
 * Records and reports LLM API token usage.
 *
 * Usage data is persisted to a local JSON file so it survives process
 * restarts and can be queried across sessions. Each `TokenTelemetry`
 * instance represents one session, identified by a UUID generated at
 * construction time.
 *
 * @example
 * const telemetry = new TokenTelemetry();
 * await telemetry.record({ model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 500 });
 * const report = await telemetry.getUsageReport();
 * console.log(telemetry.formatReport(report));
 */
export class TokenTelemetry {
  private readonly statePath: string;
  private readonly sessionId: string;
  private readonly sessionStart: string;

  constructor(statePath: string = DEFAULT_STATE_PATH) {
    this.statePath = statePath;
    this.sessionId = randomUUID();
    this.sessionStart = new Date().toISOString();
  }

  /**
   * Records a single LLM API call's token usage.
   *
   * Appends the record to today's daily entry and persists to disk.
   *
   * @param opts.model        LLM model identifier.
   * @param opts.inputTokens  Input tokens consumed.
   * @param opts.outputTokens Output tokens generated.
   * @param opts.timestamp    ISO 8601 timestamp (defaults to now).
   */
  async record(opts: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    timestamp?: string;
  }): Promise<void> {
    const state = await loadState(this.statePath, this.sessionId, this.sessionStart);
    const timestamp = opts.timestamp ?? new Date().toISOString();
    const date = timestamp.slice(0, 10);

    const tokenRecord: TokenRecord = {
      model: opts.model,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      timestamp,
      sessionId: this.sessionId,
    };

    let entry = state.entries.find((e) => e.date === date);
    if (entry === undefined) {
      entry = { date, records: [] };
      state.entries.push(entry);
      state.entries.sort((a, b) => a.date.localeCompare(b.date));
    }
    entry.records.push(tokenRecord);

    await saveState(this.statePath, state);
  }

  /**
   * Sets the soft daily token threshold.
   *
   * @param tokens  Threshold in tokens (e.g. 50 000).
   */
  async setThreshold(tokens: number): Promise<void> {
    const state = await loadState(this.statePath, this.sessionId, this.sessionStart);
    state.threshold = tokens;
    await saveState(this.statePath, state);
  }

  /**
   * Returns aggregated usage for a single calendar date.
   *
   * @param date  Date in YYYY-MM-DD format (defaults to today UTC).
   */
  async getDailyUsage(date?: string): Promise<DailyUsageSummary> {
    const targetDate = date ?? todayUtc();
    const state = await loadState(this.statePath, this.sessionId, this.sessionStart);
    const entry = state.entries.find((e) => e.date === targetDate);
    if (entry === undefined) {
      return {
        date: targetDate,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
      };
    }
    return aggregateDay(entry);
  }

  /**
   * Returns day-by-day usage history for the last `days` calendar days.
   *
   * Days with no recorded usage are included as zero-valued entries.
   *
   * @param days  Number of calendar days to include (default 7).
   */
  async getHistory(days: number = 7): Promise<DailyUsageSummary[]> {
    const state = await loadState(this.statePath, this.sessionId, this.sessionStart);
    const result: DailyUsageSummary[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const entry = state.entries.find((e) => e.date === date);
      result.push(
        entry !== undefined
          ? aggregateDay(entry)
          : { date, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
      );
    }

    return result;
  }

  /**
   * Builds a full usage report for the token-budget skill.
   *
   * Includes session-level and daily totals, threshold status, estimated
   * burn rate, and history for the last `historyDays` calendar days.
   *
   * @param historyDays  Number of days to include in history (default 7).
   */
  async getUsageReport(historyDays: number = 7): Promise<UsageReport> {
    const state = await loadState(this.statePath, this.sessionId, this.sessionStart);
    const today = todayUtc();

    // ── Session metrics ──────────────────────────────────────────────────────
    let sessionTokens = 0;
    let sessionCost = 0;
    for (const entry of state.entries) {
      for (const r of entry.records) {
        if (r.sessionId === this.sessionId) {
          sessionTokens += r.inputTokens + r.outputTokens;
          sessionCost += calculateCost(r.model, r.inputTokens, r.outputTokens);
        }
      }
    }

    // ── Daily metrics ────────────────────────────────────────────────────────
    const todayEntry = state.entries.find((e) => e.date === today);
    const dailySummary =
      todayEntry !== undefined
        ? aggregateDay(todayEntry)
        : { totalTokens: 0, estimatedCost: 0 };
    const dailyTokens = dailySummary.totalTokens;
    const dailyCost = dailySummary.estimatedCost;

    // ── Threshold ────────────────────────────────────────────────────────────
    const { threshold } = state;
    const thresholdPercent = threshold > 0 ? (dailyTokens / threshold) * 100 : 0;
    const remaining = Math.max(0, threshold - dailyTokens);

    // ── Burn rate ────────────────────────────────────────────────────────────
    const sessionAgeMs = Date.now() - new Date(this.sessionStart).getTime();
    const sessionAgeHours = sessionAgeMs / (1000 * 60 * 60);
    // Only report burn rate after at least one minute of session activity.
    const burnRate =
      sessionAgeHours >= 1 / 60 ? Math.round(sessionTokens / sessionAgeHours) : 0;

    // ── History ──────────────────────────────────────────────────────────────
    const history = await this.getHistory(historyDays);

    return {
      sessionTokens,
      sessionCost,
      dailyTokens,
      dailyCost,
      threshold,
      thresholdPercent,
      remaining,
      burnRate,
      history,
    };
  }

  /**
   * Formats a usage report as the plain-text display block used by the
   * token-budget skill.
   *
   * @param report  Usage report from `getUsageReport()`.
   * @returns       Formatted multi-line string ready for display.
   */
  formatReport(report: UsageReport): string {
    const bar = '─────────────────────────────────';
    const pct = report.thresholdPercent.toFixed(1);
    const cost = report.dailyCost.toFixed(2);
    const burnRate =
      report.burnRate > 0 ? `~${report.burnRate.toLocaleString()} tokens/hr` : 'N/A';
    const status =
      report.dailyTokens >= report.threshold
        ? `WARNING — threshold exceeded`
        : `OK — ${report.remaining.toLocaleString()} tokens remaining`;

    return [
      'Budget Summary',
      bar,
      `Session tokens:     ${report.sessionTokens.toLocaleString()}`,
      `Daily tokens:       ${report.dailyTokens.toLocaleString()} / ${report.threshold.toLocaleString()} (${pct}%)`,
      `Estimated spend:    $${cost} today`,
      `Burn rate:          ${burnRate}`,
      bar,
      `Threshold:          ${report.threshold.toLocaleString()} tokens/day`,
      `Status:             ${status}`,
    ].join('\n');
  }
}

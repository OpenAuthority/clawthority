/**
 * token-telemetry — test suite
 *
 * Covers:
 *   resolvePricing      — exact match, prefix match, unknown model fallback
 *   calculateCost       — known models, unknown model fallback, zero tokens
 *   TokenTelemetry      — record, getDailyUsage, getHistory, setThreshold,
 *                         getUsageReport, formatReport
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  MODEL_PRICING,
  resolvePricing,
  calculateCost,
  TokenTelemetry,
} from './token-telemetry.js';
import type { UsageReport, DailyUsageSummary } from './token-telemetry.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Returns a deterministic ISO timestamp for a given date and hour offset. */
function ts(date: string, hour = 10): string {
  return `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

// ─── resolvePricing ───────────────────────────────────────────────────────────

describe('resolvePricing', () => {
  it('returns exact entry for a known model', () => {
    const pricing = resolvePricing('claude-sonnet-4-6');
    expect(pricing.inputCostPerMillion).toBe(3.0);
    expect(pricing.outputCostPerMillion).toBe(15.0);
  });

  it('returns exact entry for claude-opus-4-6', () => {
    const pricing = resolvePricing('claude-opus-4-6');
    expect(pricing.inputCostPerMillion).toBe(15.0);
    expect(pricing.outputCostPerMillion).toBe(75.0);
  });

  it('resolves a versioned model id via prefix match', () => {
    // e.g. 'claude-sonnet-4-6-20251022' → 'claude-sonnet-4-6'
    const pricing = resolvePricing('claude-sonnet-4-6-20251022');
    expect(pricing.inputCostPerMillion).toBe(3.0);
  });

  it('resolves longer prefix before shorter prefix', () => {
    // 'claude-3-5-sonnet-20241022' is an exact key; this tests a variant suffix
    const pricing = resolvePricing('claude-3-5-sonnet-20241022-preview');
    expect(pricing.inputCostPerMillion).toBe(3.0);
  });

  it('falls back to default pricing for an unknown model', () => {
    const pricing = resolvePricing('gpt-4o-unknown');
    expect(pricing).toEqual(MODEL_PRICING['default']);
  });

  it('falls back to default for an empty model string', () => {
    const pricing = resolvePricing('');
    expect(pricing).toEqual(MODEL_PRICING['default']);
  });
});

// ─── calculateCost ────────────────────────────────────────────────────────────

describe('calculateCost', () => {
  it('calculates cost correctly for claude-sonnet-4-6', () => {
    // 1 000 000 input @ $3/M + 500 000 output @ $15/M = $3 + $7.50 = $10.50
    const cost = calculateCost('claude-sonnet-4-6', 1_000_000, 500_000);
    expect(cost).toBeCloseTo(10.5, 6);
  });

  it('calculates cost correctly for claude-haiku-4-5', () => {
    // 1 000 000 input @ $0.80/M + 1 000 000 output @ $4/M = $0.80 + $4 = $4.80
    const cost = calculateCost('claude-haiku-4-5', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(4.8, 6);
  });

  it('calculates cost correctly for claude-opus-4-6', () => {
    // 100 000 input @ $15/M = $1.50; 50 000 output @ $75/M = $3.75
    const cost = calculateCost('claude-opus-4-6', 100_000, 50_000);
    expect(cost).toBeCloseTo(5.25, 6);
  });

  it('returns 0 when both token counts are 0', () => {
    expect(calculateCost('claude-sonnet-4-6', 0, 0)).toBe(0);
  });

  it('uses default pricing for an unknown model', () => {
    // default = $3/M in, $15/M out — same as sonnet
    const cost = calculateCost('unknown-model-xyz', 1_000_000, 1_000_000);
    const expected = calculateCost('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(expected, 6);
  });

  it('returns a small but non-zero cost for 1 000 tokens', () => {
    const cost = calculateCost('claude-sonnet-4-6', 500, 500);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.01);
  });
});

// ─── TokenTelemetry (I/O tests using temp directory) ─────────────────────────

describe('TokenTelemetry', () => {
  let tempDir: string;
  let statePath: string;
  let tel: TokenTelemetry;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `oa-token-tel-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    statePath = join(tempDir, 'budget-state.json');
    tel = new TokenTelemetry(statePath);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── record ──────────────────────────────────────────────────────────────────

  describe('record', () => {
    it('creates the state file on first record', async () => {
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 50 });
      const usage = await tel.getDailyUsage();
      expect(usage.totalTokens).toBe(150);
    });

    it('accumulates multiple records on the same day', async () => {
      const date = '2025-06-01';
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 200, outputTokens: 100, timestamp: ts(date, 9) });
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 300, outputTokens: 150, timestamp: ts(date, 10) });
      const usage = await tel.getDailyUsage(date);
      expect(usage.inputTokens).toBe(500);
      expect(usage.outputTokens).toBe(250);
      expect(usage.totalTokens).toBe(750);
    });

    it('records to different daily entries for different dates', async () => {
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 50, timestamp: ts('2025-05-01') });
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 200, outputTokens: 100, timestamp: ts('2025-05-02') });
      const day1 = await tel.getDailyUsage('2025-05-01');
      const day2 = await tel.getDailyUsage('2025-05-02');
      expect(day1.totalTokens).toBe(150);
      expect(day2.totalTokens).toBe(300);
    });

    it('calculates estimatedCost for the day', async () => {
      const date = '2025-06-01';
      // 1 000 input @ $3/M + 500 output @ $15/M = $0.003 + $0.0075 = $0.0105
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 1_000, outputTokens: 500, timestamp: ts(date) });
      const usage = await tel.getDailyUsage(date);
      expect(usage.estimatedCost).toBeCloseTo(0.0105, 5);
    });
  });

  // ── getDailyUsage ───────────────────────────────────────────────────────────

  describe('getDailyUsage', () => {
    it('returns zero summary for a date with no records', async () => {
      const summary = await tel.getDailyUsage('2000-01-01');
      expect(summary.totalTokens).toBe(0);
      expect(summary.estimatedCost).toBe(0);
      expect(summary.date).toBe('2000-01-01');
    });

    it('aggregates across multiple models on the same day', async () => {
      const date = '2025-07-01';
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 1_000, outputTokens: 500, timestamp: ts(date, 8) });
      await tel.record({ model: 'claude-haiku-4-5', inputTokens: 2_000, outputTokens: 1_000, timestamp: ts(date, 9) });
      const usage = await tel.getDailyUsage(date);
      expect(usage.totalTokens).toBe(4_500);
    });
  });

  // ── setThreshold ─────────────────────────────────────────────────────────────

  describe('setThreshold', () => {
    it('updates the threshold in the persisted state', async () => {
      await tel.setThreshold(40_000);
      const report = await tel.getUsageReport();
      expect(report.threshold).toBe(40_000);
    });

    it('preserves existing records when updating threshold', async () => {
      const date = '2025-06-15';
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 500, outputTokens: 200, timestamp: ts(date) });
      await tel.setThreshold(25_000);
      const usage = await tel.getDailyUsage(date);
      expect(usage.totalTokens).toBe(700);
    });
  });

  // ── getHistory ───────────────────────────────────────────────────────────────

  describe('getHistory', () => {
    it('returns 7 entries by default', async () => {
      const history = await tel.getHistory();
      expect(history).toHaveLength(7);
    });

    it('returns N entries when N is specified', async () => {
      const history = await tel.getHistory(3);
      expect(history).toHaveLength(3);
    });

    it('fills days with no records as zero-valued entries', async () => {
      const history = await tel.getHistory(7);
      for (const day of history) {
        expect(day.totalTokens).toBe(0);
        expect(day.estimatedCost).toBe(0);
      }
    });

    it('includes recorded data for days that have records', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 1_000, outputTokens: 200 });
      const history = await tel.getHistory(7);
      const todayEntry = history.find((d: DailyUsageSummary) => d.date === today);
      expect(todayEntry).toBeDefined();
      expect(todayEntry!.totalTokens).toBe(1_200);
    });

    it('orders history from oldest to newest', async () => {
      const history = await tel.getHistory(7);
      for (let i = 1; i < history.length; i++) {
        expect(history[i]!.date >= history[i - 1]!.date).toBe(true);
      }
    });
  });

  // ── getUsageReport ───────────────────────────────────────────────────────────

  describe('getUsageReport', () => {
    it('returns zero metrics when no records exist', async () => {
      const report = await tel.getUsageReport();
      expect(report.sessionTokens).toBe(0);
      expect(report.dailyTokens).toBe(0);
      expect(report.sessionCost).toBe(0);
      expect(report.dailyCost).toBe(0);
    });

    it('counts only current session tokens in sessionTokens', async () => {
      // Record via this instance (current session)
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 1_000, outputTokens: 500 });

      // Simulate a different session by creating a second instance using the same file
      const otherTel = new TokenTelemetry(statePath);
      await otherTel.record({ model: 'claude-sonnet-4-6', inputTokens: 2_000, outputTokens: 1_000 });

      const report = await tel.getUsageReport();
      // This session should only see its own 1 500 tokens
      expect(report.sessionTokens).toBe(1_500);
    });

    it('counts all records for today in dailyTokens', async () => {
      // Both sessions contribute to dailyTokens
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 1_000, outputTokens: 500 });

      const otherTel = new TokenTelemetry(statePath);
      await otherTel.record({ model: 'claude-sonnet-4-6', inputTokens: 2_000, outputTokens: 1_000 });

      const report = await tel.getUsageReport();
      expect(report.dailyTokens).toBe(4_500);
    });

    it('calculates thresholdPercent correctly', async () => {
      await tel.setThreshold(10_000);
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 5_000, outputTokens: 0 });
      const report = await tel.getUsageReport();
      expect(report.thresholdPercent).toBeCloseTo(50, 1);
    });

    it('sets remaining to 0 when threshold is exceeded', async () => {
      await tel.setThreshold(100);
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 200, outputTokens: 0 });
      const report = await tel.getUsageReport();
      expect(report.remaining).toBe(0);
    });

    it('calculates remaining correctly when under threshold', async () => {
      await tel.setThreshold(10_000);
      await tel.record({ model: 'claude-sonnet-4-6', inputTokens: 3_000, outputTokens: 0 });
      const report = await tel.getUsageReport();
      expect(report.remaining).toBe(7_000);
    });

    it('includes history with the correct number of days', async () => {
      const report = await tel.getUsageReport(5);
      expect(report.history).toHaveLength(5);
    });

    it('uses default threshold of 50 000 on first use', async () => {
      const report = await tel.getUsageReport();
      expect(report.threshold).toBe(50_000);
    });
  });

  // ── formatReport ─────────────────────────────────────────────────────────────

  describe('formatReport', () => {
    function makeReport(overrides?: Partial<UsageReport>): UsageReport {
      return {
        sessionTokens: 4_218,
        sessionCost: 0.095,
        dailyTokens: 38_420,
        dailyCost: 1.92,
        threshold: 50_000,
        thresholdPercent: 76.84,
        remaining: 11_580,
        burnRate: 2_100,
        history: [],
        ...overrides,
      };
    }

    it('includes the "Budget Summary" heading', () => {
      expect(tel.formatReport(makeReport())).toContain('Budget Summary');
    });

    it('includes session tokens', () => {
      const text = tel.formatReport(makeReport({ sessionTokens: 4_218 }));
      expect(text).toContain('4,218');
    });

    it('includes daily tokens and threshold', () => {
      const text = tel.formatReport(makeReport({ dailyTokens: 38_420, threshold: 50_000 }));
      expect(text).toContain('38,420');
      expect(text).toContain('50,000');
    });

    it('includes the percentage used', () => {
      const text = tel.formatReport(makeReport({ thresholdPercent: 76.84 }));
      expect(text).toContain('76.8%');
    });

    it('includes estimated spend', () => {
      const text = tel.formatReport(makeReport({ dailyCost: 1.92 }));
      expect(text).toContain('$1.92');
    });

    it('shows burn rate with ~ prefix when non-zero', () => {
      const text = tel.formatReport(makeReport({ burnRate: 2_100 }));
      expect(text).toContain('~2,100 tokens/hr');
    });

    it('shows "N/A" burn rate when burnRate is 0', () => {
      const text = tel.formatReport(makeReport({ burnRate: 0 }));
      expect(text).toContain('N/A');
    });

    it('shows OK status when under threshold', () => {
      const text = tel.formatReport(makeReport({ dailyTokens: 38_420, threshold: 50_000, remaining: 11_580 }));
      expect(text).toContain('OK');
      expect(text).toContain('11,580 tokens remaining');
    });

    it('shows WARNING status when threshold is reached', () => {
      const text = tel.formatReport(makeReport({ dailyTokens: 55_000, threshold: 50_000, remaining: 0 }));
      expect(text).toContain('WARNING');
    });
  });
});

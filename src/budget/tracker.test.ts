/**
 * budget/tracker — test suite
 *
 * Covers:
 *   pricing        — resolvePricing, estimateCost
 *   BudgetTracker  — append (JSONL write), sessionId stability,
 *                    dailyTokenLimit, warnAt, model fallback
 *   createBudgetTracker — env-var overrides
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { PRICING, resolvePricing, estimateCost } from './pricing.js';
import { BudgetTracker, createBudgetTracker } from './tracker.js';
import type { BudgetEntry } from './tracker.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir(): string {
  const d = join(tmpdir(), `budget-tracker-test-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function readEntries(logFile: string): BudgetEntry[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BudgetEntry);
}

// ─── pricing.ts ───────────────────────────────────────────────────────────────

describe('resolvePricing', () => {
  it('returns exact entry for a known model', () => {
    const p = resolvePricing('claude-sonnet-4-6');
    expect(p.inputCostPerMillion).toBe(3.0);
    expect(p.outputCostPerMillion).toBe(15.0);
  });

  it('returns exact entry for claude-opus-4-6', () => {
    const p = resolvePricing('claude-opus-4-6');
    expect(p.inputCostPerMillion).toBe(15.0);
    expect(p.outputCostPerMillion).toBe(75.0);
  });

  it('resolves versioned model via prefix match', () => {
    // 'claude-sonnet-4-6-20251022' should resolve to 'claude-sonnet-4-6'
    const p = resolvePricing('claude-sonnet-4-6-20251022');
    expect(p.inputCostPerMillion).toBe(3.0);
  });

  it('falls back to default for unknown model', () => {
    const p = resolvePricing('gpt-4-turbo');
    expect(p).toEqual(PRICING['default']);
  });

  it('prefers longer prefix match over shorter one', () => {
    // 'claude-3-5-haiku' is more specific than 'claude-3'
    const p = resolvePricing('claude-3-5-haiku-20241022');
    expect(p.inputCostPerMillion).toBe(0.8); // haiku-3.5 pricing, not haiku-3
  });
});

describe('estimateCost', () => {
  it('returns 0 for zero tokens', () => {
    expect(estimateCost('claude-sonnet-4-6', 0, 0)).toBe(0);
  });

  it('calculates input-only cost correctly', () => {
    // 1M input tokens at $3.00/M = $3.00
    expect(estimateCost('claude-sonnet-4-6', 1_000_000, 0)).toBeCloseTo(3.0);
  });

  it('calculates output-only cost correctly', () => {
    // 1M output tokens at $15.00/M = $15.00
    expect(estimateCost('claude-sonnet-4-6', 0, 1_000_000)).toBeCloseTo(15.0);
  });

  it('combines input and output costs', () => {
    // 500k input @ $3/M + 500k output @ $15/M = $1.50 + $7.50 = $9.00
    expect(estimateCost('claude-sonnet-4-6', 500_000, 500_000)).toBeCloseTo(9.0);
  });

  it('uses default pricing for unknown model', () => {
    const known = estimateCost('claude-sonnet-4-6', 1000, 500);
    const unknown = estimateCost('unknown-model-xyz', 1000, 500);
    expect(unknown).toBeCloseTo(known);
  });
});

// ─── BudgetTracker ────────────────────────────────────────────────────────────

describe('BudgetTracker', () => {
  let dir: string;
  let logFile: string;

  beforeEach(() => {
    dir = tmpDir();
    logFile = join(dir, 'budget.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('assigns a stable sessionId across multiple appends', () => {
    const tracker = new BudgetTracker({ logFile });
    tracker.append(100, 50);
    tracker.append(200, 80);

    const entries = readEntries(logFile);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.session_id).toBe(tracker.sessionId);
    expect(entries[1]!.session_id).toBe(tracker.sessionId);
  });

  it('writes a valid JSONL entry per append() call', () => {
    const tracker = new BudgetTracker({ logFile, model: 'claude-sonnet-4-6' });
    tracker.append(1000, 500);

    const entries = readEntries(logFile);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.model).toBe('claude-sonnet-4-6');
    expect(entry.tokens).toBe(1500);
    expect(typeof entry.cost).toBe('number');
    expect(entry.cost).toBeGreaterThan(0);
  });

  it('uses explicit model override in append()', () => {
    const tracker = new BudgetTracker({ logFile, model: 'claude-sonnet-4-6' });
    tracker.append(100, 0, 'claude-opus-4-6');

    const entries = readEntries(logFile);
    expect(entries[0]!.model).toBe('claude-opus-4-6');
    // Opus is more expensive
    const opusCost = entries[0]!.cost;
    expect(opusCost).toBeGreaterThan(estimateCost('claude-sonnet-4-6', 100, 0));
  });

  it('accumulates multiple entries in the log file', () => {
    const tracker = new BudgetTracker({ logFile });
    tracker.append(100, 50);
    tracker.append(200, 80);
    tracker.append(50, 20);

    const entries = readEntries(logFile);
    expect(entries).toHaveLength(3);
  });

  it('creates parent directories if they do not exist', () => {
    const nestedLog = join(dir, 'a', 'b', 'c', 'budget.jsonl');
    const tracker = new BudgetTracker({ logFile: nestedLog });
    tracker.append(100, 50);
    expect(existsSync(nestedLog)).toBe(true);
  });

  it('applies default dailyTokenLimit of 100_000', () => {
    const tracker = new BudgetTracker({ logFile });
    expect(tracker.dailyTokenLimit).toBe(100_000);
  });

  it('applies default warnAt of 80_000', () => {
    const tracker = new BudgetTracker({ logFile });
    expect(tracker.warnAt).toBe(80_000);
  });

  it('respects custom dailyTokenLimit and warnAt', () => {
    const tracker = new BudgetTracker({ logFile, dailyTokenLimit: 50_000, warnAt: 40_000 });
    expect(tracker.dailyTokenLimit).toBe(50_000);
    expect(tracker.warnAt).toBe(40_000);
  });

  it('records cost=0 for zero tokens', () => {
    const tracker = new BudgetTracker({ logFile });
    tracker.append(0, 0);
    const entries = readEntries(logFile);
    expect(entries[0]!.tokens).toBe(0);
    expect(entries[0]!.cost).toBe(0);
  });
});

// ─── createBudgetTracker ──────────────────────────────────────────────────────

describe('createBudgetTracker', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    // Clean up env vars
    delete process.env.OPENAUTH_BUDGET_LOG_FILE;
    delete process.env.OPENAUTH_BUDGET_MODEL;
    delete process.env.OPENAUTH_BUDGET_DAILY_LIMIT;
    delete process.env.OPENAUTH_BUDGET_WARN_AT;
  });

  it('uses data/budget.jsonl under pluginRoot by default', () => {
    const tracker = createBudgetTracker(dir);
    tracker.append(100, 50);
    const logFile = join(dir, 'data', 'budget.jsonl');
    expect(existsSync(logFile)).toBe(true);
  });

  it('respects OPENAUTH_BUDGET_LOG_FILE env override', () => {
    const customLog = join(dir, 'custom.jsonl');
    process.env.OPENAUTH_BUDGET_LOG_FILE = customLog;
    const tracker = createBudgetTracker(dir);
    tracker.append(100, 50);
    expect(existsSync(customLog)).toBe(true);
  });

  it('respects OPENAUTH_BUDGET_DAILY_LIMIT env override', () => {
    process.env.OPENAUTH_BUDGET_DAILY_LIMIT = '25000';
    const tracker = createBudgetTracker(dir);
    expect(tracker.dailyTokenLimit).toBe(25_000);
  });

  it('respects OPENAUTH_BUDGET_WARN_AT env override', () => {
    process.env.OPENAUTH_BUDGET_WARN_AT = '20000';
    const tracker = createBudgetTracker(dir);
    expect(tracker.warnAt).toBe(20_000);
  });

  it('respects OPENAUTH_BUDGET_MODEL env override', () => {
    process.env.OPENAUTH_BUDGET_MODEL = 'claude-opus-4-6';
    const tracker = createBudgetTracker(dir);
    expect(tracker.model).toBe('claude-opus-4-6');
  });
});

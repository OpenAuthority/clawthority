/**
 * Auto-permit performance monitor — test suite
 *
 * TC-APMPERF-01  measurePermitEval returns the result of evalFn unchanged
 * TC-APMPERF-02  metrics.durationMs is a non-negative number
 * TC-APMPERF-03  metrics.permitCount matches the value passed
 * TC-APMPERF-04  metrics.matched is true when evalFn returns a non-null value
 * TC-APMPERF-05  metrics.matched is false when evalFn returns null
 * TC-APMPERF-06  slow evaluation emits a console.warn with duration and count
 * TC-APMPERF-07  fast evaluation with large permit set emits count/duration log
 * TC-APMPERF-08  fast evaluation with small permit set emits no console.warn
 * TC-APMPERF-09  estimatePermitMemoryBytes returns 0 for an empty rule set
 * TC-APMPERF-10  estimatePermitMemoryBytes scales with rule count and string lengths
 * TC-APMPERF-11  logPermitMemoryUsage warns when estimated bytes exceed threshold
 * TC-APMPERF-12  logPermitMemoryUsage logs metric line at large-set threshold
 * TC-APMPERF-13  logPermitMemoryUsage is silent for small set below both thresholds
 * TC-APMPERF-14  FileAutoPermitChecker constructor calls logPermitMemoryUsage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  measurePermitEval,
  estimatePermitMemoryBytes,
  logPermitMemoryUsage,
  SLOW_EVAL_THRESHOLD_MS,
  LARGE_PERMIT_SET_THRESHOLD,
  MEMORY_WARN_THRESHOLD_BYTES,
} from './perf-monitor.js';
import { FileAutoPermitChecker } from './matcher.js';
import type { AutoPermit } from '../models/auto-permit.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRule(pattern: string): AutoPermit {
  return { pattern, method: 'default', createdAt: Date.now(), originalCommand: pattern };
}

/** Returns a `{ pattern, originalCommand }` stub for memory estimation tests. */
function stub(pattern: string, originalCommand = pattern) {
  return { pattern, originalCommand };
}

// ── measurePermitEval ─────────────────────────────────────────────────────────

describe('measurePermitEval', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TC-APMPERF-01
  it('TC-APMPERF-01: returns the result of evalFn unchanged', () => {
    const sentinel = { matched: true };
    const { result } = measurePermitEval(1, () => sentinel);
    expect(result).toBe(sentinel);
  });

  // TC-APMPERF-02
  it('TC-APMPERF-02: metrics.durationMs is a non-negative number', () => {
    const { metrics } = measurePermitEval(1, () => null);
    expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof metrics.durationMs).toBe('number');
  });

  // TC-APMPERF-03
  it('TC-APMPERF-03: metrics.permitCount matches the value passed', () => {
    const { metrics } = measurePermitEval(42, () => null);
    expect(metrics.permitCount).toBe(42);
  });

  // TC-APMPERF-04
  it('TC-APMPERF-04: metrics.matched is true when evalFn returns non-null', () => {
    const { metrics } = measurePermitEval(1, () => ({ pattern: 'git *' }));
    expect(metrics.matched).toBe(true);
  });

  // TC-APMPERF-05
  it('TC-APMPERF-05: metrics.matched is false when evalFn returns null', () => {
    const { metrics } = measurePermitEval(1, () => null);
    expect(metrics.matched).toBe(false);
  });

  // TC-APMPERF-06
  it('TC-APMPERF-06: slow evaluation emits console.warn with duration and count', () => {
    // Simulate a slow evaluation by mocking performance.now
    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      callCount++;
      // First call (start): 0; second call (end): threshold + 1
      return callCount === 1 ? 0 : SLOW_EVAL_THRESHOLD_MS + 10;
    });

    measurePermitEval(3, () => null);

    expect(warnSpy).toHaveBeenCalledOnce();
    const msg: string = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('[auto-permits] perf: slow evaluation');
    expect(msg).toContain('3 rule(s)');
  });

  // TC-APMPERF-07
  it('TC-APMPERF-07: fast evaluation with large permit set emits a count/duration log', () => {
    // duration stays at 0 (performance.now always returns 0)
    vi.spyOn(performance, 'now').mockReturnValue(0);

    measurePermitEval(LARGE_PERMIT_SET_THRESHOLD, () => null);

    expect(warnSpy).toHaveBeenCalledOnce();
    const msg: string = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain(`${LARGE_PERMIT_SET_THRESHOLD} rules evaluated`);
  });

  // TC-APMPERF-08
  it('TC-APMPERF-08: fast evaluation with small permit set emits no console.warn', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);

    measurePermitEval(LARGE_PERMIT_SET_THRESHOLD - 1, () => null);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── estimatePermitMemoryBytes ─────────────────────────────────────────────────

describe('estimatePermitMemoryBytes', () => {
  // TC-APMPERF-09
  it('TC-APMPERF-09: returns 0 for an empty rule set', () => {
    expect(estimatePermitMemoryBytes([])).toBe(0);
  });

  // TC-APMPERF-10
  it('TC-APMPERF-10: scales with rule count and string lengths', () => {
    const single = estimatePermitMemoryBytes([stub('git commit *')]);
    const double = estimatePermitMemoryBytes([stub('git commit *'), stub('npm run *')]);
    // Two rules should be strictly larger than one
    expect(double).toBeGreaterThan(single);
    // A longer pattern produces a larger estimate than a shorter one
    const short = estimatePermitMemoryBytes([stub('a')]);
    const long = estimatePermitMemoryBytes([stub('a'.repeat(100))]);
    expect(long).toBeGreaterThan(short);
  });
});

// ── logPermitMemoryUsage ──────────────────────────────────────────────────────

describe('logPermitMemoryUsage', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TC-APMPERF-11
  it('TC-APMPERF-11: warns when estimated bytes meet or exceed memory threshold', () => {
    // Construct enough rules to push estimated bytes past MEMORY_WARN_THRESHOLD_BYTES.
    // Each rule: 200 (overhead) + pattern.length * 2 + originalCommand.length * 2
    // Use a long pattern to hit the threshold with fewer rules.
    const longPattern = 'x'.repeat(2048); // 2048 * 2 * 2 + 200 = ~8 392 bytes per rule
    const rulesNeeded = Math.ceil(MEMORY_WARN_THRESHOLD_BYTES / (200 + longPattern.length * 4)) + 1;
    const rules = Array.from({ length: rulesNeeded }, () => stub(longPattern));

    logPermitMemoryUsage(rules);

    expect(warnSpy).toHaveBeenCalledOnce();
    const msg: string = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('consider pruning');
    expect(msg).toContain('KiB');
  });

  // TC-APMPERF-12
  it('TC-APMPERF-12: logs metric line at large-set threshold (below memory threshold)', () => {
    // Use minimal-length patterns so we stay below the memory threshold
    const rules = Array.from({ length: LARGE_PERMIT_SET_THRESHOLD }, (_, i) =>
      stub(`rule${i}`),
    );
    // Verify we're below the memory threshold
    const bytes = estimatePermitMemoryBytes(rules);
    expect(bytes).toBeLessThan(MEMORY_WARN_THRESHOLD_BYTES);

    logPermitMemoryUsage(rules);

    expect(warnSpy).toHaveBeenCalledOnce();
    const msg: string = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain(`${LARGE_PERMIT_SET_THRESHOLD} rules loaded`);
    expect(msg).toContain('KiB');
  });

  // TC-APMPERF-13
  it('TC-APMPERF-13: silent for small set below both thresholds', () => {
    const rules = Array.from({ length: LARGE_PERMIT_SET_THRESHOLD - 1 }, (_, i) =>
      stub(`rule${i}`),
    );
    logPermitMemoryUsage(rules);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── FileAutoPermitChecker integration ─────────────────────────────────────────

describe('FileAutoPermitChecker memory monitoring', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TC-APMPERF-14
  it('TC-APMPERF-14: constructor emits a warn for large permit sets', () => {
    const rules = Array.from({ length: LARGE_PERMIT_SET_THRESHOLD }, (_, i) =>
      makeRule(`tool${i} *`),
    );
    // Constructing the checker should trigger logPermitMemoryUsage
    new FileAutoPermitChecker(rules);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('TC-APMPERF-14b: constructor is silent for small permit sets', () => {
    const rules = [makeRule('git commit *'), makeRule('npm run *')];
    new FileAutoPermitChecker(rules);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

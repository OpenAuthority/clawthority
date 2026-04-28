/**
 * Auto-permit performance monitor.
 *
 * Provides lightweight instrumentation for auto-permit evaluation latency
 * and permit-store memory usage. Warnings are emitted to stderr when
 * evaluation time or memory usage exceeds configured thresholds.
 *
 * Integrates with the existing stderr-based monitoring pattern used across
 * the auto-permits subsystem (mirrors the `[auto-permits]` log prefix
 * convention established by `store.ts`).
 *
 * @module
 */

// ── Thresholds ────────────────────────────────────────────────────────────────

/**
 * Evaluation durations above this threshold (milliseconds) trigger a
 * slow-evaluation warning on stderr.
 */
export const SLOW_EVAL_THRESHOLD_MS = 5;

/**
 * Permit sets with a rule count at or above this value trigger metric
 * logging on every evaluation, even when evaluation is fast.
 */
export const LARGE_PERMIT_SET_THRESHOLD = 50;

/**
 * Estimated permit-store heap size at or above this byte count triggers a
 * memory-usage warning on stderr.
 */
export const MEMORY_WARN_THRESHOLD_BYTES = 512 * 1024; // 512 KiB

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Metrics snapshot captured by a single {@link measurePermitEval} call.
 */
export interface AutoPermitPerfMetrics {
  /** Wall-clock duration of the evaluation, in milliseconds. */
  durationMs: number;
  /** Number of rules in the permit set that was evaluated. */
  permitCount: number;
  /** `true` when the evaluation found a matching rule. */
  matched: boolean;
  /** Pattern of the matched rule, if any. */
  matchedPattern?: string;
}

// ── measurePermitEval ─────────────────────────────────────────────────────────

/**
 * Wraps an auto-permit evaluation function with timing instrumentation.
 *
 * After `evalFn` returns, the following warnings are emitted to stderr:
 * - When `durationMs > SLOW_EVAL_THRESHOLD_MS`: slow-evaluation warning
 *   including the duration and permit count.
 * - When the set is large (`permitCount >= LARGE_PERMIT_SET_THRESHOLD`) but
 *   evaluation was not slow: a metric log line with duration and count.
 *
 * The `evalFn` return value is forwarded unchanged as `result`.
 *
 * @param permitCount  Number of rules in the permit set being evaluated.
 * @param evalFn       The synchronous evaluation to time.
 * @returns The raw evaluation result and the captured {@link AutoPermitPerfMetrics}.
 */
export function measurePermitEval<T>(
  permitCount: number,
  evalFn: () => T,
): { result: T; metrics: AutoPermitPerfMetrics } {
  const start = performance.now();
  const result = evalFn();
  const durationMs = performance.now() - start;

  const matched = result !== null && result !== undefined;
  const metrics: AutoPermitPerfMetrics = { durationMs, permitCount, matched };

  if (durationMs > SLOW_EVAL_THRESHOLD_MS) {
    console.warn(
      `[auto-permits] perf: slow evaluation — ${durationMs.toFixed(3)}ms for ${permitCount} rule(s); ` +
        `consider pruning the permit set`,
    );
  } else if (permitCount >= LARGE_PERMIT_SET_THRESHOLD) {
    console.warn(
      `[auto-permits] perf: ${permitCount} rules evaluated in ${durationMs.toFixed(3)}ms`,
    );
  }

  return { result, metrics };
}

// ── estimatePermitMemoryBytes ─────────────────────────────────────────────────

/**
 * Estimates the heap memory occupied by a set of auto-permit rules.
 *
 * Uses a fixed per-object overhead plus the UTF-16 encoded byte sizes of the
 * `pattern` and `originalCommand` string fields (2 bytes per character). The
 * result is an approximation — actual V8 heap consumption may differ.
 *
 * @param rules  Rules to measure.
 * @returns Estimated byte count.
 */
export function estimatePermitMemoryBytes(
  rules: ReadonlyArray<{ pattern: string; originalCommand: string }>,
): number {
  /** Fixed overhead per rule object: properties, hidden class, etc. */
  const PER_OBJECT_OVERHEAD_BYTES = 200;
  return rules.reduce(
    (acc, rule) =>
      acc +
      PER_OBJECT_OVERHEAD_BYTES +
      (rule.pattern.length + rule.originalCommand.length) * 2,
    0,
  );
}

// ── logPermitMemoryUsage ──────────────────────────────────────────────────────

/**
 * Logs an estimated memory-usage metric for a loaded permit set.
 *
 * Emits to stderr:
 * - A memory warning when the estimated size meets or exceeds
 *   {@link MEMORY_WARN_THRESHOLD_BYTES}.
 * - A metric log line when the rule count meets or exceeds
 *   {@link LARGE_PERMIT_SET_THRESHOLD} (below the memory warning threshold).
 *
 * Silent for small permit sets that are within both thresholds.
 *
 * @param rules  The rules currently held in the permit store.
 */
export function logPermitMemoryUsage(
  rules: ReadonlyArray<{ pattern: string; originalCommand: string }>,
): void {
  const bytes = estimatePermitMemoryBytes(rules);
  const kib = (bytes / 1024).toFixed(1);

  if (bytes >= MEMORY_WARN_THRESHOLD_BYTES) {
    console.warn(
      `[auto-permits] perf: permit store estimated at ${kib}KiB (${rules.length} rules) — consider pruning`,
    );
  } else if (rules.length >= LARGE_PERMIT_SET_THRESHOLD) {
    console.warn(
      `[auto-permits] perf: ${rules.length} rules loaded, estimated memory ${kib}KiB`,
    );
  }
}

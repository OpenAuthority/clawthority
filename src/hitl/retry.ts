/**
 * Shared retry + circuit-breaker helper for HITL adapters.
 *
 * Provides bounded exponential backoff with jitter for 429 responses and a
 * circuit breaker that opens after max retries, returning a caller-supplied
 * fallback value while the breaker is open. The breaker auto-recovers after
 * a configurable cooldown period.
 */

/** Observable state of the circuit breaker. */
export type CircuitState = 'closed' | 'open';

/** Tuning parameters for the retry loop. */
export interface RetryOptions {
  /** Maximum number of 429 retries before tripping the circuit. Default: 4. */
  maxRetries: number;
  /** Base delay for exponential backoff in ms. Default: 500. */
  baseDelayMs: number;
  /** Maximum backoff cap in ms. Default: 30 000. */
  maxDelayMs: number;
  /** ±Jitter fraction applied to the computed delay. Default: 0.25. */
  jitterFactor: number;
}

const DEFAULTS: RetryOptions = {
  maxRetries: 4,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitterFactor: 0.25,
};

/**
 * Circuit breaker that opens after repeated 429 failures and auto-recovers
 * after a configurable cooldown period. One instance should be shared per
 * upstream API endpoint (e.g. one for Telegram, one for Slack).
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private openedAt: number | null = null;

  constructor(
    /** How long (ms) the breaker stays open before auto-closing. Default: 60 000. */
    readonly cooldownMs: number = 60_000,
  ) {}

  /**
   * Returns `true` if the breaker is currently blocking calls.
   * Automatically transitions back to closed once the cooldown elapses.
   */
  isOpen(): boolean {
    if (this.state !== 'open') return false;
    if (this.openedAt !== null && Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'closed';
      this.openedAt = null;
      console.log('[hitl-retry] circuit breaker closed — cooldown elapsed');
      return false;
    }
    return true;
  }

  /** Opens the breaker. Called after max retries are exhausted. */
  trip(): void {
    if (this.state === 'open') return; // already open, preserve original openedAt
    this.state = 'open';
    this.openedAt = Date.now();
    console.error('[hitl-retry] circuit breaker opened');
  }

  /** Current state — for diagnostics and tests. */
  getState(): CircuitState {
    return this.state;
  }
}

/**
 * Wraps a single fetch-based API call with exponential backoff for 429
 * responses and circuit-breaker protection.
 *
 * - Non-429 responses (success or other HTTP errors) are passed directly to
 *   `parse`; `withRetry` does not interpret them.
 * - Network errors thrown by `fn` propagate to the caller unchanged.
 * - If the breaker is already open, `onFallback()` is returned immediately
 *   without touching the network.
 * - After `maxRetries` 429 responses, the breaker trips and `onFallback()` is
 *   returned for this call and all subsequent calls until the cooldown elapses.
 *
 * @param fn         Factory that executes one fetch attempt.
 * @param parse      Converts a non-429 Response into the desired result.
 * @param onFallback Returns the fallback result when the circuit is open.
 * @param breaker    Shared CircuitBreaker for this API endpoint.
 * @param opts       Optional retry-tuning overrides.
 */
export async function withRetry<T>(
  fn: () => Promise<Response>,
  parse: (res: Response) => Promise<T>,
  onFallback: () => T,
  breaker: CircuitBreaker,
  opts: Partial<RetryOptions> = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, jitterFactor } = { ...DEFAULTS, ...opts };

  if (breaker.isOpen()) {
    console.warn('[hitl-retry] circuit open — returning fallback immediately');
    return onFallback();
  }

  let attempt = 0;

  for (;;) {
    const res = await fn(); // network errors propagate to caller

    if (res.status !== 429) {
      return parse(res);
    }

    // 429 — rate limited
    if (attempt >= maxRetries) {
      breaker.trip();
      console.error(`[hitl-retry] max retries (${maxRetries}) exhausted — circuit tripped`);
      return onFallback();
    }

    const delay = computeBackoff(attempt, baseDelayMs, maxDelayMs, jitterFactor);
    console.warn(
      `[hitl-retry] 429 received (attempt ${attempt + 1}/${maxRetries + 1}) — backing off ${delay}ms`,
    );
    await sleep(delay);
    attempt++;
  }
}

/** Computes bounded exponential backoff with additive ±jitter. */
export function computeBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor: number,
): number {
  const exp = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  const jitter = exp * jitterFactor * (2 * Math.random() - 1);
  return Math.max(0, Math.round(exp + jitter));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  });
}

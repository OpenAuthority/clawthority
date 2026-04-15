import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, withRetry, computeBackoff } from './retry.js';

// ─── CircuitBreaker ──────────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const breaker = new CircuitBreaker();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.isOpen()).toBe(false);
  });

  it('trip() opens the breaker', () => {
    const breaker = new CircuitBreaker();
    breaker.trip();
    expect(breaker.getState()).toBe('open');
    expect(breaker.isOpen()).toBe(true);
  });

  it('trip() is idempotent — second call does not reset openedAt', () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker(1_000);
    breaker.trip();

    // Advance time partway (not yet past cooldown)
    vi.advanceTimersByTime(600);
    // Trip again — should not reset the clock
    breaker.trip();

    // Advance by another 600ms — total 1200ms past first trip, 600ms past second
    vi.advanceTimersByTime(600);
    // Cooldown is 1000ms; 1200ms have elapsed since first trip → should be closed
    expect(breaker.isOpen()).toBe(false);
    vi.useRealTimers();
  });

  it('auto-closes after cooldown elapses', () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker(500);
    breaker.trip();

    expect(breaker.isOpen()).toBe(true);

    vi.advanceTimersByTime(500);
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.getState()).toBe('closed');
    vi.useRealTimers();
  });

  it('remains open before cooldown elapses', () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker(1_000);
    breaker.trip();

    vi.advanceTimersByTime(999);
    expect(breaker.isOpen()).toBe(true);
    vi.useRealTimers();
  });

  it('can be tripped again after recovering from cooldown', () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker(100);
    breaker.trip();
    vi.advanceTimersByTime(100);
    expect(breaker.isOpen()).toBe(false); // auto-recovered

    breaker.trip();
    expect(breaker.isOpen()).toBe(true);
    vi.useRealTimers();
  });
});

// ─── computeBackoff ───────────────────────────────────────────────────────────

describe('computeBackoff', () => {
  it('doubles delay with each attempt up to maxDelayMs', () => {
    // With jitterFactor:0 the output is deterministic
    expect(computeBackoff(0, 100, 10_000, 0)).toBe(100);
    expect(computeBackoff(1, 100, 10_000, 0)).toBe(200);
    expect(computeBackoff(2, 100, 10_000, 0)).toBe(400);
    expect(computeBackoff(3, 100, 10_000, 0)).toBe(800);
  });

  it('caps at maxDelayMs', () => {
    const capped = computeBackoff(20, 500, 1_000, 0);
    expect(capped).toBe(1_000);
  });

  it('never returns a negative value', () => {
    // With maximum negative jitter (mocked Math.random = 0 → jitter = -jitterFactor * exp)
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const delay = computeBackoff(0, 100, 10_000, 1.0); // 100% jitter, full negative
    expect(delay).toBeGreaterThanOrEqual(0);
    vi.restoreAllMocks();
  });
});

// ─── withRetry ───────────────────────────────────────────────────────────────

describe('withRetry', () => {
  const NO_DELAY: Parameters<typeof withRetry>[4] = {
    maxRetries: 2,
    baseDelayMs: 0,
    maxDelayMs: 0,
    jitterFactor: 0,
  };

  let fetchMock: ReturnType<typeof vi.fn>;
  let breaker: CircuitBreaker;

  beforeEach(() => {
    fetchMock = vi.fn();
    breaker = new CircuitBreaker(60_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed result on 200 response', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const result = await withRetry(
      fetchMock,
      async (_res) => 'success',
      () => 'fallback',
      breaker,
      NO_DELAY,
    );

    expect(result).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes non-429 error responses to parse', async () => {
    fetchMock.mockResolvedValue(new Response('error', { status: 500 }));

    const result = await withRetry(
      fetchMock,
      async (res) => (res.ok ? 'ok' : 'http-error'),
      () => 'fallback',
      breaker,
      NO_DELAY,
    );

    expect(result).toBe('http-error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Circuit should remain closed — 500 is not a rate-limit response
    expect(breaker.getState()).toBe('closed');
  });

  it('retries on 429 and succeeds after backoff', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const result = await withRetry(
      fetchMock,
      async (_res) => 'done',
      () => 'fallback',
      breaker,
      NO_DELAY,
    );

    expect(result).toBe('done');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(breaker.getState()).toBe('closed');
  });

  it('trips the circuit after maxRetries 429 responses', async () => {
    // maxRetries:2 means 3 total attempts (0,1,2) then trip on 3rd 429
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));

    const result = await withRetry(
      fetchMock,
      async (_res) => 'done',
      () => 'fallback',
      breaker,
      NO_DELAY,
    );

    expect(result).toBe('fallback');
    // 3 fetch calls: attempt 0 (retry), attempt 1 (retry), attempt 2 (trips)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(breaker.getState()).toBe('open');
  });

  it('returns fallback immediately when circuit is already open', async () => {
    breaker.trip();

    const result = await withRetry(
      fetchMock,
      async (_res) => 'done',
      () => 'circuit-fallback',
      breaker,
      NO_DELAY,
    );

    expect(result).toBe('circuit-fallback');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates network errors from fn()', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    await expect(
      withRetry(
        fetchMock,
        async (_res) => 'done',
        () => 'fallback',
        breaker,
        NO_DELAY,
      ),
    ).rejects.toThrow('Network error');

    expect(breaker.getState()).toBe('closed');
  });

  it('succeeds on first retry after single 429', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    let parsedRes: Response | undefined;
    const result = await withRetry(
      fetchMock,
      async (res) => {
        parsedRes = res;
        return 'parsed';
      },
      () => 'fallback',
      breaker,
      NO_DELAY,
    );

    expect(result).toBe('parsed');
    expect(parsedRes?.status).toBe(200);
  });

  it('circuit auto-recovers after cooldown and allows new calls', async () => {
    vi.useFakeTimers();
    const shortBreaker = new CircuitBreaker(100);
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));

    // Trip the circuit
    await withRetry(
      fetchMock,
      async (_res) => 'done',
      () => 'fallback',
      shortBreaker,
      { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0, jitterFactor: 0 },
    );
    expect(shortBreaker.getState()).toBe('open');

    // Advance past cooldown
    vi.advanceTimersByTime(100);

    // Now a call succeeds
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    const result = await withRetry(
      fetchMock,
      async (_res) => 'recovered',
      () => 'fallback',
      shortBreaker,
      { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0, jitterFactor: 0 },
    );
    expect(result).toBe('recovered');
    expect(shortBreaker.getState()).toBe('closed');
    vi.useRealTimers();
  });

  it('parse receives the actual Response object', async () => {
    const mockBody = JSON.stringify({ ts: 'abc.123' });
    fetchMock.mockResolvedValue(new Response(mockBody, { status: 200 }));

    const result = await withRetry(
      fetchMock,
      async (res) => {
        const data = (await res.json()) as { ts: string };
        return data.ts;
      },
      () => '',
      breaker,
      NO_DELAY,
    );

    expect(result).toBe('abc.123');
  });
});

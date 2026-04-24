/**
 * Unit tests for the webhook tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 * The global setTimeout is stubbed via vi.useFakeTimers so retry backoff
 * does not slow down the test suite.
 *
 * Test IDs:
 *   TC-WH-01: Successful post — returns status_code, response_body, attempts
 *   TC-WH-02: Content-Type response — response Content-Type included in result
 *   TC-WH-03: Content-Type request — application/json set by default
 *   TC-WH-04: Content-Type override — caller Content-Type is not overridden
 *   TC-WH-05: Custom headers — caller headers forwarded in request
 *   TC-WH-06: Payload serialisation — payload JSON-serialised in POST body
 *   TC-WH-07: invalid-url — non-http/https URL throws WebhookError immediately
 *   TC-WH-08: Retry on network-error — retries up to max_retries times
 *   TC-WH-09: Retry on timeout — retries up to max_retries times
 *   TC-WH-10: No retry on HTTP error — non-2xx returns without retrying
 *   TC-WH-11: Exhausted retries — throws WebhookError after all attempts fail
 *   TC-WH-12: Custom max_retries — respects caller-supplied max_retries
 *   TC-WH-13: Zero retries — no retry when max_retries is 0
 *   TC-WH-14: Attempts count — result.attempts reflects the actual attempt number
 *   TC-WH-15: Always POST — method is POST regardless of payload
 *   TC-WH-16: Result shape — required fields present in result
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { webhook, WebhookError } from './webhook.js';

// ─── Fake timers ──────────────────────────────────────────────────────────────

// Use fake timers so backoff sleeps resolve immediately.
vi.useFakeTimers();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllTimers();
});

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubFetch(
  status: number,
  body: string,
  opts: { contentType?: string } = {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    status,
    text: async () => body,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') return opts.contentType ?? null;
        return null;
      },
    },
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchRejected(message: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockRejectedValue(new Error(message));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchAbort(): ReturnType<typeof vi.fn> {
  const abortError = new Error('The operation was aborted');
  abortError.name = 'AbortError';
  const fetchMock = vi.fn().mockRejectedValue(abortError);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Stubs fetch to fail N times then succeed on the (N+1)th call. */
function stubFetchFailThenSucceed(
  failCount: number,
  failType: 'network' | 'abort',
): ReturnType<typeof vi.fn> {
  const error =
    failType === 'abort'
      ? Object.assign(new Error('aborted'), { name: 'AbortError' })
      : new Error('ECONNREFUSED');

  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(error);

  for (let i = 1; i < failCount; i++) {
    fetchMock.mockRejectedValueOnce(failType === 'abort'
      ? Object.assign(new Error('aborted'), { name: 'AbortError' })
      : new Error('ECONNREFUSED'));
  }

  fetchMock.mockResolvedValue({
    status: 200,
    text: async () => 'ok',
    headers: { get: () => null },
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Helper that runs the async webhook call while advancing fake timers to
// unblock any backoff sleeps.
async function runWebhook(
  params: Parameters<typeof webhook>[0],
): Promise<ReturnType<typeof webhook>> {
  const promise = webhook(params);
  // Attach a no-op catch before draining timers so Node.js does not report
  // the rejection as unhandled during the vi.runAllTimersAsync() phase.
  // The calling test's own try/catch still receives the rejection.
  promise.catch(() => {});
  await vi.runAllTimersAsync();
  return promise;
}

// ─── TC-WH-01: Successful post ───────────────────────────────────────────────

describe('TC-WH-01: successful post — returns status_code, response_body, attempts', () => {
  it('returns status 200 and the response body', async () => {
    stubFetch(200, 'ok');
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: { event: 'test' } });
    expect(result.status_code).toBe(200);
    expect(result.response_body).toBe('ok');
  });

  it('returns attempts: 1 on first-attempt success', async () => {
    stubFetch(200, 'ok');
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(result.attempts).toBe(1);
  });

  it('returns status 204 with empty body', async () => {
    stubFetch(204, '');
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(result.status_code).toBe(204);
    expect(result.response_body).toBe('');
  });
});

// ─── TC-WH-02: Content-Type response ─────────────────────────────────────────

describe('TC-WH-02: content-type — response Content-Type included in result', () => {
  it('includes content_type when the response header is present', async () => {
    stubFetch(200, '{"ok":true}', { contentType: 'application/json' });
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: { x: 1 } });
    expect(result.content_type).toBe('application/json');
  });

  it('omits content_type when the response header is absent', async () => {
    stubFetch(200, 'ok');
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: { x: 1 } });
    expect(result.content_type).toBeUndefined();
  });
});

// ─── TC-WH-03: Content-Type request header default ───────────────────────────

describe('TC-WH-03: content-type request header — application/json set by default', () => {
  it('sets Content-Type: application/json when no headers provided', async () => {
    const fetchMock = stubFetch(200, 'ok');

    await runWebhook({ url: 'https://hooks.example.com/event', payload: { a: 1 } });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ─── TC-WH-04: Content-Type override ─────────────────────────────────────────

describe('TC-WH-04: content-type override — caller Content-Type is not overridden', () => {
  it('preserves caller-supplied Content-Type header', async () => {
    const fetchMock = stubFetch(200, 'ok');

    await runWebhook({
      url: 'https://hooks.example.com/event',
      payload: { a: 1 },
      headers: { 'Content-Type': 'application/vnd.custom+json' },
    });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/vnd.custom+json');
  });

  it('case-insensitive Content-Type detection — does not double-set', async () => {
    const fetchMock = stubFetch(200, 'ok');

    await runWebhook({
      url: 'https://hooks.example.com/event',
      payload: { a: 1 },
      headers: { 'content-type': 'text/plain' },
    });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['content-type']).toBe('text/plain');
    expect(headers['Content-Type']).toBeUndefined();
  });
});

// ─── TC-WH-05: Custom headers ────────────────────────────────────────────────

describe('TC-WH-05: custom headers — caller headers forwarded in request', () => {
  it('includes custom Authorization header in request', async () => {
    const fetchMock = stubFetch(200, 'ok');

    await runWebhook({
      url: 'https://hooks.example.com/event',
      payload: { a: 1 },
      headers: { 'X-Secret': 'tok-abc' },
    });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['X-Secret']).toBe('tok-abc');
  });
});

// ─── TC-WH-06: Payload serialisation ─────────────────────────────────────────

describe('TC-WH-06: payload serialisation — payload JSON-serialised in POST body', () => {
  it('sends the payload as a JSON string in the request body', async () => {
    const fetchMock = stubFetch(200, 'ok');

    await runWebhook({
      url: 'https://hooks.example.com/event',
      payload: { event: 'deploy', version: '1.2.3' },
    });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, string>;
    expect(body['event']).toBe('deploy');
    expect(body['version']).toBe('1.2.3');
  });
});

// ─── TC-WH-07: invalid-url ───────────────────────────────────────────────────

describe('TC-WH-07: invalid-url — non-http/https URL throws WebhookError immediately', () => {
  it('throws WebhookError with code invalid-url for ftp scheme', async () => {
    let err: WebhookError | undefined;
    try {
      await webhook({ url: 'ftp://hooks.example.com/event', payload: {} });
    } catch (e) {
      err = e as WebhookError;
    }
    expect(err).toBeInstanceOf(WebhookError);
    expect(err!.code).toBe('invalid-url');
  });

  it('throws WebhookError with code invalid-url for bare path', async () => {
    let err: WebhookError | undefined;
    try {
      await webhook({ url: '/not/a/url', payload: {} });
    } catch (e) {
      err = e as WebhookError;
    }
    expect(err).toBeInstanceOf(WebhookError);
    expect(err!.code).toBe('invalid-url');
  });

  it('does not call fetch for invalid-url', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await webhook({ url: 'ws://example.com', payload: {} });
    } catch {
      // expected
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('error name is WebhookError', async () => {
    let err: WebhookError | undefined;
    try {
      await webhook({ url: 'ws://example.com', payload: {} });
    } catch (e) {
      err = e as WebhookError;
    }
    expect(err!.name).toBe('WebhookError');
  });
});

// ─── TC-WH-08: Retry on network-error ────────────────────────────────────────

describe('TC-WH-08: retry on network-error — retries up to max_retries times', () => {
  it('retries on network-error and succeeds on second attempt', async () => {
    const fetchMock = stubFetchFailThenSucceed(1, 'network');

    const result = await runWebhook({
      url: 'https://hooks.example.com/event',
      payload: {},
      max_retries: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status_code).toBe(200);
    expect(result.attempts).toBe(2);
  });

  it('throws WebhookError code network-error after exhausting retries', async () => {
    stubFetchRejected('connection refused');

    let err: WebhookError | undefined;
    try {
      await runWebhook({ url: 'https://hooks.example.com/event', payload: {}, max_retries: 2 });
    } catch (e) {
      err = e as WebhookError;
    }

    expect(err).toBeInstanceOf(WebhookError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original failure cause', async () => {
    stubFetchRejected('ECONNREFUSED');

    let err: WebhookError | undefined;
    try {
      await runWebhook({ url: 'https://hooks.example.com/event', payload: {}, max_retries: 0 });
    } catch (e) {
      err = e as WebhookError;
    }

    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-WH-09: Retry on timeout ──────────────────────────────────────────────

describe('TC-WH-09: retry on timeout — retries up to max_retries times', () => {
  it('retries on timeout and succeeds on second attempt', async () => {
    const fetchMock = stubFetchFailThenSucceed(1, 'abort');

    const result = await runWebhook({
      url: 'https://hooks.example.com/event',
      payload: {},
      max_retries: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status_code).toBe(200);
    expect(result.attempts).toBe(2);
  });

  it('throws WebhookError code timeout after exhausting retries', async () => {
    stubFetchAbort();

    let err: WebhookError | undefined;
    try {
      await runWebhook({ url: 'https://hooks.example.com/event', payload: {}, max_retries: 1 });
    } catch (e) {
      err = e as WebhookError;
    }

    expect(err).toBeInstanceOf(WebhookError);
    expect(err!.code).toBe('timeout');
  });
});

// ─── TC-WH-10: No retry on HTTP error ────────────────────────────────────────

describe('TC-WH-10: no retry on HTTP error — non-2xx returns without retrying', () => {
  it('returns 400 without retrying', async () => {
    const fetchMock = stubFetch(400, 'bad request');
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(result.status_code).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
  });

  it('returns 500 without retrying', async () => {
    const fetchMock = stubFetch(500, 'internal server error');
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(result.status_code).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ─── TC-WH-11: Exhausted retries ─────────────────────────────────────────────

describe('TC-WH-11: exhausted retries — throws WebhookError after all attempts fail', () => {
  it('makes exactly max_retries + 1 fetch calls before throwing', async () => {
    const fetchMock = stubFetchRejected('ECONNRESET');

    let err: WebhookError | undefined;
    try {
      await runWebhook({ url: 'https://hooks.example.com/event', payload: {}, max_retries: 2 });
    } catch (e) {
      err = e as WebhookError;
    }

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(err).toBeInstanceOf(WebhookError);
  });

  it('error.attempts equals the number of attempts made', async () => {
    stubFetchRejected('ECONNRESET');

    let err: WebhookError | undefined;
    try {
      await runWebhook({ url: 'https://hooks.example.com/event', payload: {}, max_retries: 2 });
    } catch (e) {
      err = e as WebhookError;
    }

    expect(err!.attempts).toBe(3);
  });
});

// ─── TC-WH-12: Custom max_retries ────────────────────────────────────────────

describe('TC-WH-12: custom max_retries — respects caller-supplied max_retries', () => {
  it('only retries as many times as specified', async () => {
    const fetchMock = stubFetchRejected('fail');

    try {
      await runWebhook({ url: 'https://hooks.example.com/event', payload: {}, max_retries: 1 });
    } catch {
      // expected
    }

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });
});

// ─── TC-WH-13: Zero retries ──────────────────────────────────────────────────

describe('TC-WH-13: zero retries — no retry when max_retries is 0', () => {
  it('makes exactly one fetch call when max_retries is 0', async () => {
    const fetchMock = stubFetchRejected('fail');

    try {
      await runWebhook({ url: 'https://hooks.example.com/event', payload: {}, max_retries: 0 });
    } catch {
      // expected
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ─── TC-WH-14: Attempts count ────────────────────────────────────────────────

describe('TC-WH-14: attempts count — result.attempts reflects the actual attempt number', () => {
  it('reports attempts: 1 when the first attempt succeeds', async () => {
    stubFetch(200, 'ok');
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(result.attempts).toBe(1);
  });

  it('reports attempts: 2 when one retry was needed', async () => {
    stubFetchFailThenSucceed(1, 'network');
    const result = await runWebhook({
      url: 'https://hooks.example.com/event',
      payload: {},
      max_retries: 3,
    });
    expect(result.attempts).toBe(2);
  });
});

// ─── TC-WH-15: Always POST ───────────────────────────────────────────────────

describe('TC-WH-15: always POST — method is POST regardless of payload', () => {
  it('sends a POST request', async () => {
    const fetchMock = stubFetch(200, 'ok');

    await runWebhook({ url: 'https://hooks.example.com/event', payload: { a: 1 } });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.method).toBe('POST');
  });
});

// ─── TC-WH-16: Result shape ──────────────────────────────────────────────────

describe('TC-WH-16: result shape — required fields present in result', () => {
  it('result has a numeric status_code field', async () => {
    stubFetch(200, 'ok');
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(typeof result.status_code).toBe('number');
  });

  it('result has a string response_body field', async () => {
    stubFetch(200, 'ok');
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(typeof result.response_body).toBe('string');
  });

  it('result has a numeric attempts field', async () => {
    stubFetch(200, 'ok');
    const result = await runWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(typeof result.attempts).toBe('number');
  });
});

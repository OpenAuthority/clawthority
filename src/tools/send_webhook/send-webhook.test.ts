/**
 * Unit tests for the send_webhook tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 *
 * Test IDs:
 *   TC-SWH-01: Successful post — returns status_code, response_body
 *   TC-SWH-02: Content-Type — response Content-Type included in result
 *   TC-SWH-03: Content-Type header — application/json set by default
 *   TC-SWH-04: Content-Type override — caller Content-Type is not overridden
 *   TC-SWH-05: Custom headers — caller headers forwarded in request
 *   TC-SWH-06: Payload serialisation — payload JSON-serialised in POST body
 *   TC-SWH-07: invalid-url — non-http/https URL throws SendWebhookError
 *   TC-SWH-08: network-error — fetch rejection throws SendWebhookError
 *   TC-SWH-09: timeout — AbortError surfaces as code 'timeout'
 *   TC-SWH-10: Non-2xx response — returns status_code without throwing
 *   TC-SWH-11: Result shape — required fields present in result
 *   TC-SWH-12: Always POST — method is POST regardless of payload
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendWebhook, SendWebhookError } from './send-webhook.js';

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubFetch(
  status: number,
  body: string,
  opts: { contentType?: string } = {},
): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    text: async () => body,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') return opts.contentType ?? null;
        return null;
      },
    },
  }));
}

function stubFetchRejected(message: string): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── TC-SWH-01: Successful post ───────────────────────────────────────────────

describe('TC-SWH-01: successful post — returns status_code and response_body', () => {
  it('returns status 200 and the response body', async () => {
    stubFetch(200, 'ok');
    const result = await sendWebhook({ url: 'https://hooks.example.com/event', payload: { event: 'test' } });
    expect(result.status_code).toBe(200);
    expect(result.response_body).toBe('ok');
  });

  it('returns status 204 with empty body', async () => {
    stubFetch(204, '');
    const result = await sendWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(result.status_code).toBe(204);
    expect(result.response_body).toBe('');
  });
});

// ─── TC-SWH-02: Content-Type response header ──────────────────────────────────

describe('TC-SWH-02: content-type — response Content-Type included in result', () => {
  it('includes content_type when the response header is present', async () => {
    stubFetch(200, '{"ok":true}', { contentType: 'application/json' });
    const result = await sendWebhook({ url: 'https://hooks.example.com/event', payload: { x: 1 } });
    expect(result.content_type).toBe('application/json');
  });

  it('omits content_type when the response header is absent', async () => {
    stubFetch(200, 'ok');
    const result = await sendWebhook({ url: 'https://hooks.example.com/event', payload: { x: 1 } });
    expect(result.content_type).toBeUndefined();
  });
});

// ─── TC-SWH-03: Content-Type request header default ─────────────────────────

describe('TC-SWH-03: content-type request header — application/json set by default', () => {
  it('sets Content-Type: application/json when no headers provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'ok',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendWebhook({ url: 'https://hooks.example.com/event', payload: { a: 1 } });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ─── TC-SWH-04: Content-Type override ────────────────────────────────────────

describe('TC-SWH-04: content-type override — caller Content-Type is not overridden', () => {
  it('preserves caller-supplied Content-Type header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'ok',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendWebhook({
      url: 'https://hooks.example.com/event',
      payload: { a: 1 },
      headers: { 'Content-Type': 'application/vnd.custom+json' },
    });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/vnd.custom+json');
  });

  it('case-insensitive Content-Type detection — does not double-set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'ok',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendWebhook({
      url: 'https://hooks.example.com/event',
      payload: { a: 1 },
      headers: { 'content-type': 'text/plain' },
    });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    // Only caller's header should be present (lowercase key)
    expect(headers['content-type']).toBe('text/plain');
    expect(headers['Content-Type']).toBeUndefined();
  });
});

// ─── TC-SWH-05: Custom headers ────────────────────────────────────────────────

describe('TC-SWH-05: custom headers — caller headers forwarded in request', () => {
  it('includes custom Authorization header in request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'ok',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendWebhook({
      url: 'https://hooks.example.com/event',
      payload: { a: 1 },
      headers: { 'X-Secret': 'tok-abc' },
    });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['X-Secret']).toBe('tok-abc');
  });
});

// ─── TC-SWH-06: Payload serialisation ────────────────────────────────────────

describe('TC-SWH-06: payload serialisation — payload JSON-serialised in POST body', () => {
  it('sends the payload as a JSON string in the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'ok',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendWebhook({
      url: 'https://hooks.example.com/event',
      payload: { event: 'deploy', version: '1.2.3' },
    });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, string>;
    expect(body['event']).toBe('deploy');
    expect(body['version']).toBe('1.2.3');
  });
});

// ─── TC-SWH-07: invalid-url ───────────────────────────────────────────────────

describe('TC-SWH-07: invalid-url — non-http/https URL throws SendWebhookError', () => {
  it('throws SendWebhookError with code invalid-url for ftp scheme', async () => {
    let err: SendWebhookError | undefined;
    try {
      await sendWebhook({ url: 'ftp://hooks.example.com/event', payload: {} });
    } catch (e) {
      err = e as SendWebhookError;
    }
    expect(err).toBeInstanceOf(SendWebhookError);
    expect(err!.code).toBe('invalid-url');
  });

  it('throws SendWebhookError with code invalid-url for bare path', async () => {
    let err: SendWebhookError | undefined;
    try {
      await sendWebhook({ url: '/not/a/url', payload: {} });
    } catch (e) {
      err = e as SendWebhookError;
    }
    expect(err).toBeInstanceOf(SendWebhookError);
    expect(err!.code).toBe('invalid-url');
  });

  it('error name is SendWebhookError', async () => {
    let err: SendWebhookError | undefined;
    try {
      await sendWebhook({ url: 'ws://example.com', payload: {} });
    } catch (e) {
      err = e as SendWebhookError;
    }
    expect(err!.name).toBe('SendWebhookError');
  });
});

// ─── TC-SWH-08: network-error ─────────────────────────────────────────────────

describe('TC-SWH-08: network-error — fetch rejection throws SendWebhookError', () => {
  it('throws SendWebhookError with code network-error when fetch rejects', async () => {
    stubFetchRejected('connection refused');
    let err: SendWebhookError | undefined;
    try {
      await sendWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    } catch (e) {
      err = e as SendWebhookError;
    }
    expect(err).toBeInstanceOf(SendWebhookError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original failure cause', async () => {
    stubFetchRejected('ECONNREFUSED');
    let err: SendWebhookError | undefined;
    try {
      await sendWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    } catch (e) {
      err = e as SendWebhookError;
    }
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-SWH-09: timeout ───────────────────────────────────────────────────────

describe('TC-SWH-09: timeout — AbortError surfaces as code timeout', () => {
  it('throws SendWebhookError with code timeout when fetch is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: SendWebhookError | undefined;
    try {
      await sendWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    } catch (e) {
      err = e as SendWebhookError;
    }
    expect(err).toBeInstanceOf(SendWebhookError);
    expect(err!.code).toBe('timeout');
  });

  it('timeout error is distinct from network-error', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: SendWebhookError | undefined;
    try {
      await sendWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    } catch (e) {
      err = e as SendWebhookError;
    }
    expect(err!.code).not.toBe('network-error');
    expect(err!.code).toBe('timeout');
  });
});

// ─── TC-SWH-10: Non-2xx response ──────────────────────────────────────────────

describe('TC-SWH-10: non-2xx response — returns status_code without throwing', () => {
  it('returns 400 status without throwing', async () => {
    stubFetch(400, 'bad request');
    const result = await sendWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(result.status_code).toBe(400);
    expect(result.response_body).toBe('bad request');
  });

  it('returns 500 status without throwing', async () => {
    stubFetch(500, 'internal server error');
    const result = await sendWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(result.status_code).toBe(500);
  });
});

// ─── TC-SWH-11: Result shape ──────────────────────────────────────────────────

describe('TC-SWH-11: result shape — required fields present in result', () => {
  it('result has a numeric status_code field', async () => {
    stubFetch(200, 'ok');
    const result = await sendWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(typeof result.status_code).toBe('number');
  });

  it('result has a string response_body field', async () => {
    stubFetch(200, 'ok');
    const result = await sendWebhook({ url: 'https://hooks.example.com/event', payload: {} });
    expect(typeof result.response_body).toBe('string');
  });
});

// ─── TC-SWH-12: Always POST ───────────────────────────────────────────────────

describe('TC-SWH-12: always POST — method is POST regardless of payload', () => {
  it('sends a POST request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'ok',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendWebhook({ url: 'https://hooks.example.com/event', payload: { a: 1 } });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.method).toBe('POST');
  });
});

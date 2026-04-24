/**
 * Unit tests for the call_webhook tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 *
 * Test IDs:
 *   TC-CWH-01: Successful POST — returns status_code and response_body
 *   TC-CWH-02: HTTP method forwarding — method is passed to fetch
 *   TC-CWH-03: JSON payload — payload serialised with Content-Type header
 *   TC-CWH-04: Custom headers — caller headers are forwarded
 *   TC-CWH-05: Content-Type — response Content-Type included in result
 *   TC-CWH-06: invalid-url — non-http/https URL throws CallWebhookError
 *   TC-CWH-07: network-error — fetch rejection throws CallWebhookError
 *   TC-CWH-08: timeout — AbortError throws CallWebhookError with timeout code
 *   TC-CWH-09: Non-2xx response — returns status_code without throwing
 *   TC-CWH-10: GET without body — payload ignored, no body sent
 *   TC-CWH-11: Result shape — status_code, response_body fields present
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { callWebhook, CallWebhookError } from './call-webhook.js';

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubFetch(status: number, responseBody: string, contentType?: string): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    text: async () => responseBody,
    headers: {
      get: (name: string) => name === 'content-type' ? (contentType ?? null) : null,
    },
  }));
}

function stubFetchRejected(message: string): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── TC-CWH-01: Successful POST ───────────────────────────────────────────────

describe('TC-CWH-01: successful POST — returns status_code and response_body', () => {
  it('returns status 200 and the response body', async () => {
    stubFetch(200, '{"ok":true}');
    const result = await callWebhook({ url: 'https://hooks.example.com/trigger' });
    expect(result.status_code).toBe(200);
    expect(result.response_body).toBe('{"ok":true}');
  });

  it('defaults to POST method', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({ url: 'https://hooks.example.com/trigger' });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callInit.method).toBe('POST');
  });
});

// ─── TC-CWH-02: HTTP method forwarding ───────────────────────────────────────

describe('TC-CWH-02: HTTP method forwarding — method is passed to fetch', () => {
  it('sends PUT method when specified', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({ url: 'https://api.example.com/resource/1', method: 'PUT' });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callInit.method).toBe('PUT');
  });

  it('sends PATCH method when specified', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({ url: 'https://api.example.com/resource/1', method: 'PATCH' });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callInit.method).toBe('PATCH');
  });

  it('sends DELETE method when specified', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({ url: 'https://api.example.com/resource/1', method: 'DELETE' });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callInit.method).toBe('DELETE');
  });
});

// ─── TC-CWH-03: JSON payload ──────────────────────────────────────────────────

describe('TC-CWH-03: JSON payload — payload serialised with Content-Type header', () => {
  it('serialises payload as JSON body for POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({
      url: 'https://hooks.example.com/event',
      payload: { event: 'deploy', version: '1.0.0' },
    });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callInit.body).toBe('{"event":"deploy","version":"1.0.0"}');
  });

  it('sets Content-Type application/json automatically for POST with payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({
      url: 'https://hooks.example.com/event',
      payload: { key: 'value' },
    });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((callInit.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('does not override Content-Type when caller sets it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({
      url: 'https://hooks.example.com/event',
      payload: { key: 'value' },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((callInit.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect((callInit.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});

// ─── TC-CWH-04: Custom headers ────────────────────────────────────────────────

describe('TC-CWH-04: custom headers — caller headers are forwarded', () => {
  it('forwards custom headers to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({
      url: 'https://hooks.example.com/trigger',
      headers: { 'X-Secret': 'abc123', 'X-Source': 'agent' },
    });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    const hdrs = callInit.headers as Record<string, string>;
    expect(hdrs['X-Secret']).toBe('abc123');
    expect(hdrs['X-Source']).toBe('agent');
  });
});

// ─── TC-CWH-05: Content-Type ──────────────────────────────────────────────────

describe('TC-CWH-05: Content-Type — response Content-Type included in result', () => {
  it('includes content_type when Content-Type response header is present', async () => {
    stubFetch(200, '{"ok":true}', 'application/json');
    const result = await callWebhook({ url: 'https://hooks.example.com/trigger' });
    expect(result.content_type).toBe('application/json');
  });

  it('omits content_type when Content-Type response header is absent', async () => {
    stubFetch(200, 'ok');
    const result = await callWebhook({ url: 'https://hooks.example.com/trigger' });
    expect(result.content_type).toBeUndefined();
  });
});

// ─── TC-CWH-06: invalid-url ───────────────────────────────────────────────────

describe('TC-CWH-06: invalid-url — non-http/https URL throws CallWebhookError', () => {
  it('throws CallWebhookError with code invalid-url for ftp scheme', async () => {
    let err: CallWebhookError | undefined;
    try {
      await callWebhook({ url: 'ftp://files.example.com/resource' });
    } catch (e) {
      err = e as CallWebhookError;
    }
    expect(err).toBeInstanceOf(CallWebhookError);
    expect(err!.code).toBe('invalid-url');
  });

  it('error message includes the invalid URL', async () => {
    let err: CallWebhookError | undefined;
    try {
      await callWebhook({ url: 'not-a-url' });
    } catch (e) {
      err = e as CallWebhookError;
    }
    expect(err!.message).toContain('not-a-url');
  });

  it('error name is CallWebhookError', async () => {
    let err: CallWebhookError | undefined;
    try {
      await callWebhook({ url: 'file:///etc/passwd' });
    } catch (e) {
      err = e as CallWebhookError;
    }
    expect(err!.name).toBe('CallWebhookError');
  });
});

// ─── TC-CWH-07: network-error ────────────────────────────────────────────────

describe('TC-CWH-07: network-error — fetch rejection throws CallWebhookError', () => {
  it('throws CallWebhookError with code network-error when fetch rejects', async () => {
    stubFetchRejected('connection refused');
    let err: CallWebhookError | undefined;
    try {
      await callWebhook({ url: 'https://unreachable.example.com/hook' });
    } catch (e) {
      err = e as CallWebhookError;
    }
    expect(err).toBeInstanceOf(CallWebhookError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original cause', async () => {
    stubFetchRejected('ECONNREFUSED');
    let err: CallWebhookError | undefined;
    try {
      await callWebhook({ url: 'https://unreachable.example.com/hook' });
    } catch (e) {
      err = e as CallWebhookError;
    }
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-CWH-08: timeout ───────────────────────────────────────────────────────

describe('TC-CWH-08: timeout — AbortError throws CallWebhookError with timeout code', () => {
  it('throws CallWebhookError with code timeout on AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: CallWebhookError | undefined;
    try {
      await callWebhook({ url: 'https://slow.example.com/hook' });
    } catch (e) {
      err = e as CallWebhookError;
    }
    expect(err).toBeInstanceOf(CallWebhookError);
    expect(err!.code).toBe('timeout');
  });

  it('timeout error message includes the URL', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: CallWebhookError | undefined;
    try {
      await callWebhook({ url: 'https://slow.example.com/hook' });
    } catch (e) {
      err = e as CallWebhookError;
    }
    expect(err!.message).toContain('https://slow.example.com/hook');
  });
});

// ─── TC-CWH-09: Non-2xx response ─────────────────────────────────────────────

describe('TC-CWH-09: non-2xx response — returns status_code without throwing', () => {
  it('returns 404 status without throwing', async () => {
    stubFetch(404, 'not found');
    const result = await callWebhook({ url: 'https://hooks.example.com/missing' });
    expect(result.status_code).toBe(404);
    expect(result.response_body).toBe('not found');
  });

  it('returns 500 status without throwing', async () => {
    stubFetch(500, 'server error');
    const result = await callWebhook({ url: 'https://hooks.example.com/trigger' });
    expect(result.status_code).toBe(500);
  });
});

// ─── TC-CWH-10: GET without body ─────────────────────────────────────────────

describe('TC-CWH-10: GET without body — payload ignored, no body sent', () => {
  it('does not send a body for GET requests even when payload is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '{}',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({
      url: 'https://api.example.com/status',
      method: 'GET',
      payload: { should: 'be-ignored' },
    });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callInit.body).toBeUndefined();
  });

  it('does not send a body for DELETE requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({
      url: 'https://api.example.com/resource/1',
      method: 'DELETE',
      payload: { should: 'be-ignored' },
    });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callInit.body).toBeUndefined();
  });
});

// ─── TC-CWH-11: Result shape ──────────────────────────────────────────────────

describe('TC-CWH-11: result shape — status_code, response_body fields present', () => {
  it('result has a status_code number field', async () => {
    stubFetch(200, '{}');
    const result = await callWebhook({ url: 'https://hooks.example.com/trigger' });
    expect(typeof result.status_code).toBe('number');
  });

  it('result has a response_body string field', async () => {
    stubFetch(200, '{"event":"ok"}');
    const result = await callWebhook({ url: 'https://hooks.example.com/trigger' });
    expect(typeof result.response_body).toBe('string');
    expect(result.response_body).toBe('{"event":"ok"}');
  });
});

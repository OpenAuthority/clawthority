/**
 * Unit tests for the http_post tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 *
 * Test IDs:
 *   TC-HPO-01: Successful POST — returns status_code and body
 *   TC-HPO-02: POST with body — body is forwarded in the request
 *   TC-HPO-03: POST with custom headers — headers are forwarded
 *   TC-HPO-04: invalid-url — non-http/https scheme throws HttpPostError
 *   TC-HPO-05: network-error — fetch rejection throws HttpPostError
 *   TC-HPO-06: Result shape — status_code and body fields present
 *   TC-HPO-07: Non-2xx response — returns status_code without throwing
 *   TC-HPO-08: Empty body — accepts undefined body
 *   TC-HPO-09: timeout — AbortError surfaces as code 'timeout'
 *   TC-HPO-10: content_type — response Content-Type header included in result
 *   TC-HPO-11: invalid-content-type — multipart/* header rejected before fetch
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpPost, HttpPostError } from './http-post.js';

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubFetch(status: number, responseBody: string, contentType?: string): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    text: async () => responseBody,
    headers: { get: (name: string) => name === 'content-type' ? (contentType ?? null) : null },
  }));
}

function stubFetchRejected(message: string): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── TC-HPO-01: Successful POST ───────────────────────────────────────────────

describe('TC-HPO-01: successful POST — returns status_code and body', () => {
  it('returns status 201 and the response body', async () => {
    stubFetch(201, '{"id":42}');
    const result = await httpPost({ url: 'https://api.example.com/resources' });
    expect(result.status_code).toBe(201);
    expect(result.body).toBe('{"id":42}');
  });

  it('returns status 200 with a response body', async () => {
    stubFetch(200, '{"ok":true}');
    const result = await httpPost({ url: 'https://api.example.com/action' });
    expect(result.status_code).toBe(200);
    expect(result.body).toBe('{"ok":true}');
  });
});

// ─── TC-HPO-02: POST with body ────────────────────────────────────────────────

describe('TC-HPO-02: POST with body — body forwarded in request', () => {
  it('calls fetch with the provided body string', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 201, text: async () => '', headers: { get: () => null } });
    vi.stubGlobal('fetch', fetchMock);

    const payload = JSON.stringify({ name: 'new-resource' });
    await httpPost({ url: 'https://api.example.com/resources', body: payload });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/resources',
      expect.objectContaining({ method: 'POST', body: payload }),
    );
  });

  it('sends undefined body when body is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => '', headers: { get: () => null } });
    vi.stubGlobal('fetch', fetchMock);

    await httpPost({ url: 'https://api.example.com/resources' });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.body).toBeUndefined();
  });
});

// ─── TC-HPO-03: POST with custom headers ─────────────────────────────────────

describe('TC-HPO-03: POST with custom headers — headers forwarded', () => {
  it('passes custom headers to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 201, text: async () => '', headers: { get: () => null } });
    vi.stubGlobal('fetch', fetchMock);

    const headers = { 'Content-Type': 'application/json', 'X-Request-ID': 'post-001' };
    await httpPost({ url: 'https://api.example.com/resources', headers });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/resources',
      expect.objectContaining({ headers }),
    );
  });

  it('uses empty headers object when headers are omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 201, text: async () => '', headers: { get: () => null } });
    vi.stubGlobal('fetch', fetchMock);

    await httpPost({ url: 'https://api.example.com/resources' });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.headers).toEqual({});
  });
});

// ─── TC-HPO-04: invalid-url ───────────────────────────────────────────────────

describe('TC-HPO-04: invalid-url — non-http/https scheme throws HttpPostError', () => {
  it('throws HttpPostError with code invalid-url for ftp scheme', async () => {
    let err: HttpPostError | undefined;
    try {
      await httpPost({ url: 'ftp://files.example.com/resource' });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err).toBeInstanceOf(HttpPostError);
    expect(err!.code).toBe('invalid-url');
  });

  it('throws HttpPostError with code invalid-url for bare path', async () => {
    let err: HttpPostError | undefined;
    try {
      await httpPost({ url: '/relative/path' });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err!.code).toBe('invalid-url');
  });

  it('error message includes the invalid URL', async () => {
    let err: HttpPostError | undefined;
    try {
      await httpPost({ url: 'file:///etc/passwd' });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err!.message).toContain('file:///etc/passwd');
  });

  it('error name is HttpPostError', async () => {
    let err: HttpPostError | undefined;
    try {
      await httpPost({ url: 'not-a-url' });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err!.name).toBe('HttpPostError');
  });
});

// ─── TC-HPO-05: network-error ────────────────────────────────────────────────

describe('TC-HPO-05: network-error — fetch rejection throws HttpPostError', () => {
  it('throws HttpPostError with code network-error when fetch rejects', async () => {
    stubFetchRejected('connection refused');
    let err: HttpPostError | undefined;
    try {
      await httpPost({ url: 'https://unreachable.example.com/resources' });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err).toBeInstanceOf(HttpPostError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original failure cause', async () => {
    stubFetchRejected('ECONNREFUSED');
    let err: HttpPostError | undefined;
    try {
      await httpPost({ url: 'https://unreachable.example.com/resources' });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-HPO-06: Result shape ──────────────────────────────────────────────────

describe('TC-HPO-06: result shape — status_code and body present', () => {
  it('result has a status_code number field', async () => {
    stubFetch(201, '{}');
    const result = await httpPost({ url: 'https://api.example.com/resources' });
    expect(typeof result.status_code).toBe('number');
  });

  it('result has a body string field', async () => {
    stubFetch(201, '{"id":1}');
    const result = await httpPost({ url: 'https://api.example.com/resources' });
    expect(typeof result.body).toBe('string');
    expect(result.body).toBe('{"id":1}');
  });
});

// ─── TC-HPO-07: Non-2xx response — no throw ──────────────────────────────────

describe('TC-HPO-07: non-2xx response — returns status_code without throwing', () => {
  it('returns 400 without throwing', async () => {
    stubFetch(400, 'bad request');
    const result = await httpPost({ url: 'https://api.example.com/resources' });
    expect(result.status_code).toBe(400);
    expect(result.body).toBe('bad request');
  });

  it('returns 500 without throwing', async () => {
    stubFetch(500, 'internal server error');
    const result = await httpPost({ url: 'https://api.example.com/resources' });
    expect(result.status_code).toBe(500);
  });
});

// ─── TC-HPO-08: Empty body ────────────────────────────────────────────────────

describe('TC-HPO-08: empty body — accepts undefined body param', () => {
  it('succeeds when body is explicitly undefined', async () => {
    stubFetch(200, '');
    const result = await httpPost({ url: 'https://api.example.com/resources', body: undefined });
    expect(result.status_code).toBe(200);
  });

  it('accepts http scheme in addition to https', async () => {
    stubFetch(201, 'ok');
    const result = await httpPost({ url: 'http://api.example.com/resources' });
    expect(result.status_code).toBe(201);
  });
});

// ─── TC-HPO-09: timeout ───────────────────────────────────────────────────────

describe('TC-HPO-09: timeout — AbortError surfaces as code timeout', () => {
  it('throws HttpPostError with code timeout when fetch is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpPostError | undefined;
    try {
      await httpPost({ url: 'https://slow.example.com/resources' });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err).toBeInstanceOf(HttpPostError);
    expect(err!.code).toBe('timeout');
  });

  it('timeout error message includes the URL', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpPostError | undefined;
    try {
      await httpPost({ url: 'https://slow.example.com/resources' });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err!.message).toContain('https://slow.example.com/resources');
  });

  it('timeout error is distinct from network-error', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpPostError | undefined;
    try {
      await httpPost({ url: 'https://slow.example.com/resources' });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err!.code).not.toBe('network-error');
    expect(err!.code).toBe('timeout');
  });
});

// ─── TC-HPO-10: content_type ──────────────────────────────────────────────────

describe('TC-HPO-10: content_type — response Content-Type header included in result', () => {
  it('includes content_type when Content-Type response header is present', async () => {
    stubFetch(200, '{"id":1}', 'application/json');
    const result = await httpPost({ url: 'https://api.example.com/resources' });
    expect(result.content_type).toBe('application/json');
  });

  it('omits content_type when Content-Type response header is absent', async () => {
    stubFetch(201, '');
    const result = await httpPost({ url: 'https://api.example.com/resources' });
    expect(result.content_type).toBeUndefined();
  });

  it('includes content_type with charset suffix', async () => {
    stubFetch(200, '{}', 'application/json; charset=utf-8');
    const result = await httpPost({ url: 'https://api.example.com/resources' });
    expect(result.content_type).toBe('application/json; charset=utf-8');
  });
});

// ─── TC-HPO-11: invalid-content-type ─────────────────────────────────────────

describe('TC-HPO-11: invalid-content-type — multipart/* header rejected before fetch', () => {
  it('throws HttpPostError with code invalid-content-type for multipart/form-data', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    let err: HttpPostError | undefined;
    try {
      await httpPost({
        url: 'https://api.example.com/upload',
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err).toBeInstanceOf(HttpPostError);
    expect(err!.code).toBe('invalid-content-type');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws for multipart/mixed content-type', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    let err: HttpPostError | undefined;
    try {
      await httpPost({
        url: 'https://api.example.com/upload',
        headers: { 'Content-Type': 'multipart/mixed' },
      });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err!.code).toBe('invalid-content-type');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is case-insensitive for the content-type header key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    let err: HttpPostError | undefined;
    try {
      await httpPost({
        url: 'https://api.example.com/upload',
        headers: { 'content-type': 'multipart/form-data' },
      });
    } catch (e) {
      err = e as HttpPostError;
    }
    expect(err!.code).toBe('invalid-content-type');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows application/json without throwing', async () => {
    stubFetch(200, '{"ok":true}', 'application/json');
    const result = await httpPost({
      url: 'https://api.example.com/resources',
      body: '{"name":"test"}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(result.status_code).toBe(200);
  });

  it('allows application/x-www-form-urlencoded without throwing', async () => {
    stubFetch(200, 'ok');
    const result = await httpPost({
      url: 'https://api.example.com/form',
      body: 'name=test&value=1',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(result.status_code).toBe(200);
  });
});

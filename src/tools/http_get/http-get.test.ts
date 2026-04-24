/**
 * Unit tests for the http_get tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 *
 * Test IDs:
 *   TC-HGE-01: Successful GET — returns status_code and body
 *   TC-HGE-02: GET with custom headers — headers are forwarded
 *   TC-HGE-03: Content-Type — response Content-Type header included in result
 *   TC-HGE-04: invalid-url — non-http/https scheme throws HttpGetError
 *   TC-HGE-05: network-error — fetch rejection throws HttpGetError
 *   TC-HGE-06: Result shape — status_code, body, content_type fields present
 *   TC-HGE-07: Non-2xx response — returns status_code without throwing
 *   TC-HGE-08: No request body / http scheme edge cases
 *   TC-HGE-09: Timeout — AbortController fires after 30 s
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpGet, HttpGetError } from './http-get.js';

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

// ─── TC-HGE-01: Successful GET ────────────────────────────────────────────────

describe('TC-HGE-01: successful GET — returns status_code and body', () => {
  it('returns status 200 and the response body', async () => {
    stubFetch(200, '{"users":[]}');
    const result = await httpGet({ url: 'https://api.example.com/users' });
    expect(result.status_code).toBe(200);
    expect(result.body).toBe('{"users":[]}');
  });

  it('returns status 200 with a non-JSON body', async () => {
    stubFetch(200, '<html><body>hello</body></html>');
    const result = await httpGet({ url: 'https://www.example.com/' });
    expect(result.status_code).toBe(200);
    expect(result.body).toBe('<html><body>hello</body></html>');
  });
});

// ─── TC-HGE-02: GET with custom headers ──────────────────────────────────────

describe('TC-HGE-02: GET with custom headers — headers forwarded', () => {
  it('passes custom headers to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    const headers = { 'Accept': 'application/json', 'X-Request-ID': 'get-001' };
    await httpGet({ url: 'https://api.example.com/users', headers });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/users',
      expect.objectContaining({ headers }),
    );
  });

  it('uses empty headers object when headers are omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await httpGet({ url: 'https://api.example.com/users' });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.headers).toEqual({});
  });
});

// ─── TC-HGE-03: Content-Type ──────────────────────────────────────────────────

describe('TC-HGE-03: Content-Type — response Content-Type header included in result', () => {
  it('includes content_type when Content-Type header is present', async () => {
    stubFetch(200, '{"id":1}', 'application/json');
    const result = await httpGet({ url: 'https://api.example.com/resource/1' });
    expect(result.content_type).toBe('application/json');
  });

  it('omits content_type when Content-Type header is absent', async () => {
    stubFetch(200, 'ok');
    const result = await httpGet({ url: 'https://api.example.com/ping' });
    expect(result.content_type).toBeUndefined();
  });
});

// ─── TC-HGE-04: invalid-url ───────────────────────────────────────────────────

describe('TC-HGE-04: invalid-url — non-http/https scheme throws HttpGetError', () => {
  it('throws HttpGetError with code invalid-url for ftp scheme', async () => {
    let err: HttpGetError | undefined;
    try {
      await httpGet({ url: 'ftp://files.example.com/resource' });
    } catch (e) {
      err = e as HttpGetError;
    }
    expect(err).toBeInstanceOf(HttpGetError);
    expect(err!.code).toBe('invalid-url');
  });

  it('throws HttpGetError with code invalid-url for bare path', async () => {
    let err: HttpGetError | undefined;
    try {
      await httpGet({ url: '/relative/path' });
    } catch (e) {
      err = e as HttpGetError;
    }
    expect(err!.code).toBe('invalid-url');
  });

  it('error message includes the invalid URL', async () => {
    let err: HttpGetError | undefined;
    try {
      await httpGet({ url: 'file:///etc/passwd' });
    } catch (e) {
      err = e as HttpGetError;
    }
    expect(err!.message).toContain('file:///etc/passwd');
  });

  it('error name is HttpGetError', async () => {
    let err: HttpGetError | undefined;
    try {
      await httpGet({ url: 'not-a-url' });
    } catch (e) {
      err = e as HttpGetError;
    }
    expect(err!.name).toBe('HttpGetError');
  });
});

// ─── TC-HGE-05: network-error ────────────────────────────────────────────────

describe('TC-HGE-05: network-error — fetch rejection throws HttpGetError', () => {
  it('throws HttpGetError with code network-error when fetch rejects', async () => {
    stubFetchRejected('connection refused');
    let err: HttpGetError | undefined;
    try {
      await httpGet({ url: 'https://unreachable.example.com/resource' });
    } catch (e) {
      err = e as HttpGetError;
    }
    expect(err).toBeInstanceOf(HttpGetError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original failure cause', async () => {
    stubFetchRejected('ECONNREFUSED');
    let err: HttpGetError | undefined;
    try {
      await httpGet({ url: 'https://unreachable.example.com/resource' });
    } catch (e) {
      err = e as HttpGetError;
    }
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-HGE-06: Result shape ──────────────────────────────────────────────────

describe('TC-HGE-06: result shape — status_code, body, content_type fields present', () => {
  it('result has a status_code number field', async () => {
    stubFetch(200, '{}');
    const result = await httpGet({ url: 'https://api.example.com/resource' });
    expect(typeof result.status_code).toBe('number');
  });

  it('result has a body string field', async () => {
    stubFetch(200, '{"id":1}');
    const result = await httpGet({ url: 'https://api.example.com/resource' });
    expect(typeof result.body).toBe('string');
    expect(result.body).toBe('{"id":1}');
  });

  it('result content_type is a string when present', async () => {
    stubFetch(200, '{}', 'application/json; charset=utf-8');
    const result = await httpGet({ url: 'https://api.example.com/resource' });
    expect(typeof result.content_type).toBe('string');
  });
});

// ─── TC-HGE-07: Non-2xx response — no throw ──────────────────────────────────

describe('TC-HGE-07: non-2xx response — returns status_code without throwing', () => {
  it('returns 404 without throwing', async () => {
    stubFetch(404, 'not found');
    const result = await httpGet({ url: 'https://api.example.com/missing' });
    expect(result.status_code).toBe(404);
    expect(result.body).toBe('not found');
  });

  it('returns 500 without throwing', async () => {
    stubFetch(500, 'internal server error');
    const result = await httpGet({ url: 'https://api.example.com/resource' });
    expect(result.status_code).toBe(500);
  });
});

// ─── TC-HGE-08: No request body / http scheme ────────────────────────────────

describe('TC-HGE-08: no request body — GET uses method GET / http scheme edge cases', () => {
  it('calls fetch with method GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await httpGet({ url: 'https://api.example.com/resource' });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.method).toBe('GET');
  });

  it('accepts http scheme in addition to https', async () => {
    stubFetch(200, 'ok');
    const result = await httpGet({ url: 'http://api.example.com/resource' });
    expect(result.status_code).toBe(200);
  });
});

// ─── TC-HGE-09: Timeout ───────────────────────────────────────────────────────

describe('TC-HGE-09: timeout — AbortController fires after 30 s', () => {
  it('throws HttpGetError with code timeout when fetch is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpGetError | undefined;
    try {
      await httpGet({ url: 'https://slow.example.com/resource' });
    } catch (e) {
      err = e as HttpGetError;
    }
    expect(err).toBeInstanceOf(HttpGetError);
    expect(err!.code).toBe('timeout');
  });

  it('timeout error message includes the URL', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpGetError | undefined;
    try {
      await httpGet({ url: 'https://slow.example.com/resource' });
    } catch (e) {
      err = e as HttpGetError;
    }
    expect(err!.message).toContain('https://slow.example.com/resource');
  });
});

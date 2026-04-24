/**
 * Unit tests for the http_delete tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 *
 * Test IDs:
 *   TC-HDL-01: Successful DELETE — returns status_code and body
 *   TC-HDL-02: DELETE with custom headers — headers are forwarded
 *   TC-HDL-03: invalid-url — non-http/https scheme throws HttpDeleteError
 *   TC-HDL-04: network-error — fetch rejection throws HttpDeleteError
 *   TC-HDL-05: Result shape — status_code and body fields present
 *   TC-HDL-06: Non-2xx response — returns status_code without throwing
 *   TC-HDL-07: No body param — DELETE has no request body
 *   TC-HDL-08: timeout — AbortError surfaces as code 'timeout'
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpDelete, HttpDeleteError } from './http-delete.js';

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubFetch(status: number, responseBody: string): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    text: async () => responseBody,
  }));
}

function stubFetchRejected(message: string): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── TC-HDL-01: Successful DELETE ────────────────────────────────────────────

describe('TC-HDL-01: successful DELETE — returns status_code and body', () => {
  it('returns status 200 and the response body', async () => {
    stubFetch(200, 'deleted');
    const result = await httpDelete({ url: 'https://api.example.com/resource/1' });
    expect(result.status_code).toBe(200);
    expect(result.body).toBe('deleted');
  });

  it('returns status 204 with an empty body', async () => {
    stubFetch(204, '');
    const result = await httpDelete({ url: 'https://api.example.com/resource/1' });
    expect(result.status_code).toBe(204);
    expect(result.body).toBe('');
  });
});

// ─── TC-HDL-02: DELETE with custom headers ───────────────────────────────────

describe('TC-HDL-02: DELETE with custom headers — headers forwarded', () => {
  it('passes custom headers to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    const headers = { Authorization: 'Bearer token123', 'X-Request-ID': 'req-abc' };
    await httpDelete({ url: 'https://api.example.com/resource/1', headers });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/resource/1',
      expect.objectContaining({ headers }),
    );
  });

  it('uses empty headers object when headers are omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await httpDelete({ url: 'https://api.example.com/resource/1' });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.headers).toEqual({});
  });
});

// ─── TC-HDL-03: invalid-url ───────────────────────────────────────────────────

describe('TC-HDL-03: invalid-url — non-http/https scheme throws HttpDeleteError', () => {
  it('throws HttpDeleteError with code invalid-url for ftp scheme', async () => {
    let err: HttpDeleteError | undefined;
    try {
      await httpDelete({ url: 'ftp://files.example.com/resource' });
    } catch (e) {
      err = e as HttpDeleteError;
    }
    expect(err).toBeInstanceOf(HttpDeleteError);
    expect(err!.code).toBe('invalid-url');
  });

  it('throws HttpDeleteError with code invalid-url for bare path', async () => {
    let err: HttpDeleteError | undefined;
    try {
      await httpDelete({ url: '/relative/path' });
    } catch (e) {
      err = e as HttpDeleteError;
    }
    expect(err!.code).toBe('invalid-url');
  });

  it('error message includes the invalid URL', async () => {
    let err: HttpDeleteError | undefined;
    try {
      await httpDelete({ url: 'file:///etc/passwd' });
    } catch (e) {
      err = e as HttpDeleteError;
    }
    expect(err!.message).toContain('file:///etc/passwd');
  });

  it('error name is HttpDeleteError', async () => {
    let err: HttpDeleteError | undefined;
    try {
      await httpDelete({ url: 'not-a-url' });
    } catch (e) {
      err = e as HttpDeleteError;
    }
    expect(err!.name).toBe('HttpDeleteError');
  });
});

// ─── TC-HDL-04: network-error ────────────────────────────────────────────────

describe('TC-HDL-04: network-error — fetch rejection throws HttpDeleteError', () => {
  it('throws HttpDeleteError with code network-error when fetch rejects', async () => {
    stubFetchRejected('connection refused');
    let err: HttpDeleteError | undefined;
    try {
      await httpDelete({ url: 'https://unreachable.example.com/resource' });
    } catch (e) {
      err = e as HttpDeleteError;
    }
    expect(err).toBeInstanceOf(HttpDeleteError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original failure cause', async () => {
    stubFetchRejected('ECONNREFUSED');
    let err: HttpDeleteError | undefined;
    try {
      await httpDelete({ url: 'https://unreachable.example.com/resource' });
    } catch (e) {
      err = e as HttpDeleteError;
    }
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-HDL-05: Result shape ──────────────────────────────────────────────────

describe('TC-HDL-05: result shape — status_code and body present', () => {
  it('result has a status_code number field', async () => {
    stubFetch(204, '');
    const result = await httpDelete({ url: 'https://api.example.com/resource/1' });
    expect(typeof result.status_code).toBe('number');
  });

  it('result has a body string field', async () => {
    stubFetch(200, '{"deleted":true}');
    const result = await httpDelete({ url: 'https://api.example.com/resource/1' });
    expect(typeof result.body).toBe('string');
    expect(result.body).toBe('{"deleted":true}');
  });
});

// ─── TC-HDL-06: Non-2xx response — no throw ──────────────────────────────────

describe('TC-HDL-06: non-2xx response — returns status_code without throwing', () => {
  it('returns 404 without throwing', async () => {
    stubFetch(404, 'not found');
    const result = await httpDelete({ url: 'https://api.example.com/resource/99' });
    expect(result.status_code).toBe(404);
    expect(result.body).toBe('not found');
  });

  it('returns 403 without throwing', async () => {
    stubFetch(403, 'forbidden');
    const result = await httpDelete({ url: 'https://api.example.com/resource/1' });
    expect(result.status_code).toBe(403);
  });
});

// ─── TC-HDL-07: No body param ────────────────────────────────────────────────

describe('TC-HDL-07: no body param — DELETE request has no body', () => {
  it('calls fetch with method DELETE and no body in the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await httpDelete({ url: 'https://api.example.com/resource/1' });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.method).toBe('DELETE');
    expect(callArgs.body).toBeUndefined();
  });

  it('accepts http scheme in addition to https', async () => {
    stubFetch(204, '');
    const result = await httpDelete({ url: 'http://api.example.com/resource/1' });
    expect(result.status_code).toBe(204);
  });
});

// ─── TC-HDL-08: timeout ───────────────────────────────────────────────────────

describe('TC-HDL-08: timeout — AbortError surfaces as code timeout', () => {
  it('throws HttpDeleteError with code timeout when fetch is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpDeleteError | undefined;
    try {
      await httpDelete({ url: 'https://slow.example.com/resource/1' });
    } catch (e) {
      err = e as HttpDeleteError;
    }
    expect(err).toBeInstanceOf(HttpDeleteError);
    expect(err!.code).toBe('timeout');
  });

  it('timeout error message includes the URL', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpDeleteError | undefined;
    try {
      await httpDelete({ url: 'https://slow.example.com/resource/1' });
    } catch (e) {
      err = e as HttpDeleteError;
    }
    expect(err!.message).toContain('https://slow.example.com/resource/1');
  });

  it('timeout error is distinct from network-error', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpDeleteError | undefined;
    try {
      await httpDelete({ url: 'https://slow.example.com/resource/1' });
    } catch (e) {
      err = e as HttpDeleteError;
    }
    expect(err!.code).not.toBe('network-error');
    expect(err!.code).toBe('timeout');
  });
});

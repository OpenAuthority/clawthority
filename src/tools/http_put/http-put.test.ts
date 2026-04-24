/**
 * Unit tests for the http_put tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 *
 * Test IDs:
 *   TC-HPT-01: Successful PUT — returns status_code and body
 *   TC-HPT-02: PUT with body — body is forwarded in the request
 *   TC-HPT-03: PUT with custom headers — headers are forwarded
 *   TC-HPT-04: invalid-url — non-http/https scheme throws HttpPutError
 *   TC-HPT-05: network-error — fetch rejection throws HttpPutError
 *   TC-HPT-06: Result shape — status_code and body fields present
 *   TC-HPT-07: Non-2xx response — returns status_code without throwing
 *   TC-HPT-08: Empty body — accepts undefined body
 *   TC-HPT-09: timeout — AbortError surfaces as code 'timeout'
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpPut, HttpPutError } from './http-put.js';

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

// ─── TC-HPT-01: Successful PUT ────────────────────────────────────────────────

describe('TC-HPT-01: successful PUT — returns status_code and body', () => {
  it('returns status 200 and the response body', async () => {
    stubFetch(200, 'updated');
    const result = await httpPut({ url: 'https://api.example.com/resource/1' });
    expect(result.status_code).toBe(200);
    expect(result.body).toBe('updated');
  });

  it('returns status 204 with an empty body', async () => {
    stubFetch(204, '');
    const result = await httpPut({ url: 'https://api.example.com/resource/1' });
    expect(result.status_code).toBe(204);
    expect(result.body).toBe('');
  });
});

// ─── TC-HPT-02: PUT with body ─────────────────────────────────────────────────

describe('TC-HPT-02: PUT with body — body forwarded in request', () => {
  it('calls fetch with the provided body string', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    const payload = JSON.stringify({ name: 'updated' });
    await httpPut({ url: 'https://api.example.com/resource/1', body: payload });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/resource/1',
      expect.objectContaining({ method: 'PUT', body: payload }),
    );
  });

  it('sends undefined body when body is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await httpPut({ url: 'https://api.example.com/resource/1' });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.body).toBeUndefined();
  });
});

// ─── TC-HPT-03: PUT with custom headers ──────────────────────────────────────

describe('TC-HPT-03: PUT with custom headers — headers forwarded', () => {
  it('passes custom headers to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    const headers = { 'Content-Type': 'application/json', 'X-Request-ID': 'abc123' };
    await httpPut({ url: 'https://api.example.com/resource/1', headers });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/resource/1',
      expect.objectContaining({ headers }),
    );
  });

  it('uses empty headers object when headers are omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await httpPut({ url: 'https://api.example.com/resource/1' });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.headers).toEqual({});
  });
});

// ─── TC-HPT-04: invalid-url ───────────────────────────────────────────────────

describe('TC-HPT-04: invalid-url — non-http/https scheme throws HttpPutError', () => {
  it('throws HttpPutError with code invalid-url for ftp scheme', async () => {
    let err: HttpPutError | undefined;
    try {
      await httpPut({ url: 'ftp://files.example.com/resource' });
    } catch (e) {
      err = e as HttpPutError;
    }
    expect(err).toBeInstanceOf(HttpPutError);
    expect(err!.code).toBe('invalid-url');
  });

  it('throws HttpPutError with code invalid-url for bare path', async () => {
    let err: HttpPutError | undefined;
    try {
      await httpPut({ url: '/relative/path' });
    } catch (e) {
      err = e as HttpPutError;
    }
    expect(err!.code).toBe('invalid-url');
  });

  it('error message includes the invalid URL', async () => {
    let err: HttpPutError | undefined;
    try {
      await httpPut({ url: 'file:///etc/passwd' });
    } catch (e) {
      err = e as HttpPutError;
    }
    expect(err!.message).toContain('file:///etc/passwd');
  });

  it('error name is HttpPutError', async () => {
    let err: HttpPutError | undefined;
    try {
      await httpPut({ url: 'not-a-url' });
    } catch (e) {
      err = e as HttpPutError;
    }
    expect(err!.name).toBe('HttpPutError');
  });
});

// ─── TC-HPT-05: network-error ────────────────────────────────────────────────

describe('TC-HPT-05: network-error — fetch rejection throws HttpPutError', () => {
  it('throws HttpPutError with code network-error when fetch rejects', async () => {
    stubFetchRejected('connection refused');
    let err: HttpPutError | undefined;
    try {
      await httpPut({ url: 'https://unreachable.example.com/resource' });
    } catch (e) {
      err = e as HttpPutError;
    }
    expect(err).toBeInstanceOf(HttpPutError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original failure cause', async () => {
    stubFetchRejected('ECONNREFUSED');
    let err: HttpPutError | undefined;
    try {
      await httpPut({ url: 'https://unreachable.example.com/resource' });
    } catch (e) {
      err = e as HttpPutError;
    }
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-HPT-06: Result shape ──────────────────────────────────────────────────

describe('TC-HPT-06: result shape — status_code and body present', () => {
  it('result has a status_code number field', async () => {
    stubFetch(200, '{}');
    const result = await httpPut({ url: 'https://api.example.com/resource/1' });
    expect(typeof result.status_code).toBe('number');
  });

  it('result has a body string field', async () => {
    stubFetch(200, '{"ok":true}');
    const result = await httpPut({ url: 'https://api.example.com/resource/1' });
    expect(typeof result.body).toBe('string');
    expect(result.body).toBe('{"ok":true}');
  });
});

// ─── TC-HPT-07: Non-2xx response — no throw ───────────────────────────────────

describe('TC-HPT-07: non-2xx response — returns status_code without throwing', () => {
  it('returns 404 without throwing', async () => {
    stubFetch(404, 'not found');
    const result = await httpPut({ url: 'https://api.example.com/resource/99' });
    expect(result.status_code).toBe(404);
    expect(result.body).toBe('not found');
  });

  it('returns 500 without throwing', async () => {
    stubFetch(500, 'server error');
    const result = await httpPut({ url: 'https://api.example.com/resource/1' });
    expect(result.status_code).toBe(500);
  });
});

// ─── TC-HPT-08: Empty body ────────────────────────────────────────────────────

describe('TC-HPT-08: empty body — accepts undefined body param', () => {
  it('succeeds when body is explicitly undefined', async () => {
    stubFetch(200, '');
    const result = await httpPut({ url: 'https://api.example.com/resource/1', body: undefined });
    expect(result.status_code).toBe(200);
  });

  it('accepts http scheme in addition to https', async () => {
    stubFetch(200, 'ok');
    const result = await httpPut({ url: 'http://api.example.com/resource/1' });
    expect(result.status_code).toBe(200);
  });
});

// ─── TC-HPT-09: timeout ───────────────────────────────────────────────────────

describe('TC-HPT-09: timeout — AbortError surfaces as code timeout', () => {
  it('throws HttpPutError with code timeout when fetch is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpPutError | undefined;
    try {
      await httpPut({ url: 'https://slow.example.com/resource/1' });
    } catch (e) {
      err = e as HttpPutError;
    }
    expect(err).toBeInstanceOf(HttpPutError);
    expect(err!.code).toBe('timeout');
  });

  it('timeout error message includes the URL', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpPutError | undefined;
    try {
      await httpPut({ url: 'https://slow.example.com/resource/1' });
    } catch (e) {
      err = e as HttpPutError;
    }
    expect(err!.message).toContain('https://slow.example.com/resource/1');
  });

  it('timeout error is distinct from network-error', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: HttpPutError | undefined;
    try {
      await httpPut({ url: 'https://slow.example.com/resource/1' });
    } catch (e) {
      err = e as HttpPutError;
    }
    expect(err!.code).not.toBe('network-error');
    expect(err!.code).toBe('timeout');
  });
});

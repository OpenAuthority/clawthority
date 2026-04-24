/**
 * Unit tests for the fetch_url tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 *
 * Test IDs:
 *   TC-FUR-01: Successful fetch — returns status_code, body, and final_url
 *   TC-FUR-02: Content-Type — response Content-Type included in result
 *   TC-FUR-03: Content-Length — response Content-Length included in result
 *   TC-FUR-04: Final URL — final_url reflects the response URL (post-redirect)
 *   TC-FUR-05: Custom headers — caller headers forwarded to fetch
 *   TC-FUR-06: invalid-url — non-http/https URL throws FetchUrlError
 *   TC-FUR-07: domain-not-allowed — hostname not in allowed_domains throws FetchUrlError
 *   TC-FUR-08: allowed_domains subdomain — subdomain of an allowed domain is permitted
 *   TC-FUR-09: network-error — fetch rejection throws FetchUrlError
 *   TC-FUR-10: timeout — AbortError throws FetchUrlError with timeout code
 *   TC-FUR-11: Non-2xx response — returns status_code without throwing
 *   TC-FUR-12: Result shape — required fields present in result
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchUrl, FetchUrlError } from './fetch-url.js';

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubFetch(
  status: number,
  body: string,
  opts: { contentType?: string; contentLength?: string; url?: string } = {},
): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status,
    url: opts.url ?? 'https://example.com/',
    text: async () => body,
    headers: {
      get: (name: string) => {
        const n = name.toLowerCase();
        if (n === 'content-type') return opts.contentType ?? null;
        if (n === 'content-length') return opts.contentLength ?? null;
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

// ─── TC-FUR-01: Successful fetch ──────────────────────────────────────────────

describe('TC-FUR-01: successful fetch — returns status_code, body, and final_url', () => {
  it('returns status 200 and the response body', async () => {
    stubFetch(200, '<html><body>Hello</body></html>');
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(result.status_code).toBe(200);
    expect(result.body).toBe('<html><body>Hello</body></html>');
  });

  it('includes final_url in the result', async () => {
    stubFetch(200, 'ok', { url: 'https://example.com/' });
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(result.final_url).toBe('https://example.com/');
  });
});

// ─── TC-FUR-02: Content-Type ──────────────────────────────────────────────────

describe('TC-FUR-02: Content-Type — response Content-Type included in result', () => {
  it('includes content_type when Content-Type response header is present', async () => {
    stubFetch(200, '<html></html>', { contentType: 'text/html; charset=utf-8' });
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(result.content_type).toBe('text/html; charset=utf-8');
  });

  it('omits content_type when Content-Type response header is absent', async () => {
    stubFetch(200, 'data');
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(result.content_type).toBeUndefined();
  });
});

// ─── TC-FUR-03: Content-Length ────────────────────────────────────────────────

describe('TC-FUR-03: Content-Length — numeric content_length included when header present', () => {
  it('parses Content-Length header as a number', async () => {
    stubFetch(200, 'hello', { contentLength: '5' });
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(result.content_length).toBe(5);
  });

  it('omits content_length when header is absent', async () => {
    stubFetch(200, 'hello');
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(result.content_length).toBeUndefined();
  });
});

// ─── TC-FUR-04: Final URL ─────────────────────────────────────────────────────

describe('TC-FUR-04: final_url — reflects the response URL after redirects', () => {
  it('uses response.url as final_url when it differs from the request URL', async () => {
    stubFetch(200, 'ok', { url: 'https://www.example.com/landing' });
    const result = await fetchUrl({ url: 'https://example.com/redirect' });
    expect(result.final_url).toBe('https://www.example.com/landing');
  });

  it('falls back to the request URL when response.url is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      url: '',
      text: async () => 'body',
      headers: { get: () => null },
    }));
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(result.final_url).toBe('https://example.com/');
  });
});

// ─── TC-FUR-05: Custom headers ────────────────────────────────────────────────

describe('TC-FUR-05: custom headers — caller headers forwarded to fetch', () => {
  it('forwards custom headers in the fetch call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      url: 'https://api.example.com/',
      text: async () => '{}',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchUrl({
      url: 'https://api.example.com/',
      headers: { Authorization: 'Bearer token123', 'X-Custom': 'value' },
    });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    const hdrs = callInit.headers as Record<string, string>;
    expect(hdrs['Authorization']).toBe('Bearer token123');
    expect(hdrs['X-Custom']).toBe('value');
  });

  it('always uses GET method', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      url: 'https://example.com/',
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchUrl({ url: 'https://example.com/' });

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callInit.method).toBe('GET');
  });
});

// ─── TC-FUR-06: invalid-url ───────────────────────────────────────────────────

describe('TC-FUR-06: invalid-url — non-http/https URL throws FetchUrlError', () => {
  it('throws FetchUrlError with code invalid-url for ftp scheme', async () => {
    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({ url: 'ftp://files.example.com/file.txt' });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err).toBeInstanceOf(FetchUrlError);
    expect(err!.code).toBe('invalid-url');
  });

  it('throws for file:// scheme', async () => {
    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({ url: 'file:///etc/passwd' });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err!.code).toBe('invalid-url');
  });

  it('error message includes the invalid URL', async () => {
    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({ url: 'not-a-url' });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err!.message).toContain('not-a-url');
  });

  it('error name is FetchUrlError', async () => {
    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({ url: 'ftp://example.com' });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err!.name).toBe('FetchUrlError');
  });
});

// ─── TC-FUR-07: domain-not-allowed ────────────────────────────────────────────

describe('TC-FUR-07: domain-not-allowed — hostname not in allowed_domains throws FetchUrlError', () => {
  it('throws FetchUrlError with code domain-not-allowed for unlisted domain', async () => {
    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({
        url: 'https://evil.example.com/',
        allowed_domains: ['trusted.com', 'safe.org'],
      });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err).toBeInstanceOf(FetchUrlError);
    expect(err!.code).toBe('domain-not-allowed');
  });

  it('error message includes the blocked hostname', async () => {
    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({
        url: 'https://blocked.example.com/',
        allowed_domains: ['safe.org'],
      });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err!.message).toContain('blocked.example.com');
  });

  it('permits exact domain match', async () => {
    stubFetch(200, 'ok', { url: 'https://trusted.com/' });
    const result = await fetchUrl({
      url: 'https://trusted.com/',
      allowed_domains: ['trusted.com'],
    });
    expect(result.status_code).toBe(200);
  });

  it('allows all domains when allowed_domains is an empty array', async () => {
    stubFetch(200, 'ok', { url: 'https://any.example.com/' });
    const result = await fetchUrl({
      url: 'https://any.example.com/',
      allowed_domains: [],
    });
    expect(result.status_code).toBe(200);
  });
});

// ─── TC-FUR-08: allowed_domains subdomain ─────────────────────────────────────

describe('TC-FUR-08: allowed_domains subdomain — subdomain of allowed domain is permitted', () => {
  it('allows a subdomain of an explicitly listed domain', async () => {
    stubFetch(200, 'api response', { url: 'https://api.trusted.com/' });
    const result = await fetchUrl({
      url: 'https://api.trusted.com/',
      allowed_domains: ['trusted.com'],
    });
    expect(result.status_code).toBe(200);
  });

  it('allows a deeply nested subdomain', async () => {
    stubFetch(200, 'ok', { url: 'https://sub.api.trusted.com/' });
    const result = await fetchUrl({
      url: 'https://sub.api.trusted.com/',
      allowed_domains: ['trusted.com'],
    });
    expect(result.status_code).toBe(200);
  });

  it('does not match a domain that merely ends with the allowed domain as a suffix', async () => {
    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({
        url: 'https://notreallytrusted.com/',
        allowed_domains: ['trusted.com'],
      });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err!.code).toBe('domain-not-allowed');
  });
});

// ─── TC-FUR-09: network-error ─────────────────────────────────────────────────

describe('TC-FUR-09: network-error — fetch rejection throws FetchUrlError', () => {
  it('throws FetchUrlError with code network-error when fetch rejects', async () => {
    stubFetchRejected('connection refused');
    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({ url: 'https://unreachable.example.com/' });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err).toBeInstanceOf(FetchUrlError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original cause', async () => {
    stubFetchRejected('ECONNREFUSED');
    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({ url: 'https://unreachable.example.com/' });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-FUR-10: timeout ───────────────────────────────────────────────────────

describe('TC-FUR-10: timeout — AbortError throws FetchUrlError with timeout code', () => {
  it('throws FetchUrlError with code timeout on AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({ url: 'https://slow.example.com/' });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err).toBeInstanceOf(FetchUrlError);
    expect(err!.code).toBe('timeout');
  });

  it('timeout error message includes the URL', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: FetchUrlError | undefined;
    try {
      await fetchUrl({ url: 'https://slow.example.com/' });
    } catch (e) {
      err = e as FetchUrlError;
    }
    expect(err!.message).toContain('https://slow.example.com/');
  });
});

// ─── TC-FUR-11: Non-2xx response ─────────────────────────────────────────────

describe('TC-FUR-11: non-2xx response — returns status_code without throwing', () => {
  it('returns 404 status without throwing', async () => {
    stubFetch(404, 'not found');
    const result = await fetchUrl({ url: 'https://example.com/missing' });
    expect(result.status_code).toBe(404);
    expect(result.body).toBe('not found');
  });

  it('returns 500 status without throwing', async () => {
    stubFetch(500, 'server error');
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(result.status_code).toBe(500);
  });
});

// ─── TC-FUR-12: Result shape ──────────────────────────────────────────────────

describe('TC-FUR-12: result shape — required fields present', () => {
  it('result has a numeric status_code', async () => {
    stubFetch(200, '{}');
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(typeof result.status_code).toBe('number');
  });

  it('result has a string body', async () => {
    stubFetch(200, 'response text');
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(typeof result.body).toBe('string');
  });

  it('result has a string final_url', async () => {
    stubFetch(200, '', { url: 'https://example.com/' });
    const result = await fetchUrl({ url: 'https://example.com/' });
    expect(typeof result.final_url).toBe('string');
  });
});

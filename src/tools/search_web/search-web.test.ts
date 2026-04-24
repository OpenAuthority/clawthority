/**
 * Unit tests for the search_web tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 *
 * Test IDs:
 *   TC-SWB-01: Successful Google search — returns ranked results
 *   TC-SWB-02: Successful Bing search — returns ranked results
 *   TC-SWB-03: Result shape — rank, title, url, snippet fields present
 *   TC-SWB-04: Limit parameter — result count respects limit
 *   TC-SWB-05: invalid-query — empty query throws SearchWebError
 *   TC-SWB-06: missing-config — missing API key throws SearchWebError
 *   TC-SWB-07: provider-error — non-200 response throws SearchWebError
 *   TC-SWB-08: network-error — fetch rejection throws SearchWebError
 *   TC-SWB-09: timeout — AbortController fires throws SearchWebError
 *   TC-SWB-10: Empty results — returns empty array without throwing
 *   TC-SWB-11: Provider field — result includes provider name
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchWeb, SearchWebError } from './search-web.js';

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubGoogleFetch(
  items: Array<{ title: string; link: string; snippet: string }>,
  status = 200,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        JSON.stringify(status >= 200 && status < 300 ? { items } : { error: { message: 'API error' } }),
    }),
  );
}

function stubBingFetch(
  values: Array<{ name: string; url: string; snippet: string }>,
  status = 200,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        JSON.stringify(
          status >= 200 && status < 300
            ? { webPages: { value: values } }
            : { error: { message: 'Bing error' } },
        ),
    }),
  );
}

function stubFetchRejected(message: string): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── TC-SWB-01: Successful Google search ──────────────────────────────────────

describe('TC-SWB-01: successful Google search — returns ranked results', () => {
  it('returns results with title, url, snippet', async () => {
    stubGoogleFetch([
      { title: 'Result One', link: 'https://example.com/1', snippet: 'Snippet one.' },
      { title: 'Result Two', link: 'https://example.com/2', snippet: 'Snippet two.' },
    ]);

    const result = await searchWeb(
      { query: 'TypeScript tutorial' },
      { provider: 'google', googleApiKey: 'key123', googleEngineId: 'engine456' },
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.title).toBe('Result One');
    expect(result.results[0]!.url).toBe('https://example.com/1');
    expect(result.results[0]!.snippet).toBe('Snippet one.');
  });

  it('passes query to Google API URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchWeb(
      { query: 'hello world' },
      { provider: 'google', googleApiKey: 'key123', googleEngineId: 'cx789' },
    );

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('googleapis.com');
    expect(calledUrl).toContain('hello+world');
  });
});

// ─── TC-SWB-02: Successful Bing search ───────────────────────────────────────

describe('TC-SWB-02: successful Bing search — returns ranked results', () => {
  it('returns results from Bing provider', async () => {
    stubBingFetch([
      { name: 'Bing Result', url: 'https://bing.example.com/1', snippet: 'Bing snippet.' },
    ]);

    const result = await searchWeb(
      { query: 'TypeScript tutorial' },
      { provider: 'bing', bingApiKey: 'bingkey123' },
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.title).toBe('Bing Result');
    expect(result.results[0]!.url).toBe('https://bing.example.com/1');
    expect(result.results[0]!.snippet).toBe('Bing snippet.');
    expect(result.provider).toBe('bing');
  });

  it('passes Bing API key as header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ webPages: { value: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchWeb(
      { query: 'test' },
      { provider: 'bing', bingApiKey: 'my-bing-key' },
    );

    const callInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((callInit.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe(
      'my-bing-key',
    );
  });
});

// ─── TC-SWB-03: Result shape ──────────────────────────────────────────────────

describe('TC-SWB-03: result shape — rank, title, url, snippet fields present', () => {
  it('results have numeric rank starting at 1', async () => {
    stubGoogleFetch([
      { title: 'A', link: 'https://a.example.com', snippet: 'aaa' },
      { title: 'B', link: 'https://b.example.com', snippet: 'bbb' },
    ]);

    const result = await searchWeb(
      { query: 'test' },
      { provider: 'google', googleApiKey: 'k', googleEngineId: 'cx' },
    );

    expect(result.results[0]!.rank).toBe(1);
    expect(result.results[1]!.rank).toBe(2);
  });

  it('result includes the submitted query string', async () => {
    stubGoogleFetch([]);
    const result = await searchWeb(
      { query: 'my search query' },
      { provider: 'google', googleApiKey: 'k', googleEngineId: 'cx' },
    );
    expect(result.query).toBe('my search query');
  });
});

// ─── TC-SWB-04: Limit parameter ──────────────────────────────────────────────

describe('TC-SWB-04: limit parameter — result count respects limit', () => {
  it('passes limit to the Google API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchWeb(
      { query: 'test', limit: 5 },
      { provider: 'google', googleApiKey: 'k', googleEngineId: 'cx' },
    );

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('num=5');
  });

  it('clamps limit to max 10 for Google', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchWeb(
      { query: 'test', limit: 50 },
      { provider: 'google', googleApiKey: 'k', googleEngineId: 'cx' },
    );

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('num=10');
  });
});

// ─── TC-SWB-05: invalid-query ─────────────────────────────────────────────────

describe('TC-SWB-05: invalid-query — empty query throws SearchWebError', () => {
  it('throws SearchWebError with code invalid-query for empty string', async () => {
    let err: SearchWebError | undefined;
    try {
      await searchWeb(
        { query: '' },
        { provider: 'google', googleApiKey: 'k', googleEngineId: 'cx' },
      );
    } catch (e) {
      err = e as SearchWebError;
    }
    expect(err).toBeInstanceOf(SearchWebError);
    expect(err!.code).toBe('invalid-query');
  });

  it('throws SearchWebError with code invalid-query for blank whitespace', async () => {
    let err: SearchWebError | undefined;
    try {
      await searchWeb(
        { query: '   ' },
        { provider: 'google', googleApiKey: 'k', googleEngineId: 'cx' },
      );
    } catch (e) {
      err = e as SearchWebError;
    }
    expect(err).toBeInstanceOf(SearchWebError);
    expect(err!.code).toBe('invalid-query');
  });
});

// ─── TC-SWB-06: missing-config ────────────────────────────────────────────────

describe('TC-SWB-06: missing-config — missing API key throws SearchWebError', () => {
  it('throws missing-config when Google API key is absent', async () => {
    let err: SearchWebError | undefined;
    try {
      await searchWeb({ query: 'test' }, { provider: 'google', googleEngineId: 'cx' });
    } catch (e) {
      err = e as SearchWebError;
    }
    expect(err).toBeInstanceOf(SearchWebError);
    expect(err!.code).toBe('missing-config');
    expect(err!.message).toContain('GOOGLE_SEARCH_API_KEY');
  });

  it('throws missing-config when Google Engine ID is absent', async () => {
    let err: SearchWebError | undefined;
    try {
      await searchWeb({ query: 'test' }, { provider: 'google', googleApiKey: 'k' });
    } catch (e) {
      err = e as SearchWebError;
    }
    expect(err).toBeInstanceOf(SearchWebError);
    expect(err!.code).toBe('missing-config');
    expect(err!.message).toContain('GOOGLE_SEARCH_ENGINE_ID');
  });

  it('throws missing-config when Bing API key is absent', async () => {
    let err: SearchWebError | undefined;
    try {
      await searchWeb({ query: 'test' }, { provider: 'bing' });
    } catch (e) {
      err = e as SearchWebError;
    }
    expect(err).toBeInstanceOf(SearchWebError);
    expect(err!.code).toBe('missing-config');
    expect(err!.message).toContain('BING_SEARCH_API_KEY');
  });
});

// ─── TC-SWB-07: provider-error ────────────────────────────────────────────────

describe('TC-SWB-07: provider-error — non-200 response throws SearchWebError', () => {
  it('throws provider-error for Google 403 response', async () => {
    stubGoogleFetch([], 403);
    let err: SearchWebError | undefined;
    try {
      await searchWeb(
        { query: 'test' },
        { provider: 'google', googleApiKey: 'bad-key', googleEngineId: 'cx' },
      );
    } catch (e) {
      err = e as SearchWebError;
    }
    expect(err).toBeInstanceOf(SearchWebError);
    expect(err!.code).toBe('provider-error');
    expect(err!.message).toContain('403');
  });

  it('throws provider-error for Bing 401 response', async () => {
    stubBingFetch([], 401);
    let err: SearchWebError | undefined;
    try {
      await searchWeb({ query: 'test' }, { provider: 'bing', bingApiKey: 'bad' });
    } catch (e) {
      err = e as SearchWebError;
    }
    expect(err).toBeInstanceOf(SearchWebError);
    expect(err!.code).toBe('provider-error');
  });
});

// ─── TC-SWB-08: network-error ────────────────────────────────────────────────

describe('TC-SWB-08: network-error — fetch rejection throws SearchWebError', () => {
  it('throws SearchWebError with code network-error when fetch rejects', async () => {
    stubFetchRejected('ECONNREFUSED');
    let err: SearchWebError | undefined;
    try {
      await searchWeb(
        { query: 'test' },
        { provider: 'google', googleApiKey: 'k', googleEngineId: 'cx' },
      );
    } catch (e) {
      err = e as SearchWebError;
    }
    expect(err).toBeInstanceOf(SearchWebError);
    expect(err!.code).toBe('network-error');
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-SWB-09: timeout ───────────────────────────────────────────────────────

describe('TC-SWB-09: timeout — AbortController fires throws SearchWebError', () => {
  it('throws SearchWebError with code timeout on AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: SearchWebError | undefined;
    try {
      await searchWeb(
        { query: 'test' },
        { provider: 'google', googleApiKey: 'k', googleEngineId: 'cx' },
      );
    } catch (e) {
      err = e as SearchWebError;
    }
    expect(err).toBeInstanceOf(SearchWebError);
    expect(err!.code).toBe('timeout');
  });
});

// ─── TC-SWB-10: Empty results ─────────────────────────────────────────────────

describe('TC-SWB-10: empty results — returns empty array without throwing', () => {
  it('returns empty results array when Google returns no items', async () => {
    stubGoogleFetch([]);
    const result = await searchWeb(
      { query: 'something obscure' },
      { provider: 'google', googleApiKey: 'k', googleEngineId: 'cx' },
    );
    expect(result.results).toEqual([]);
  });

  it('returns empty results array when Bing returns no values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ webPages: {} }),
    }));
    const result = await searchWeb(
      { query: 'something obscure' },
      { provider: 'bing', bingApiKey: 'k' },
    );
    expect(result.results).toEqual([]);
  });
});

// ─── TC-SWB-11: Provider field ────────────────────────────────────────────────

describe('TC-SWB-11: provider field — result includes provider name', () => {
  it('result.provider is "google" when using Google provider', async () => {
    stubGoogleFetch([]);
    const result = await searchWeb(
      { query: 'test' },
      { provider: 'google', googleApiKey: 'k', googleEngineId: 'cx' },
    );
    expect(result.provider).toBe('google');
  });

  it('result.provider is "bing" when using Bing provider', async () => {
    stubBingFetch([]);
    const result = await searchWeb(
      { query: 'test' },
      { provider: 'bing', bingApiKey: 'k' },
    );
    expect(result.provider).toBe('bing');
  });
});

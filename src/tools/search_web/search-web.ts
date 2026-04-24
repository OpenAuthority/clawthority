/**
 * search_web tool implementation.
 *
 * Performs a web search via a configured provider (Google Custom Search or
 * Bing Web Search) and returns ranked results with titles, URLs, and snippets.
 * Policy enforcement (HITL gating and Cedar stage2 policy) is handled at the
 * pipeline layer; this module performs only the search API call.
 *
 * Provider selection and API credentials are read from environment variables;
 * injectable overrides are accepted for testing.
 *
 * Action class: web.search
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RESULT_LIMIT = 10;
const MAX_RESULT_LIMIT = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single ranked search result. */
export interface SearchResult {
  /** 1-based rank position in the result list. */
  rank: number;
  /** Page title as returned by the search provider. */
  title: string;
  /** URL of the result page. */
  url: string;
  /** Short text excerpt from the page. */
  snippet: string;
}

/** Input parameters for the search_web tool. */
export interface SearchWebParams {
  /** Search query string to submit to the search provider. */
  query: string;
  /** Maximum number of results to return. Defaults to 10, maximum 10. */
  limit?: number;
}

/** Successful result from the search_web tool. */
export interface SearchWebResult {
  /** Ranked list of search results. */
  results: SearchResult[];
  /** The search query that was submitted. */
  query: string;
  /** Search provider used. */
  provider: 'google' | 'bing';
}

/** Injectable options for the searchWeb function (used in tests). */
export interface SearchWebOptions {
  /** Provider override (falls back to SEARCH_PROVIDER env var, default 'google'). */
  provider?: 'google' | 'bing';
  /** Google API key override (falls back to GOOGLE_SEARCH_API_KEY env var). */
  googleApiKey?: string;
  /** Google Custom Search Engine ID override (falls back to GOOGLE_SEARCH_ENGINE_ID env var). */
  googleEngineId?: string;
  /** Bing Subscription Key override (falls back to BING_SEARCH_API_KEY env var). */
  bingApiKey?: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `searchWeb`.
 *
 * - `missing-config`  — required API key or engine ID is not configured.
 * - `invalid-query`   — the query string is empty or blank.
 * - `network-error`   — a network-level failure occurred during the request.
 * - `timeout`         — the request exceeded the 30 s timeout.
 * - `provider-error`  — the search provider returned an error response.
 */
export class SearchWebError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'missing-config'
      | 'invalid-query'
      | 'network-error'
      | 'timeout'
      | 'provider-error',
  ) {
    super(message);
    this.name = 'SearchWebError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface GoogleSearchItem {
  title?: string;
  link?: string;
  snippet?: string;
}

interface GoogleSearchResponse {
  items?: GoogleSearchItem[];
  error?: { message?: string };
}

interface BingSearchValue {
  name?: string;
  url?: string;
  snippet?: string;
}

interface BingSearchResponse {
  webPages?: { value?: BingSearchValue[] };
  error?: { message?: string };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SearchWebError(
        `search_web: request timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        'timeout',
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new SearchWebError(
      `search_web: network error during search request: ${cause}`,
      'network-error',
    );
  }

  clearTimeout(timeoutId);
  return response;
}

async function searchGoogle(
  query: string,
  limit: number,
  apiKey: string,
  engineId: string,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    key: apiKey,
    cx: engineId,
    q: query,
    num: String(Math.min(limit, MAX_RESULT_LIMIT)),
  });

  const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
  const response = await fetchWithTimeout(url, { method: 'GET' });
  const raw = await response.text();

  let data: GoogleSearchResponse;
  try {
    data = JSON.parse(raw) as GoogleSearchResponse;
  } catch {
    throw new SearchWebError(
      `search_web: Google Search API returned non-JSON response (status ${response.status}).`,
      'provider-error',
    );
  }

  if (!response.ok) {
    const msg = data.error?.message ?? raw;
    throw new SearchWebError(
      `search_web: Google Search API error (${response.status}): ${msg}`,
      'provider-error',
    );
  }

  const items = data.items ?? [];
  return items.map((item, index) => ({
    rank: index + 1,
    title: item.title ?? '',
    url: item.link ?? '',
    snippet: item.snippet ?? '',
  }));
}

async function searchBing(
  query: string,
  limit: number,
  apiKey: string,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(limit, MAX_RESULT_LIMIT)),
  });

  const url = `https://api.bing.microsoft.com/v7.0/search?${params.toString()}`;
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { 'Ocp-Apim-Subscription-Key': apiKey },
  });
  const raw = await response.text();

  let data: BingSearchResponse;
  try {
    data = JSON.parse(raw) as BingSearchResponse;
  } catch {
    throw new SearchWebError(
      `search_web: Bing Search API returned non-JSON response (status ${response.status}).`,
      'provider-error',
    );
  }

  if (!response.ok) {
    const msg = data.error?.message ?? raw;
    throw new SearchWebError(
      `search_web: Bing Search API error (${response.status}): ${msg}`,
      'provider-error',
    );
  }

  const values = data.webPages?.value ?? [];
  return values.map((item, index) => ({
    rank: index + 1,
    title: item.name ?? '',
    url: item.url ?? '',
    snippet: item.snippet ?? '',
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Performs a web search via a configured provider and returns ranked results.
 *
 * Provider is selected via `SEARCH_PROVIDER` env var ('google' or 'bing',
 * default 'google'). API credentials are read from provider-specific env vars:
 *   - Google: `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_ENGINE_ID`
 *   - Bing:   `BING_SEARCH_API_KEY`
 *
 * @param params   Query string and optional result limit.
 * @param options  Injectable provider/credential overrides for testing.
 * @returns        `{ results, query, provider }` — ranked search results.
 *
 * @throws {SearchWebError} code `missing-config`  — API key not configured.
 * @throws {SearchWebError} code `invalid-query`   — query is empty or blank.
 * @throws {SearchWebError} code `network-error`   — network failure.
 * @throws {SearchWebError} code `timeout`         — request exceeded 30 s.
 * @throws {SearchWebError} code `provider-error`  — provider API returned error.
 */
export async function searchWeb(
  params: SearchWebParams,
  options: SearchWebOptions = {},
): Promise<SearchWebResult> {
  const { query, limit = DEFAULT_RESULT_LIMIT } = params;

  if (!query || query.trim().length === 0) {
    throw new SearchWebError(
      'search_web: query must not be empty.',
      'invalid-query',
    );
  }

  const provider: 'google' | 'bing' =
    options.provider ??
    ((process.env['SEARCH_PROVIDER'] as 'google' | 'bing' | undefined) ?? 'google');

  const effectiveLimit = Math.max(1, Math.min(limit, MAX_RESULT_LIMIT));

  let results: SearchResult[];

  if (provider === 'bing') {
    const bingApiKey = options.bingApiKey ?? process.env['BING_SEARCH_API_KEY'];
    if (!bingApiKey) {
      throw new SearchWebError(
        'search_web: Bing Search API key not configured — set the BING_SEARCH_API_KEY environment variable.',
        'missing-config',
      );
    }
    results = await searchBing(query, effectiveLimit, bingApiKey);
  } else {
    const googleApiKey = options.googleApiKey ?? process.env['GOOGLE_SEARCH_API_KEY'];
    if (!googleApiKey) {
      throw new SearchWebError(
        'search_web: Google Search API key not configured — set the GOOGLE_SEARCH_API_KEY environment variable.',
        'missing-config',
      );
    }
    const googleEngineId = options.googleEngineId ?? process.env['GOOGLE_SEARCH_ENGINE_ID'];
    if (!googleEngineId) {
      throw new SearchWebError(
        'search_web: Google Custom Search Engine ID not configured — set the GOOGLE_SEARCH_ENGINE_ID environment variable.',
        'missing-config',
      );
    }
    results = await searchGoogle(query, effectiveLimit, googleApiKey, googleEngineId);
  }

  return { results, query, provider };
}

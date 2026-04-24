/**
 * scrape_page tool implementation.
 *
 * Fetches a URL and extracts structured data from the HTML response using
 * cheerio (static HTML parsing — no JavaScript execution). Returns the page
 * title, body text, and optionally the text content of elements matched by
 * caller-supplied CSS selectors.
 *
 * An optional `allowed_domains` list provides Cedar-style domain policy
 * validation at the tool level (same semantics as fetch_url). Broader Cedar
 * policy enforcement (HITL gating, stage-2 rules) is handled at the pipeline
 * layer; this module performs only the network and parse operations.
 *
 * Action class: browser.scrape
 */

import { load } from 'cheerio';

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Text content extracted for a single CSS selector. */
export interface SelectorResult {
  /** CSS selector that was evaluated. */
  selector: string;
  /** Number of elements matched in the document. */
  count: number;
  /** Trimmed text content of each matched element. */
  texts: string[];
}

/** Input parameters for the scrape_page tool. */
export interface ScrapePageParams {
  /** URL to scrape (http or https). */
  url: string;
  /**
   * Optional CSS selectors to extract content from the page.
   * When provided, each selector is evaluated and its matching elements'
   * text content is included in the result under `elements`.
   */
  selectors?: string[];
  /** Optional HTTP request headers. */
  headers?: Record<string, string>;
  /**
   * Optional domain allowlist for Cedar-style policy validation.
   * When provided, the request hostname must match one of the listed domains
   * exactly or as a subdomain (e.g. 'example.com' also allows 'api.example.com').
   */
  allowed_domains?: string[];
}

/** Successful result from the scrape_page tool. */
export interface ScrapePageResult {
  /** Final URL after redirects. */
  url: string;
  /** Page title from the <title> tag, or an empty string if not found. */
  title: string;
  /** Trimmed plain text of the entire page body. */
  text: string;
  /**
   * Selector results, one entry per requested selector.
   * Only present when `selectors` was provided and non-empty.
   */
  elements?: SelectorResult[];
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `scrapePage`.
 *
 * - `invalid-url`        — the URL is not a valid http/https URL.
 * - `domain-not-allowed` — the URL hostname is not in the allowed_domains list.
 * - `network-error`      — a network-level failure occurred during the request.
 * - `timeout`            — the request exceeded the 30 s timeout.
 * - `parse-error`        — the response body could not be parsed as HTML.
 */
export class ScrapePageError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid-url'
      | 'domain-not-allowed'
      | 'network-error'
      | 'timeout'
      | 'parse-error',
  ) {
    super(message);
    this.name = 'ScrapePageError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function validateUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new ScrapePageError(
      `scrape_page: invalid URL '${url}' — only http and https schemes are supported.`,
      'invalid-url',
    );
  }
  try {
    return new URL(url).hostname;
  } catch {
    throw new ScrapePageError(
      `scrape_page: invalid URL '${url}' — could not parse hostname.`,
      'invalid-url',
    );
  }
}

function validateDomain(hostname: string, allowedDomains: string[]): void {
  const allowed = allowedDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  if (!allowed) {
    throw new ScrapePageError(
      `scrape_page: domain '${hostname}' is not in the allowed_domains list.`,
      'domain-not-allowed',
    );
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches a URL and extracts structured data from the HTML response.
 *
 * Parsing is performed with cheerio (static HTML only — no JavaScript
 * execution). When `selectors` is provided, each selector is evaluated and
 * the matching elements' text content is returned under `elements`.
 *
 * When `allowed_domains` is provided, the URL hostname is validated against
 * the list before any network request is made (Cedar-style domain policy).
 *
 * Non-2xx responses are parsed as HTML without throwing — callers may inspect
 * `title` and `text` for error page content.
 *
 * @param params  URL, optional selectors, headers, and allowed_domains.
 * @returns       `{ url, title, text, elements? }`
 *
 * @throws {ScrapePageError} code `invalid-url`        — URL is not http/https.
 * @throws {ScrapePageError} code `domain-not-allowed`  — hostname not in allowlist.
 * @throws {ScrapePageError} code `network-error`       — network failure.
 * @throws {ScrapePageError} code `timeout`             — request exceeded 30 s.
 * @throws {ScrapePageError} code `parse-error`         — HTML could not be parsed.
 */
export async function scrapePage(params: ScrapePageParams): Promise<ScrapePageResult> {
  const { url, selectors, headers = {}, allowed_domains } = params;

  const hostname = validateUrl(url);

  if (allowed_domains !== undefined && allowed_domains.length > 0) {
    validateDomain(hostname, allowed_domains);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ScrapePageError(
        `scrape_page: request to '${url}' timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        'timeout',
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new ScrapePageError(
      `scrape_page: network error while fetching '${url}': ${cause}`,
      'network-error',
    );
  }

  clearTimeout(timeoutId);

  let html: string;
  try {
    html = await response.text();
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ScrapePageError(
      `scrape_page: failed to read response body from '${url}': ${cause}`,
      'parse-error',
    );
  }

  let $ : ReturnType<typeof load>;
  try {
    $ = load(html);
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ScrapePageError(
      `scrape_page: failed to parse HTML from '${url}': ${cause}`,
      'parse-error',
    );
  }

  const title = $('title').first().text().trim();
  const text = $('body').text().trim();
  const finalUrl = response.url || url;

  const result: ScrapePageResult = { url: finalUrl, title, text };

  if (selectors !== undefined && selectors.length > 0) {
    result.elements = selectors.map((selector) => {
      const matched = $(selector);
      const texts: string[] = [];
      matched.each((_, el) => {
        texts.push($(el).text().trim());
      });
      return { selector, count: matched.length, texts };
    });
  }

  return result;
}

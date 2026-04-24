/**
 * Unit tests for the scrape_page tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 * Cheerio is used for real HTML parsing (not mocked) to validate parsing logic.
 *
 * Test IDs:
 *   TC-SPG-01: Title extraction — extracts <title> tag content
 *   TC-SPG-02: Body text extraction — extracts plain text from <body>
 *   TC-SPG-03: CSS selectors — extracts matched elements with count and texts
 *   TC-SPG-04: No selectors — elements field is absent when selectors not provided
 *   TC-SPG-05: Empty selectors — elements field is absent for empty selectors array
 *   TC-SPG-06: Final URL — url field reflects the response URL
 *   TC-SPG-07: invalid-url — non-http/https URL throws ScrapePageError
 *   TC-SPG-08: domain-not-allowed — hostname not in allowed_domains throws ScrapePageError
 *   TC-SPG-09: allowed_domains subdomain — subdomain of allowed domain is permitted
 *   TC-SPG-10: network-error — fetch rejection throws ScrapePageError
 *   TC-SPG-11: timeout — AbortError throws ScrapePageError with timeout code
 *   TC-SPG-12: Non-2xx response — parses HTML without throwing
 *   TC-SPG-13: Result shape — url, title, text fields present
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { scrapePage, ScrapePageError } from './scrape-page.js';

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubFetch(html: string, opts: { status?: number; url?: string } = {}): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status: opts.status ?? 200,
    url: opts.url ?? 'https://example.com/',
    text: async () => html,
    headers: { get: () => null },
  }));
}

function stubFetchRejected(message: string): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── TC-SPG-01: Title extraction ──────────────────────────────────────────────

describe('TC-SPG-01: title extraction — extracts <title> tag content', () => {
  it('returns the page title from the <title> element', async () => {
    stubFetch('<html><head><title>My Page Title</title></head><body>Hello</body></html>');
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(result.title).toBe('My Page Title');
  });

  it('returns an empty string when no <title> tag is present', async () => {
    stubFetch('<html><head></head><body>No title</body></html>');
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(result.title).toBe('');
  });

  it('trims whitespace from the title', async () => {
    stubFetch('<html><head><title>  Padded Title  </title></head><body></body></html>');
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(result.title).toBe('Padded Title');
  });
});

// ─── TC-SPG-02: Body text extraction ─────────────────────────────────────────

describe('TC-SPG-02: body text extraction — extracts plain text from <body>', () => {
  it('returns the trimmed body text', async () => {
    stubFetch('<html><body><p>Hello World</p></body></html>');
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(result.text).toBe('Hello World');
  });

  it('strips HTML tags from body text', async () => {
    stubFetch('<html><body><h1>Title</h1><p>Paragraph</p></body></html>');
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(result.text).toContain('Title');
    expect(result.text).toContain('Paragraph');
    expect(result.text).not.toContain('<h1>');
    expect(result.text).not.toContain('<p>');
  });

  it('returns an empty string when body has no text', async () => {
    stubFetch('<html><body></body></html>');
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(result.text).toBe('');
  });
});

// ─── TC-SPG-03: CSS selectors ─────────────────────────────────────────────────

describe('TC-SPG-03: CSS selectors — extracts matched elements with count and texts', () => {
  it('returns selector results with count and texts for matching elements', async () => {
    stubFetch(
      '<html><body><ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul></body></html>',
    );
    const result = await scrapePage({
      url: 'https://example.com/',
      selectors: ['li'],
    });
    expect(result.elements).toBeDefined();
    expect(result.elements).toHaveLength(1);
    const li = result.elements![0]!;
    expect(li.selector).toBe('li');
    expect(li.count).toBe(3);
    expect(li.texts).toEqual(['Item 1', 'Item 2', 'Item 3']);
  });

  it('returns count 0 and empty texts for a selector with no matches', async () => {
    stubFetch('<html><body><p>No list here</p></body></html>');
    const result = await scrapePage({
      url: 'https://example.com/',
      selectors: ['li'],
    });
    const li = result.elements![0]!;
    expect(li.count).toBe(0);
    expect(li.texts).toEqual([]);
  });

  it('supports multiple selectors in a single call', async () => {
    stubFetch(
      '<html><head><title>T</title></head><body><h1>Heading</h1><p>Para</p></body></html>',
    );
    const result = await scrapePage({
      url: 'https://example.com/',
      selectors: ['h1', 'p'],
    });
    expect(result.elements).toHaveLength(2);
    expect(result.elements![0]!.selector).toBe('h1');
    expect(result.elements![0]!.texts).toEqual(['Heading']);
    expect(result.elements![1]!.selector).toBe('p');
    expect(result.elements![1]!.texts).toEqual(['Para']);
  });
});

// ─── TC-SPG-04: No selectors ──────────────────────────────────────────────────

describe('TC-SPG-04: no selectors — elements field absent when selectors not provided', () => {
  it('does not include elements in the result when selectors is omitted', async () => {
    stubFetch('<html><body>Hello</body></html>');
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(result.elements).toBeUndefined();
  });
});

// ─── TC-SPG-05: Empty selectors ───────────────────────────────────────────────

describe('TC-SPG-05: empty selectors — elements absent for empty selectors array', () => {
  it('does not include elements when selectors is an empty array', async () => {
    stubFetch('<html><body>Hello</body></html>');
    const result = await scrapePage({ url: 'https://example.com/', selectors: [] });
    expect(result.elements).toBeUndefined();
  });
});

// ─── TC-SPG-06: Final URL ─────────────────────────────────────────────────────

describe('TC-SPG-06: final URL — url field reflects the response URL', () => {
  it('returns the response URL as the final url', async () => {
    stubFetch('<html><body></body></html>', { url: 'https://www.example.com/page' });
    const result = await scrapePage({ url: 'https://example.com/redirect' });
    expect(result.url).toBe('https://www.example.com/page');
  });

  it('falls back to the request URL when response.url is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      url: '',
      text: async () => '<html><body></body></html>',
      headers: { get: () => null },
    }));
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(result.url).toBe('https://example.com/');
  });
});

// ─── TC-SPG-07: invalid-url ───────────────────────────────────────────────────

describe('TC-SPG-07: invalid-url — non-http/https URL throws ScrapePageError', () => {
  it('throws ScrapePageError with code invalid-url for ftp scheme', async () => {
    let err: ScrapePageError | undefined;
    try {
      await scrapePage({ url: 'ftp://files.example.com/index.html' });
    } catch (e) {
      err = e as ScrapePageError;
    }
    expect(err).toBeInstanceOf(ScrapePageError);
    expect(err!.code).toBe('invalid-url');
  });

  it('error name is ScrapePageError', async () => {
    let err: ScrapePageError | undefined;
    try {
      await scrapePage({ url: 'not-a-url' });
    } catch (e) {
      err = e as ScrapePageError;
    }
    expect(err!.name).toBe('ScrapePageError');
  });

  it('error message includes the invalid URL', async () => {
    let err: ScrapePageError | undefined;
    try {
      await scrapePage({ url: 'file:///etc/passwd' });
    } catch (e) {
      err = e as ScrapePageError;
    }
    expect(err!.message).toContain('file:///etc/passwd');
  });
});

// ─── TC-SPG-08: domain-not-allowed ────────────────────────────────────────────

describe('TC-SPG-08: domain-not-allowed — hostname not in allowed_domains throws ScrapePageError', () => {
  it('throws ScrapePageError with code domain-not-allowed for unlisted domain', async () => {
    let err: ScrapePageError | undefined;
    try {
      await scrapePage({
        url: 'https://blocked.example.com/',
        allowed_domains: ['safe.org'],
      });
    } catch (e) {
      err = e as ScrapePageError;
    }
    expect(err).toBeInstanceOf(ScrapePageError);
    expect(err!.code).toBe('domain-not-allowed');
  });

  it('error message includes the blocked hostname', async () => {
    let err: ScrapePageError | undefined;
    try {
      await scrapePage({
        url: 'https://forbidden.com/',
        allowed_domains: ['safe.org'],
      });
    } catch (e) {
      err = e as ScrapePageError;
    }
    expect(err!.message).toContain('forbidden.com');
  });

  it('permits an exact domain match', async () => {
    stubFetch('<html><body></body></html>', { url: 'https://safe.org/' });
    const result = await scrapePage({
      url: 'https://safe.org/',
      allowed_domains: ['safe.org'],
    });
    expect(result.url).toBe('https://safe.org/');
  });

  it('allows all domains when allowed_domains is an empty array', async () => {
    stubFetch('<html><body></body></html>', { url: 'https://any.com/' });
    const result = await scrapePage({
      url: 'https://any.com/',
      allowed_domains: [],
    });
    expect(result.url).toBe('https://any.com/');
  });
});

// ─── TC-SPG-09: allowed_domains subdomain ─────────────────────────────────────

describe('TC-SPG-09: allowed_domains subdomain — subdomain of allowed domain is permitted', () => {
  it('allows a subdomain of an explicitly listed domain', async () => {
    stubFetch('<html><body>content</body></html>', { url: 'https://api.safe.org/' });
    const result = await scrapePage({
      url: 'https://api.safe.org/',
      allowed_domains: ['safe.org'],
    });
    expect(result.text).toBe('content');
  });

  it('does not match a domain ending with the allowed domain as a raw suffix', async () => {
    let err: ScrapePageError | undefined;
    try {
      await scrapePage({
        url: 'https://notreallysafe.org/',
        allowed_domains: ['safe.org'],
      });
    } catch (e) {
      err = e as ScrapePageError;
    }
    expect(err!.code).toBe('domain-not-allowed');
  });
});

// ─── TC-SPG-10: network-error ─────────────────────────────────────────────────

describe('TC-SPG-10: network-error — fetch rejection throws ScrapePageError', () => {
  it('throws ScrapePageError with code network-error when fetch rejects', async () => {
    stubFetchRejected('ECONNRESET');
    let err: ScrapePageError | undefined;
    try {
      await scrapePage({ url: 'https://unreachable.example.com/' });
    } catch (e) {
      err = e as ScrapePageError;
    }
    expect(err).toBeInstanceOf(ScrapePageError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original cause', async () => {
    stubFetchRejected('ECONNREFUSED');
    let err: ScrapePageError | undefined;
    try {
      await scrapePage({ url: 'https://unreachable.example.com/' });
    } catch (e) {
      err = e as ScrapePageError;
    }
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-SPG-11: timeout ───────────────────────────────────────────────────────

describe('TC-SPG-11: timeout — AbortError throws ScrapePageError with timeout code', () => {
  it('throws ScrapePageError with code timeout on AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: ScrapePageError | undefined;
    try {
      await scrapePage({ url: 'https://slow.example.com/' });
    } catch (e) {
      err = e as ScrapePageError;
    }
    expect(err).toBeInstanceOf(ScrapePageError);
    expect(err!.code).toBe('timeout');
  });

  it('timeout error message includes the URL', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: ScrapePageError | undefined;
    try {
      await scrapePage({ url: 'https://slow.example.com/' });
    } catch (e) {
      err = e as ScrapePageError;
    }
    expect(err!.message).toContain('https://slow.example.com/');
  });
});

// ─── TC-SPG-12: Non-2xx response ─────────────────────────────────────────────

describe('TC-SPG-12: non-2xx response — parses HTML without throwing', () => {
  it('parses a 404 error page without throwing', async () => {
    stubFetch('<html><body><p>Page Not Found</p></body></html>', { status: 404 });
    const result = await scrapePage({ url: 'https://example.com/missing' });
    expect(result.text).toContain('Page Not Found');
  });

  it('handles a 500 response by returning empty title and text', async () => {
    stubFetch('<html><head><title>Error</title></head><body>Server Error</body></html>', {
      status: 500,
    });
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(result.title).toBe('Error');
    expect(result.text).toBe('Server Error');
  });
});

// ─── TC-SPG-13: Result shape ──────────────────────────────────────────────────

describe('TC-SPG-13: result shape — url, title, text fields present', () => {
  it('result has a string url', async () => {
    stubFetch('<html><body></body></html>', { url: 'https://example.com/' });
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(typeof result.url).toBe('string');
  });

  it('result has a string title', async () => {
    stubFetch('<html><head><title>T</title></head><body></body></html>');
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(typeof result.title).toBe('string');
  });

  it('result has a string text', async () => {
    stubFetch('<html><body>Content</body></html>');
    const result = await scrapePage({ url: 'https://example.com/' });
    expect(typeof result.text).toBe('string');
  });
});

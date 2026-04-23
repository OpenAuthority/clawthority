/**
 * fetch_url tool implementation.
 *
 * Fetches a URL and returns the raw response body along with metadata such as
 * HTTP status code, final URL (after redirects), and Content-Type header.
 *
 * An optional `allowed_domains` list provides Cedar-style domain policy
 * validation at the tool level. When provided, the request URL's hostname
 * must match one of the listed domains (exact match or subdomain suffix).
 * Broader Cedar policy enforcement (HITL gating, stage-2 rules) is handled
 * at the pipeline layer; this module performs only the network operation.
 *
 * Action class: web.fetch
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the fetch_url tool. */
export interface FetchUrlParams {
  /** URL to fetch (http or https). */
  url: string;
  /** Optional HTTP request headers. */
  headers?: Record<string, string>;
  /**
   * Optional domain allowlist for Cedar-style policy validation.
   * When provided, the request hostname must match one of the listed domains
   * exactly or as a subdomain (e.g. 'example.com' also allows 'api.example.com').
   */
  allowed_domains?: string[];
}

/** Successful result from the fetch_url tool. */
export interface FetchUrlResult {
  /** HTTP response status code. */
  status_code: number;
  /** Raw response body text. */
  body: string;
  /** Value of the Content-Type response header, if present. */
  content_type?: string;
  /** Final URL after redirects. */
  final_url: string;
  /** Content-Length in bytes, if the header was present. */
  content_length?: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `fetchUrl`.
 *
 * - `invalid-url`        — the URL is not a valid http/https URL.
 * - `domain-not-allowed` — the URL hostname is not in the allowed_domains list.
 * - `network-error`      — a network-level failure occurred during the request.
 * - `timeout`            — the request exceeded the 30 s timeout.
 */
export class FetchUrlError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid-url'
      | 'domain-not-allowed'
      | 'network-error'
      | 'timeout',
  ) {
    super(message);
    this.name = 'FetchUrlError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function validateUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new FetchUrlError(
      `fetch_url: invalid URL '${url}' — only http and https schemes are supported.`,
      'invalid-url',
    );
  }
  try {
    return new URL(url).hostname;
  } catch {
    throw new FetchUrlError(
      `fetch_url: invalid URL '${url}' — could not parse hostname.`,
      'invalid-url',
    );
  }
}

function validateDomain(hostname: string, url: string, allowedDomains: string[]): void {
  const allowed = allowedDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  if (!allowed) {
    throw new FetchUrlError(
      `fetch_url: domain '${hostname}' is not in the allowed_domains list.`,
      'domain-not-allowed',
    );
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches a URL and returns the raw response body with metadata.
 *
 * When `allowed_domains` is provided, the URL hostname is validated against
 * the list before any network request is made. Hostnames match either exactly
 * or as a subdomain (e.g. the domain 'example.com' permits 'api.example.com').
 *
 * Redirects are followed automatically; the final URL is reported in `final_url`.
 * Non-2xx responses are returned without throwing — callers should inspect
 * `status_code` to determine success.
 *
 * @param params  URL, optional headers, and optional allowed_domains list.
 * @returns       `{ status_code, body, content_type?, final_url, content_length? }`
 *
 * @throws {FetchUrlError} code `invalid-url`        — URL is not http/https.
 * @throws {FetchUrlError} code `domain-not-allowed`  — hostname not in allowlist.
 * @throws {FetchUrlError} code `network-error`       — network failure.
 * @throws {FetchUrlError} code `timeout`             — request exceeded 30 s.
 */
export async function fetchUrl(params: FetchUrlParams): Promise<FetchUrlResult> {
  const { url, headers = {}, allowed_domains } = params;

  const hostname = validateUrl(url);

  if (allowed_domains !== undefined && allowed_domains.length > 0) {
    validateDomain(hostname, url, allowed_domains);
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
      throw new FetchUrlError(
        `fetch_url: request to '${url}' timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        'timeout',
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new FetchUrlError(
      `fetch_url: network error while fetching '${url}': ${cause}`,
      'network-error',
    );
  }

  clearTimeout(timeoutId);

  const body = await response.text();
  const contentType = response.headers.get('content-type') ?? undefined;
  const contentLengthRaw = response.headers.get('content-length');
  const contentLength =
    contentLengthRaw !== null ? parseInt(contentLengthRaw, 10) : undefined;

  return {
    status_code: response.status,
    body,
    final_url: response.url || url,
    ...(contentType !== undefined ? { content_type: contentType } : {}),
    ...(contentLength !== undefined && !isNaN(contentLength)
      ? { content_length: contentLength }
      : {}),
  };
}

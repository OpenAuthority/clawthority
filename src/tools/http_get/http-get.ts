/**
 * http_get tool implementation.
 *
 * Sends an HTTP GET request to a URL with optional request headers.
 * Policy enforcement (HITL gating and Cedar stage2 URL policy) is handled
 * at the pipeline layer; this module performs only the network operation.
 *
 * Action class: web.fetch
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the http_get tool. */
export interface HttpGetParams {
  /** URL to send the GET request to. */
  url: string;
  /** Optional HTTP request headers as key-value pairs. */
  headers?: Record<string, string>;
}

/** Successful result from the http_get tool. */
export interface HttpGetResult {
  /** HTTP response status code. */
  status_code: number;
  /** Response body as a UTF-8 string. */
  body: string;
  /** Value of the Content-Type response header, if present. */
  content_type?: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `httpGet`.
 *
 * - `invalid-url`    — the provided URL is not a valid http/https URL.
 * - `network-error`  — a network-level failure occurred during the request.
 */
export class HttpGetError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-url' | 'network-error',
  ) {
    super(message);
    this.name = 'HttpGetError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends an HTTP GET request to the given URL.
 *
 * @param params  URL and optional headers.
 * @returns       `{ status_code, body, content_type? }` — the HTTP response.
 *
 * @throws {HttpGetError} code `invalid-url`   — URL is not http/https.
 * @throws {HttpGetError} code `network-error` — network failure.
 */
export async function httpGet(params: HttpGetParams): Promise<HttpGetResult> {
  const { url, headers } = params;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new HttpGetError(
      `http_get: invalid URL '${url}' — only http and https schemes are supported.`,
      'invalid-url',
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: headers ?? {},
    });
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new HttpGetError(
      `http_get: network error while requesting '${url}': ${cause}`,
      'network-error',
    );
  }

  const responseBody = await response.text();
  const contentType = response.headers.get('content-type') ?? undefined;

  return {
    status_code: response.status,
    body: responseBody,
    ...(contentType !== undefined ? { content_type: contentType } : {}),
  };
}

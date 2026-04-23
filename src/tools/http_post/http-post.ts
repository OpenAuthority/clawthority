/**
 * http_post tool implementation.
 *
 * Sends an HTTP POST request to a URL with an optional request body.
 * Policy enforcement (HITL gating and Cedar stage2 URL policy) is handled
 * at the pipeline layer; this module performs only the network operation.
 *
 * Action class: web.post
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the http_post tool. */
export interface HttpPostParams {
  /** URL to send the POST request to. */
  url: string;
  /** Request body to send. Serialise JSON before passing. */
  body?: string;
  /** Optional HTTP request headers as key-value pairs. */
  headers?: Record<string, string>;
}

/** Successful result from the http_post tool. */
export interface HttpPostResult {
  /** HTTP response status code. */
  status_code: number;
  /** Response body as a UTF-8 string. */
  body: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `httpPost`.
 *
 * - `invalid-url`    — the provided URL is not a valid http/https URL.
 * - `network-error`  — a network-level failure occurred during the request.
 */
export class HttpPostError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-url' | 'network-error',
  ) {
    super(message);
    this.name = 'HttpPostError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends an HTTP POST request to the given URL.
 *
 * @param params  URL, optional body, and optional headers.
 * @returns       `{ status_code, body }` — the HTTP response.
 *
 * @throws {HttpPostError} code `invalid-url`   — URL is not http/https.
 * @throws {HttpPostError} code `network-error` — network failure.
 */
export async function httpPost(params: HttpPostParams): Promise<HttpPostResult> {
  const { url, body, headers } = params;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new HttpPostError(
      `http_post: invalid URL '${url}' — only http and https schemes are supported.`,
      'invalid-url',
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: body ?? undefined,
      headers: headers ?? {},
    });
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new HttpPostError(
      `http_post: network error while requesting '${url}': ${cause}`,
      'network-error',
    );
  }

  const responseBody = await response.text();
  return {
    status_code: response.status,
    body: responseBody,
  };
}

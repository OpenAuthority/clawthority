/**
 * http_post tool implementation.
 *
 * Sends an HTTP POST request to a URL with an optional request body.
 * Policy enforcement (HITL gating and Cedar stage2 URL policy) is handled
 * at the pipeline layer; this module performs only the network operation.
 *
 * Action class: web.post
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

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
  /** Value of the Content-Type response header, if present. */
  content_type?: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `httpPost`.
 *
 * - `invalid-url`          — the provided URL is not a valid http/https URL.
 * - `invalid-content-type` — the Content-Type header contains an unsupported type (e.g. multipart/*).
 * - `network-error`        — a network-level failure occurred during the request.
 * - `timeout`              — the request exceeded the 30 s timeout.
 */
export class HttpPostError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-url' | 'invalid-content-type' | 'network-error' | 'timeout',
  ) {
    super(message);
    this.name = 'HttpPostError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends an HTTP POST request to the given URL.
 *
 * Supports application/json and application/x-www-form-urlencoded bodies.
 * multipart/* content types are rejected (file uploads are out of scope).
 *
 * @param params  URL, optional body, and optional headers.
 * @returns       `{ status_code, body, content_type? }` — the HTTP response.
 *
 * @throws {HttpPostError} code `invalid-url`          — URL is not http/https.
 * @throws {HttpPostError} code `invalid-content-type` — Content-Type is multipart/*.
 * @throws {HttpPostError} code `network-error`        — network failure.
 * @throws {HttpPostError} code `timeout`              — request exceeded 30 s.
 */
export async function httpPost(params: HttpPostParams): Promise<HttpPostResult> {
  const { url, body, headers } = params;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new HttpPostError(
      `http_post: invalid URL '${url}' — only http and https schemes are supported.`,
      'invalid-url',
    );
  }

  // Validate content-type: reject multipart/* (file uploads are out of scope).
  const contentTypeEntry = Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === 'content-type',
  );
  if (contentTypeEntry !== undefined) {
    const [, contentTypeValue] = contentTypeEntry;
    if (contentTypeValue.toLowerCase().startsWith('multipart/')) {
      throw new HttpPostError(
        `http_post: content-type '${contentTypeValue}' is not supported — file uploads and multipart data are out of scope.`,
        'invalid-content-type',
      );
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      ...(body != null ? { body } : {}),
      headers: headers ?? {},
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpPostError(
        `http_post: request to '${url}' timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        'timeout',
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new HttpPostError(
      `http_post: network error while requesting '${url}': ${cause}`,
      'network-error',
    );
  }

  clearTimeout(timeoutId);
  const responseBody = await response.text();
  const contentType = response.headers.get('content-type') ?? undefined;

  return {
    status_code: response.status,
    body: responseBody,
    ...(contentType !== undefined ? { content_type: contentType } : {}),
  };
}

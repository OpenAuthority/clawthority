/**
 * http_delete tool implementation.
 *
 * Sends an HTTP DELETE request to a URL with optional request headers.
 * Policy enforcement (HITL gating and Cedar stage2 URL policy) is handled
 * at the pipeline layer; this module performs only the network operation.
 *
 * Action class: web.post
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the http_delete tool. */
export interface HttpDeleteParams {
  /** URL of the resource to delete. */
  url: string;
  /** Optional HTTP request headers as key-value pairs. */
  headers?: Record<string, string>;
}

/** Successful result from the http_delete tool. */
export interface HttpDeleteResult {
  /** HTTP response status code. */
  status_code: number;
  /** Response body as a UTF-8 string. */
  body: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `httpDelete`.
 *
 * - `invalid-url`    — the provided URL is not a valid http/https URL.
 * - `network-error`  — a network-level failure occurred during the request.
 * - `timeout`        — the request exceeded the 30 s timeout.
 */
export class HttpDeleteError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-url' | 'network-error' | 'timeout',
  ) {
    super(message);
    this.name = 'HttpDeleteError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends an HTTP DELETE request to the given URL.
 *
 * @param params  URL and optional headers.
 * @returns       `{ status_code, body }` — the HTTP response.
 *
 * @throws {HttpDeleteError} code `invalid-url`   — URL is not http/https.
 * @throws {HttpDeleteError} code `network-error` — network failure.
 * @throws {HttpDeleteError} code `timeout`       — request exceeded 30 s.
 */
export async function httpDelete(params: HttpDeleteParams): Promise<HttpDeleteResult> {
  const { url, headers } = params;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new HttpDeleteError(
      `http_delete: invalid URL '${url}' — only http and https schemes are supported.`,
      'invalid-url',
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'DELETE',
      headers: headers ?? {},
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpDeleteError(
        `http_delete: request to '${url}' timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        'timeout',
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new HttpDeleteError(
      `http_delete: network error while requesting '${url}': ${cause}`,
      'network-error',
    );
  }

  clearTimeout(timeoutId);
  const responseBody = await response.text();
  return {
    status_code: response.status,
    body: responseBody,
  };
}

/**
 * http_patch tool implementation.
 *
 * Sends an HTTP PATCH request to a URL with an optional partial-update payload.
 * Policy enforcement (HITL gating and Cedar stage2 URL policy) is handled
 * at the pipeline layer; this module performs only the network operation.
 *
 * Action class: web.post
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the http_patch tool. */
export interface HttpPatchParams {
  /** URL to send the PATCH request to. */
  url: string;
  /** Partial update payload to send. Serialise JSON before passing. */
  body?: string;
  /** Optional HTTP request headers as key-value pairs. */
  headers?: Record<string, string>;
}

/** Successful result from the http_patch tool. */
export interface HttpPatchResult {
  /** HTTP response status code. */
  status_code: number;
  /** Response body as a UTF-8 string. */
  body: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `httpPatch`.
 *
 * - `invalid-url`    — the provided URL is not a valid http/https URL.
 * - `network-error`  — a network-level failure occurred during the request.
 * - `timeout`        — the request exceeded the 30 s timeout.
 */
export class HttpPatchError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-url' | 'network-error' | 'timeout',
  ) {
    super(message);
    this.name = 'HttpPatchError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends an HTTP PATCH request to the given URL.
 *
 * @param params  URL, optional partial-update body, and optional headers.
 * @returns       `{ status_code, body }` — the HTTP response.
 *
 * @throws {HttpPatchError} code `invalid-url`   — URL is not http/https.
 * @throws {HttpPatchError} code `network-error` — network failure.
 * @throws {HttpPatchError} code `timeout`       — request exceeded 30 s.
 */
export async function httpPatch(params: HttpPatchParams): Promise<HttpPatchResult> {
  const { url, body, headers } = params;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new HttpPatchError(
      `http_patch: invalid URL '${url}' — only http and https schemes are supported.`,
      'invalid-url',
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PATCH',
      ...(body != null ? { body } : {}),
      headers: headers ?? {},
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpPatchError(
        `http_patch: request to '${url}' timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        'timeout',
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new HttpPatchError(
      `http_patch: network error while requesting '${url}': ${cause}`,
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

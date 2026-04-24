/**
 * webhook tool implementation.
 *
 * Posts a JSON payload to a webhook URL via HTTP POST with automatic retry on
 * transient network failures. URL must use the http or https scheme. Custom
 * headers may be supplied; Content-Type is automatically set to
 * application/json unless the caller overrides it (checked case-insensitively).
 *
 * Retry behaviour:
 *   - Retries on `network-error` and `timeout` — both are transient failures.
 *   - Does NOT retry on non-2xx HTTP responses — the server understood and
 *     rejected the request; retrying would not help.
 *   - Exponential backoff: BASE_BACKOFF_MS * 2^(attempt-1) ms between retries.
 *   - Default maximum retries: 3 (caller-overridable via `max_retries`).
 *
 * Policy enforcement (HITL gating and Cedar stage2 policy) is handled at the
 * pipeline layer; this module performs only the HTTP operation.
 *
 * Action class: communication.webhook
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the webhook tool. */
export interface WebhookParams {
  /** Webhook endpoint URL (http or https). */
  url: string;
  /** JSON payload to POST to the webhook endpoint. */
  payload: Record<string, unknown>;
  /** Optional HTTP headers to include in the request. */
  headers?: Record<string, string>;
  /**
   * Maximum number of retry attempts on transient network failures.
   * Defaults to 3. Set to 0 to disable retries.
   */
  max_retries?: number;
}

/** Successful result from the webhook tool. */
export interface WebhookResult {
  /** HTTP response status code from the webhook endpoint. */
  status_code: number;
  /** Response body returned by the webhook endpoint. */
  response_body: string;
  /** Value of the Content-Type response header, if present. */
  content_type?: string;
  /** Total number of attempts made (1 means no retries were needed). */
  attempts: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `webhook`.
 *
 * - `invalid-url`   — the provided URL is not a valid http/https URL.
 * - `network-error` — a network-level failure occurred during the request.
 * - `timeout`       — the request exceeded the 30 s timeout.
 */
export class WebhookError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-url' | 'network-error' | 'timeout',
    /** Number of attempts made before giving up. */
    public readonly attempts: number,
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Returns a promise that resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Performs a single HTTP POST attempt with a 30 s timeout.
 *
 * Resolves with the raw `Response` on any HTTP response (including 4xx/5xx).
 * Rejects with a `WebhookError` on network failure or timeout.
 */
async function attemptPost(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new WebhookError(
        `webhook: request to '${url}' timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        'timeout',
        0, // placeholder; caller fills in attempts
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new WebhookError(
      `webhook: network error while posting to '${url}': ${cause}`,
      'network-error',
      0, // placeholder; caller fills in attempts
    );
  }

  clearTimeout(timeoutId);
  return response;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Posts a JSON payload to a webhook endpoint via HTTP POST, retrying on
 * transient network failures.
 *
 * Content-Type is set to `application/json` unless the caller already
 * supplies a `Content-Type` header (checked case-insensitively). Non-2xx
 * HTTP responses are returned without throwing — callers should inspect
 * `status_code` to determine success.
 *
 * @param params  URL, payload, optional headers, and optional max_retries.
 * @returns       `{ status_code, response_body, content_type?, attempts }`.
 *
 * @throws {WebhookError} code `invalid-url`   — URL is not http/https.
 * @throws {WebhookError} code `network-error` — network failure after all retries exhausted.
 * @throws {WebhookError} code `timeout`       — request timed out after all retries exhausted.
 */
export async function webhook(params: WebhookParams): Promise<WebhookResult> {
  const { url, payload, headers = {}, max_retries = DEFAULT_MAX_RETRIES } = params;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new WebhookError(
      `webhook: invalid URL '${url}' — only http and https schemes are supported.`,
      'invalid-url',
      0,
    );
  }

  const requestHeaders: Record<string, string> = { ...headers };
  const hasContentType = Object.keys(requestHeaders).some(
    (k) => k.toLowerCase() === 'content-type',
  );
  if (!hasContentType) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const body = JSON.stringify(payload);
  const maxAttempts = max_retries + 1;
  let lastError: WebhookError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 2);
      await sleep(backoffMs);
    }

    let response: Response;
    try {
      response = await attemptPost(url, requestHeaders, body);
    } catch (err: unknown) {
      if (err instanceof WebhookError) {
        lastError = new WebhookError(err.message, err.code, attempt);
        // Only retry on transient failures (network-error or timeout).
        if (err.code === 'invalid-url') throw lastError;
        continue;
      }
      throw err;
    }

    // Any HTTP response (including 4xx/5xx) is a definitive answer — return it.
    const responseBody = await response.text();
    const contentType = response.headers.get('content-type') ?? undefined;

    return {
      status_code: response.status,
      response_body: responseBody,
      attempts: attempt,
      ...(contentType !== undefined ? { content_type: contentType } : {}),
    };
  }

  // All attempts exhausted — rethrow the last transient error with the final attempt count.
  throw lastError!;
}

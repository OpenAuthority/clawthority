/**
 * call_webhook tool implementation.
 *
 * Makes an HTTP request to a webhook endpoint with an optional JSON payload.
 * Supports GET, POST, PUT, PATCH, and DELETE methods. When a payload is
 * provided for a body-bearing method, it is serialised to JSON and
 * Content-Type: application/json is set unless overridden by the caller.
 *
 * Policy enforcement (HITL gating and Cedar stage2 policy) is handled at the
 * pipeline layer; this module performs only the network operation.
 *
 * Action class: communication.webhook
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

/** HTTP methods that carry a request body. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// ─── Types ────────────────────────────────────────────────────────────────────

export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Input parameters for the call_webhook tool. */
export interface CallWebhookParams {
  /** Webhook endpoint URL (http or https). */
  url: string;
  /** HTTP method to use. Defaults to POST. */
  method?: WebhookMethod;
  /** JSON payload for the request body. Used with POST, PUT, PATCH only. */
  payload?: Record<string, unknown>;
  /** Optional HTTP headers to include in the request. */
  headers?: Record<string, string>;
}

/** Successful result from the call_webhook tool. */
export interface CallWebhookResult {
  /** HTTP response status code from the webhook endpoint. */
  status_code: number;
  /** Response body returned by the webhook endpoint. */
  response_body: string;
  /** Value of the Content-Type response header, if present. */
  content_type?: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `callWebhook`.
 *
 * - `invalid-url`    — the provided URL is not a valid http/https URL.
 * - `network-error`  — a network-level failure occurred during the request.
 * - `timeout`        — the request exceeded the 30 s timeout.
 */
export class CallWebhookError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-url' | 'network-error' | 'timeout',
  ) {
    super(message);
    this.name = 'CallWebhookError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Makes an HTTP request to a webhook endpoint.
 *
 * When `payload` is provided and the method supports a body (POST, PUT,
 * PATCH), the payload is JSON-serialised and Content-Type is set to
 * application/json unless the caller already supplies a Content-Type header.
 * For GET and DELETE, `payload` is ignored and no body is sent.
 *
 * @param params  URL, optional method, payload, and headers.
 * @returns       `{ status_code, response_body, content_type? }` — the HTTP response.
 *
 * @throws {CallWebhookError} code `invalid-url`   — URL is not http/https.
 * @throws {CallWebhookError} code `network-error` — network failure.
 * @throws {CallWebhookError} code `timeout`       — request exceeded 30 s.
 */
export async function callWebhook(params: CallWebhookParams): Promise<CallWebhookResult> {
  const { url, method = 'POST', payload, headers = {} } = params;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new CallWebhookError(
      `call_webhook: invalid URL '${url}' — only http and https schemes are supported.`,
      'invalid-url',
    );
  }

  // Build request headers, injecting Content-Type for body-bearing methods
  // with a payload unless the caller has already set Content-Type.
  const requestHeaders: Record<string, string> = { ...headers };
  let body: string | undefined;

  if (BODY_METHODS.has(method) && payload !== undefined) {
    const hasContentType = Object.keys(requestHeaders).some(
      (k) => k.toLowerCase() === 'content-type',
    );
    if (!hasContentType) {
      requestHeaders['Content-Type'] = 'application/json';
    }
    body = JSON.stringify(payload);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      ...(body !== undefined ? { body } : {}),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CallWebhookError(
        `call_webhook: request to '${url}' timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        'timeout',
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new CallWebhookError(
      `call_webhook: network error while requesting '${url}': ${cause}`,
      'network-error',
    );
  }

  clearTimeout(timeoutId);

  const responseBody = await response.text();
  const contentType = response.headers.get('content-type') ?? undefined;

  return {
    status_code: response.status,
    response_body: responseBody,
    ...(contentType !== undefined ? { content_type: contentType } : {}),
  };
}

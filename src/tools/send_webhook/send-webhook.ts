/**
 * send_webhook tool implementation.
 *
 * Posts a JSON payload to a webhook URL via HTTP POST. The URL must use
 * the http or https scheme. Custom headers may be supplied; Content-Type
 * is automatically set to application/json unless the caller overrides it.
 *
 * Policy enforcement (HITL gating and Cedar stage2 policy) is handled
 * at the pipeline layer; this module performs only the HTTP operation.
 *
 * Action class: communication.webhook
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the send_webhook tool. */
export interface SendWebhookParams {
  /** Webhook endpoint URL (http or https). */
  url: string;
  /** JSON payload to POST to the webhook. */
  payload: Record<string, unknown>;
  /** Optional HTTP headers to include in the request. */
  headers?: Record<string, string>;
}

/** Successful result from the send_webhook tool. */
export interface SendWebhookResult {
  /** HTTP response status code from the webhook endpoint. */
  status_code: number;
  /** Response body returned by the webhook endpoint. */
  response_body: string;
  /** Value of the Content-Type response header, if present. */
  content_type?: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `sendWebhook`.
 *
 * - `invalid-url`   — the provided URL is not a valid http/https URL.
 * - `network-error` — a network-level failure occurred during the request.
 * - `timeout`       — the request exceeded the 30 s timeout.
 */
export class SendWebhookError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-url' | 'network-error' | 'timeout',
  ) {
    super(message);
    this.name = 'SendWebhookError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Posts a JSON payload to a webhook endpoint via HTTP POST.
 *
 * Content-Type is set to application/json unless the caller already supplies
 * a Content-Type header. Non-2xx responses are returned without throwing —
 * callers should inspect `status_code` to determine success.
 *
 * @param params  URL, payload, and optional headers.
 * @returns       `{ status_code, response_body, content_type? }` — the HTTP response.
 *
 * @throws {SendWebhookError} code `invalid-url`   — URL is not http/https.
 * @throws {SendWebhookError} code `network-error` — network failure.
 * @throws {SendWebhookError} code `timeout`       — request exceeded 30 s.
 */
export async function sendWebhook(params: SendWebhookParams): Promise<SendWebhookResult> {
  const { url, payload, headers = {} } = params;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new SendWebhookError(
      `send_webhook: invalid URL '${url}' — only http and https schemes are supported.`,
      'invalid-url',
    );
  }

  const requestHeaders: Record<string, string> = { ...headers };
  const hasContentType = Object.keys(requestHeaders).some(
    (k) => k.toLowerCase() === 'content-type',
  );
  if (!hasContentType) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SendWebhookError(
        `send_webhook: request to '${url}' timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        'timeout',
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new SendWebhookError(
      `send_webhook: network error while posting to '${url}': ${cause}`,
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

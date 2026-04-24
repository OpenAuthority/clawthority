/**
 * send_notification tool implementation.
 *
 * Sends a notification to a communication platform via webhook. The platform
 * parameter selects a platform adapter that formats the message payload for
 * the target service. Supported platforms: 'slack', 'discord', 'teams',
 * 'generic'.
 *
 * Delegates to the webhook backend (HTTP POST) for delivery. Policy
 * enforcement (HITL gating and Cedar stage2 policy) is handled at the
 * pipeline layer.
 *
 * Action class: communication.webhook
 */

import { sendWebhook, SendWebhookError } from '../send_webhook/send-webhook.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Supported notification platforms. */
export type NotificationPlatform = 'slack' | 'discord' | 'teams' | 'generic';

/** Input parameters for the send_notification tool. */
export interface SendNotificationParams {
  /** Target notification platform. Controls payload formatting. */
  platform: NotificationPlatform;
  /** Notification message text. */
  message: string;
  /** Webhook URL for the target platform. */
  url: string;
}

/** Successful result from the send_notification tool. */
export interface SendNotificationResult {
  /** Whether the notification was successfully delivered. */
  delivered: boolean;
  /** HTTP response status code from the webhook endpoint. */
  status_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `sendNotification`.
 *
 * - `unsupported-platform` — platform is not a recognised value.
 * - `invalid-url`          — the provided URL is not a valid http/https URL.
 * - `network-error`        — a network-level failure occurred during delivery.
 * - `timeout`              — the request exceeded the timeout.
 * - `delivery-error`       — the webhook endpoint returned a non-2xx response.
 */
export class SendNotificationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unsupported-platform'
      | 'invalid-url'
      | 'network-error'
      | 'timeout'
      | 'delivery-error',
  ) {
    super(message);
    this.name = 'SendNotificationError';
  }
}

// ─── Platform adapters ────────────────────────────────────────────────────────

/**
 * Returns a platform-formatted payload for the given message.
 * Each adapter wraps the message in the envelope expected by that platform's
 * Incoming Webhook API.
 */
function buildPayload(platform: NotificationPlatform, message: string): Record<string, unknown> {
  switch (platform) {
    case 'slack':
      return { text: message };
    case 'discord':
      return { content: message };
    case 'teams':
      return { text: message };
    case 'generic':
      return { message };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends a notification message to a platform via webhook.
 *
 * The message is formatted according to the platform adapter before delivery.
 * A 2xx HTTP response from the webhook endpoint is considered successful
 * delivery. Non-2xx responses throw a `delivery-error`.
 *
 * @param params  Platform, message text, and webhook URL.
 * @returns       `{ delivered: true, status_code }` on success.
 *
 * @throws {SendNotificationError} code `unsupported-platform` — platform is not recognised.
 * @throws {SendNotificationError} code `invalid-url`          — URL is not http/https.
 * @throws {SendNotificationError} code `network-error`        — network failure.
 * @throws {SendNotificationError} code `timeout`              — request timed out.
 * @throws {SendNotificationError} code `delivery-error`       — non-2xx HTTP response.
 */
export async function sendNotification(
  params: SendNotificationParams,
): Promise<SendNotificationResult> {
  const { platform, message, url } = params;

  const validPlatforms: NotificationPlatform[] = ['slack', 'discord', 'teams', 'generic'];
  if (!validPlatforms.includes(platform)) {
    throw new SendNotificationError(
      `send_notification: unsupported platform '${platform}' — supported platforms are: ${validPlatforms.join(', ')}.`,
      'unsupported-platform',
    );
  }

  const payload = buildPayload(platform, message);

  let statusCode: number;
  try {
    const result = await sendWebhook({ url, payload });
    statusCode = result.status_code;
  } catch (err: unknown) {
    if (err instanceof SendWebhookError) {
      if (err.code === 'invalid-url') {
        throw new SendNotificationError(err.message, 'invalid-url');
      }
      if (err.code === 'timeout') {
        throw new SendNotificationError(err.message, 'timeout');
      }
      throw new SendNotificationError(err.message, 'network-error');
    }
    throw new SendNotificationError(
      `send_notification: unexpected error: ${String(err)}`,
      'network-error',
    );
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new SendNotificationError(
      `send_notification: delivery failed — webhook returned HTTP ${statusCode}.`,
      'delivery-error',
    );
  }

  return { delivered: true, status_code: statusCode };
}

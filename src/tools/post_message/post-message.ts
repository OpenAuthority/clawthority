/**
 * post_message tool implementation.
 *
 * Posts a message to a communication platform. Initial version supports Slack
 * via the Slack Web API (chat.postMessage). The platform parameter identifies
 * the backend; only 'slack' is supported in this version.
 *
 * Delegates to sendSlack for the actual delivery. Policy enforcement (HITL
 * gating and Cedar stage2 policy) is handled at the pipeline layer.
 *
 * Action class: communication.slack
 */

import { sendSlack, SendSlackError } from '../send_slack/send-slack.js';
import type { SendSlackOptions } from '../send_slack/send-slack.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the post_message tool. */
export interface PostMessageParams {
  /** Target platform. Currently only 'slack' is supported. */
  platform: 'slack';
  /** Message text to post. */
  message: string;
  /** Channel or recipient specification (e.g. "#general" or "C01234ABCDE"). */
  channel: string;
  /** Timestamp of the parent message to reply in a thread. Optional. */
  thread_ts?: string;
}

/** Successful result from the post_message tool. */
export interface PostMessageResult {
  /** Unique message identifier returned by the platform (Slack message timestamp). */
  message_id: string;
  /** Whether the message was successfully posted. */
  posted: boolean;
}

/** Injectable options for the postMessage function (used in tests). */
export interface PostMessageOptions {
  /**
   * Bot token override for the Slack backend. When absent, falls back to the
   * SLACK_BOT_TOKEN environment variable.
   */
  token?: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `postMessage`.
 *
 * - `unsupported-platform` — platform is not 'slack' or is not yet supported.
 * - `missing-token`        — no bot token configured.
 * - `network-error`        — network-level failure during the request.
 * - `timeout`              — the request exceeded the timeout.
 * - `platform-error`       — the platform API returned an error response.
 */
export class PostMessageError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unsupported-platform'
      | 'missing-token'
      | 'network-error'
      | 'timeout'
      | 'platform-error',
  ) {
    super(message);
    this.name = 'PostMessageError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Posts a message to a communication platform.
 *
 * @param params   Platform, channel, message text, and optional thread_ts.
 * @param options  Injectable token override (useful in tests).
 * @returns        `{ message_id, posted: true }` on success.
 *
 * @throws {PostMessageError} code `unsupported-platform` — platform is not 'slack'.
 * @throws {PostMessageError} code `missing-token`        — SLACK_BOT_TOKEN not set.
 * @throws {PostMessageError} code `network-error`        — network failure.
 * @throws {PostMessageError} code `timeout`              — request timed out.
 * @throws {PostMessageError} code `platform-error`       — platform API error.
 */
export async function postMessage(
  params: PostMessageParams,
  options: PostMessageOptions = {},
): Promise<PostMessageResult> {
  const { platform, message, channel, thread_ts } = params;

  if (platform !== 'slack') {
    throw new PostMessageError(
      `post_message: unsupported platform '${platform}' — only 'slack' is supported.`,
      'unsupported-platform',
    );
  }

  const slackOptions: SendSlackOptions = {};
  if (options.token !== undefined) {
    slackOptions.token = options.token;
  }

  const slackParams: Parameters<typeof sendSlack>[0] = { channel, text: message };
  if (thread_ts !== undefined) {
    slackParams.thread_ts = thread_ts;
  }

  let ts: string;
  try {
    const result = await sendSlack(slackParams, slackOptions);
    ts = result.ts;
  } catch (err: unknown) {
    if (err instanceof SendSlackError) {
      if (err.code === 'missing-token') {
        throw new PostMessageError(err.message, 'missing-token');
      }
      if (err.code === 'timeout') {
        throw new PostMessageError(err.message, 'timeout');
      }
      if (err.code === 'network-error') {
        throw new PostMessageError(err.message, 'network-error');
      }
      throw new PostMessageError(err.message, 'platform-error');
    }
    throw new PostMessageError(
      `post_message: unexpected error: ${String(err)}`,
      'platform-error',
    );
  }

  return { message_id: ts, posted: true };
}

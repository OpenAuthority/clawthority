/**
 * send_slack tool implementation.
 *
 * Posts a message to a Slack channel using the Slack Web API
 * (chat.postMessage). The bot token is read from the SLACK_BOT_TOKEN
 * environment variable; an injectable override is accepted for testing.
 *
 * Policy enforcement (HITL gating and Cedar stage2 policy) is handled
 * at the pipeline layer; this module performs only the Slack API call.
 *
 * Action class: communication.slack
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const REQUEST_TIMEOUT_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the send_slack tool. */
export interface SendSlackParams {
  /** Slack channel ID (e.g. "C01234ABCDE") or name (e.g. "#general"). */
  channel: string;
  /** Message text to post. Supports Slack mrkdwn formatting. */
  text: string;
  /** Timestamp of the parent message to reply in a thread. Optional. */
  thread_ts?: string;
  /** Bot display name override shown in the channel. Optional. */
  username?: string;
}

/** Successful result from the send_slack tool. */
export interface SendSlackResult {
  /** Timestamp of the posted message, used as a unique message identifier. */
  ts: string;
  /** Channel ID where the message was posted. */
  channel: string;
}

/** Injectable options for the sendSlack function (used in tests). */
export interface SendSlackOptions {
  /**
   * Bot token override. When absent, falls back to the SLACK_BOT_TOKEN
   * environment variable.
   */
  token?: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `sendSlack`.
 *
 * - `missing-token`   — no bot token configured (env var absent and no override).
 * - `network-error`   — a network-level failure occurred during the request.
 * - `timeout`         — the request exceeded the 30 s timeout.
 * - `slack-api-error` — Slack responded with `ok: false`; see `message` for detail.
 */
export class SendSlackError extends Error {
  constructor(
    message: string,
    public readonly code: 'missing-token' | 'network-error' | 'timeout' | 'slack-api-error',
  ) {
    super(message);
    this.name = 'SendSlackError';
  }
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface SlackApiResponse {
  ok: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Posts a message to a Slack channel via the Slack Web API.
 *
 * @param params   Channel, text, and optional thread_ts.
 * @param options  Injectable bot token override (useful in tests).
 * @returns        `{ ts, channel }` — the posted message timestamp and channel ID.
 *
 * @throws {SendSlackError} code `missing-token`   — SLACK_BOT_TOKEN not set.
 * @throws {SendSlackError} code `network-error`   — network failure.
 * @throws {SendSlackError} code `timeout`         — request exceeded 30 s.
 * @throws {SendSlackError} code `slack-api-error` — Slack returned ok: false.
 */
export async function sendSlack(
  params: SendSlackParams,
  options: SendSlackOptions = {},
): Promise<SendSlackResult> {
  const { channel, text, thread_ts, username } = params;
  const token = options.token ?? process.env['SLACK_BOT_TOKEN'];

  if (!token) {
    throw new SendSlackError(
      'send_slack: no bot token configured — set the SLACK_BOT_TOKEN environment variable.',
      'missing-token',
    );
  }

  const body: Record<string, string> = { channel, text };
  if (thread_ts !== undefined) {
    body['thread_ts'] = thread_ts;
  }
  if (username !== undefined) {
    body['username'] = username;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(SLACK_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SendSlackError(
        `send_slack: request timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        'timeout',
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new SendSlackError(
      `send_slack: network error while calling Slack API: ${cause}`,
      'network-error',
    );
  }

  clearTimeout(timeoutId);

  const responseText = await response.text();
  let parsed: SlackApiResponse;
  try {
    parsed = JSON.parse(responseText) as SlackApiResponse;
  } catch {
    throw new SendSlackError(
      `send_slack: unexpected non-JSON response from Slack API (status ${response.status}).`,
      'slack-api-error',
    );
  }

  if (!parsed.ok) {
    throw new SendSlackError(
      `send_slack: Slack API error — ${parsed.error ?? 'unknown_error'}.`,
      'slack-api-error',
    );
  }

  return {
    ts: parsed.ts!,
    channel: parsed.channel!,
  };
}

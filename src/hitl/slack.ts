import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { SlackConfig } from './types.js';

const SLACK_API = 'https://slack.com/api';
const DEFAULT_INTERACTION_PORT = 3201;
const TIMESTAMP_MAX_AGE_SECONDS = 300; // 5 minutes

export interface ResolvedSlackConfig {
  botToken: string;
  channelId: string;
  signingSecret: string;
  interactionPort: number;
}

/**
 * Resolves Slack configuration from env vars and/or the HITL policy config.
 * Env vars take precedence. Returns `null` if botToken, channelId, or signingSecret is missing.
 */
export function resolveSlackConfig(
  policyConfig?: SlackConfig,
): ResolvedSlackConfig | null {
  const botToken = process.env.SLACK_BOT_TOKEN ?? policyConfig?.botToken;
  const channelId = process.env.SLACK_CHANNEL_ID ?? policyConfig?.channelId;
  const signingSecret = process.env.SLACK_SIGNING_SECRET ?? policyConfig?.signingSecret;
  if (!botToken || !channelId || !signingSecret) return null;

  const portStr = process.env.SLACK_INTERACTION_PORT;
  const interactionPort = portStr
    ? parseInt(portStr, 10)
    : policyConfig?.interactionPort ?? DEFAULT_INTERACTION_PORT;

  return { botToken, channelId, signingSecret, interactionPort };
}

export interface SlackSendApprovalOpts {
  token: string;
  toolName: string;
  agentId: string;
  policyName: string;
  timeoutSeconds: number;
}

export interface SlackSendApprovalResult {
  ok: boolean;
  /** Slack message timestamp — needed for chat.update on decision. */
  messageTs?: string | undefined;
}

/**
 * Sends an approval request message to the configured Slack channel using Block Kit
 * with interactive Approve/Deny buttons.
 */
export async function sendSlackApprovalRequest(
  config: ResolvedSlackConfig,
  opts: SlackSendApprovalOpts,
): Promise<SlackSendApprovalResult> {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `:rotating_light: *HITL Approval Request* — \`${opts.token}\``,
          '',
          `*Tool:* \`${opts.toolName}\``,
          `*Agent:* \`${opts.agentId}\``,
          `*Policy:* ${opts.policyName}`,
          `*Expires in:* ${opts.timeoutSeconds}s`,
        ].join('\n'),
      },
    },
    {
      type: 'actions',
      block_id: `hitl_${opts.token}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          action_id: 'hitl_approve',
          value: `approve:${opts.token}`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Deny' },
          style: 'danger',
          action_id: 'hitl_deny',
          value: `deny:${opts.token}`,
        },
      ],
    },
  ];

  try {
    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${config.botToken}`,
      },
      body: JSON.stringify({
        channel: config.channelId,
        text: `HITL Approval Request — ${opts.token}`, // fallback for notifications
        blocks,
      }),
    });

    if (!res.ok) {
      console.error(`[hitl-slack] chat.postMessage HTTP error: ${res.status} ${res.statusText}`);
      return { ok: false };
    }

    const body = (await res.json()) as { ok: boolean; ts?: string; error?: string };
    if (!body.ok) {
      console.error(`[hitl-slack] chat.postMessage API error: ${body.error}`);
      return { ok: false };
    }

    return { ok: true, messageTs: body.ts };
  } catch (err) {
    console.error('[hitl-slack] chat.postMessage error:', err);
    return { ok: false };
  }
}

/**
 * Updates the original approval message to show the decision and remove buttons.
 */
export async function sendSlackConfirmation(
  config: ResolvedSlackConfig,
  opts: { token: string; decision: string; toolName: string; messageTs: string },
): Promise<void> {
  const emoji = opts.decision === 'approved' ? ':white_check_mark:' : ':x:';
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} Action \`${opts.token}\` — *${opts.decision.toUpperCase()}*\nTool: \`${opts.toolName}\``,
      },
    },
  ];

  try {
    await fetch(`${SLACK_API}/chat.update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${config.botToken}`,
      },
      body: JSON.stringify({
        channel: config.channelId,
        ts: opts.messageTs,
        text: `Action ${opts.token} — ${opts.decision.toUpperCase()}`,
        blocks,
      }),
    });
  } catch {
    // Best-effort — don't fail the flow.
  }
}

// ─── Slack interaction webhook server ───────────────────────────────────────

export type SlackActionCommand = 'approve' | 'deny';

const ACTION_VALUE_RE = /^(approve|deny):([A-Za-z0-9_-]{6,12})$/;

/**
 * Verifies a Slack request signature.
 *
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TIMESTAMP_MAX_AGE_SECONDS) return false;

  const basestring = `v0:${timestamp}:${body}`;
  const computed = 'v0=' + createHmac('sha256', signingSecret).update(basestring).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Lightweight HTTP server that handles Slack interaction webhook payloads.
 *
 * Listens on a configurable port for POST requests to `/slack/interactions`,
 * verifies the Slack request signature, and dispatches approve/deny actions.
 */
export class SlackInteractionServer {
  private server: Server | null = null;

  constructor(
    private readonly port: number,
    private readonly signingSecret: string,
    private readonly onAction: (command: SlackActionCommand, token: string) => void,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        console.error('[hitl-slack] interaction server error:', err);
        reject(err);
      });

      this.server.listen(this.port, () => {
        console.log(`[hitl-slack] interaction server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        console.log('[hitl-slack] interaction server stopped');
        this.server = null;
        resolve();
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only accept POST /slack/interactions
    if (req.method !== 'POST' || req.url !== '/slack/interactions') {
      res.writeHead(404);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf-8');

      // Verify signature
      const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
      const signature = req.headers['x-slack-signature'] as string | undefined;

      if (!timestamp || !signature || !verifySlackSignature(this.signingSecret, timestamp, rawBody, signature)) {
        console.warn('[hitl-slack] rejected request: invalid signature');
        res.writeHead(401);
        res.end('Invalid signature');
        return;
      }

      // Respond 200 immediately (Slack requires < 3s)
      res.writeHead(200);
      res.end();

      // Parse payload
      try {
        const params = new URLSearchParams(rawBody);
        const payloadStr = params.get('payload');
        if (!payloadStr) return;

        const payload = JSON.parse(payloadStr) as {
          type?: string;
          actions?: Array<{ action_id?: string; value?: string }>;
        };

        if (payload.type !== 'block_actions' || !payload.actions?.length) return;

        for (const action of payload.actions) {
          if (!action.value) continue;
          const match = ACTION_VALUE_RE.exec(action.value);
          if (match) {
            const command = match[1] as SlackActionCommand;
            const token = match[2]!;
            this.onAction(command, token);
          }
        }
      } catch (err) {
        console.error('[hitl-slack] failed to parse interaction payload:', err);
      }
    });
  }
}

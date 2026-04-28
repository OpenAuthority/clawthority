import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { CircuitBreaker, withRetry } from './retry.js';
import { type ResolvedSlackConfig } from './config.js';

// Re-export so existing imports from this module keep working.
export type { ResolvedSlackConfig } from './config.js';
export { resolveSlackConfig } from './config.js';

const SLACK_API = 'https://slack.com/api';
const TIMESTAMP_MAX_AGE_SECONDS = 300; // 5 minutes
/** Maximum display length for values embedded in Block Kit fields. */
const MAX_DISPLAY_LENGTH = 100;

/** Truncates a string to at most `max` characters, appending … if cut. */
function truncate(s: string, max = MAX_DISPLAY_LENGTH): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

/**
 * Shared circuit breaker for outbound Slack API calls (chat.postMessage / chat.update).
 * Exported so tests can inject a fresh instance.
 */
export const slackCircuitBreaker = new CircuitBreaker();

export interface SlackSendApprovalOpts {
  token: string;
  toolName: string;
  agentId: string;
  policyName: string;
  timeoutSeconds: number;
  /** Logical action class (e.g. "email.send"). */
  action_class?: string;
  /** Target resource of the action (e.g. email address, file path). */
  target?: string;
  /** Human-readable summary of the requested action. */
  summary?: string;
  /** Absolute expiry timestamp (ISO 8601 string). */
  expires_at?: string;
  /**
   * False when the agent identity claim could not be verified against the
   * registry. When false, a warning banner is prepended so the operator
   * cannot confuse a spoofed agent with a registered one.
   */
  verified?: boolean;
  /**
   * When true (default), a 🔁 "Approve Always" button is included in the
   * message. Operators can click it to approve this request and
   * automatically approve all subsequent requests of the same action class
   * in the same channel without further prompts.
   *
   * Set to false to hide the button (e.g. when
   * `CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1` is set).
   */
  showApproveAlways?: boolean;
  /** Risk level label shown in the message (e.g. "low", "medium", "high"). */
  riskLevel?: string;
  /**
   * Human-readable explanation of what the command will do, provided by the
   * command explainer. Truncated to 500 characters with an ellipsis.
   */
  explanation?: string;
  /** Side-effects of the action, rendered as a bullet list. */
  effects?: string[];
  /** Warnings or caveats about the action, rendered as a bullet list. */
  warnings?: string[];
  /**
   * Raw shell command string, rendered in a de-emphasised context block.
   * Truncated to 200 characters with an ellipsis.
   */
  rawCommand?: string;
  /**
   * Agent-provided rationale for why this action is being taken.
   * Rendered as a 'Why this is happening' section, truncated at 200 characters.
   */
  intentHint?: string;
}

export interface SlackSendApprovalResult {
  ok: boolean;
  /** Slack message timestamp — needed for chat.update on decision. */
  messageTs?: string | undefined;
}

/**
 * Sends an approval request message to the configured Slack channel using Block Kit
 * with interactive Approve/Deny buttons.
 *
 * 429 responses from Slack trigger exponential backoff. After max retries are
 * exhausted the circuit breaker opens and `{ ok: false }` is returned
 * immediately for subsequent calls until the cooldown elapses.
 *
 * @param breaker  Injected for testing; defaults to the module-level singleton.
 */
export async function sendSlackApprovalRequest(
  config: ResolvedSlackConfig,
  opts: SlackSendApprovalOpts,
  breaker: CircuitBreaker = slackCircuitBreaker,
): Promise<SlackSendApprovalResult> {
  const blocks: object[] = [];

  // Unverified agent warning — prepended when identity cannot be confirmed.
  if (opts.verified === false) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *UNVERIFIED AGENT* — the identity claim "${truncate(opts.agentId)}" could not be verified. Treat with caution.`,
      },
    });
  }

  // Header — mirrors Telegram's "🚨 HITL Approval Request" line.
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '\uD83D\uDEA8 HITL Approval Request' },
  });

  // Core fields: Tool, Agent, Policy, Expires in, Risk? — rendered as a 2-column grid.
  const coreFields: object[] = [
    { type: 'mrkdwn', text: `*Tool:*\n\`${truncate(opts.toolName)}\`` },
    { type: 'mrkdwn', text: `*Agent:*\n\`${truncate(opts.agentId)}\`` },
    { type: 'mrkdwn', text: `*Policy:*\n${truncate(opts.policyName)}` },
    { type: 'mrkdwn', text: `*Expires in:*\n${opts.timeoutSeconds}s` },
  ];
  if (opts.riskLevel) {
    coreFields.push({ type: 'mrkdwn', text: `*Risk:*\n${truncate(opts.riskLevel)}` });
  }
  blocks.push({ type: 'section', fields: coreFields });

  // Optional fields: Action Class and Target.
  const optionalFields: object[] = [];
  if (opts.action_class) {
    optionalFields.push({
      type: 'mrkdwn',
      text: `:closed_lock_with_key: *Action Class:*\n\`${truncate(opts.action_class)}\``,
    });
  }
  if (opts.target) {
    optionalFields.push({
      type: 'mrkdwn',
      text: `:dart: *Target:*\n\`${truncate(opts.target)}\``,
    });
  }
  if (optionalFields.length > 0) {
    blocks.push({ type: 'section', fields: optionalFields });
  }

  // Optional summary — full-width section to allow longer text.
  if (opts.summary) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:clipboard: *Summary:* ${truncate(opts.summary, 200)}` },
    });
  }

  // Optional explanation — truncated at 500 chars.
  if (opts.explanation) {
    const explanation = opts.explanation.length > 500 ? opts.explanation.slice(0, 499) + '\u2026' : opts.explanation;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:mag: *Explanation:*\n${explanation}` },
    });
  }

  // Optional rawCommand — de-emphasised context block, truncated at 200 chars.
  if (opts.rawCommand) {
    const raw = opts.rawCommand.length > 200 ? opts.rawCommand.slice(0, 199) + '\u2026' : opts.rawCommand;
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `:computer: *Command:* \`${raw}\`` }],
    });
  }

  // Optional effects — bullet list.
  if (opts.effects && opts.effects.length > 0) {
    const effectLines = opts.effects.map(e => `\u2022 ${e}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Effects:*\n${effectLines}` },
    });
  }

  // Optional warnings — bullet list with warning prefix.
  if (opts.warnings && opts.warnings.length > 0) {
    const warningLines = opts.warnings.map(w => `:warning: ${w}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Warnings:*\n${warningLines}` },
    });
  }

  // Optional intent hint — agent-provided rationale, truncated at 200 chars.
  if (opts.intentHint) {
    const hint = opts.intentHint.length > 200 ? opts.intentHint.slice(0, 199) + '\u2026' : opts.intentHint;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:thinking_face: *Why this is happening:*\n${hint}` },
    });
  }

  // Context footer: Approval ID and optional expiry timestamp.
  const contextElements: object[] = [
    { type: 'mrkdwn', text: `:key: *Approval ID:* \`${opts.token}\`` },
  ];
  if (opts.expires_at) {
    contextElements.push({ type: 'mrkdwn', text: `:stopwatch: *Expires at:* ${opts.expires_at}` });
  }
  blocks.push({ type: 'context', elements: contextElements });

  // Visual separator before action buttons.
  blocks.push({ type: 'divider' });

  // Action buttons — Approve, (optional) Approve Always, Deny.
  const showApproveAlways = opts.showApproveAlways !== false;
  const actionElements: object[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Approve' },
      style: 'primary',
      action_id: 'hitl_approve',
      value: `approve:${opts.token}`,
    },
  ];
  if (showApproveAlways) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: '\uD83D\uDD01 Approve Always' },
      action_id: 'hitl_approve_always',
      value: `approve_always:${opts.token}`,
    });
  }
  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: 'Deny' },
    style: 'danger',
    action_id: 'hitl_deny',
    value: `deny:${opts.token}`,
  });
  blocks.push({
    type: 'actions',
    block_id: `hitl_${opts.token}`,
    elements: actionElements,
  });

  try {
    return await withRetry<SlackSendApprovalResult>(
      () =>
        fetch(`${SLACK_API}/chat.postMessage`, {
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
        }),
      async (res) => {
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
      },
      () => ({ ok: false } satisfies SlackSendApprovalResult),
      breaker,
    );
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

export type SlackActionCommand = 'approve' | 'approve_always' | 'deny';

// Tokens are UUID v7 (36 chars with hyphens) or session_approval keys
// of the form "session_id:action_class" (may contain ':', '.').
const ACTION_VALUE_RE = /^(approve|approve_always|deny):([\w.:-]{6,128})$/;

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
        console.log(`[hitl-slack] interaction server listening on port ${this.address().port}`);
        resolve();
      });
    });
  }

  /**
   * Returns the address the underlying HTTP server is bound to.
   * Use this when constructing the server with port 0 (OS-assigned port)
   * to discover the actual port chosen by the kernel.
   *
   * @throws if called before {@link start} has resolved.
   */
  address(): { port: number } {
    if (!this.server) {
      throw new Error('SlackInteractionServer.address(): server not started');
    }
    const addr = this.server.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error('SlackInteractionServer.address(): no port info available');
    }
    return { port: addr.port };
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

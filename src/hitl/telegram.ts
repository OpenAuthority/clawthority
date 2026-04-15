import type { TelegramConfig } from './types.js';
import { CircuitBreaker, withRetry } from './retry.js';

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT_SECONDS = 30;
const RETRY_DELAY_MS = 5_000;
const POLL_RATE_LIMIT_DELAY_MS = 30_000;

/**
 * Shared circuit breaker for outbound Telegram API calls (sendMessage).
 * Exported so tests can inject a fresh instance.
 */
export const telegramCircuitBreaker = new CircuitBreaker();

export interface ResolvedTelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Resolves the Telegram configuration from env vars and/or the HITL policy config.
 * Env vars take precedence. Returns `null` if either token or chatId is missing.
 */
export function resolveTelegramConfig(
  policyConfig?: TelegramConfig,
): ResolvedTelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? policyConfig?.botToken;
  const chatId = process.env.TELEGRAM_CHAT_ID ?? policyConfig?.chatId;
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

export interface SendApprovalOpts {
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
}

/**
 * Sends an approval request message to the configured Telegram chat.
 * Returns `true` on success, `false` on failure (including when the circuit
 * breaker is open after a rate-limit storm).
 *
 * @param breaker  Injected for testing; defaults to the module-level singleton.
 */
export async function sendApprovalRequest(
  config: ResolvedTelegramConfig,
  opts: SendApprovalOpts,
  breaker: CircuitBreaker = telegramCircuitBreaker,
): Promise<boolean> {
  const lines: string[] = [];
  if (opts.verified === false) {
    lines.push(
      `\u26A0\uFE0F *UNVERIFIED AGENT* \u2014 the identity claim "${opts.agentId}" could not be verified. Treat with caution.`,
      '',
    );
  }
  lines.push(
    `\u{1F6A8} *HITL Approval Request* \u2014 \`${opts.token}\``,
    '',
    `*Tool:* \`${opts.toolName}\``,
    `*Agent:* \`${opts.agentId}\``,
    `*Policy:* ${opts.policyName}`,
    `*Expires in:* ${opts.timeoutSeconds}s`,
  );
  if (opts.action_class) lines.push(`\u{1F510} *Action Class:* \`${opts.action_class}\``);
  if (opts.target) lines.push(`\u{1F3AF} *Target:* \`${opts.target}\``);
  if (opts.summary) lines.push(`\u{1F4CB} *Summary:* ${opts.summary}`);
  if (opts.expires_at) lines.push(`\u23F1 *Expires at:* ${opts.expires_at}`);
  lines.push(`\u{1F511} *Approval ID:* \`${opts.token}\``);
  lines.push('', `Reply with:`, `\`/approve ${opts.token}\` or \`/deny ${opts.token}\``);
  const text = lines.join('\n');

  try {
    return await withRetry(
      () =>
        fetch(`${TELEGRAM_API}/bot${config.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: 'Markdown' }),
        }),
      async (res) => {
        if (!res.ok) {
          console.error(`[hitl-telegram] sendMessage failed: ${res.status} ${res.statusText}`);
          return false;
        }
        return true;
      },
      () => false,
      breaker,
    );
  } catch (err) {
    console.error('[hitl-telegram] sendMessage error:', err);
    return false;
  }
}

/**
 * Sends a confirmation message after an approval decision is made.
 */
export async function sendConfirmation(
  config: ResolvedTelegramConfig,
  opts: { token: string; decision: string; toolName: string },
): Promise<void> {
  const emoji = opts.decision === 'approved' ? '\u2705' : '\u274C';
  const text = `${emoji} Action \`${opts.token}\` — *${opts.decision.toUpperCase()}*\nTool: \`${opts.toolName}\``;

  try {
    await fetch(`${TELEGRAM_API}/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
  } catch {
    // Best-effort confirmation — don't fail the flow.
  }
}

export type TelegramCommand = 'approve' | 'deny';

const COMMAND_RE = /^\/(approve|deny)\s+([A-Za-z0-9_-]{6,12})$/;

/**
 * Long-polling listener for Telegram bot updates.
 *
 * Parses `/approve TOKEN` and `/deny TOKEN` commands from incoming messages
 * and forwards them to the provided callback.
 */
export class TelegramListener {
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;

  constructor(
    private readonly botToken: string,
    private readonly onCommand: (command: TelegramCommand, token: string) => void,
  ) {}

  /** Starts the long-polling loop. Safe to call multiple times (no-op if already running). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll().catch((err) => {
      if (this.running) {
        console.error('[hitl-telegram] poll loop exited unexpectedly:', err);
      }
    });
    console.log('[hitl-telegram] listener started');
  }

  /** Stops the polling loop and aborts any in-flight fetch. */
  stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    console.log('[hitl-telegram] listener stopped');
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        this.abortController = new AbortController();
        const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=${this.offset}&timeout=${POLL_TIMEOUT_SECONDS}`;

        const res = await fetch(url, { signal: this.abortController.signal });

        if (res.status === 429) {
          console.warn('[hitl-telegram] getUpdates rate-limited (429) — backing off');
          await this.delay(POLL_RATE_LIMIT_DELAY_MS);
          continue;
        }

        if (!res.ok) {
          console.error(`[hitl-telegram] getUpdates failed: ${res.status}`);
          await this.delay(RETRY_DELAY_MS);
          continue;
        }

        const body = (await res.json()) as {
          ok: boolean;
          result?: Array<{
            update_id: number;
            message?: { text?: string; chat?: { id: number } };
          }>;
        };

        if (!body.ok || !body.result) {
          await this.delay(RETRY_DELAY_MS);
          continue;
        }

        for (const update of body.result) {
          this.offset = update.update_id + 1;
          const text = update.message?.text?.trim();
          if (!text) continue;

          const match = COMMAND_RE.exec(text);
          if (match) {
            const command = match[1] as TelegramCommand;
            const token = match[2]!;
            this.onCommand(command, token);
          }
        }
      } catch (err) {
        if (!this.running) return; // AbortError from stop()
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[hitl-telegram] poll error, retrying in 5s:', err);
        await this.delay(RETRY_DELAY_MS);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    });
  }
}

import { CircuitBreaker, withRetry } from './retry.js';
import type { ResolvedTelegramConfig } from './config.js';

// Re-export so existing imports from this module keep working.
export type { ResolvedTelegramConfig } from './config.js';
export { resolveTelegramConfig } from './config.js';

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT_SECONDS = 5;
const RETRY_DELAY_MS = 5_000;
const POLL_RATE_LIMIT_DELAY_MS = 30_000;
/** Maximum character count for command explanation text before truncation. */
const MAX_COMMAND_LENGTH = 500;

/**
 * Shared circuit breaker for outbound Telegram API calls (sendMessage).
 * Exported so tests can inject a fresh instance.
 */
export const telegramCircuitBreaker = new CircuitBreaker();

/**
 * Escapes special MarkdownV2 characters in a plain-text string.
 *
 * Per the Telegram Bot API spec the following characters must be preceded
 * by a backslash when they appear outside of entity boundaries:
 * `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`,
 * `=`, `|`, `{`, `}`, `.`, `!`, `\`
 *
 * Exported for use in tests.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/** Escapes characters that have special meaning inside a MarkdownV2 code span. */
function escapeCodeSpan(text: string): string {
  return text.replace(/[`\\]/g, '\\$&');
}

/** Truncates a string to at most `max` characters, appending … if cut. */
function truncateCommand(s: string, max = MAX_COMMAND_LENGTH): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
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
  /**
   * When true (default), a 🔁 "Approve Always" inline button is included in
   * the message. Operators can click it to approve this request and
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
   * Raw shell command string, rendered as a pre-formatted code block.
   * Truncated to 200 characters with an ellipsis.
   */
  rawCommand?: string;
  /**
   * Agent-provided rationale for why this action is being taken.
   * Rendered as a 'Why this is happening' section, truncated at 200 characters.
   */
  intentHint?: string;
}

export interface SendApprovalResult {
  ok: boolean;
  /** Telegram message_id — needed for editMessageText on decision. */
  messageId?: number | undefined;
}

/**
 * Sends a MarkdownV2-formatted approval request message to the configured
 * Telegram chat. The message includes rich formatting (agent, tool, risk
 * level, explanation, effects, warnings) and an inline keyboard with three
 * buttons: ✅ Approve Once, 🔁 Approve Always (optional), ❌ Deny.
 *
 * Returns `{ ok: true, messageId }` on success, `{ ok: false }` on failure
 * (including when the circuit breaker is open after a rate-limit storm).
 * The `messageId` is used to edit the original message when a decision is made.
 *
 * @param breaker  Injected for testing; defaults to the module-level singleton.
 */
export async function sendApprovalRequest(
  config: ResolvedTelegramConfig,
  opts: SendApprovalOpts,
  breaker: CircuitBreaker = telegramCircuitBreaker,
): Promise<SendApprovalResult> {
  const lines: string[] = [];

  // Unverified agent warning — prepended when identity cannot be confirmed.
  if (opts.verified === false) {
    const escapedId = escapeMarkdownV2(opts.agentId);
    lines.push(
      `\u26A0\uFE0F *UNVERIFIED AGENT* \u2014 the identity claim "${escapedId}" could not be verified\\. Treat with caution\\.`,
      '',
    );
  }

  // Header
  lines.push(`\uD83D\uDEA8 *HITL Approval Request*`, '');

  // Core fields block
  lines.push(
    `*Tool:* \`${escapeCodeSpan(opts.toolName)}\``,
    `*Agent:* \`${escapeCodeSpan(opts.agentId)}\``,
    `*Policy:* ${escapeMarkdownV2(opts.policyName)}`,
  );
  if (opts.riskLevel) {
    lines.push(`*Risk:* ${escapeMarkdownV2(opts.riskLevel)}`);
  }
  lines.push(`*Expires in:* ${opts.timeoutSeconds}s`);

  // Optional action class and target
  if (opts.action_class) {
    lines.push(`\uD83D\uDD10 *Action Class:* \`${escapeCodeSpan(opts.action_class)}\``);
  }
  if (opts.target) {
    lines.push(`\uD83C\uDFAF *Target:* \`${escapeCodeSpan(opts.target)}\``);
  }

  // Optional summary (legacy field)
  if (opts.summary) {
    lines.push(``, `\uD83D\uDCCB *Summary:* ${escapeMarkdownV2(opts.summary)}`);
  }

  // Command explanation from command explainer (truncated at 500 chars)
  if (opts.explanation) {
    const truncated = truncateCommand(opts.explanation);
    lines.push(``, `\uD83D\uDCCB *Explanation:*`, escapeMarkdownV2(truncated));
  }

  // Effects bullet list
  if (opts.effects && opts.effects.length > 0) {
    lines.push(``, `*Effects:*`);
    for (const effect of opts.effects) {
      lines.push(`\u2022 ${escapeMarkdownV2(effect)}`);
    }
  }

  // Warnings bullet list
  if (opts.warnings && opts.warnings.length > 0) {
    lines.push(``, `\u26A0\uFE0F *Warnings:*`);
    for (const warning of opts.warnings) {
      lines.push(`\u2022 ${escapeMarkdownV2(warning)}`);
    }
  }

  // Intent hint — agent-provided rationale, truncated to 200 chars
  if (opts.intentHint) {
    const truncated = opts.intentHint.length > 200 ? opts.intentHint.slice(0, 199) + '\u2026' : opts.intentHint;
    lines.push(``, `\uD83E\uDD14 *Why this is happening:*`, escapeMarkdownV2(truncated));
  }

  // Raw command — pre-formatted code block, truncated to 200 chars
  if (opts.rawCommand) {
    const truncated = opts.rawCommand.length > 200 ? opts.rawCommand.slice(0, 199) + '\u2026' : opts.rawCommand;
    lines.push(``, `\uD83D\uDDB5 *Command:*`);
    lines.push(`\`\`\`\n${truncated}\n\`\`\``);
  }

  // Footer: optional expiry and approval ID
  lines.push('');
  if (opts.expires_at) {
    lines.push(`\u23F1 *Expires at:* ${escapeMarkdownV2(opts.expires_at)}`);
  }
  lines.push(`\uD83D\uDD11 *Approval ID:* \`${escapeCodeSpan(opts.token)}\``);

  const text = lines.join('\n');

  // Inline keyboard — Approve Once, (optional) Approve Always, Deny.
  const showApproveAlways = opts.showApproveAlways !== false;
  const row: Array<{ text: string; callback_data: string }> = [
    { text: '\u2705 Approve Once', callback_data: `approve_once:${opts.token}` },
  ];
  if (showApproveAlways) {
    row.push({ text: '\uD83D\uDD01 Approve Always', callback_data: `approve_always:${opts.token}` });
  }
  row.push({ text: '\u274C Deny', callback_data: `deny:${opts.token}` });
  const reply_markup = { inline_keyboard: [row] };

  try {
    return await withRetry(
      () =>
        fetch(`${TELEGRAM_API}/bot${config.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: config.chatId,
            text,
            parse_mode: 'MarkdownV2',
            reply_markup,
          }),
        }),
      async (res) => {
        if (!res.ok) {
          console.error(`[hitl-telegram] sendMessage failed: ${res.status} ${res.statusText}`);
          return { ok: false } as SendApprovalResult;
        }
        const body = await res.json() as { ok: boolean; result?: { message_id?: number } };
        const messageId = body.result?.message_id;
        return { ok: true, ...(messageId !== undefined ? { messageId } : {}) } as SendApprovalResult;
      },
      () => ({ ok: false }) as SendApprovalResult,
      breaker,
    );
  } catch (err) {
    console.error('[hitl-telegram] sendMessage error:', err);
    return { ok: false };
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
  const text = `${emoji} Action \`${escapeCodeSpan(opts.token)}\` \u2014 *${opts.decision.toUpperCase()}*\nTool: \`${escapeCodeSpan(opts.toolName)}\``;

  try {
    await fetch(`${TELEGRAM_API}/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: 'MarkdownV2',
      }),
    });
  } catch {
    // Best-effort confirmation — don't fail the flow.
  }
}

/**
 * Edits the original approval request message to show the decision and remove
 * the inline keyboard buttons.  Mirrors Slack's `sendSlackConfirmation` /
 * `chat.update` behaviour.
 *
 * Fire-and-forget — failure here does not affect the approval flow.
 */
export async function editMessageDecision(
  config: ResolvedTelegramConfig,
  opts: { messageId: number; token: string; decision: string; toolName: string },
): Promise<void> {
  const emoji = opts.decision === 'approved' ? '\u2705' : '\u274C';
  const text = `${emoji} Action \`${escapeCodeSpan(opts.token)}\` \u2014 *${opts.decision.toUpperCase()}*\nTool: \`${escapeCodeSpan(opts.toolName)}\``;

  try {
    await fetch(`${TELEGRAM_API}/bot${config.botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        message_id: opts.messageId,
        text,
        parse_mode: 'MarkdownV2',
        // Omitting reply_markup removes the inline keyboard buttons.
      }),
    });
  } catch {
    // Best-effort — don't fail the flow.
  }
}

/** Options for {@link sendApproveAlwaysConfirmation}. */
export interface SendApproveAlwaysConfirmationOpts {
  /** The original approval token — used in Save/Cancel callback data. */
  token: string;
  /** Human-readable auto-permit pattern derived from the command. */
  pattern: string;
  /** The original command string from which the pattern was derived. */
  originalCommand: string;
}

/**
 * Sends a confirmation message asking the operator to save or cancel an
 * auto-permit pattern derived from an "Approve Always" click.
 *
 * The message shows the derived pattern in human-readable form and provides
 * two inline buttons:
 *   - ✅ Save  → callback_data `confirm_approve_always:TOKEN`
 *   - ❌ Cancel → callback_data `cancel_approve_always:TOKEN`
 *
 * Cancelling preserves the original approval request so the operator can
 * still use the original Approve Once / Deny buttons.
 *
 * Returns `true` on success, `false` on failure.
 */
export async function sendApproveAlwaysConfirmation(
  config: ResolvedTelegramConfig,
  opts: SendApproveAlwaysConfirmationOpts,
  breaker: CircuitBreaker = telegramCircuitBreaker,
): Promise<boolean> {
  const lines: string[] = [];

  lines.push(`\uD83D\uDD01 *Approve Always \u2014 Confirm Pattern*`, '');
  lines.push(`Save the following auto\\-permit rule?`, '');
  lines.push(`*Pattern:* \`${escapeCodeSpan(opts.pattern)}\``);
  lines.push(`*Original command:* \`${escapeCodeSpan(truncateCommand(opts.originalCommand))}\``);
  lines.push('');
  lines.push(
    `\u26A0\uFE0F Future commands matching this pattern will be auto\\-approved without human review\\.`,
  );
  lines.push('');
  lines.push(`\uD83D\uDD11 *Approval ID:* \`${escapeCodeSpan(opts.token)}\``);

  const text = lines.join('\n');
  const row = [
    { text: '\u2705 Save', callback_data: `confirm_approve_always:${opts.token}` },
    { text: '\u274C Cancel', callback_data: `cancel_approve_always:${opts.token}` },
  ];
  const reply_markup = { inline_keyboard: [row] };

  try {
    return await withRetry(
      () =>
        fetch(`${TELEGRAM_API}/bot${config.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: config.chatId,
            text,
            parse_mode: 'MarkdownV2',
            reply_markup,
          }),
        }),
      async (res) => {
        if (!res.ok) {
          console.error(
            `[hitl-telegram] sendApproveAlwaysConfirmation failed: ${res.status} ${res.statusText}`,
          );
          return false;
        }
        return true;
      },
      () => false,
      breaker,
    );
  } catch (err) {
    console.error('[hitl-telegram] sendApproveAlwaysConfirmation error:', err);
    return false;
  }
}

export type TelegramCommand = 'approve' | 'approve_once' | 'approve_always' | 'deny' | 'confirm_approve_always' | 'cancel_approve_always';

/**
 * Identity of the Telegram operator who triggered a command via an inline
 * keyboard button click.  Populated from the `callback_query.from` field of
 * the Telegram Bot API update.  Not available for text-command approvals
 * (`/approve TOKEN`) because the Bot API message object does not expose the
 * sender in the same structured way as `callback_query.from`.
 */
export interface TelegramOperatorInfo {
  /** Telegram numeric user ID of the operator. */
  userId: number;
  /** Telegram username (without `@`), when set by the operator. */
  username?: string;
  /** Display first name of the operator. */
  firstName?: string;
}

// Tokens are UUID v7 (36 chars with hyphens, e.g. "019daa50-5dc1-78ee-9ab4-bcf652bddfa3")
// or session_approval keys of the form "session_id:action_class" (may contain ':', '.').
// approve_always must appear before approve in the alternation so it matches first.
const COMMAND_RE = /^\/(approve_always|approve|deny)\s+([\w.:-]{6,128})$/;

// Same token format but triggered by inline keyboard callback_data ("command:TOKEN").
// confirm_approve_always and cancel_approve_always must appear before approve_always,
// and approve_once must appear before approve so the longer prefixes are tried first.
const CALLBACK_DATA_RE = /^(confirm_approve_always|cancel_approve_always|approve_always|approve_once|approve|deny):([\w.:-]{6,128})$/;

/**
 * Long-polling listener for Telegram bot updates.
 *
 * Handles both text commands (`/approve TOKEN`, `/deny TOKEN`,
 * `/approve_always TOKEN`) and inline keyboard button clicks (via
 * `callback_query` updates). Callback queries are answered immediately so
 * Telegram removes the loading indicator on the button.
 */
export class TelegramListener {
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;

  constructor(
    private readonly botToken: string,
    /**
     * Called when a recognised command token is received.
     *
     * For inline keyboard button clicks the optional third argument carries
     * the Telegram operator's identity (user ID, username, first name).
     * For text commands (`/approve TOKEN`) the third argument is absent
     * because the Bot API message object does not expose sender identity in a
     * structured `from` field at this listener level.
     *
     * When the handler returns a non-empty string for a callback_query, that
     * string is used as the alert text shown to the operator (e.g. "Already
     * decided").  Returning `undefined` or `void` sends a silent dismiss.
     */
    private readonly onCommand: (
      command: TelegramCommand,
      token: string,
      from?: TelegramOperatorInfo,
    ) => string | void,
  ) {}

  /** Masked token for safe logging (shows first 8 chars + …). */
  private get maskedToken(): string {
    return this.botToken.length > 8 ? this.botToken.slice(0, 8) + '…' : '***';
  }

  /** Starts the long-polling loop. Safe to call multiple times (no-op if already running). */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[hitl-telegram] listener starting — token=${this.maskedToken}`);
    // Close any in-flight getUpdates from a previous instance before starting.
    // closeOtherSessions terminates all active long-poll connections on Telegram's
    // side, preventing the 409 Conflict that occurs when two pollers race.
    // We then wait 2s for the termination to propagate before polling.
    this.closeOtherSessions().then(() => new Promise(resolve => setTimeout(resolve, 2_000))).then(() => {
      this.poll().catch((err) => {
        if (this.running) {
          console.error('[hitl-telegram] poll loop exited unexpectedly:', err);
        }
      });
      console.log(`[hitl-telegram] listener started — token=${this.maskedToken}`);
    });
  }

  /**
   * Terminates any active getUpdates sessions from previous instances.
   * Calls getUpdates with timeout=0 to take over the session from Telegram,
   * then calls deleteWebhook to clear any stale webhook registration.
   * This is the standard pattern to resolve 409 Conflict on startup.
   */
  private async closeOtherSessions(): Promise<void> {
    try {
      // A timeout=0 getUpdates call immediately terminates any other active
      // long-poll session Telegram has open for this bot token.
      const kickUrl = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=-1&timeout=0&limit=1`;
      const kickRes = await fetch(kickUrl);
      if (kickRes.ok) {
        console.log(`[hitl-telegram] session takeover OK — token=${this.maskedToken}`);
      } else {
        const body = await kickRes.json() as { description?: string };
        console.warn(`[hitl-telegram] session takeover returned ${kickRes.status}: ${body.description ?? ''} — token=${this.maskedToken}`);
      }
    } catch (err) {
      console.warn('[hitl-telegram] session takeover error (non-fatal):', err);
    }
    await this.deleteWebhook();
  }

  /** Attempts to delete any registered webhook before starting long-polling. */
  private async deleteWebhook(): Promise<void> {
    try {
      const res = await fetch(`${TELEGRAM_API}/bot${this.botToken}/deleteWebhook`, { method: 'POST' });
      const body = await res.json() as { ok: boolean; description?: string };
      if (res.ok && body.ok) {
        console.log(`[hitl-telegram] deleteWebhook OK — token=${this.maskedToken}`);
      } else {
        console.warn(`[hitl-telegram] deleteWebhook failed: ${res.status} — ${body.description ?? 'no description'} — token=${this.maskedToken}`);
      }
    } catch (err) {
      console.warn('[hitl-telegram] deleteWebhook error (non-fatal):', err);
    }
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
          console.warn(`[hitl-telegram] getUpdates rate-limited (429) — backing off — token=${this.maskedToken}`);
          await this.delay(POLL_RATE_LIMIT_DELAY_MS);
          continue;
        }

        if (res.status === 409) {
          let description = '';
          try { description = ((await res.json()) as { description?: string }).description ?? ''; } catch { /* ignore */ }
          console.error(`[hitl-telegram] getUpdates conflict (409) — another poller is active — token=${this.maskedToken} — ${description}`);
          await this.delay(POLL_RATE_LIMIT_DELAY_MS); // 30s backoff for conflicts
          continue;
        }

        if (!res.ok) {
          let description = '';
          try { description = ((await res.json()) as { description?: string }).description ?? ''; } catch { /* ignore */ }
          console.error(`[hitl-telegram] getUpdates failed: ${res.status} — ${description} — token=${this.maskedToken}`);
          await this.delay(RETRY_DELAY_MS);
          continue;
        }

        const body = (await res.json()) as {
          ok: boolean;
          result?: Array<{
            update_id: number;
            message?: { text?: string; chat?: { id: number } };
            callback_query?: {
              id: string;
              data?: string;
              from?: { id: number; username?: string; first_name?: string };
            };
          }>;
        };

        if (!body.ok || !body.result) {
          await this.delay(RETRY_DELAY_MS);
          continue;
        }

        for (const update of body.result) {
          this.offset = update.update_id + 1;

          // Handle inline keyboard button clicks (callback_query).
          if (update.callback_query) {
            const { id: queryId, data, from } = update.callback_query;
            if (data) {
              const match = CALLBACK_DATA_RE.exec(data);
              if (match) {
                const command = match[1] as TelegramCommand;
                const token = match[2]!;
                // Capture operator identity from callback_query.from when present.
                const operatorInfo: TelegramOperatorInfo | undefined = from
                  ? {
                      userId: from.id,
                      ...(from.username !== undefined ? { username: from.username } : {}),
                      ...(from.first_name !== undefined ? { firstName: from.first_name } : {}),
                    }
                  : undefined;
                const alertText = operatorInfo !== undefined
                  ? this.onCommand(command, token, operatorInfo)
                  : this.onCommand(command, token);
                void this.answerCallbackQuery(queryId, alertText ?? undefined);
              }
            }
            continue;
          }

          // Handle text commands (/approve TOKEN, /deny TOKEN, /approve_always TOKEN).
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

  /**
   * Answers a Telegram callback query to dismiss the button loading indicator.
   * When `alertText` is provided it is shown as a pop-up alert to the operator
   * (e.g. "Already decided" for duplicate button taps).
   * Fire-and-forget — failure here does not affect the approval flow.
   */
  private async answerCallbackQuery(queryId: string, alertText?: string): Promise<void> {
    try {
      const payload: Record<string, unknown> = { callback_query_id: queryId };
      if (alertText !== undefined && alertText.length > 0) {
        payload['text'] = alertText;
        payload['show_alert'] = true;
      }
      await fetch(`${TELEGRAM_API}/bot${this.botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Best-effort — don't fail the poll loop.
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    });
  }
}

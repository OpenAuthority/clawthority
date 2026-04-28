/**
 * HITL Telegram Buttons — end-to-end workflow tests (T28)
 *
 * Exercises the complete Telegram bot HITL button interaction flow by combining
 * a mocked Telegram Bot API (via globally-stubbed fetch), TelegramListener, and
 * ApprovalManager.  Each test drives the listener with fake getUpdates callback
 * payloads and asserts on approval resolution, API calls, and error handling.
 *
 * Acceptance criteria:
 *   TC-TG-BTN-01  sendApprovalRequest sends MarkdownV2 message with correct inline buttons
 *   TC-TG-BTN-02  Approve Once button resolves approval as 'approved'
 *   TC-TG-BTN-03  Deny button resolves approval as 'denied'
 *   TC-TG-BTN-04  Approve Always button sends confirmation dialog; original stays pending
 *   TC-TG-BTN-05  confirm_approve_always resolves 'approved' and registers session auto-approval
 *   TC-TG-BTN-06  cancel_approve_always leaves original approval pending
 *   TC-TG-BTN-07  answerCallbackQuery is called after every button click
 *   TC-TG-BTN-08  Consumed token click triggers "Already decided" alert via answerCallbackQuery
 *   TC-TG-BTN-09  editMessageDecision uses the message_id returned by sendApprovalRequest
 *
 * References: T28
 * Dependencies: T45
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TelegramListener,
  sendApprovalRequest,
  sendApproveAlwaysConfirmation,
  editMessageDecision,
} from './hitl/telegram.js';
import type { TelegramCommand, TelegramOperatorInfo } from './hitl/telegram.js';
import { ApprovalManager } from './hitl/approval-manager.js';
import { CircuitBreaker } from './hitl/retry.js';
import type { HitlPolicy } from './hitl/types.js';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const BOT_TOKEN = 'test-bot-token';
const CHAT_ID = '42000';
const TG_CONFIG = { botToken: BOT_TOKEN, chatId: CHAT_ID };
const CHANNEL_ID = 'chan-e2e';

const TEST_POLICY: HitlPolicy = {
  name: 'Shell commands',
  actions: ['shell.exec'],
  approval: { channel: 'telegram', timeout: 300, fallback: 'deny' },
};

const OPERATOR = { id: 12345, username: 'testoperator', first_name: 'Test' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCallbackUpdate(
  updateId: number,
  queryId: string,
  data: string,
  from?: { id: number; username?: string; first_name?: string },
): string {
  return JSON.stringify({
    ok: true,
    result: [
      {
        update_id: updateId,
        callback_query: { id: queryId, data, ...(from ? { from } : {}) },
      },
    ],
  });
}

/** Used as the fallback mock response — valid for getUpdates, answerCallbackQuery, sendMessage, etc. */
const EMPTY_UPDATES = JSON.stringify({ ok: true, result: [] });

// ─── TelegramButtonHarness ────────────────────────────────────────────────────

/**
 * Wires TelegramListener to ApprovalManager, mirroring the real HITL dispatcher.
 *
 *  - approve_once            → editMessageDecision + resolveApproval('approved')
 *  - deny                    → editMessageDecision + resolveApproval('denied')
 *  - approve_always          → sendApproveAlwaysConfirmation; original stays pending
 *  - confirm_approve_always  → addSessionAutoApproval + resolveApproval('approved')
 *  - cancel_approve_always   → delete pending confirmation; original stays pending
 *  - already-consumed token  → return 'Already decided' alert text
 */
class TelegramButtonHarness {
  readonly manager: ApprovalManager;
  readonly breaker: CircuitBreaker;

  /**
   * Keyed by approval token.  Stores the derived pattern / originalCommand from
   * an approve_always click plus the optional message_id from sendApprovalRequest.
   */
  private readonly pendingConfirmations = new Map<
    string,
    { pattern: string; originalCommand: string; messageId?: number }
  >();

  private listener: TelegramListener | null = null;

  constructor() {
    this.manager = new ApprovalManager();
    this.breaker = new CircuitBreaker();
  }

  /** Creates a listener wired to this harness's dispatch logic. */
  createListener(): TelegramListener {
    const self = this;
    this.listener = new TelegramListener(BOT_TOKEN, (command, token, from) =>
      self.handleCommand(command, token, from),
    );
    return this.listener;
  }

  stopListener(): void {
    this.listener?.stop();
    this.listener = null;
  }

  /**
   * Pre-populates the message_id for a token so that editMessageDecision
   * receives the correct ID when an approve_once or deny click is processed.
   * Call this after capturing the messageId from sendApprovalRequest.
   */
  storeMessageId(token: string, messageId: number): void {
    const existing = this.pendingConfirmations.get(token);
    if (existing) {
      this.pendingConfirmations.set(token, { ...existing, messageId });
    } else {
      this.pendingConfirmations.set(token, { pattern: '', originalCommand: '', messageId });
    }
  }

  /**
   * Pre-populates a pending Approve Always confirmation.
   * Used in tests that verify confirm_approve_always without first clicking approve_always.
   */
  preloadConfirmation(token: string, pattern: string, originalCommand: string): void {
    this.pendingConfirmations.set(token, { pattern, originalCommand });
  }

  private handleCommand(
    command: TelegramCommand,
    token: string,
    _from?: TelegramOperatorInfo,
  ): string | void {
    if (this.manager.isConsumed(token)) {
      return 'Already decided';
    }

    switch (command) {
      case 'approve_once': {
        const pending = this.manager.getPending(token);
        if (!pending) return 'Already decided';
        const stored = this.pendingConfirmations.get(token);
        void editMessageDecision(TG_CONFIG, {
          messageId: stored?.messageId ?? 0,
          token,
          decision: 'approved',
          toolName: pending.toolName,
        });
        this.manager.resolveApproval(token, 'approved');
        return;
      }
      case 'deny': {
        const pending = this.manager.getPending(token);
        if (!pending) return 'Already decided';
        const stored = this.pendingConfirmations.get(token);
        void editMessageDecision(TG_CONFIG, {
          messageId: stored?.messageId ?? 0,
          token,
          decision: 'denied',
          toolName: pending.toolName,
        });
        this.manager.resolveApproval(token, 'denied');
        return;
      }
      case 'approve_always': {
        const pending = this.manager.getPending(token);
        if (!pending) return 'Already decided';
        const pattern = 'git commit *';
        this.pendingConfirmations.set(token, { pattern, originalCommand: pending.target });
        void sendApproveAlwaysConfirmation(
          TG_CONFIG,
          { token, pattern, originalCommand: pending.target },
          this.breaker,
        );
        return; // original stays pending
      }
      case 'confirm_approve_always': {
        const conf = this.pendingConfirmations.get(token);
        if (!conf) return;
        this.pendingConfirmations.delete(token);
        const pending = this.manager.getPending(token);
        if (pending) {
          this.manager.addSessionAutoApproval(pending.channelId, pending.action_class);
        }
        this.manager.resolveApproval(token, 'approved');
        return;
      }
      case 'cancel_approve_always': {
        this.pendingConfirmations.delete(token);
        return; // original stays pending
      }
    }
  }

  shutdown(): void {
    this.stopListener();
    this.manager.shutdown();
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('HITL Telegram buttons — end-to-end workflow', () => {
  let harness: TelegramButtonHarness;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    harness = new TelegramButtonHarness();
  });

  afterEach(() => {
    harness.shutdown();
    vi.unstubAllGlobals();
  });

  // ── TC-TG-BTN-01 ──────────────────────────────────────────────────────────

  it(
    'TC-TG-BTN-01: sendApprovalRequest sends MarkdownV2 message with Approve Once, Approve Always, and Deny buttons',
    async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response('{"ok":true,"result":{"message_id":100}}', { status: 200 }),
      );

      const result = await sendApprovalRequest(
        TG_CONFIG,
        {
          token: 'tok-btn-01',
          toolName: 'bash',
          agentId: 'agent-btn-01',
          policyName: 'Shell policy',
          timeoutSeconds: 300,
          riskLevel: 'medium',
          explanation: 'Runs a shell command.',
          effects: ['Modifies filesystem'],
          warnings: ['Irreversible'],
        },
        harness.breaker,
      );

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe(100);

      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toContain('/sendMessage');

      const body = JSON.parse(init?.body as string);
      expect(body.parse_mode).toBe('MarkdownV2');
      expect(body.chat_id).toBe(CHAT_ID);
      expect(body.text).toContain('HITL Approval Request');
      expect(body.text).toContain('bash');
      expect(body.text).toContain('300s');
      expect(body.text).toContain('medium');

      const row: Array<{ text: string; callback_data: string }> =
        body.reply_markup.inline_keyboard[0];
      expect(row).toHaveLength(3);
      const callbacks = row.map((b) => b.callback_data);
      expect(callbacks).toContain('approve_once:tok-btn-01');
      expect(callbacks).toContain('approve_always:tok-btn-01');
      expect(callbacks).toContain('deny:tok-btn-01');

      // Button text labels
      const texts = row.map((b) => b.text);
      expect(texts.some((t) => t.includes('Approve Once'))).toBe(true);
      expect(texts.some((t) => t.includes('Approve Always'))).toBe(true);
      expect(texts.some((t) => t.includes('Deny'))).toBe(true);
    },
  );

  // ── TC-TG-BTN-02 ──────────────────────────────────────────────────────────

  it(
    'TC-TG-BTN-02: Approve Once button click resolves approval as "approved"',
    async () => {
      const { token, promise } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-btn-02',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'git commit -m "fix"',
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(makeCallbackUpdate(1, 'qid-02', `approve_once:${token}`, OPERATOR), {
            status: 200,
          }),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      const decision = await promise;
      expect(decision).toBe('approved');
      expect(harness.manager.isConsumed(token)).toBe(true);
    },
  );

  // ── TC-TG-BTN-03 ──────────────────────────────────────────────────────────

  it(
    'TC-TG-BTN-03: Deny button click resolves approval as "denied"',
    async () => {
      const { token, promise } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-btn-03',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'rm -rf /tmp/test',
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(makeCallbackUpdate(2, 'qid-03', `deny:${token}`, OPERATOR), {
            status: 200,
          }),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      const decision = await promise;
      expect(decision).toBe('denied');
      expect(harness.manager.isConsumed(token)).toBe(true);
    },
  );

  // ── TC-TG-BTN-04 ──────────────────────────────────────────────────────────

  it(
    'TC-TG-BTN-04: Approve Always button triggers confirmation dialog; original approval stays pending',
    async () => {
      const { token } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-btn-04',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'git commit -m "initial"',
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(makeCallbackUpdate(3, 'qid-04', `approve_always:${token}`, OPERATOR), {
            status: 200,
          }),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      // Wait for sendApproveAlwaysConfirmation to make its sendMessage call.
      await vi.waitFor(() => {
        const sendMsgCall = vi.mocked(fetch).mock.calls.find((c) =>
          (c[0] as string).includes('sendMessage'),
        );
        expect(sendMsgCall).toBeDefined();
      });

      // Original approval must still be pending — not resolved.
      expect(harness.manager.getPending(token)).toBeDefined();
      expect(harness.manager.isConsumed(token)).toBe(false);

      // Confirm the dialog message contains the derived pattern.
      const sendMsgCall = vi.mocked(fetch).mock.calls.find((c) =>
        (c[0] as string).includes('sendMessage'),
      );
      const body = JSON.parse(sendMsgCall![1]?.body as string);
      expect(body.text).toContain('git commit *');

      // Dialog must have Save and Cancel buttons.
      const row: Array<{ callback_data: string }> = body.reply_markup.inline_keyboard[0];
      const callbacks = row.map((b) => b.callback_data);
      expect(callbacks).toContain(`confirm_approve_always:${token}`);
      expect(callbacks).toContain(`cancel_approve_always:${token}`);
    },
  );

  // ── TC-TG-BTN-05 ──────────────────────────────────────────────────────────

  it(
    'TC-TG-BTN-05: confirm_approve_always resolves approval as "approved" and registers session auto-approval',
    async () => {
      const { token, promise } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-btn-05',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'git commit -m "feat"',
      });

      // Pre-populate confirmation as though approve_always was already clicked.
      harness.preloadConfirmation(token, 'git commit *', 'git commit -m "feat"');

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(
            makeCallbackUpdate(4, 'qid-05', `confirm_approve_always:${token}`, OPERATOR),
            { status: 200 },
          ),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      const decision = await promise;
      expect(decision).toBe('approved');
      expect(harness.manager.isConsumed(token)).toBe(true);

      // Session auto-approval must be registered for the channel + action class.
      expect(harness.manager.isSessionAutoApproved(CHANNEL_ID, 'shell.exec')).toBe(true);
    },
  );

  // ── TC-TG-BTN-06 ──────────────────────────────────────────────────────────

  it(
    'TC-TG-BTN-06: cancel_approve_always leaves original approval pending',
    async () => {
      const { token } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-btn-06',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'git status',
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(
            makeCallbackUpdate(5, 'qid-06', `cancel_approve_always:${token}`, OPERATOR),
            { status: 200 },
          ),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      // Wait for answerCallbackQuery to confirm the command was processed.
      await vi.waitFor(() =>
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(
          expect.stringContaining('answerCallbackQuery'),
          expect.anything(),
        ),
      );

      // Original approval must still be pending.
      expect(harness.manager.getPending(token)).toBeDefined();
      expect(harness.manager.isConsumed(token)).toBe(false);
    },
  );

  // ── TC-TG-BTN-07 ──────────────────────────────────────────────────────────

  it(
    'TC-TG-BTN-07: answerCallbackQuery is called after every button click',
    async () => {
      const { token } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-btn-07',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'ls -la',
      });

      const QUERY_ID = 'qid-answer-07';

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(makeCallbackUpdate(6, QUERY_ID, `approve_once:${token}`, OPERATOR), {
            status: 200,
          }),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      await vi.waitFor(() =>
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(
          expect.stringContaining('answerCallbackQuery'),
          expect.anything(),
        ),
      );

      const answerCall = vi.mocked(fetch).mock.calls.find((c) =>
        (c[0] as string).includes('answerCallbackQuery'),
      );
      expect(answerCall).toBeDefined();
      const answerBody = JSON.parse(answerCall![1]?.body as string);
      expect(answerBody.callback_query_id).toBe(QUERY_ID);
    },
  );

  // ── TC-TG-BTN-08 ──────────────────────────────────────────────────────────

  it(
    'TC-TG-BTN-08: clicking a button for an already-consumed token returns "Already decided" alert via answerCallbackQuery',
    async () => {
      const { token } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-btn-08',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'echo hello',
      });

      // Pre-resolve so the token is in the consumed set.
      harness.manager.resolveApproval(token, 'approved');
      expect(harness.manager.isConsumed(token)).toBe(true);

      const QUERY_ID = 'qid-expired-08';

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(makeCallbackUpdate(7, QUERY_ID, `approve_once:${token}`, OPERATOR), {
            status: 200,
          }),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      await vi.waitFor(() =>
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(
          expect.stringContaining('answerCallbackQuery'),
          expect.anything(),
        ),
      );

      const answerCall = vi.mocked(fetch).mock.calls.find((c) =>
        (c[0] as string).includes('answerCallbackQuery'),
      );
      expect(answerCall).toBeDefined();
      const answerBody = JSON.parse(answerCall![1]?.body as string);
      expect(answerBody.callback_query_id).toBe(QUERY_ID);
      expect(answerBody.text).toBe('Already decided');
      expect(answerBody.show_alert).toBe(true);
    },
  );

  // ── TC-TG-BTN-09 ──────────────────────────────────────────────────────────

  it(
    'TC-TG-BTN-09: editMessageDecision uses the message_id returned by sendApprovalRequest',
    async () => {
      const MESSAGE_ID = 555;

      const { token } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-btn-09',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'git push',
      });

      // Store the message_id as though it was captured from a prior sendApprovalRequest call.
      harness.storeMessageId(token, MESSAGE_ID);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(makeCallbackUpdate(8, 'qid-09', `approve_once:${token}`, OPERATOR), {
            status: 200,
          }),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      // Wait for editMessageText to be called.
      await vi.waitFor(() =>
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(
          expect.stringContaining('editMessageText'),
          expect.anything(),
        ),
      );

      const editCall = vi.mocked(fetch).mock.calls.find((c) =>
        (c[0] as string).includes('editMessageText'),
      );
      expect(editCall).toBeDefined();
      const editBody = JSON.parse(editCall![1]?.body as string);
      expect(editBody.message_id).toBe(MESSAGE_ID);
      expect(editBody.chat_id).toBe(CHAT_ID);
      expect(editBody.text).toContain('APPROVED');
    },
  );
});

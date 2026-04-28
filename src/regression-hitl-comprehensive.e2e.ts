/**
 * Comprehensive HITL E2E regression test — T3, T8
 *
 * Full integration test of the HITL flow covering all three button outcomes
 * (Approve Once, Approve Always, Deny) with simulated Telegram interactions,
 * auto-permit persistence verification, message update validation, concurrent
 * request handling, and regression coverage for the text command fallback.
 *
 * All external network calls are intercepted via a globally-stubbed fetch so
 * tests run deterministically in CI without a real Telegram bot.
 *
 * Acceptance criteria:
 *   TC-HITL-REG-01  Approve Once: resolves 'approved', edits message, no rule persisted
 *   TC-HITL-REG-02  Approve Always: full flow — button → confirm → pattern derivation → store persistence → bypass
 *   TC-HITL-REG-03  Deny: resolves 'denied', edits message with DENIED status
 *   TC-HITL-REG-04  Auto-permit persistence: file rule survives process restart simulation
 *   TC-HITL-REG-05  Concurrent requests: two simultaneous requests resolved independently
 *   TC-HITL-REG-06  Text command fallback: /approve and /deny text commands resolve pending approvals
 *   TC-HITL-REG-07  Message update validation: editMessageDecision uses correct message_id and text
 *   TC-HITL-REG-08  Auto-permit rule integrity: stored rule has valid SHA-256 checksum after Approve Always
 *
 * References: T3, T8
 * Dependencies: TC-TG-BTN-01…09, TC-AA-E2E-01…06
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
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
import { derivePattern } from './auto-permits/pattern-derivation.js';
import {
  loadAutoPermitRulesFromFile,
  saveAutoPermitRules,
} from './auto-permits/store.js';
import { FileAutoPermitChecker } from './auto-permits/matcher.js';
import type { AutoPermit } from './models/auto-permit.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BOT_TOKEN = 'regression-bot-token';
const CHAT_ID = '99001';
const TG_CONFIG = { botToken: BOT_TOKEN, chatId: CHAT_ID };
const CHANNEL_ID = 'chan-hitl-regression';

const TEST_POLICY: HitlPolicy = {
  name: 'regression-policy',
  actions: ['shell.exec'],
  approval: { channel: 'telegram', timeout: 300, fallback: 'deny' },
};

const OPERATOR = { id: 55001, username: 'regressor', first_name: 'Reg' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const id = randomBytes(6).toString('hex');
  return join(tmpdir(), `hitl-reg-e2e-${id}`);
}

function storePathFor(dir: string): string {
  return join(dir, 'auto-permits.json');
}

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

function makeCallbackBatch(
  updates: Array<{ updateId: number; queryId: string; data: string }>,
  from?: { id: number; username?: string; first_name?: string },
): string {
  return JSON.stringify({
    ok: true,
    result: updates.map(({ updateId, queryId, data }) => ({
      update_id: updateId,
      callback_query: { id: queryId, data, ...(from ? { from } : {}) },
    })),
  });
}

function makeTextUpdate(updateId: number, text: string): string {
  return JSON.stringify({
    ok: true,
    result: [
      {
        update_id: updateId,
        message: { text },
      },
    ],
  });
}

const EMPTY_UPDATES = JSON.stringify({ ok: true, result: [] });

/**
 * Returns a mock implementation factory that creates a fresh Response(EMPTY_UPDATES) for
 * every call AND introduces a 1 ms macrotask delay via setTimeout.
 *
 * Two problems are solved together:
 *  1. A Response body can only be consumed once.  Reusing the same object via
 *     `mockResolvedValue(new Response(...))` causes "Body is unusable" errors on the second
 *     getUpdates call, which triggers the poll loop's 5 s retry and causes timeouts.
 *  2. Resolving fetch with `Promise.resolve()` (a microtask) keeps the event loop in a
 *     continuous microtask burst, starving macrotasks like vi.waitFor's setTimeout checks
 *     and eventually crashing V8 through heap exhaustion.  A 1 ms setTimeout yields to
 *     the macrotask queue between each poll iteration.
 *
 * Use this as `.mockImplementation(emptyUpdatesImpl())` only in tests that need the poll
 * loop to make more than one getUpdates call (i.e. multi-step Approve Always flows).
 */
function emptyUpdatesImpl(): () => Promise<Response> {
  return () =>
    new Promise<Response>((resolve) => {
      const t = setTimeout(() => resolve(new Response(EMPTY_UPDATES, { status: 200 })), 1);
      // Prevent the timer from keeping the process alive after the test ends.
      if (typeof t === 'object' && 'unref' in t) (t as NodeJS.Timeout).unref();
    });
}

// ─── ComprehensiveHitlHarness ──────────────────────────────────────────────────

/**
 * Combines TelegramListener + ApprovalManager + auto-permit persistence into a
 * single test harness for comprehensive HITL regression testing.
 *
 * Wires all Telegram button outcomes and text commands:
 *  - approve_once           → editMessageDecision + resolveApproval('approved')
 *  - deny                   → editMessageDecision + resolveApproval('denied')
 *  - approve_always         → derivePattern + sendApproveAlwaysConfirmation; original stays pending
 *  - confirm_approve_always → save rule to store + addSessionAutoApproval + resolveApproval('approved')
 *  - cancel_approve_always  → delete pending confirmation; original stays pending
 *  - approve (text cmd)     → resolveApproval('approved')
 *  - consumed token         → returns 'Already decided' alert
 */
class ComprehensiveHitlHarness {
  readonly manager: ApprovalManager;
  readonly breaker: CircuitBreaker;

  /**
   * Keyed by approval token.  Stores derived pattern + optional messageId
   * after an approve_always click so confirm_approve_always can find them.
   */
  private readonly pendingConfirmations = new Map<
    string,
    { pattern: string; originalCommand: string; messageId?: number }
  >();

  /**
   * Promise tracking the most recent auto-permit file save triggered by
   * confirm_approve_always.  Await via `waitForSave()` before asserting
   * on-disk state.
   */
  private _lastSavePromise: Promise<void> = Promise.resolve();

  /** Path to the auto-permit store file. Set via setStorePath(). */
  private storePath: string | null = null;

  private listener: TelegramListener | null = null;

  constructor() {
    this.manager = new ApprovalManager();
    this.breaker = new CircuitBreaker();
  }

  /** Configures the store path for auto-permit file persistence. */
  setStorePath(path: string): void {
    this.storePath = path;
  }

  /** Creates and wires a TelegramListener to this harness's dispatch logic. */
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
   * Call this after capturing messageId from sendApprovalRequest.
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
   * Awaits the most recent auto-permit file save triggered by
   * confirm_approve_always.  Must be called after awaiting the decision promise.
   */
  waitForSave(): Promise<void> {
    return this._lastSavePromise;
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
        // Derive pattern from the actual command (pending.target).
        const derived = derivePattern({ command: pending.target });
        this.pendingConfirmations.set(token, {
          pattern: derived.pattern,
          originalCommand: pending.target,
        });
        void sendApproveAlwaysConfirmation(
          TG_CONFIG,
          { token, pattern: derived.pattern, originalCommand: pending.target },
          this.breaker,
        );
        return; // original approval stays pending
      }

      case 'confirm_approve_always': {
        const conf = this.pendingConfirmations.get(token);
        if (!conf) return;
        this.pendingConfirmations.delete(token);
        const pending = this.manager.getPending(token);
        if (pending) {
          this.manager.addSessionAutoApproval(pending.channelId, pending.action_class);
        }
        // Persist rule to file store when storePath is configured.
        if (this.storePath !== null) {
          const storePath = this.storePath;
          const now = Date.now();
          const newRule: AutoPermit = {
            pattern: conf.pattern,
            method: 'default',
            createdAt: now,
            originalCommand: conf.originalCommand,
            created_by: CHANNEL_ID,
            created_at: new Date(now).toISOString(),
            derived_from: conf.originalCommand,
          };
          this._lastSavePromise = (async () => {
            const existing = await loadAutoPermitRulesFromFile(storePath);
            await saveAutoPermitRules(
              storePath,
              [...existing.rules, newRule],
              existing.version + 1,
            );
          })();
        }
        this.manager.resolveApproval(token, 'approved');
        return;
      }

      case 'cancel_approve_always': {
        this.pendingConfirmations.delete(token);
        return; // original approval stays pending
      }

      case 'approve': {
        // Text-command fallback: /approve TOKEN
        this.manager.resolveApproval(token, 'approved');
        return;
      }
    }
  }

  shutdown(): void {
    this.stopListener();
    this.manager.shutdown();
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('HITL comprehensive E2E regression', () => {
  let harness: ComprehensiveHitlHarness;
  let tmpDir: string;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    harness = new ComprehensiveHitlHarness();
    tmpDir = makeTmpDir();
  });

  afterEach(async () => {
    harness.shutdown();
    vi.unstubAllGlobals();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── TC-HITL-REG-01 ──────────────────────────────────────────────────────────

  it(
    'TC-HITL-REG-01: Approve Once resolves approval as "approved" and does not save an auto-permit rule',
    async () => {
      const MESSAGE_ID = 201;

      const { token, promise } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-reg-01',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'ls -la /workspace',
      });
      harness.storeMessageId(token, MESSAGE_ID);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(makeCallbackUpdate(10, 'qid-reg-01', `approve_once:${token}`, OPERATOR), {
            status: 200,
          }),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      const decision = await promise;
      expect(decision).toBe('approved');
      expect(harness.manager.isConsumed(token)).toBe(true);

      // No auto-permit rule should be saved when only "Approve Once" is clicked.
      const storePath = storePathFor(tmpDir);
      const stored = await loadAutoPermitRulesFromFile(storePath);
      expect(stored.found).toBe(false);
      expect(stored.rules).toHaveLength(0);
    },
  );

  // ── TC-HITL-REG-02 ──────────────────────────────────────────────────────────

  it(
    'TC-HITL-REG-02: Approve Always full flow — button → confirm → pattern derivation → store persistence → subsequent bypass',
    async () => {
      const storePath = storePathFor(tmpDir);
      harness.setStorePath(storePath);

      const COMMAND = 'git commit -m "feat: add login"';

      const { token, promise } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-reg-02',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: COMMAND,
      });

      // Step 1: inject approve_always callback; use mockImplementation so subsequent
      // poll iterations each receive a FRESH Response (a Response body can only be
      // consumed once — reusing the same object causes "Body is unusable" errors on
      // the second getUpdates call in the same test, which triggers the 5s retry).
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(
            makeCallbackUpdate(20, 'qid-reg-02a', `approve_always:${token}`, OPERATOR),
            { status: 200 },
          ),
        )
        .mockImplementation(emptyUpdatesImpl());

      const listener = harness.createListener();
      listener.start();

      // Wait for sendApproveAlwaysConfirmation to issue a sendMessage call.
      await vi.waitFor(() => {
        const call = vi.mocked(fetch).mock.calls.find((c) =>
          (c[0] as string).includes('sendMessage'),
        );
        expect(call).toBeDefined();
      });

      // Original approval must remain pending while the confirm dialog is shown.
      expect(harness.manager.getPending(token)).toBeDefined();
      expect(harness.manager.isConsumed(token)).toBe(false);

      // Verify the confirmation message contains the derived pattern.
      const sendMsgCall = vi.mocked(fetch).mock.calls.find((c) =>
        (c[0] as string).includes('sendMessage'),
      );
      const sendMsgBody = JSON.parse(sendMsgCall![1]?.body as string);
      expect(sendMsgBody.text).toContain('git commit *');

      // Confirm dialog must offer Save and Cancel buttons with the correct token.
      const confirmRow: Array<{ callback_data: string }> =
        sendMsgBody.reply_markup.inline_keyboard[0];
      const confirmCallbacks = confirmRow.map((b) => b.callback_data);
      expect(confirmCallbacks).toContain(`confirm_approve_always:${token}`);
      expect(confirmCallbacks).toContain(`cancel_approve_always:${token}`);

      // Step 2: inject confirm_approve_always callback so the listener processes it.
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          makeCallbackUpdate(21, 'qid-reg-02b', `confirm_approve_always:${token}`, OPERATOR),
          { status: 200 },
        ),
      );

      // Await final decision.
      const decision = await promise;
      expect(decision).toBe('approved');
      expect(harness.manager.isConsumed(token)).toBe(true);

      // Session auto-approval must be registered for the channel + action class.
      expect(harness.manager.isSessionAutoApproved(CHANNEL_ID, 'shell.exec')).toBe(true);

      // Wait for the async file save to complete before asserting on-disk state.
      await harness.waitForSave();

      // Verify rule persisted on disk.
      const loaded = await loadAutoPermitRulesFromFile(storePath);
      expect(loaded.found).toBe(true);
      expect(loaded.rules).toHaveLength(1);
      // Pattern derived from 'git commit -m "feat: add login"' should be 'git commit *'.
      expect(loaded.rules[0]!.pattern).toBe('git commit *');
      expect(loaded.rules[0]!.method).toBe('default');
      expect(loaded.rules[0]!.originalCommand).toBe(COMMAND);
      expect(loaded.validationErrors).toHaveLength(0);

      // Step 3: verify subsequent matching commands bypass via the stored rule.
      const checker = new FileAutoPermitChecker(loaded.rules);
      expect(checker.matchCommand('git commit -m "fix: bug"')).not.toBeNull();
      expect(checker.matchCommand('git commit --amend')).not.toBeNull();

      // Non-matching command must not match.
      expect(checker.matchCommand('git push origin main')).toBeNull();
    },
    10_000,
  );

  // ── TC-HITL-REG-03 ──────────────────────────────────────────────────────────

  it(
    'TC-HITL-REG-03: Deny button resolves approval as "denied" and edits message with DENIED status',
    async () => {
      const MESSAGE_ID = 303;

      const { token, promise } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-reg-03',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'rm -rf /tmp/cache',
      });
      harness.storeMessageId(token, MESSAGE_ID);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(makeCallbackUpdate(30, 'qid-reg-03', `deny:${token}`, OPERATOR), {
            status: 200,
          }),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      const decision = await promise;
      expect(decision).toBe('denied');
      expect(harness.manager.isConsumed(token)).toBe(true);

      // Wait for editMessageText to confirm the message was updated.
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
      expect(editBody.text).toContain('DENIED');
    },
  );

  // ── TC-HITL-REG-04 ──────────────────────────────────────────────────────────

  it(
    'TC-HITL-REG-04: auto-permit file rule survives process restart simulation (store reload)',
    async () => {
      const storePath = storePathFor(tmpDir);

      // Simulate a rule saved during a previous session.
      const previousRule: AutoPermit = {
        pattern: 'npm run *',
        method: 'default',
        createdAt: Date.now() - 120_000,
        originalCommand: 'npm run build',
        created_by: 'telegram',
        created_at: new Date(Date.now() - 120_000).toISOString(),
      };
      await saveAutoPermitRules(storePath, [previousRule], 1);

      // Simulate process restart: create a fresh harness (all in-memory state cleared).
      const freshHarness = new ComprehensiveHitlHarness();
      try {
        const loaded = await loadAutoPermitRulesFromFile(storePath);
        expect(loaded.found).toBe(true);
        expect(loaded.version).toBe(1);
        expect(loaded.rules).toHaveLength(1);
        expect(loaded.rules[0]!.pattern).toBe('npm run *');
        expect(loaded.validationErrors).toHaveLength(0);

        // Checker built from reloaded rules must match npm run commands.
        const checker = new FileAutoPermitChecker(loaded.rules);
        expect(checker.matchCommand('npm run test')).not.toBeNull();
        expect(checker.matchCommand('npm run lint')).not.toBeNull();
        expect(checker.matchCommand('npm run build')).not.toBeNull();

        // Unrelated commands must not match.
        expect(checker.matchCommand('npm install')).toBeNull();
        expect(checker.matchCommand('yarn run test')).toBeNull();
        expect(checker.matchCommand('node scripts/start.js')).toBeNull();
      } finally {
        freshHarness.shutdown();
      }
    },
  );

  // ── TC-HITL-REG-05 ──────────────────────────────────────────────────────────

  it(
    'TC-HITL-REG-05: concurrent requests — approve first, deny second; each resolves independently',
    async () => {
      const { token: token1, promise: promise1 } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-reg-05a',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'git push origin release',
      });

      const { token: token2, promise: promise2 } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-reg-05b',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'rm -rf /var/log/old',
      });

      expect(harness.manager.size).toBe(2);

      // Deliver both callback updates in a single getUpdates response so the
      // poll loop processes them atomically without answerCallbackQuery racing
      // for the second mockResolvedValueOnce slot.
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(
            makeCallbackBatch(
              [
                { updateId: 50, queryId: 'qid-reg-05a', data: `approve_once:${token1}` },
                { updateId: 51, queryId: 'qid-reg-05b', data: `deny:${token2}` },
              ],
              OPERATOR,
            ),
            { status: 200 },
          ),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      const [decision1, decision2] = await Promise.all([promise1, promise2]);

      expect(decision1).toBe('approved');
      expect(decision2).toBe('denied');

      expect(harness.manager.isConsumed(token1)).toBe(true);
      expect(harness.manager.isConsumed(token2)).toBe(true);
      expect(harness.manager.size).toBe(0);
    },
  );

  // ── TC-HITL-REG-06 ──────────────────────────────────────────────────────────

  it(
    'TC-HITL-REG-06: text command fallback — /approve and /deny text commands resolve pending approvals',
    async () => {
      // Sub-test A: /approve TOKEN text command.
      const { token: tokenA, promise: promiseA } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-reg-06a',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'git pull origin main',
      });

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(makeTextUpdate(60, `/approve ${tokenA}`), { status: 200 }),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listenerA = harness.createListener();
      listenerA.start();

      const decisionA = await promiseA;
      expect(decisionA).toBe('approved');
      expect(harness.manager.isConsumed(tokenA)).toBe(true);

      harness.stopListener();

      // Sub-test B: /deny TOKEN text command.
      const { token: tokenB, promise: promiseB } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-reg-06b',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: 'deploy.sh --env prod',
      });

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(makeTextUpdate(61, `/deny ${tokenB}`), { status: 200 }),
      );

      const listenerB = harness.createListener();
      listenerB.start();

      const decisionB = await promiseB;
      expect(decisionB).toBe('denied');
      expect(harness.manager.isConsumed(tokenB)).toBe(true);
    },
  );

  // ── TC-HITL-REG-07 ──────────────────────────────────────────────────────────

  it(
    'TC-HITL-REG-07: message update validation — editMessageDecision uses correct message_id, text, chat_id, and parse_mode',
    async () => {
      const MESSAGE_ID = 707;

      // First, capture messageId from sendApprovalRequest as the real dispatcher would.
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(`{"ok":true,"result":{"message_id":${MESSAGE_ID}}}`, { status: 200 }),
      );

      const sendResult = await sendApprovalRequest(
        TG_CONFIG,
        {
          token: 'tok-reg-07',
          toolName: 'write_file',
          agentId: 'agent-reg-07',
          policyName: 'File write policy',
          timeoutSeconds: 60,
          riskLevel: 'high',
          explanation: 'Write configuration file to /etc.',
          effects: ['Overwrites /etc/app.conf'],
          warnings: ['System restart required'],
        },
        harness.breaker,
      );

      expect(sendResult.ok).toBe(true);
      expect(sendResult.messageId).toBe(MESSAGE_ID);

      // Now simulate the button click using the captured messageId.
      const { token, promise } = harness.manager.createApprovalRequest({
        toolName: 'write_file',
        agentId: 'agent-reg-07',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: '/etc/app.conf',
      });
      harness.storeMessageId(token, MESSAGE_ID);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(makeCallbackUpdate(70, 'qid-reg-07', `approve_once:${token}`, OPERATOR), {
            status: 200,
          }),
        )
        .mockResolvedValue(new Response(EMPTY_UPDATES, { status: 200 }));

      const listener = harness.createListener();
      listener.start();

      await promise;

      // Wait for editMessageText call to confirm message was updated.
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

      // All critical editMessageText payload fields must be correct.
      expect(editBody.message_id).toBe(MESSAGE_ID);
      expect(editBody.chat_id).toBe(CHAT_ID);
      expect(editBody.text).toContain('APPROVED');
      expect(editBody.parse_mode).toBe('MarkdownV2');
      // Inline keyboard must be absent — editMessageDecision removes the buttons.
      expect(editBody.reply_markup).toBeUndefined();
    },
  );

  // ── TC-HITL-REG-08 ──────────────────────────────────────────────────────────

  it(
    'TC-HITL-REG-08: auto-permit rule integrity — stored rule has valid SHA-256 checksum after Approve Always',
    async () => {
      const storePath = storePathFor(tmpDir);
      harness.setStorePath(storePath);

      const COMMAND = 'docker build -t app:latest .';

      const { token, promise } = harness.manager.createApprovalRequest({
        toolName: 'bash',
        agentId: 'agent-reg-08',
        channelId: CHANNEL_ID,
        policy: TEST_POLICY,
        action_class: 'shell.exec',
        target: COMMAND,
      });

      // Step 1: approve_always click.  Use mockImplementation so each subsequent
      // getUpdates poll iteration creates a fresh Response (same fix as TC-HITL-REG-02).
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(
            makeCallbackUpdate(80, 'qid-reg-08a', `approve_always:${token}`, OPERATOR),
            { status: 200 },
          ),
        )
        .mockImplementation(emptyUpdatesImpl());

      const listener = harness.createListener();
      listener.start();

      // Wait for sendApproveAlwaysConfirmation sendMessage call.
      await vi.waitFor(() => {
        const call = vi.mocked(fetch).mock.calls.find((c) =>
          (c[0] as string).includes('sendMessage'),
        );
        expect(call).toBeDefined();
      });

      // Step 2: inject confirm_approve_always callback.
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          makeCallbackUpdate(81, 'qid-reg-08b', `confirm_approve_always:${token}`, OPERATOR),
          { status: 200 },
        ),
      );

      await promise;
      await harness.waitForSave();

      // Load the file and verify checksum integrity.
      const loaded = await loadAutoPermitRulesFromFile(storePath);
      expect(loaded.found).toBe(true);
      expect(loaded.rules).toHaveLength(1);
      // No validation errors means the stored checksum matched on reload.
      expect(loaded.validationErrors).toHaveLength(0);

      // Manually verify the checksum matches SHA-256(JSON.stringify(rules)).
      const expectedChecksum = createHash('sha256')
        .update(JSON.stringify(loaded.rules))
        .digest('hex');
      expect(loaded.checksum).toBe(expectedChecksum);

      // Pattern derived from 'docker build -t app:latest .' should be 'docker build *'.
      expect(loaded.rules[0]!.pattern).toBe('docker build *');
      expect(loaded.rules[0]!.originalCommand).toBe(COMMAND);
    },
    10_000,
  );
});

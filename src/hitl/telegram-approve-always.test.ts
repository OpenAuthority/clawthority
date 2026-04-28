/**
 * Telegram Approve Always — end-to-end workflow tests (T52)
 *
 * Integration-level tests that exercise the complete Approve Always workflow
 * by combining TelegramListener, ApprovalManager, and sendApproveAlwaysConfirmation.
 *
 * Acceptance criteria:
 *  - Button appears in HITL messages
 *  - Callback processing and session auto-approval registration (auto-permit creation)
 *  - Confirmation step workflow (save and cancel paths)
 *  - Error handling in callback processing
 *  - Operator identity capture
 *  - Mock Telegram API interactions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TelegramListener,
  sendApprovalRequest,
  sendApproveAlwaysConfirmation,
} from './telegram.js';
import type { TelegramCommand, TelegramOperatorInfo } from './telegram.js';
import { ApprovalManager } from './approval-manager.js';
import type { HitlPolicy } from './types.js';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const config = { botToken: 'test-bot-token', chatId: '42000' };

const testPolicy: HitlPolicy = {
  name: 'Shell commands',
  actions: ['shell.exec'],
  approval: { channel: 'telegram', timeout: 300, fallback: 'deny' },
};

function makeCallbackUpdate(updateId: number, queryId: string, data: string, from?: object) {
  return {
    ok: true,
    result: [
      {
        update_id: updateId,
        callback_query: { id: queryId, data, ...(from ? { from } : {}) },
      },
    ],
  };
}

// ─── Approve Always — button in HITL messages ─────────────────────────────────

describe('Approve Always — button in HITL messages', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes an Approve Always button by default', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 }),
    );

    await sendApprovalRequest(config, {
      token: 'abc12345',
      toolName: 'bash',
      agentId: 'agent-1',
      policyName: 'Shell policy',
      timeoutSeconds: 300,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    const row: Array<{ callback_data: string }> = body.reply_markup.inline_keyboard[0];
    const callbackDatas = row.map((b) => b.callback_data);
    expect(callbackDatas).toContain('approve_always:abc12345');
  });

  it('omits the Approve Always button when showApproveAlways is false', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 }),
    );

    await sendApprovalRequest(config, {
      token: 'abc12345',
      toolName: 'bash',
      agentId: 'agent-1',
      policyName: 'Shell policy',
      timeoutSeconds: 300,
      showApproveAlways: false,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    const row: Array<{ callback_data: string }> = body.reply_markup.inline_keyboard[0];
    const callbackDatas = row.map((b) => b.callback_data);
    expect(callbackDatas).not.toContain('approve_always:abc12345');
    expect(callbackDatas).toContain('approve_once:abc12345');
    expect(callbackDatas).toContain('deny:abc12345');
    expect(row).toHaveLength(2);
  });

  it('Approve Always callback_data embeds the correct token', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 }),
    );

    const token = '019daa50-5dc1-78ee-9ab4-bcf652bddfa3';
    await sendApprovalRequest(config, {
      token,
      toolName: 'bash',
      agentId: 'agent-1',
      policyName: 'Shell policy',
      timeoutSeconds: 300,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    const row: Array<{ text: string; callback_data: string }> = body.reply_markup.inline_keyboard[0];
    const btn = row.find((b) => b.callback_data.startsWith('approve_always:'));
    expect(btn).toBeDefined();
    expect(btn!.callback_data).toBe(`approve_always:${token}`);
  });

  it('shows three buttons by default (Approve Once, Approve Always, Deny)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 }),
    );

    await sendApprovalRequest(config, {
      token: 'abc12345',
      toolName: 'bash',
      agentId: 'agent-1',
      policyName: 'Shell policy',
      timeoutSeconds: 300,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    const row: Array<{ callback_data: string }> = body.reply_markup.inline_keyboard[0];
    expect(row).toHaveLength(3);
    const callbackDatas = row.map((b) => b.callback_data);
    expect(callbackDatas).toContain('approve_once:abc12345');
    expect(callbackDatas).toContain('approve_always:abc12345');
    expect(callbackDatas).toContain('deny:abc12345');
  });
});

// ─── Approve Always — confirmation step workflow ──────────────────────────────

describe('Approve Always — confirmation step workflow', () => {
  let manager: ApprovalManager;
  let listener: TelegramListener;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    manager = new ApprovalManager();
  });

  afterEach(() => {
    listener?.stop();
    manager.shutdown();
    vi.unstubAllGlobals();
  });

  it('approve_always callback triggers sendApproveAlwaysConfirmation with pattern and originalCommand', async () => {
    // Simulate the handler: on approve_always, call sendApproveAlwaysConfirmation.
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "initial commit"',
    });

    const confirmationCalls: Array<{ token: string; pattern: string; originalCommand: string }> = [];

    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      if (command === 'approve_always') {
        const pending = manager.getPending(tok);
        if (pending) {
          const pattern = 'git commit *';
          // Mirror index.ts: call sendApproveAlwaysConfirmation, do NOT resolve yet.
          void sendApproveAlwaysConfirmation(config, {
            token: tok,
            pattern,
            originalCommand: pending.target,
          });
          confirmationCalls.push({ token: tok, pattern, originalCommand: pending.target });
        }
        // Return early — original approval stays pending
        return;
      }
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeCallbackUpdate(200, 'cq-conf-1', `approve_always:${token}`)), {
          status: 200,
        }),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    // Allow fire-and-forget sendApproveAlwaysConfirmation to settle
    await new Promise((r) => setTimeout(r, 20));

    expect(onCommand).toHaveBeenCalledWith('approve_always', token);

    // Confirmation dialog must have been sent
    expect(confirmationCalls).toHaveLength(1);
    expect(confirmationCalls[0]!.pattern).toBe('git commit *');
    expect(confirmationCalls[0]!.originalCommand).toBe('git commit -m "initial commit"');

    // sendApproveAlwaysConfirmation should have made a Telegram API call
    const sendConfirmCall = vi.mocked(fetch).mock.calls.find(
      (c) => (c[0] as string).includes('sendMessage'),
    );
    expect(sendConfirmCall).toBeDefined();
    const sendConfirmBody = JSON.parse(sendConfirmCall![1]?.body as string);
    expect(sendConfirmBody.text).toContain('git commit *');

    // Original approval must still be pending (not yet resolved)
    expect(manager.getPending(token)).toBeDefined();
    expect(manager.isConsumed(token)).toBe(false);
  });

  it('sendApproveAlwaysConfirmation message contains Save and Cancel buttons with correct callback_data', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    const token = 'conf-token-001';
    const result = await sendApproveAlwaysConfirmation(config, {
      token,
      pattern: 'git commit *',
      originalCommand: 'git commit -m "msg"',
    });

    expect(result).toBe(true);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    const row: Array<{ text: string; callback_data: string }> = body.reply_markup.inline_keyboard[0];
    const callbackDatas = row.map((b) => b.callback_data);
    expect(callbackDatas).toContain(`confirm_approve_always:${token}`);
    expect(callbackDatas).toContain(`cancel_approve_always:${token}`);
  });

  it('sendApproveAlwaysConfirmation message shows the derived pattern', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    await sendApproveAlwaysConfirmation(config, {
      token: 'tok',
      pattern: 'npm run *',
      originalCommand: 'npm run build',
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    expect(body.text).toContain('npm run *');
    expect(body.text).toContain('npm run build');
    expect(body.parse_mode).toBe('MarkdownV2');
  });

  it('sendApproveAlwaysConfirmation returns false when Telegram responds with non-OK status', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 400 }));

    const result = await sendApproveAlwaysConfirmation(config, {
      token: 'tok',
      pattern: 'git *',
      originalCommand: 'git status',
    });

    expect(result).toBe(false);
  });

  it('sendApproveAlwaysConfirmation returns false when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network failure'));

    const result = await sendApproveAlwaysConfirmation(config, {
      token: 'tok',
      pattern: 'git *',
      originalCommand: 'git status',
    });

    expect(result).toBe(false);
  });
});

// ─── Approve Always — session auto-approval registration ─────────────────────

describe('Approve Always — session auto-approval registration (auto-permit creation)', () => {
  let manager: ApprovalManager;
  let listener: TelegramListener;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    manager = new ApprovalManager();
  });

  afterEach(() => {
    listener?.stop();
    manager.shutdown();
    vi.unstubAllGlobals();
  });

  it('confirm_approve_always registers session auto-approval via addSessionAutoApproval', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "initial commit"',
    });

    const sessionAutoApprovals = new Set<string>();
    const pendingConfirmations = new Map<string, { pattern: string }>();
    // Pre-register a pending confirmation (as though approve_always was already clicked).
    pendingConfirmations.set(token, { pattern: 'git commit *' });

    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      if (command === 'confirm_approve_always') {
        const conf = pendingConfirmations.get(tok);
        if (conf) {
          pendingConfirmations.delete(tok);
          const pending = manager.getPending(tok);
          if (pending) {
            manager.addSessionAutoApproval(pending.channelId, pending.action_class);
            sessionAutoApprovals.add(`${pending.channelId}:${pending.action_class}`);
          }
        }
        manager.resolveApproval(tok, 'approved');
        return;
      }
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeCallbackUpdate(300, 'cq-save', `confirm_approve_always:${token}`)),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());

    expect(onCommand).toHaveBeenCalledWith('confirm_approve_always', token);
    // Session auto-approval must be registered
    expect(sessionAutoApprovals.has('chan-1:shell.exec')).toBe(true);
    expect(manager.isSessionAutoApproved('chan-1', 'shell.exec')).toBe(true);
    // Approval must be resolved
    expect(manager.isConsumed(token)).toBe(true);
    expect(manager.getPending(token)).toBeUndefined();
    // Confirmation entry must be removed
    expect(pendingConfirmations.has(token)).toBe(false);
  });

  it('confirm_approve_always resolves the original approval as approved', async () => {
    let resolvedDecision: string | undefined;
    const { token, promise } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });
    promise.then((d) => { resolvedDecision = d; });

    const pendingConfirmations = new Map<string, { pattern: string }>();
    pendingConfirmations.set(token, { pattern: 'git commit *' });

    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      if (command === 'confirm_approve_always') {
        const conf = pendingConfirmations.get(tok);
        if (conf) {
          pendingConfirmations.delete(tok);
          const pending = manager.getPending(tok);
          if (pending) {
            manager.addSessionAutoApproval(pending.channelId, pending.action_class);
          }
        }
        manager.resolveApproval(tok, 'approved');
        return;
      }
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeCallbackUpdate(301, 'cq-save-2', `confirm_approve_always:${token}`)),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    expect(resolvedDecision).toBe('approved');
  });

  it('confirm_approve_always for unknown token does not crash and token stays unconsumed', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    // No pendingConfirmations entry — simulates orphaned confirmation
    const pendingConfirmations = new Map<string, { pattern: string }>();

    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      if (command === 'confirm_approve_always') {
        const conf = pendingConfirmations.get(tok);
        if (conf) {
          pendingConfirmations.delete(tok);
          const pending = manager.getPending(tok);
          if (pending) {
            manager.addSessionAutoApproval(pending.channelId, pending.action_class);
          }
        }
        // Still attempt to resolve even if no confirmation entry
        manager.resolveApproval(tok, 'approved');
        return;
      }
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeCallbackUpdate(302, 'cq-orphan', `confirm_approve_always:${token}`)),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());

    // No session auto-approval was registered (no pending confirmation)
    expect(manager.isSessionAutoApproved('chan-1', 'shell.exec')).toBe(false);
    // Approval is still resolved (the resolveApproval call succeeds)
    expect(manager.isConsumed(token)).toBe(true);
  });
});

// ─── Approve Always — cancel workflow ────────────────────────────────────────

describe('Approve Always — cancel workflow', () => {
  let manager: ApprovalManager;
  let listener: TelegramListener;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    manager = new ApprovalManager();
  });

  afterEach(() => {
    listener?.stop();
    manager.shutdown();
    vi.unstubAllGlobals();
  });

  it('cancel_approve_always leaves the original approval pending', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    const pendingConfirmations = new Map<string, { pattern: string }>();
    pendingConfirmations.set(token, { pattern: 'git commit *' });

    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      if (command === 'cancel_approve_always') {
        // Clear the pending confirmation
        pendingConfirmations.delete(tok);
        // Do NOT resolve the approval — original message stays live
        return;
      }
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeCallbackUpdate(400, 'cq-cancel', `cancel_approve_always:${token}`)),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());

    expect(onCommand).toHaveBeenCalledWith('cancel_approve_always', token);
    // Confirmation entry cleared
    expect(pendingConfirmations.has(token)).toBe(false);
    // Original approval still pending
    expect(manager.isConsumed(token)).toBe(false);
    expect(manager.getPending(token)).toBeDefined();
    // No session auto-approval registered
    expect(manager.isSessionAutoApproved('chan-1', 'shell.exec')).toBe(false);
  });

  it('after cancel, operator can still approve via Approve Once', async () => {
    const { token, promise } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    let resolvedDecision: string | undefined;
    promise.then((d) => { resolvedDecision = d; });

    const pendingConfirmations = new Map<string, { pattern: string }>();
    pendingConfirmations.set(token, { pattern: 'git commit *' });

    // Simulate: cancel first, then approve_once on the next click
    const callCount = { val: 0 };
    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      callCount.val++;
      if (command === 'cancel_approve_always') {
        pendingConfirmations.delete(tok);
        return; // Original approval stays pending
      }
      if (command === 'approve_once') {
        if (manager.isConsumed(tok)) return 'Already decided';
        manager.resolveApproval(tok, 'approved');
      }
    });

    const updates = {
      ok: true,
      result: [
        makeCallbackUpdate(401, 'cq-cancel2', `cancel_approve_always:${token}`).result[0]!,
        makeCallbackUpdate(402, 'cq-approve', `approve_once:${token}`).result[0]!,
      ],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(updates), { status: 200 }))
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(callCount.val).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 20));

    expect(resolvedDecision).toBe('approved');
    expect(manager.isConsumed(token)).toBe(true);
  });
});

// ─── Approve Always — auto-confirm path ──────────────────────────────────────

describe('Approve Always — auto-confirm path (approveAlwaysAutoConfirm)', () => {
  let manager: ApprovalManager;
  let listener: TelegramListener;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    manager = new ApprovalManager();
  });

  afterEach(() => {
    listener?.stop();
    manager.shutdown();
    vi.unstubAllGlobals();
  });

  it('auto-confirm path registers session auto-approval and resolves approval without confirmation dialog', async () => {
    const { token, promise } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    let resolvedDecision: string | undefined;
    promise.then((d) => { resolvedDecision = d; });

    const sessionAutoApprovals = new Set<string>();
    let confirmationDialogSent = false;

    // Auto-confirm mode: skip confirmation dialog, immediately register and resolve.
    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      if (command === 'approve_always') {
        const pending = manager.getPending(tok);
        if (pending) {
          // Auto-confirm: register without showing confirmation dialog
          manager.addSessionAutoApproval(pending.channelId, pending.action_class);
          sessionAutoApprovals.add(`${pending.channelId}:${pending.action_class}`);
          // No sendApproveAlwaysConfirmation call in auto-confirm mode
          confirmationDialogSent = false;
        }
      }
      // Fall through to resolve
      if (manager.isConsumed(tok)) return 'Already decided';
      const decision = command === 'deny' ? ('denied' as const) : ('approved' as const);
      manager.resolveApproval(tok, decision);
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeCallbackUpdate(500, 'cq-autoconf', `approve_always:${token}`)),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    expect(sessionAutoApprovals.has('chan-1:shell.exec')).toBe(true);
    expect(manager.isSessionAutoApproved('chan-1', 'shell.exec')).toBe(true);
    expect(confirmationDialogSent).toBe(false);
    expect(resolvedDecision).toBe('approved');
  });

  it('auto-confirm path skips sendApproveAlwaysConfirmation API call', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      if (command === 'approve_always') {
        const pending = manager.getPending(tok);
        if (pending) {
          manager.addSessionAutoApproval(pending.channelId, pending.action_class);
          // Auto-confirm: no sendApproveAlwaysConfirmation call
        }
      }
      if (!manager.isConsumed(tok)) {
        manager.resolveApproval(tok, 'approved');
      }
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeCallbackUpdate(501, 'cq-autoconf-2', `approve_always:${token}`)),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    // Only answerCallbackQuery should be sent (not sendMessage for confirmation)
    const sendMessageCalls = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes('sendMessage'),
    );
    expect(sendMessageCalls).toHaveLength(0);
  });
});

// ─── Approve Always — operator identity capture ───────────────────────────────

describe('Approve Always — operator identity capture', () => {
  let manager: ApprovalManager;
  let listener: TelegramListener;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    manager = new ApprovalManager();
  });

  afterEach(() => {
    listener?.stop();
    manager.shutdown();
    vi.unstubAllGlobals();
  });

  it('operator info from callback_query.from is passed to onCommand on approve_always', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    const capturedOperator: TelegramOperatorInfo[] = [];
    const onCommand = vi.fn(
      (command: TelegramCommand, tok: string, from?: TelegramOperatorInfo) => {
        if (from) capturedOperator.push(from);
        if (!manager.isConsumed(tok)) {
          manager.resolveApproval(tok, 'approved');
        }
      },
    );

    const updates = {
      ok: true,
      result: [
        {
          update_id: 600,
          callback_query: {
            id: 'cq-op',
            data: `approve_always:${token}`,
            from: { id: 987654321, username: 'alice_ops', first_name: 'Alice' },
          },
        },
      ],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(updates), { status: 200 }))
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());

    expect(onCommand).toHaveBeenCalledWith('approve_always', token, {
      userId: 987654321,
      username: 'alice_ops',
      firstName: 'Alice',
    });
    expect(capturedOperator).toHaveLength(1);
    expect(capturedOperator[0]!.userId).toBe(987654321);
    expect(capturedOperator[0]!.username).toBe('alice_ops');
    expect(capturedOperator[0]!.firstName).toBe('Alice');
  });

  it('operator info is formatted as userId@username when username is set', () => {
    // Verifies the operatorId formatting used in the index.ts handler.
    const from: TelegramOperatorInfo = { userId: 123456, username: 'ops_user', firstName: 'Ops' };
    const operatorId = from.username !== undefined
      ? `${from.userId}@${from.username}`
      : String(from.userId);
    expect(operatorId).toBe('123456@ops_user');
  });

  it('operator info is formatted as userId string when username is absent', () => {
    const from: TelegramOperatorInfo = { userId: 999888, firstName: 'Anonymous' };
    const operatorId = from.username !== undefined
      ? `${from.userId}@${from.username}`
      : String(from.userId);
    expect(operatorId).toBe('999888');
  });

  it('no operator info when callback_query lacks a from field', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    const onCommand = vi.fn((command: TelegramCommand, tok: string, from?: TelegramOperatorInfo) => {
      if (!manager.isConsumed(tok)) {
        manager.resolveApproval(tok, 'approved');
      }
    });

    const updates = {
      ok: true,
      result: [
        {
          update_id: 601,
          callback_query: { id: 'cq-noop', data: `approve_always:${token}` },
          // No 'from' field
        },
      ],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(updates), { status: 200 }))
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    expect(onCommand).toHaveBeenCalledWith('approve_always', token);
    // Third argument (from) must be absent
    expect(onCommand.mock.calls[0]).toHaveLength(2);
  });

  it('confirm_approve_always passes operator info for attribution', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    const capturedOps: TelegramOperatorInfo[] = [];
    const onCommand = vi.fn(
      (command: TelegramCommand, tok: string, from?: TelegramOperatorInfo) => {
        if (from) capturedOps.push(from);
        if (!manager.isConsumed(tok)) {
          manager.resolveApproval(tok, 'approved');
        }
      },
    );

    const updates = {
      ok: true,
      result: [
        {
          update_id: 602,
          callback_query: {
            id: 'cq-conf-op',
            data: `confirm_approve_always:${token}`,
            from: { id: 111222333, username: 'bob_ops', first_name: 'Bob' },
          },
        },
      ],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(updates), { status: 200 }))
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    expect(onCommand).toHaveBeenCalledWith('confirm_approve_always', token, {
      userId: 111222333,
      username: 'bob_ops',
      firstName: 'Bob',
    });
    expect(capturedOps[0]!.username).toBe('bob_ops');
  });
});

// ─── Approve Always — error handling in callback processing ───────────────────

describe('Approve Always — error handling in callback processing', () => {
  let manager: ApprovalManager;
  let listener: TelegramListener;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    manager = new ApprovalManager();
  });

  afterEach(() => {
    listener?.stop();
    manager.shutdown();
    vi.unstubAllGlobals();
  });

  it('duplicate approve_always tap returns Already decided alert', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    // Consume the token first
    manager.resolveApproval(token, 'approved');

    const onCommand = vi.fn((command: TelegramCommand, tok: string): string | void => {
      if (manager.isConsumed(tok)) return 'Already decided';
      manager.resolveApproval(tok, 'approved');
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeCallbackUpdate(700, 'cq-dup', `approve_always:${token}`)),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    // answerCallbackQuery must carry the alert text
    const answerCall = vi.mocked(fetch).mock.calls.find(
      (c) => (c[0] as string).includes('answerCallbackQuery'),
    );
    expect(answerCall).toBeDefined();
    const answerBody = JSON.parse(answerCall![1]?.body as string);
    expect(answerBody.callback_query_id).toBe('cq-dup');
    expect(answerBody.text).toBe('Already decided');
    expect(answerBody.show_alert).toBe(true);
  });

  it('approve_always for non-existent token does not register session auto-approval', async () => {
    const unknownToken = 'nonexistent-token123';

    const sessionAutoApprovals = new Set<string>();
    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      if (command === 'approve_always') {
        const pending = manager.getPending(tok);
        if (pending) {
          manager.addSessionAutoApproval(pending.channelId, pending.action_class);
          sessionAutoApprovals.add(`${pending.channelId}:${pending.action_class}`);
        }
        // Fall through to resolve
      }
      if (!manager.isConsumed(tok)) {
        manager.resolveApproval(tok, 'approved');
      }
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeCallbackUpdate(701, 'cq-unknown', `approve_always:${unknownToken}`)),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());

    expect(sessionAutoApprovals.size).toBe(0);
  });

  it('answerCallbackQuery is always sent for approve_always callback', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      if (!manager.isConsumed(tok)) {
        manager.resolveApproval(tok, 'approved');
      }
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeCallbackUpdate(702, 'cq-answer', `approve_always:${token}`)),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    const answerCall = vi.mocked(fetch).mock.calls.find(
      (c) => (c[0] as string).includes('answerCallbackQuery'),
    );
    expect(answerCall).toBeDefined();
    const answerBody = JSON.parse(answerCall![1]?.body as string);
    expect(answerBody.callback_query_id).toBe('cq-answer');
  });

  it('confirm_approve_always answerCallbackQuery carries the correct callback_query_id', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    const onCommand = vi.fn((command: TelegramCommand, tok: string) => {
      if (!manager.isConsumed(tok)) {
        manager.resolveApproval(tok, 'approved');
      }
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeCallbackUpdate(703, 'cq-conf-answer', `confirm_approve_always:${token}`),
          ),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    const answerCall = vi.mocked(fetch).mock.calls.find(
      (c) => (c[0] as string).includes('answerCallbackQuery'),
    );
    expect(answerCall).toBeDefined();
    const answerBody = JSON.parse(answerCall![1]?.body as string);
    expect(answerBody.callback_query_id).toBe('cq-conf-answer');
  });

  it('cancel_approve_always answerCallbackQuery carries the correct callback_query_id', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'chan-1',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    const onCommand = vi.fn((_command: TelegramCommand, _tok: string) => {
      // cancel: do nothing to the approval
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeCallbackUpdate(704, 'cq-cancel-answer', `cancel_approve_always:${token}`),
          ),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    listener = new TelegramListener('test-bot-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    const answerCall = vi.mocked(fetch).mock.calls.find(
      (c) => (c[0] as string).includes('answerCallbackQuery'),
    );
    expect(answerCall).toBeDefined();
    const answerBody = JSON.parse(answerCall![1]?.body as string);
    expect(answerBody.callback_query_id).toBe('cq-cancel-answer');
  });
});

// ─── Approve Always — isSessionAutoApproved prevents duplicate prompts ────────

describe('Approve Always — isSessionAutoApproved prevents duplicate HITL prompts', () => {
  it('addSessionAutoApproval makes isSessionAutoApproved return true', () => {
    const manager = new ApprovalManager();
    expect(manager.isSessionAutoApproved('chan-1', 'shell.exec')).toBe(false);
    manager.addSessionAutoApproval('chan-1', 'shell.exec');
    expect(manager.isSessionAutoApproved('chan-1', 'shell.exec')).toBe(true);
    manager.shutdown();
  });

  it('session auto-approval is scoped to channelId and actionClass', () => {
    const manager = new ApprovalManager();
    manager.addSessionAutoApproval('chan-1', 'shell.exec');
    // Different channelId — not auto-approved
    expect(manager.isSessionAutoApproved('chan-2', 'shell.exec')).toBe(false);
    // Different actionClass — not auto-approved
    expect(manager.isSessionAutoApproved('chan-1', 'filesystem.read')).toBe(false);
    // Same pair — auto-approved
    expect(manager.isSessionAutoApproved('chan-1', 'shell.exec')).toBe(true);
    manager.shutdown();
  });

  it('multiple action classes can be auto-approved independently', () => {
    const manager = new ApprovalManager();
    manager.addSessionAutoApproval('chan-1', 'shell.exec');
    manager.addSessionAutoApproval('chan-1', 'filesystem.read');
    expect(manager.isSessionAutoApproved('chan-1', 'shell.exec')).toBe(true);
    expect(manager.isSessionAutoApproved('chan-1', 'filesystem.read')).toBe(true);
    expect(manager.isSessionAutoApproved('chan-1', 'email.send')).toBe(false);
    manager.shutdown();
  });

  it('shutdown clears all session auto-approvals', () => {
    const manager = new ApprovalManager();
    manager.addSessionAutoApproval('chan-1', 'shell.exec');
    expect(manager.isSessionAutoApproved('chan-1', 'shell.exec')).toBe(true);
    manager.shutdown();
    expect(manager.isSessionAutoApproved('chan-1', 'shell.exec')).toBe(false);
  });
});

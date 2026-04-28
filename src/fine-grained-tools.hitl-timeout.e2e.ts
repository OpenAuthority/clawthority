/**
 * Fine-grained tools — HITL timeout e2e tests
 *
 * Verifies that when a HITL approval request times out (the operator does not
 * respond within the configured timeout period), the fallback policy specified
 * in HitlApprovalConfig is applied correctly and deterministically.
 *
 * The ApprovalManager is mocked to return an immediately-resolved 'expired'
 * promise, simulating TTL expiry without relying on real timers. Channel
 * adapters (Telegram, Slack) are stubbed so the send step succeeds and
 * resolveHitlDecision() receives the 'expired' decision and applies the
 * configured fallback.
 *
 * Stubbing strategies used across this suite:
 *
 *  Telegram + 'expired' promise (TC-HTO-01 … TC-HTO-08):
 *    TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env vars are set to fake values so
 *    resolveTelegramConfig returns a config object. sendApprovalRequest is
 *    mocked to return `true` (message delivered) so execution reaches
 *    resolveHitlDecision(). ApprovalManager is mocked to return
 *    promise: Promise.resolve('expired'), simulating the TTL firing without
 *    operator interaction.
 *
 *  Slack + 'expired' promise (TC-HTO-09 … TC-HTO-14):
 *    Same approach via sendSlackApprovalRequest, which is mocked to return
 *    `{ ok: true, messageTs: 'mock-ts' }`. ApprovalManager is mocked
 *    identically to the Telegram stub.
 *
 * Fallback scenarios tested:
 *  - 'deny'         → handler returns { block: true, blockReason: /timed out/ }
 *  - 'auto-approve' → handler returns undefined (tool call is allowed)
 *
 * Test IDs: TC-HTO-01 … TC-HTO-14 (HITL Timeout)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BeforeToolCallHandler,
  BeforeToolCallResult,
  HookContext,
  OpenclawPluginContext,
} from './index.js';
import type { HitlPolicyConfig } from './hitl/types.js';

// ─── Shared chokidar stub (required by every plugin load) ────────────────────

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// ─── Audit stub (suppress on-disk writes) ────────────────────────────────────

vi.mock('./audit.js', async () => {
  const actual = await vi.importActual<typeof import('./audit.js')>('./audit.js');
  return {
    ...actual,
    JsonlAuditLogger: class StubJsonlAuditLogger {
      constructor(_opts: { logFile: string }) {}
      log(_entry: Record<string, unknown>): Promise<void> {
        return Promise.resolve();
      }
      flush(): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HOOK_CTX: HookContext = { agentId: 'agent-test', channelId: 'default' };

async function callHook(
  handler: BeforeToolCallHandler,
  toolName: string,
  params: Record<string, unknown> = {},
): Promise<BeforeToolCallResult | undefined> {
  const result = await handler({ toolName, params, source: 'user' }, HOOK_CTX);
  return result ?? undefined;
}

// ─── Suite 1: Telegram timeout — fallback 'deny' ──────────────────────────────
//
// sendApprovalRequest returns true (message sent). ApprovalManager promise
// resolves immediately as 'expired', simulating the TTL timer firing with no
// operator response. Expects resolveHitlDecision() to apply the 'deny'
// fallback and return a blocking result for every covered action class.

describe('fine-grained tools — HITL timeout (Telegram, fallback: deny)', () => {
  const TELEGRAM_DENY_POLICY: HitlPolicyConfig = {
    version: '1',
    policies: [
      {
        name: 'telegram-timeout-deny',
        actions: [
          'filesystem.write',
          'filesystem.delete',
          'vcs.remote',
          'vcs.write',
          'archive.create',
        ],
        approval: { channel: 'telegram', timeout: 30, fallback: 'deny' },
      },
    ],
  };

  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    process.env.TELEGRAM_BOT_TOKEN = 'fake-bot-token-for-testing';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat-id-for-testing';
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.SLACK_SIGNING_SECRET;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.doUnmock('./hitl/parser.js');
    vi.doUnmock('./hitl/approval-manager.js');
    vi.doUnmock('./hitl/telegram.js');
  });

  interface TelegramTimeoutHandlers {
    handler: BeforeToolCallHandler;
    createSpy: ReturnType<typeof vi.fn>;
  }

  async function loadWithTelegramTimeoutDeny(): Promise<TelegramTimeoutHandlers> {
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.resetModules();

    // Spy captures every createApprovalRequest call for argument assertions.
    const createSpy = vi.fn((_opts: unknown) => ({
      token: `mock-timeout-token-${Date.now()}`,
      promise: Promise.resolve('expired' as const),
    }));

    vi.doMock('./hitl/approval-manager.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/approval-manager.js')>(
        './hitl/approval-manager.js',
      );
      return {
        ...actual,
        ApprovalManager: class MockApprovalManager {
          createApprovalRequest(opts: unknown) {
            return createSpy(opts);
          }
          resolveApproval() { return true; }
          cancel() {}
          isConsumed() { return false; }
          getPending() { return undefined; }
          get size() { return 0; }
          shutdown() {}
          isSessionAutoApproved() { return false; }
          addSessionAutoApproval() {}
        },
      };
    });

    // sendApprovalRequest returns true so execution reaches resolveHitlDecision().
    // TelegramListener is a no-op to avoid long-polling.
    vi.doMock('./hitl/telegram.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/telegram.js')>(
        './hitl/telegram.js',
      );
      return {
        ...actual,
        sendApprovalRequest: vi.fn(async () => ({ ok: true })),
        TelegramListener: class MockTelegramListener {
          constructor(_botToken: string, _onCommand: unknown) {}
          start(): void {}
          stop(): void {}
        },
      };
    });

    vi.doMock('./hitl/parser.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/parser.js')>(
        './hitl/parser.js',
      );
      return {
        ...actual,
        parseHitlPolicyFile: vi.fn(async () => TELEGRAM_DENY_POLICY),
      };
    });

    const mod = (await import('./index.js')) as {
      default: {
        activate: (ctx: OpenclawPluginContext) => Promise<void>;
      };
    };

    let captured: BeforeToolCallHandler | undefined;
    const ctx: OpenclawPluginContext = {
      registerHook: () => undefined,
      on: (hookName: string, handler: unknown) => {
        if (hookName === 'before_tool_call') {
          captured = handler as BeforeToolCallHandler;
        }
      },
    } as unknown as OpenclawPluginContext;

    process.env.CLAWTHORITY_MODE = 'closed';
    process.env.OPENAUTH_FORCE_ACTIVE = '1';
    await mod.default.activate(ctx);

    if (captured === undefined) {
      throw new Error('beforeToolCallHandler was not registered during activate()');
    }
    return { handler: captured, createSpy };
  }

  // ── TC-HTO-01 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-01: write_file (filesystem.write) is blocked when Telegram approval times out (fallback: deny)',
    async () => {
      const { handler } = await loadWithTelegramTimeoutDeny();
      const result = await callHook(handler, 'write_file', {
        file_path: '/workspace/report.txt',
        content: 'Generated output',
      });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/timed out/i);
    },
  );

  // ── TC-HTO-02 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-02: delete_file (filesystem.delete) is blocked when Telegram approval times out (fallback: deny)',
    async () => {
      const { handler } = await loadWithTelegramTimeoutDeny();
      const result = await callHook(handler, 'delete_file', { path: '/tmp/old.log' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/timed out/i);
    },
  );

  // ── TC-HTO-03 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-03: git_push (vcs.remote) is blocked when Telegram approval times out (fallback: deny)',
    async () => {
      const { handler } = await loadWithTelegramTimeoutDeny();
      const result = await callHook(handler, 'git_push', {
        remote: 'origin',
        branch: 'main',
      });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/timed out/i);
    },
  );

  // ── TC-HTO-04 ─────────────────────────────────────────────────────────────
  //
  // Additionally verifies that the policy timeout value (30 s) is forwarded
  // to createApprovalRequest(), confirming the duration wires end-to-end from
  // the HITL config through to the approval manager.

  it(
    'TC-HTO-04: git_checkout (vcs.write) is blocked and approval request carries configured timeout (30 s)',
    async () => {
      const { handler, createSpy } = await loadWithTelegramTimeoutDeny();
      const result = await callHook(handler, 'git_checkout', { branch: 'feature/auth' });
      expect(result?.block).toBe(true);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          policy: expect.objectContaining({
            approval: expect.objectContaining({ timeout: 30 }),
          }),
        }),
      );
    },
  );

  // ── TC-HTO-05 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-05: archive_create (archive.create) is blocked when Telegram approval times out (fallback: deny)',
    async () => {
      const { handler } = await loadWithTelegramTimeoutDeny();
      const result = await callHook(handler, 'archive_create', {
        source: '/workspace/dist',
        destination: '/releases/v1.0.tar.gz',
      });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/timed out/i);
    },
  );
});

// ─── Suite 2: Telegram timeout — fallback 'auto-approve' ─────────────────────
//
// Identical Telegram stub but with fallback: 'auto-approve'. When the operator
// does not respond, resolveHitlDecision() should allow the tool call (return
// undefined) rather than blocking.

describe('fine-grained tools — HITL timeout (Telegram, fallback: auto-approve)', () => {
  const TELEGRAM_AUTO_POLICY: HitlPolicyConfig = {
    version: '1',
    policies: [
      {
        name: 'telegram-timeout-auto',
        actions: ['filesystem.write', 'filesystem.delete', 'vcs.remote'],
        approval: { channel: 'telegram', timeout: 10, fallback: 'auto-approve' },
      },
    ],
  };

  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    process.env.TELEGRAM_BOT_TOKEN = 'fake-bot-token-for-testing';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat-id-for-testing';
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.SLACK_SIGNING_SECRET;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.doUnmock('./hitl/parser.js');
    vi.doUnmock('./hitl/approval-manager.js');
    vi.doUnmock('./hitl/telegram.js');
  });

  async function loadWithTelegramTimeoutAutoApprove(): Promise<BeforeToolCallHandler> {
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.resetModules();

    vi.doMock('./hitl/approval-manager.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/approval-manager.js')>(
        './hitl/approval-manager.js',
      );
      return {
        ...actual,
        ApprovalManager: class MockApprovalManager {
          createApprovalRequest(_opts: unknown) {
            return {
              token: `mock-timeout-token-${Date.now()}`,
              promise: Promise.resolve('expired' as const),
            };
          }
          resolveApproval() { return true; }
          cancel() {}
          isConsumed() { return false; }
          getPending() { return undefined; }
          get size() { return 0; }
          shutdown() {}
          isSessionAutoApproved() { return false; }
          addSessionAutoApproval() {}
        },
      };
    });

    vi.doMock('./hitl/telegram.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/telegram.js')>(
        './hitl/telegram.js',
      );
      return {
        ...actual,
        sendApprovalRequest: vi.fn(async () => ({ ok: true })),
        TelegramListener: class MockTelegramListener {
          constructor(_botToken: string, _onCommand: unknown) {}
          start(): void {}
          stop(): void {}
        },
      };
    });

    vi.doMock('./hitl/parser.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/parser.js')>(
        './hitl/parser.js',
      );
      return {
        ...actual,
        parseHitlPolicyFile: vi.fn(async () => TELEGRAM_AUTO_POLICY),
      };
    });

    const mod = (await import('./index.js')) as {
      default: {
        activate: (ctx: OpenclawPluginContext) => Promise<void>;
      };
    };

    let captured: BeforeToolCallHandler | undefined;
    const ctx: OpenclawPluginContext = {
      registerHook: () => undefined,
      on: (hookName: string, handler: unknown) => {
        if (hookName === 'before_tool_call') {
          captured = handler as BeforeToolCallHandler;
        }
      },
    } as unknown as OpenclawPluginContext;

    process.env.CLAWTHORITY_MODE = 'closed';
    process.env.OPENAUTH_FORCE_ACTIVE = '1';
    await mod.default.activate(ctx);

    if (captured === undefined) {
      throw new Error('beforeToolCallHandler was not registered during activate()');
    }
    return captured;
  }

  // ── TC-HTO-06 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-06: write_file (filesystem.write) proceeds when Telegram times out (fallback: auto-approve)',
    async () => {
      const handler = await loadWithTelegramTimeoutAutoApprove();
      const result = await callHook(handler, 'write_file', {
        file_path: '/workspace/output.json',
        content: '{"status":"ok"}',
      });
      expect(result?.block).not.toBe(true);
    },
  );

  // ── TC-HTO-07 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-07: delete_file (filesystem.delete) proceeds when Telegram times out (fallback: auto-approve)',
    async () => {
      const handler = await loadWithTelegramTimeoutAutoApprove();
      const result = await callHook(handler, 'delete_file', { path: '/tmp/session.log' });
      expect(result?.block).not.toBe(true);
    },
  );

  // ── TC-HTO-08 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-08: git_push (vcs.remote) proceeds when Telegram times out (fallback: auto-approve)',
    async () => {
      const handler = await loadWithTelegramTimeoutAutoApprove();
      const result = await callHook(handler, 'git_push', {
        remote: 'origin',
        branch: 'release/1.0',
      });
      expect(result?.block).not.toBe(true);
    },
  );
});

// ─── Suite 3: Slack timeout — fallback 'deny' ─────────────────────────────────
//
// sendSlackApprovalRequest returns { ok: true, messageTs: 'mock-ts' }
// (message delivered). ApprovalManager promise resolves as 'expired'.
// Expects resolveHitlDecision() to block with the 'deny' fallback.

describe('fine-grained tools — HITL timeout (Slack, fallback: deny)', () => {
  const SLACK_DENY_POLICY: HitlPolicyConfig = {
    version: '1',
    policies: [
      {
        name: 'slack-timeout-deny',
        actions: ['filesystem.write', 'filesystem.delete', 'vcs.remote'],
        approval: { channel: 'slack', timeout: 60, fallback: 'deny' },
      },
    ],
  };

  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    process.env.SLACK_BOT_TOKEN = 'xoxb-fake-slack-bot-token';
    process.env.SLACK_CHANNEL_ID = 'C0FAKE12345';
    process.env.SLACK_SIGNING_SECRET = 'fake-signing-secret-for-testing';
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.SLACK_SIGNING_SECRET;
    vi.doUnmock('./hitl/parser.js');
    vi.doUnmock('./hitl/approval-manager.js');
    vi.doUnmock('./hitl/slack.js');
  });

  async function loadWithSlackTimeoutDeny(): Promise<BeforeToolCallHandler> {
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.resetModules();

    vi.doMock('./hitl/approval-manager.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/approval-manager.js')>(
        './hitl/approval-manager.js',
      );
      return {
        ...actual,
        ApprovalManager: class MockApprovalManager {
          createApprovalRequest(_opts: unknown) {
            return {
              token: `mock-timeout-token-${Date.now()}`,
              promise: Promise.resolve('expired' as const),
            };
          }
          resolveApproval() { return true; }
          cancel() {}
          isConsumed() { return false; }
          getPending() { return undefined; }
          get size() { return 0; }
          shutdown() {}
          isSessionAutoApproved() { return false; }
          addSessionAutoApproval() {}
        },
      };
    });

    // sendSlackApprovalRequest returns ok so execution reaches resolveHitlDecision().
    // SlackInteractionServer is a no-op to avoid binding an HTTP port.
    vi.doMock('./hitl/slack.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/slack.js')>(
        './hitl/slack.js',
      );
      return {
        ...actual,
        sendSlackApprovalRequest: vi.fn(async () => ({
          ok: true,
          messageTs: 'mock-slack-message-ts',
        })),
        SlackInteractionServer: class MockSlackInteractionServer {
          constructor(_port: number, _signingSecret: string, _onCommand: unknown) {}
          async start(): Promise<void> {}
          async stop(): Promise<void> {}
        },
      };
    });

    vi.doMock('./hitl/parser.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/parser.js')>(
        './hitl/parser.js',
      );
      return {
        ...actual,
        parseHitlPolicyFile: vi.fn(async () => SLACK_DENY_POLICY),
      };
    });

    const mod = (await import('./index.js')) as {
      default: {
        activate: (ctx: OpenclawPluginContext) => Promise<void>;
      };
    };

    let captured: BeforeToolCallHandler | undefined;
    const ctx: OpenclawPluginContext = {
      registerHook: () => undefined,
      on: (hookName: string, handler: unknown) => {
        if (hookName === 'before_tool_call') {
          captured = handler as BeforeToolCallHandler;
        }
      },
    } as unknown as OpenclawPluginContext;

    process.env.CLAWTHORITY_MODE = 'closed';
    process.env.OPENAUTH_FORCE_ACTIVE = '1';
    await mod.default.activate(ctx);

    if (captured === undefined) {
      throw new Error('beforeToolCallHandler was not registered during activate()');
    }
    return captured;
  }

  // ── TC-HTO-09 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-09: write_file (filesystem.write) is blocked when Slack approval times out (fallback: deny)',
    async () => {
      const handler = await loadWithSlackTimeoutDeny();
      const result = await callHook(handler, 'write_file', {
        file_path: '/workspace/config.json',
        content: '{"env":"prod"}',
      });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/timed out/i);
    },
  );

  // ── TC-HTO-10 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-10: delete_file (filesystem.delete) is blocked when Slack approval times out (fallback: deny)',
    async () => {
      const handler = await loadWithSlackTimeoutDeny();
      const result = await callHook(handler, 'delete_file', { path: '/data/archive.zip' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/timed out/i);
    },
  );

  // ── TC-HTO-11 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-11: git_push (vcs.remote) is blocked when Slack approval times out (fallback: deny)',
    async () => {
      const handler = await loadWithSlackTimeoutDeny();
      const result = await callHook(handler, 'git_push', {
        remote: 'origin',
        branch: 'deploy/prod',
      });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/timed out/i);
    },
  );
});

// ─── Suite 4: Slack timeout — fallback 'auto-approve' ────────────────────────
//
// Identical Slack stub but with fallback: 'auto-approve'. Operator non-response
// should cause resolveHitlDecision() to allow the tool call (return undefined).

describe('fine-grained tools — HITL timeout (Slack, fallback: auto-approve)', () => {
  const SLACK_AUTO_POLICY: HitlPolicyConfig = {
    version: '1',
    policies: [
      {
        name: 'slack-timeout-auto',
        actions: ['filesystem.write', 'filesystem.delete', 'vcs.write'],
        approval: { channel: 'slack', timeout: 45, fallback: 'auto-approve' },
      },
    ],
  };

  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    process.env.SLACK_BOT_TOKEN = 'xoxb-fake-slack-bot-token';
    process.env.SLACK_CHANNEL_ID = 'C0FAKE12345';
    process.env.SLACK_SIGNING_SECRET = 'fake-signing-secret-for-testing';
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.SLACK_SIGNING_SECRET;
    vi.doUnmock('./hitl/parser.js');
    vi.doUnmock('./hitl/approval-manager.js');
    vi.doUnmock('./hitl/slack.js');
  });

  async function loadWithSlackTimeoutAutoApprove(): Promise<BeforeToolCallHandler> {
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.resetModules();

    vi.doMock('./hitl/approval-manager.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/approval-manager.js')>(
        './hitl/approval-manager.js',
      );
      return {
        ...actual,
        ApprovalManager: class MockApprovalManager {
          createApprovalRequest(_opts: unknown) {
            return {
              token: `mock-timeout-token-${Date.now()}`,
              promise: Promise.resolve('expired' as const),
            };
          }
          resolveApproval() { return true; }
          cancel() {}
          isConsumed() { return false; }
          getPending() { return undefined; }
          get size() { return 0; }
          shutdown() {}
          isSessionAutoApproved() { return false; }
          addSessionAutoApproval() {}
        },
      };
    });

    vi.doMock('./hitl/slack.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/slack.js')>(
        './hitl/slack.js',
      );
      return {
        ...actual,
        sendSlackApprovalRequest: vi.fn(async () => ({
          ok: true,
          messageTs: 'mock-slack-message-ts',
        })),
        SlackInteractionServer: class MockSlackInteractionServer {
          constructor(_port: number, _signingSecret: string, _onCommand: unknown) {}
          async start(): Promise<void> {}
          async stop(): Promise<void> {}
        },
      };
    });

    vi.doMock('./hitl/parser.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/parser.js')>(
        './hitl/parser.js',
      );
      return {
        ...actual,
        parseHitlPolicyFile: vi.fn(async () => SLACK_AUTO_POLICY),
      };
    });

    const mod = (await import('./index.js')) as {
      default: {
        activate: (ctx: OpenclawPluginContext) => Promise<void>;
      };
    };

    let captured: BeforeToolCallHandler | undefined;
    const ctx: OpenclawPluginContext = {
      registerHook: () => undefined,
      on: (hookName: string, handler: unknown) => {
        if (hookName === 'before_tool_call') {
          captured = handler as BeforeToolCallHandler;
        }
      },
    } as unknown as OpenclawPluginContext;

    process.env.CLAWTHORITY_MODE = 'closed';
    process.env.OPENAUTH_FORCE_ACTIVE = '1';
    await mod.default.activate(ctx);

    if (captured === undefined) {
      throw new Error('beforeToolCallHandler was not registered during activate()');
    }
    return captured;
  }

  // ── TC-HTO-12 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-12: write_file (filesystem.write) proceeds when Slack times out (fallback: auto-approve)',
    async () => {
      const handler = await loadWithSlackTimeoutAutoApprove();
      const result = await callHook(handler, 'write_file', {
        file_path: '/workspace/index.ts',
        content: 'export {};',
      });
      expect(result?.block).not.toBe(true);
    },
  );

  // ── TC-HTO-13 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-13: delete_file (filesystem.delete) proceeds when Slack times out (fallback: auto-approve)',
    async () => {
      const handler = await loadWithSlackTimeoutAutoApprove();
      const result = await callHook(handler, 'delete_file', { path: '/cache/stale.json' });
      expect(result?.block).not.toBe(true);
    },
  );

  // ── TC-HTO-14 ─────────────────────────────────────────────────────────────

  it(
    'TC-HTO-14: git_checkout (vcs.write) proceeds when Slack times out (fallback: auto-approve)',
    async () => {
      const handler = await loadWithSlackTimeoutAutoApprove();
      const result = await callHook(handler, 'git_checkout', { branch: 'hotfix/patch' });
      expect(result?.block).not.toBe(true);
    },
  );
});

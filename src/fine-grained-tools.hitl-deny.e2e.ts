/**
 * Fine-grained tools — HITL deny e2e tests
 *
 * Verifies that HITL-routed tools (hitl_mode: 'per_request') are blocked when
 * the operator denies the request. External communication services (Telegram,
 * Slack) are stubbed so tests run deterministically without network access.
 *
 * Stubbing strategies used across this suite:
 *
 *  Telegram stub — per-class coverage (TC-HDN-01 … TC-HDN-10):
 *    TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env vars are set to fake values so
 *    `resolveTelegramConfig` returns a config object. `sendApprovalRequest` is
 *    mocked to return `true` (message delivered) and `ApprovalManager` is
 *    mocked to return an immediately-resolved 'denied' promise, simulating a
 *    human clicking Deny in Telegram without any network I/O. All ten action
 *    classes from the approve test suite are covered here.
 *
 *  Telegram stub (TC-HDN-11 … TC-HDN-12):
 *    Same Telegram stub approach covering filesystem.delete and vcs.remote to
 *    mirror the per-channel structure of the approve tests.
 *
 *  Slack stub (TC-HDN-13 … TC-HDN-14):
 *    Same approach via `sendSlackApprovalRequest`, which is mocked to return
 *    `{ ok: true, messageTs: 'mock-ts' }`. `ApprovalManager` is mocked
 *    identically to the Telegram stub.
 *
 * Test IDs: TC-HDN-01 … TC-HDN-14 (HITL Deny per-request)
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

// ─── Suite 1: per-class coverage via Telegram stub with denial ────────────────
//
// Configures the plugin with `channel: 'telegram'` and fake env vars. The
// `ApprovalManager` is mocked to return an immediately-resolved 'denied'
// promise, simulating a human clicking Deny in Telegram. Covers one
// representative tool for every action class with default_hitl_mode:
// 'per_request'.

describe('fine-grained tools — HITL deny (Telegram stub, per-class)', () => {
  const TELEGRAM_DENY_POLICY: HitlPolicyConfig = {
    version: '1',
    policies: [
      {
        name: 'telegram-deny-test',
        actions: [
          'filesystem.write',
          'filesystem.delete',
          'vcs.write',
          'vcs.remote',
          'archive.create',
          'archive.extract',
        ],
        approval: { channel: 'telegram', timeout: 60, fallback: 'deny' },
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

  async function loadWithTelegramDenyStub(): Promise<BeforeToolCallHandler> {
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.resetModules();

    // Stub the ApprovalManager to return an immediately-resolved 'denied'
    // promise, simulating a human clicking Deny in the Telegram chat.
    vi.doMock('./hitl/approval-manager.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/approval-manager.js')>(
        './hitl/approval-manager.js',
      );
      return {
        ...actual,
        ApprovalManager: class MockApprovalManager {
          createApprovalRequest(_opts: unknown) {
            return {
              token: `mock-telegram-deny-token-${Date.now()}`,
              promise: Promise.resolve('denied' as const),
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
    return captured;
  }

  // ── TC-HDN-01: filesystem.write ───────────────────────────────────────────

  it('TC-HDN-01: write_file (filesystem.write) is blocked when HITL denies', async () => {
    const handler = await loadWithTelegramDenyStub();
    const result = await callHook(handler, 'write_file', {
      file_path: '/workspace/report.txt',
      content: 'Generated output',
    });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator denied/i);
  });

  // ── TC-HDN-02: filesystem.delete ─────────────────────────────────────────

  it('TC-HDN-02: delete_file (filesystem.delete) is blocked when HITL denies', async () => {
    const handler = await loadWithTelegramDenyStub();
    const result = await callHook(handler, 'delete_file', { path: '/tmp/old_log.txt' });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator denied/i);
  });

  // ── TC-HDN-03: filesystem.write via edit_file ────────────────────────────

  it('TC-HDN-03: edit_file (filesystem.write) is blocked when HITL denies', async () => {
    const handler = await loadWithTelegramDenyStub();
    const result = await callHook(handler, 'edit_file', {
      file_path: '/src/main.ts',
      content: 'export const x = 1;',
    });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator denied/i);
  });

  // ── TC-HDN-04: filesystem.write via copy_file ────────────────────────────

  it('TC-HDN-04: copy_file (filesystem.write) is blocked when HITL denies', async () => {
    const handler = await loadWithTelegramDenyStub();
    const result = await callHook(handler, 'copy_file', {
      source: '/src/template.ts',
      destination: '/dist/output.ts',
    });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator denied/i);
  });

  // ── TC-HDN-05: filesystem.write via move_file ────────────────────────────

  it('TC-HDN-05: move_file (filesystem.write) is blocked when HITL denies', async () => {
    const handler = await loadWithTelegramDenyStub();
    const result = await callHook(handler, 'move_file', {
      source: '/tmp/draft.md',
      destination: '/docs/final.md',
    });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator denied/i);
  });

  // ── TC-HDN-06: vcs.write via git_checkout ────────────────────────────────

  it('TC-HDN-06: git_checkout (vcs.write) is blocked when HITL denies', async () => {
    const handler = await loadWithTelegramDenyStub();
    const result = await callHook(handler, 'git_checkout', { branch: 'feature/auth' });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator denied/i);
  });

  // ── TC-HDN-07: vcs.write via git_add ─────────────────────────────────────

  it('TC-HDN-07: git_add (vcs.write) is blocked when HITL denies', async () => {
    const handler = await loadWithTelegramDenyStub();
    const result = await callHook(handler, 'git_add', { path: 'src/index.ts' });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator denied/i);
  });

  // ── TC-HDN-08: vcs.remote via git_push ───────────────────────────────────

  it('TC-HDN-08: git_push (vcs.remote) is blocked when HITL denies', async () => {
    const handler = await loadWithTelegramDenyStub();
    const result = await callHook(handler, 'git_push', {
      remote: 'origin',
      branch: 'main',
    });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator denied/i);
  });

  // ── TC-HDN-09: archive.create ────────────────────────────────────────────

  it('TC-HDN-09: archive_create (archive.create) is blocked when HITL denies', async () => {
    const handler = await loadWithTelegramDenyStub();
    const result = await callHook(handler, 'archive_create', {
      source: '/workspace/dist',
      destination: '/releases/v1.0.tar.gz',
    });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator denied/i);
  });

  // ── TC-HDN-10: archive.extract ───────────────────────────────────────────

  it('TC-HDN-10: archive_extract (archive.extract) is blocked when HITL denies', async () => {
    const handler = await loadWithTelegramDenyStub();
    const result = await callHook(handler, 'archive_extract', {
      source: '/releases/v1.0.tar.gz',
      destination: '/workspace/dist',
    });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator denied/i);
  });
});

// ─── Suite 2: Telegram stub ───────────────────────────────────────────────────
//
// Configures the plugin with `channel: 'telegram'` and fake env vars so
// `resolveTelegramConfig` returns a valid config. The `sendApprovalRequest`
// function is mocked to return `true` (simulating successful message delivery).
// The `ApprovalManager` is mocked to return an immediately-resolved 'denied'
// promise, simulating a human clicking Deny in the Telegram chat.

describe('fine-grained tools — HITL deny (Telegram stub)', () => {
  const TELEGRAM_POLICY: HitlPolicyConfig = {
    version: '1',
    policies: [
      {
        name: 'telegram-denials',
        actions: ['filesystem.delete', 'vcs.remote'],
        approval: { channel: 'telegram', timeout: 60, fallback: 'deny' },
      },
    ],
  };

  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    // Set fake Telegram credentials so resolveTelegramConfig returns a config.
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

  async function loadWithTelegramDenyStub(): Promise<BeforeToolCallHandler> {
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.resetModules();

    // Stub the ApprovalManager to return an immediately-resolved 'denied'
    // promise, simulating a human clicking Deny in the Telegram chat.
    vi.doMock('./hitl/approval-manager.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/approval-manager.js')>(
        './hitl/approval-manager.js',
      );
      return {
        ...actual,
        ApprovalManager: class MockApprovalManager {
          createApprovalRequest(_opts: unknown) {
            return {
              token: `mock-telegram-deny-token-${Date.now()}`,
              promise: Promise.resolve('denied' as const),
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
        parseHitlPolicyFile: vi.fn(async () => TELEGRAM_POLICY),
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

  // ── TC-HDN-11 ─────────────────────────────────────────────────────────────

  it(
    'TC-HDN-11: delete_file is blocked when Telegram approval is stubbed as denied',
    async () => {
      const handler = await loadWithTelegramDenyStub();
      const result = await callHook(handler, 'delete_file', { path: '/tmp/stale-cache.log' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/operator denied/i);
    },
  );

  // ── TC-HDN-12 ─────────────────────────────────────────────────────────────

  it(
    'TC-HDN-12: git_push is blocked when Telegram approval is stubbed as denied',
    async () => {
      const handler = await loadWithTelegramDenyStub();
      const result = await callHook(handler, 'git_push', { remote: 'origin', branch: 'release' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/operator denied/i);
    },
  );
});

// ─── Suite 3: Slack stub ──────────────────────────────────────────────────────
//
// Same strategy as the Telegram stub suite but uses `channel: 'slack'`.
// `sendSlackApprovalRequest` is mocked to return `{ ok: true, messageTs: 'mock-ts' }`.
// `ApprovalManager` is mocked to return an immediately-resolved 'denied' promise.

describe('fine-grained tools — HITL deny (Slack stub)', () => {
  const SLACK_POLICY: HitlPolicyConfig = {
    version: '1',
    policies: [
      {
        name: 'slack-denials',
        actions: ['filesystem.write', 'vcs.write'],
        approval: { channel: 'slack', timeout: 60, fallback: 'deny' },
      },
    ],
  };

  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    // Set fake Slack credentials so resolveSlackConfig returns a config.
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

  async function loadWithSlackDenyStub(): Promise<BeforeToolCallHandler> {
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.resetModules();

    // Stub the ApprovalManager to return an immediately-resolved 'denied'
    // promise, simulating a human clicking Deny in the Slack message.
    vi.doMock('./hitl/approval-manager.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/approval-manager.js')>(
        './hitl/approval-manager.js',
      );
      return {
        ...actual,
        ApprovalManager: class MockApprovalManager {
          createApprovalRequest(_opts: unknown) {
            return {
              token: `mock-slack-deny-token-${Date.now()}`,
              promise: Promise.resolve('denied' as const),
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

    // sendSlackApprovalRequest returns success with a fake messageTs and
    // SlackInteractionServer is a no-op so activate() doesn't bind an HTTP port.
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
        parseHitlPolicyFile: vi.fn(async () => SLACK_POLICY),
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

  // ── TC-HDN-13 ─────────────────────────────────────────────────────────────

  it(
    'TC-HDN-13: write_file is blocked when Slack approval is stubbed as denied',
    async () => {
      const handler = await loadWithSlackDenyStub();
      const result = await callHook(handler, 'write_file', {
        file_path: '/workspace/config.json',
        content: '{"env":"prod"}',
      });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/operator denied/i);
    },
  );

  // ── TC-HDN-14 ─────────────────────────────────────────────────────────────

  it(
    'TC-HDN-14: git_checkout is blocked when Slack approval is stubbed as denied',
    async () => {
      const handler = await loadWithSlackDenyStub();
      const result = await callHook(handler, 'git_checkout', { branch: 'release/2.0' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/operator denied/i);
    },
  );
});

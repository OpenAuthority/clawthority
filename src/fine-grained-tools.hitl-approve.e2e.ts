/**
 * Fine-grained tools — HITL approve e2e tests
 *
 * Verifies that HITL-routed tools (hitl_mode: 'per_request') proceed when the
 * operator approves the request. External communication services (Telegram,
 * Slack) are stubbed so tests run deterministically without network access.
 *
 * Stubbing strategies used across this suite:
 *
 *  test-unknown channel:
 *    `dispatchHitlChannel` returns `undefined` for unknown channels, which the
 *    handler treats as "approved — proceed". This is the primary stub for the
 *    per-class coverage tests (TC-HAP-01 … TC-HAP-10).
 *
 *  Telegram stub (TC-HAP-11 … TC-HAP-12):
 *    TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env vars are set to fake values so
 *    `resolveTelegramConfig` returns a config object. `sendApprovalRequest` is
 *    mocked to return `true` (message delivered) and `ApprovalManager` is
 *    mocked to return an immediately-resolved 'approved' promise, simulating a
 *    human clicking Approve in Telegram without any network I/O.
 *
 *  Slack stub (TC-HAP-13 … TC-HAP-14):
 *    Same approach via `sendSlackApprovalRequest`, which is mocked to return
 *    `{ ok: true, messageTs: 'mock-ts' }`. `ApprovalManager` is mocked
 *    identically to the Telegram stub.
 *
 * Test IDs: TC-HAP-01 … TC-HAP-14 (HITL Approve per-request)
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

interface LoadOpts {
  mode: 'open' | 'closed';
  hitl: HitlPolicyConfig;
}

/**
 * Loads a fresh copy of the plugin with the given mode and injected HITL
 * config. Calls `vi.resetModules()` to isolate each test from module-level
 * state accumulated by previous loads.
 */
async function loadPlugin(opts: LoadOpts): Promise<BeforeToolCallHandler> {
  process.env.CLAWTHORITY_MODE = opts.mode;
  process.env.OPENAUTH_FORCE_ACTIVE = '1';
  delete process.env.CLAWTHORITY_RULES_FILE;

  vi.resetModules();

  vi.doMock('./hitl/parser.js', async () => {
    const actual = await vi.importActual<typeof import('./hitl/parser.js')>(
      './hitl/parser.js',
    );
    return {
      ...actual,
      parseHitlPolicyFile: vi.fn(async () => opts.hitl),
    };
  });

  const mod = (await import('./index.js')) as {
    default: {
      activate: (ctx: OpenclawPluginContext) => Promise<void>;
      deactivate?: () => Promise<void>;
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

  await mod.default.activate(ctx);
  if (captured === undefined) {
    throw new Error('beforeToolCallHandler was not registered during activate()');
  }
  return captured;
}

const HOOK_CTX: HookContext = { agentId: 'agent-test', channelId: 'default' };

async function callHook(
  handler: BeforeToolCallHandler,
  toolName: string,
  params: Record<string, unknown> = {},
): Promise<BeforeToolCallResult | undefined> {
  const result = await handler({ toolName, params, source: 'user' }, HOOK_CTX);
  return result ?? undefined;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Policy covering all action classes via the 'test-unknown' channel.
 * `dispatchHitlChannel` returns `undefined` for unknown channels, which the
 * handler treats as "approved — proceed". Provides a deterministic,
 * network-free approval path for the per-class coverage suite.
 */
function makeAutoApprovePolicy(actions: string[]): HitlPolicyConfig {
  return {
    version: '1',
    policies: [
      {
        name: 'hitl-approve-test',
        actions,
        approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
      },
    ],
  };
}

// ─── Suite 1: per-class coverage via unknown-channel auto-approve ─────────────
//
// Covers one representative tool for every action class with
// default_hitl_mode: 'per_request'. The HITL policy uses 'test-unknown' as
// the channel so dispatchHitlChannel returns undefined (auto-approved).

describe('fine-grained tools — HITL approve (unknown-channel stub)', () => {
  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.SLACK_SIGNING_SECRET;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.SLACK_SIGNING_SECRET;
    vi.doUnmock('./hitl/parser.js');
    vi.doUnmock('./hitl/approval-manager.js');
    vi.doUnmock('./hitl/telegram.js');
    vi.doUnmock('./hitl/slack.js');
  });

  // ── TC-HAP-01: filesystem.write ───────────────────────────────────────────

  it('TC-HAP-01: write_file (filesystem.write) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['filesystem.write']),
    });
    const result = await callHook(handler, 'write_file', {
      file_path: '/workspace/report.txt',
      content: 'Generated output',
    });
    expect(result?.block).not.toBe(true);
  });

  // ── TC-HAP-02: filesystem.delete ─────────────────────────────────────────

  it('TC-HAP-02: delete_file (filesystem.delete) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['filesystem.delete']),
    });
    const result = await callHook(handler, 'delete_file', { path: '/tmp/old_log.txt' });
    expect(result?.block).not.toBe(true);
  });

  // ── TC-HAP-03: filesystem.write via edit_file ────────────────────────────

  it('TC-HAP-03: edit_file (filesystem.write) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['filesystem.write']),
    });
    const result = await callHook(handler, 'edit_file', {
      file_path: '/src/main.ts',
      content: 'export const x = 1;',
    });
    expect(result?.block).not.toBe(true);
  });

  // ── TC-HAP-04: filesystem.write via copy_file ────────────────────────────

  it('TC-HAP-04: copy_file (filesystem.write) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['filesystem.write']),
    });
    const result = await callHook(handler, 'copy_file', {
      source: '/src/template.ts',
      destination: '/dist/output.ts',
    });
    expect(result?.block).not.toBe(true);
  });

  // ── TC-HAP-05: filesystem.write via move_file ────────────────────────────

  it('TC-HAP-05: move_file (filesystem.write) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['filesystem.write']),
    });
    const result = await callHook(handler, 'move_file', {
      source: '/tmp/draft.md',
      destination: '/docs/final.md',
    });
    expect(result?.block).not.toBe(true);
  });

  // ── TC-HAP-06: vcs.write via git_checkout ────────────────────────────────

  it('TC-HAP-06: git_checkout (vcs.write) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['vcs.write']),
    });
    const result = await callHook(handler, 'git_checkout', { branch: 'feature/auth' });
    expect(result?.block).not.toBe(true);
  });

  // ── TC-HAP-07: vcs.write via git_add ─────────────────────────────────────

  it('TC-HAP-07: git_add (vcs.write) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['vcs.write']),
    });
    const result = await callHook(handler, 'git_add', { path: 'src/index.ts' });
    expect(result?.block).not.toBe(true);
  });

  // ── TC-HAP-08: vcs.remote via git_push ───────────────────────────────────

  it('TC-HAP-08: git_push (vcs.remote) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['vcs.remote']),
    });
    const result = await callHook(handler, 'git_push', {
      remote: 'origin',
      branch: 'main',
    });
    expect(result?.block).not.toBe(true);
  });

  // ── TC-HAP-09: archive.create ────────────────────────────────────────────

  it('TC-HAP-09: archive_create (archive.create) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['archive.create']),
    });
    const result = await callHook(handler, 'archive_create', {
      source: '/workspace/dist',
      destination: '/releases/v1.0.tar.gz',
    });
    expect(result?.block).not.toBe(true);
  });

  // ── TC-HAP-10: archive.extract ───────────────────────────────────────────

  it('TC-HAP-10: archive_extract (archive.extract) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['archive.extract']),
    });
    const result = await callHook(handler, 'archive_extract', {
      source: '/releases/v1.0.tar.gz',
      destination: '/workspace/dist',
    });
    expect(result?.block).not.toBe(true);
  });
});

// ─── Suite 2: Telegram stub ───────────────────────────────────────────────────
//
// Configures the plugin with `channel: 'telegram'` and fake env vars so
// `resolveTelegramConfig` returns a valid config. The `sendApprovalRequest`
// function is mocked to return `true` (simulating successful message delivery).
// The `ApprovalManager` is mocked to return an immediately-resolved 'approved'
// promise, simulating a human clicking Approve in the Telegram chat.

describe('fine-grained tools — HITL approve (Telegram stub)', () => {
  const TELEGRAM_POLICY: HitlPolicyConfig = {
    version: '1',
    policies: [
      {
        name: 'telegram-approvals',
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

  async function loadWithTelegramStub(): Promise<BeforeToolCallHandler> {
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.resetModules();

    // Stub the ApprovalManager to return an immediately-resolved 'approved'
    // promise, simulating a human clicking Approve in the Telegram chat.
    vi.doMock('./hitl/approval-manager.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/approval-manager.js')>(
        './hitl/approval-manager.js',
      );
      return {
        ...actual,
        ApprovalManager: class MockApprovalManager {
          createApprovalRequest(_opts: unknown) {
            return {
              token: `mock-telegram-token-${Date.now()}`,
              promise: Promise.resolve('approved' as const),
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

    // Stub sendApprovalRequest to return true (message delivered) and
    // TelegramListener to a no-op so activate() doesn't start long-polling.
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

  // ── TC-HAP-11 ─────────────────────────────────────────────────────────────

  it(
    'TC-HAP-11: delete_file proceeds when Telegram approval is stubbed as approved',
    async () => {
      const handler = await loadWithTelegramStub();
      const result = await callHook(handler, 'delete_file', { path: '/tmp/stale-cache.log' });
      // Telegram stub resolves immediately as 'approved' → handler returns undefined → not blocked.
      expect(result?.block).not.toBe(true);
    },
  );

  // ── TC-HAP-12 ─────────────────────────────────────────────────────────────

  it(
    'TC-HAP-12: git_push proceeds when Telegram approval is stubbed as approved',
    async () => {
      const handler = await loadWithTelegramStub();
      const result = await callHook(handler, 'git_push', { remote: 'origin', branch: 'release' });
      expect(result?.block).not.toBe(true);
    },
  );
});

// ─── Suite 3: Slack stub ──────────────────────────────────────────────────────
//
// Same strategy as the Telegram stub suite but uses `channel: 'slack'`.
// `sendSlackApprovalRequest` is mocked to return `{ ok: true, messageTs: 'mock-ts' }`.
// `ApprovalManager` is mocked identically.

describe('fine-grained tools — HITL approve (Slack stub)', () => {
  const SLACK_POLICY: HitlPolicyConfig = {
    version: '1',
    policies: [
      {
        name: 'slack-approvals',
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

  async function loadWithSlackStub(): Promise<BeforeToolCallHandler> {
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.resetModules();

    // Stub the ApprovalManager to return an immediately-resolved 'approved'
    // promise, simulating a human clicking Approve in the Slack message.
    vi.doMock('./hitl/approval-manager.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/approval-manager.js')>(
        './hitl/approval-manager.js',
      );
      return {
        ...actual,
        ApprovalManager: class MockApprovalManager {
          createApprovalRequest(_opts: unknown) {
            return {
              token: `mock-slack-token-${Date.now()}`,
              promise: Promise.resolve('approved' as const),
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

    // Stub sendSlackApprovalRequest to return success with a fake messageTs and
    // SlackInteractionServer to a no-op so activate() doesn't bind an HTTP port.
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

  // ── TC-HAP-13 ─────────────────────────────────────────────────────────────

  it(
    'TC-HAP-13: write_file proceeds when Slack approval is stubbed as approved',
    async () => {
      const handler = await loadWithSlackStub();
      const result = await callHook(handler, 'write_file', {
        file_path: '/workspace/config.json',
        content: '{"env":"prod"}',
      });
      // Slack stub resolves immediately as 'approved' → handler returns undefined → not blocked.
      expect(result?.block).not.toBe(true);
    },
  );

  // ── TC-HAP-14 ─────────────────────────────────────────────────────────────

  it(
    'TC-HAP-14: git_checkout proceeds when Slack approval is stubbed as approved',
    async () => {
      const handler = await loadWithSlackStub();
      const result = await callHook(handler, 'git_checkout', { branch: 'release/2.0' });
      expect(result?.block).not.toBe(true);
    },
  );
});

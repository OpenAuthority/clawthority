/**
 * HITL-gated forbid routing e2e tests
 *
 * Proves the Stage-2 fix: Cedar `forbid` rules at priority < 100 are
 * "HITL-gated" — they defer the final decision to the HITL policy instead
 * of blocking immediately. With a matching HITL policy and operator
 * approval the tool call proceeds; without a matching policy (or without
 * HITL configured at all) the original forbid is upheld. Priority >= 100
 * forbids still block unconditionally regardless of HITL.
 *
 * Each test injects a synthetic HITL config via `vi.doMock` on the parser
 * module so we don't have to drop YAML files into the repo root. We use
 * `channel: 'test-unknown'` for the approve-side tests — `dispatchHitlChannel`
 * returns `undefined` for unknown channels, which the handler treats as
 * "approved, proceed", giving us a deterministic success path without
 * wiring up a real Telegram/Slack transport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BeforeToolCallHandler,
  BeforeToolCallResult,
  HookContext,
  OpenclawPluginContext,
} from './index.js';
import type { HitlPolicyConfig } from './hitl/types.js';

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

interface LoadOpts {
  mode: 'open' | 'closed';
  hitl?: HitlPolicyConfig;
}

/**
 * Loads a fresh copy of the plugin in the requested mode, optionally
 * injecting a HITL config via a mock of the policy parser. When `hitl` is
 * omitted, HITL is disabled (parser throws ENOENT, matching real "no
 * policy file" behavior).
 */
async function loadPlugin(opts: LoadOpts): Promise<BeforeToolCallHandler> {
  process.env.CLAWTHORITY_MODE = opts.mode;
  process.env.OPENAUTH_FORCE_ACTIVE = '1';
  vi.resetModules();

  vi.doMock('./hitl/parser.js', async () => {
    const actual = await vi.importActual<typeof import('./hitl/parser.js')>(
      './hitl/parser.js',
    );
    return {
      ...actual,
      parseHitlPolicyFile: vi.fn(async () => {
        if (opts.hitl === undefined) {
          const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return opts.hitl;
      }),
    };
  });

  const mod = (await import('./index.js')) as { default: {
    activate: (ctx: OpenclawPluginContext) => Promise<void>;
    deactivate?: () => Promise<void>;
  } };

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

// ─── Fixtures ───────────────────────────────────────────────────────────────

/**
 * HITL policy covering filesystem.delete via an "unknown" channel. An
 * unknown channel in `dispatchHitlChannel` returns undefined (no adapter),
 * which the handler treats as "approved — proceed". Gives us a deterministic
 * success path for the release test.
 */
const AUTO_APPROVE_DELETE_POLICY: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'delete-approvals',
      actions: ['filesystem.delete'],
      approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
    },
  ],
};

/**
 * Same shape but bound to Telegram with no bot token configured. The
 * dispatcher hits "telegram not configured" and applies fallback: 'deny'
 * → returns a block. Gives us a deterministic denial path.
 */
const FALLBACK_DENY_DELETE_POLICY: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'delete-approvals',
      actions: ['filesystem.delete'],
      approval: { channel: 'telegram', timeout: 60, fallback: 'deny' },
    },
  ],
};

/** A HITL config that covers no relevant action — proves "no match → uphold forbid". */
const IRRELEVANT_POLICY: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'unrelated',
      actions: ['payment.initiate'],
      approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
    },
  ],
};

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('HITL-gated forbid routing', () => {
  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.doUnmock('./hitl/parser.js');
  });

  // ── Priority 90: the HITL-gated tier ──────────────────────────────────────

  describe('priority-90 forbid (filesystem.delete) in CLOSED mode', () => {
    it('blocks when no HITL is configured (no operator to approve)', async () => {
      const handler = await loadPlugin({ mode: 'closed' });
      const result = await callHook(handler, 'delete_file', { path: '/tmp/x' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/delete|approval/i);
    });

    it('blocks when HITL is configured but no policy matches the action', async () => {
      const handler = await loadPlugin({ mode: 'closed', hitl: IRRELEVANT_POLICY });
      const result = await callHook(handler, 'delete_file', { path: '/tmp/x' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/delete|approval/i);
    });

    it('permits when a HITL policy matches and the operator approves', async () => {
      const handler = await loadPlugin({
        mode: 'closed',
        hitl: AUTO_APPROVE_DELETE_POLICY,
      });
      const result = await callHook(handler, 'delete_file', { path: '/tmp/x' });
      // Unknown-channel dispatch returns undefined → handler treats as approved.
      expect(result?.block).not.toBe(true);
    });

    it('blocks when HITL dispatch applies fallback: deny (e.g. transport unconfigured)', async () => {
      // Telegram channel without TELEGRAM_BOT_TOKEN → fallback: 'deny' path.
      const handler = await loadPlugin({
        mode: 'closed',
        hitl: FALLBACK_DENY_DELETE_POLICY,
      });
      const result = await callHook(handler, 'delete_file', { path: '/tmp/x' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/telegram|hitl|approval/i);
    });
  });

  // ── Priority 100: unconditional tier, HITL must NOT override ──────────────

  describe('priority-100 unconditional forbid (shell.exec)', () => {
    it('blocks even when HITL policy matches shell.exec', async () => {
      // A HITL policy trying to approve shell.exec must not override the
      // unconditional tier — `shell.exec` is priority 100, ships in both
      // modes, and should always block.
      const shellApprovalPolicy: HitlPolicyConfig = {
        version: '1',
        policies: [
          {
            name: 'shell-approvals',
            actions: ['shell.exec'],
            approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
          },
        ],
      };
      const handler = await loadPlugin({ mode: 'closed', hitl: shellApprovalPolicy });
      const result = await callHook(handler, 'bash', { command: 'ls' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/shell|forbidden/i);
    });

    it('blocks in OPEN mode too — critical-forbid ships in both modes', async () => {
      const handler = await loadPlugin({ mode: 'open' });
      const result = await callHook(handler, 'bash', { command: 'ls' });
      expect(result?.block).toBe(true);
    });
  });

  // ── OPEN-mode coverage — priority-90 rules ship only when in CRITICAL_ACTION_CLASSES ──

  describe('OPEN mode priority-90 shipped rules (credential.read)', () => {
    it('blocks when no HITL is configured', async () => {
      const handler = await loadPlugin({ mode: 'open' });
      const result = await callHook(handler, 'read_secret', { path: '/tmp/x' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/credential|approval/i);
    });

    it('permits when a matching HITL policy approves', async () => {
      const credentialPolicy: HitlPolicyConfig = {
        version: '1',
        policies: [
          {
            name: 'credential-approvals',
            actions: ['credential.read'],
            approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
          },
        ],
      };
      const handler = await loadPlugin({ mode: 'open', hitl: credentialPolicy });
      const result = await callHook(handler, 'read_secret', { path: '/tmp/x' });
      expect(result?.block).not.toBe(true);
    });
  });

  // ── Regression: the existing "permit + HITL match" flow still works ───────

  describe('pre-existing HITL flow (Cedar permit + HITL policy match)', () => {
    it('still dispatches HITL when Cedar permits and a policy matches', async () => {
      // filesystem.read is permitted at priority 10 in defaultRules, so Cedar
      // permits. A HITL policy matching filesystem.read should still route
      // through approval (no regression).
      const readPolicy: HitlPolicyConfig = {
        version: '1',
        policies: [
          {
            name: 'read-approvals',
            actions: ['filesystem.read'],
            approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
          },
        ],
      };
      const handler = await loadPlugin({ mode: 'closed', hitl: readPolicy });
      // Unknown channel → dispatcher returns undefined → handler treats as approved.
      const result = await callHook(handler, 'read_file', { path: '/tmp/x.txt' });
      expect(result?.block).not.toBe(true);
    });
  });
});

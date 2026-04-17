/**
 * Install-mode hook-handler e2e tests
 *
 * These tests exercise the PRODUCTION code path — `beforeToolCallHandler`
 * inside src/index.ts — rather than the parallel `runPipeline()` used by
 * the wider test suite. They pin the two guarantees an operator actually
 * relies on in production:
 *
 *   1. In `open` mode the hook PERMITS a tool call that normalizes to an
 *      unregistered action class (implicit permit via `defaultEffect`).
 *   2. In `open` mode the hook still BLOCKS a tool call that normalizes
 *      to a critical action class (`shell.exec` here) via the action-class
 *      forbid rule shipped in OPEN_MODE_RULES.
 *   3. In `closed` mode the hook BLOCKS the same unregistered action
 *      (implicit deny) and still permits read operations via the
 *      priority-10 `filesystem.read` permit from the full defaultRules.
 *
 * `CLAWTHORITY_MODE` is consumed at module-load time, so each test resets
 * the module cache via `vi.resetModules()` and dynamically re-imports
 * `./index.js` after setting the env var.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BeforeToolCallHandler,
  BeforeToolCallResult,
  HookContext,
  OpenclawPluginContext,
} from './index.js';

// ─── Mock chokidar so activation doesn't spin up a real FS watcher ──────────

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Activates a fresh copy of the plugin module in the given mode and returns
 * the registered `before_tool_call` handler. The module cache is reset
 * beforehand so `MODE` / `DEFAULT_EFFECT` / `ACTIVE_RULES` are re-computed
 * against the new env var.
 */
async function loadPluginInMode(
  mode: 'open' | 'closed',
): Promise<BeforeToolCallHandler> {
  process.env.CLAWTHORITY_MODE = mode;
  vi.resetModules();

  // Bypass the install-lifecycle gate so activate() doesn't short-circuit on
  // missing data/.installed.
  process.env.OPENAUTH_FORCE_ACTIVE = '1';

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

const HOOK_CTX: HookContext = {
  agentId: 'agent-test',
  channelId: 'default',
};

async function callHook(
  handler: BeforeToolCallHandler,
  toolName: string,
  params: Record<string, unknown> = {},
): Promise<BeforeToolCallResult | undefined> {
  // `source: 'user'` bypasses the untrusted-source Stage 1 gate so the test
  // specifically exercises the Cedar engine path this feature controls.
  const result = await handler(
    { toolName, params, source: 'user' },
    HOOK_CTX,
  );
  return result ?? undefined;
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('install mode — production hook handler', () => {
  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
  });

  describe('open', () => {
    it('permits a tool whose action_class has no matching rule (implicit permit)', async () => {
      const handler = await loadPluginInMode('open');
      // `read_file` normalizes to `filesystem.read`, which is NOT in
      // OPEN_MODE_RULES. With defaultEffect='permit' it must pass through.
      const result = await callHook(handler, 'read_file', { path: '/tmp/notes.txt' });
      expect(result?.block).not.toBe(true);
    });

    it('blocks shell.exec via the critical forbid in OPEN_MODE_RULES', async () => {
      const handler = await loadPluginInMode('open');
      const result = await callHook(handler, 'bash', { command: 'ls' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/shell|forbidden/i);
    });

    it('permits an unknown tool (unknown_sensitive_action falls through to implicit permit)', async () => {
      const handler = await loadPluginInMode('open');
      const result = await callHook(handler, 'totally_unknown_tool_xyz', {});
      // Unknown tools normalize to `unknown_sensitive_action`, which is NOT in
      // OPEN_MODE_RULES — so the implicit permit must win. OPEN mode is
      // zero-friction: unknown tools fall through unless a specific critical
      // forbid matches.
      expect(result?.block).not.toBe(true);
    });
  });

  describe('closed', () => {
    it('blocks a tool whose action_class has no matching forbid (implicit deny)', async () => {
      const handler = await loadPluginInMode('closed');
      // `write_file` normalizes to `filesystem.write`; there is no permit rule
      // for it in the default set. With defaultEffect='forbid' it must block.
      const result = await callHook(handler, 'write_file', {
        path: '/tmp/notes.txt',
        content: 'hi',
      });
      expect(result?.block).toBe(true);
    });

    it('permits filesystem.read via the priority-10 default permit rule', async () => {
      const handler = await loadPluginInMode('closed');
      const result = await callHook(handler, 'read_file', { path: '/tmp/notes.txt' });
      expect(result?.block).not.toBe(true);
    });

    it('blocks shell.exec (hard forbid, closed mode)', async () => {
      const handler = await loadPluginInMode('closed');
      const result = await callHook(handler, 'bash', { command: 'ls' });
      expect(result?.block).toBe(true);
    });
  });
});

/**
 * Fine-grained tools — default forbid rules e2e tests
 *
 * Verifies that each tool carrying a default forbid rule is blocked at the
 * expected enforcement stage and produces the correct block reason.
 *
 * Priority tiers under test:
 *   90  — HITL-gated forbid: blocks when no matching HITL policy is configured.
 *         The forbid can be released by operator approval via a matching policy.
 *   100 — Unconditional forbid: always blocks regardless of HITL configuration.
 *
 * Unless noted otherwise, tests run in CLOSED mode. OPEN-mode coverage is
 * included for the CRITICAL_ACTION_CLASSES subset (shell.exec, code.execute,
 * payment.initiate, credential.read, credential.write) which ship in both modes.
 *
 * unknown_sensitive_action (priority 100) is closed-mode only: in OPEN mode
 * unrecognised tools fall through to the implicit permit.
 *
 * Tool aliases exercised per class:
 *   filesystem.delete   delete_file, rm
 *   payment.initiate    pay, initiate_payment
 *   credential.read     read_secret, get_credential
 *   credential.write    write_secret, set_credential
 *   shell.exec          bash, run_command
 *   code.execute        run_code, python
 *   unknown             unrecognised_tool_xyz (no registry alias)
 *
 * Test IDs: TC-FGB-01 … TC-FGB-21 (Fine-Grained tools Block)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BeforeToolCallHandler,
  BeforeToolCallResult,
  HookContext,
  OpenclawPluginContext,
} from './index.js';
import type { HitlPolicyConfig } from './hitl/types.js';

const NO_JSON_RULES_FILE = '/tmp/clawthority-fine-grained-no-rules.json';
const NO_AUTO_PERMITS_FILE = '/tmp/clawthority-fine-grained-no-auto-permits.json';

// ─── Shared stubs ────────────────────────────────────────────────────────────

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// Capture audit entries so tests can assert enforcement stage and priority
// without touching the real on-disk audit log.
const auditEntries: Array<Record<string, unknown>> = [];
vi.mock('./audit.js', async () => {
  const actual = await vi.importActual<typeof import('./audit.js')>('./audit.js');
  return {
    ...actual,
    JsonlAuditLogger: class StubJsonlAuditLogger {
      constructor(_opts: { logFile: string }) {}
      log(entry: Record<string, unknown>): Promise<void> {
        auditEntries.push(entry);
        return Promise.resolve();
      }
      flush(): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface LoadOpts {
  mode: 'open' | 'closed';
  /**
   * HITL policy to inject via the parser mock. When omitted the parser throws
   * ENOENT, matching real "no policy file" behaviour (HITL not configured).
   */
  hitl?: HitlPolicyConfig;
}

/**
 * Loads a fresh copy of the plugin in the requested mode, optionally
 * injecting a HITL config via a mock of the policy parser. Calls
 * `vi.resetModules()` to isolate each test from accumulated module state.
 */
async function loadPlugin(opts: LoadOpts): Promise<BeforeToolCallHandler> {
  process.env.CLAWTHORITY_MODE = opts.mode;
  process.env.OPENAUTH_FORCE_ACTIVE = '1';
  process.env.CLAWTHORITY_RULES_FILE = NO_JSON_RULES_FILE;
  process.env.CLAWTHORITY_AUTO_PERMIT_STORE = NO_AUTO_PERMITS_FILE;

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

const HOOK_CTX: HookContext = { agentId: 'agent-forbid-test', channelId: 'default' };

async function callHook(
  handler: BeforeToolCallHandler,
  toolName: string,
  params: Record<string, unknown> = {},
): Promise<BeforeToolCallResult | undefined> {
  const result = await handler({ toolName, params, source: 'user' }, HOOK_CTX);
  return result ?? undefined;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Returns a HITL policy covering an action unrelated to the one under test.
 * Proves that a "no matching policy" path upholds the forbid.
 */
function makeIrrelevantPolicy(unrelatedAction: string): HitlPolicyConfig {
  return {
    version: '1',
    policies: [
      {
        name: 'irrelevant',
        actions: [unrelatedAction],
        approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
      },
    ],
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('fine-grained tools — default forbid rules', () => {
  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    auditEntries.length = 0;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    delete process.env.CLAWTHORITY_AUTO_PERMIT_STORE;
    vi.doUnmock('./hitl/parser.js');
  });

  // ── Priority 90: filesystem.delete ────────────────────────────────────────

  describe('priority-90 HITL-gated forbid — filesystem.delete', () => {
    it('TC-FGB-01: delete_file is blocked in CLOSED mode when no HITL is configured', async () => {
      const handler = await loadPlugin({ mode: 'closed' });
      const result = await callHook(handler, 'delete_file', { path: '/tmp/important.txt' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/delete|approval/i);
    });

    it('TC-FGB-02: rm is blocked in CLOSED mode when the HITL policy covers a different action', async () => {
      const handler = await loadPlugin({
        mode: 'closed',
        hitl: makeIrrelevantPolicy('payment.initiate'),
      });
      const result = await callHook(handler, 'rm', { path: '/var/log/app.log' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/delete|approval/i);
    });
  });

  // ── Priority 90: payment.initiate ─────────────────────────────────────────

  describe('priority-90 HITL-gated forbid — payment.initiate', () => {
    it('TC-FGB-03: pay is blocked in CLOSED mode when no HITL is configured', async () => {
      const handler = await loadPlugin({ mode: 'closed' });
      const result = await callHook(handler, 'pay', {
        amount: 150,
        currency: 'USD',
        to: 'vendor@example.com',
      });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/payment|approval/i);
    });

    it('TC-FGB-04: initiate_payment is blocked in CLOSED mode when the HITL policy covers a different action', async () => {
      const handler = await loadPlugin({
        mode: 'closed',
        hitl: makeIrrelevantPolicy('filesystem.delete'),
      });
      const result = await callHook(handler, 'initiate_payment', { amount: 200 });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/payment|approval/i);
    });
  });

  // ── Priority 90: credential.read ──────────────────────────────────────────

  describe('priority-90 HITL-gated forbid — credential.read', () => {
    it('TC-FGB-05: read_secret is blocked in CLOSED mode when no HITL is configured', async () => {
      const handler = await loadPlugin({ mode: 'closed' });
      const result = await callHook(handler, 'read_secret', { key: 'DB_PASSWORD' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/credential|approval/i);
    });

    it('TC-FGB-06: get_credential is blocked in CLOSED mode when the HITL policy covers a different action', async () => {
      const handler = await loadPlugin({
        mode: 'closed',
        hitl: makeIrrelevantPolicy('filesystem.delete'),
      });
      const result = await callHook(handler, 'get_credential', { key: 'API_KEY' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/credential|approval/i);
    });
  });

  // ── Priority 90: credential.write ─────────────────────────────────────────

  describe('priority-90 HITL-gated forbid — credential.write', () => {
    it('TC-FGB-07: write_secret is blocked in CLOSED mode when no HITL is configured', async () => {
      const handler = await loadPlugin({ mode: 'closed' });
      const result = await callHook(handler, 'write_secret', { key: 'TOKEN', value: 'abc123' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/credential|approval/i);
    });

    it('TC-FGB-08: set_credential is blocked in CLOSED mode when the HITL policy covers a different action', async () => {
      const handler = await loadPlugin({
        mode: 'closed',
        hitl: makeIrrelevantPolicy('payment.initiate'),
      });
      const result = await callHook(handler, 'set_credential', { key: 'SECRET', value: 'xyz' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/credential|approval/i);
    });
  });

  // ── Priority 90: shell.exec (HITL-gated) ─────────────────────────────────

  describe('priority-90 HITL-gated forbid — shell.exec', () => {
    it('TC-FGB-09: bash is blocked in CLOSED mode when no HITL is configured', async () => {
      const handler = await loadPlugin({ mode: 'closed' });
      const result = await callHook(handler, 'bash', { command: 'ls -la /etc' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/shell|approval/i);
    });

    it('TC-FGB-10: bash is blocked in OPEN mode when no HITL is configured', async () => {
      const handler = await loadPlugin({ mode: 'open' });
      const result = await callHook(handler, 'bash', { command: 'pwd' });
      expect(result?.block).toBe(true);
    });

    it('TC-FGB-11: run_command is permitted when a HITL policy covers shell.exec and approves', async () => {
      const shellPolicy: HitlPolicyConfig = {
        version: '1',
        policies: [
          {
            name: 'shell-approvals',
            actions: ['shell.exec'],
            approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
          },
        ],
      };
      const handler = await loadPlugin({ mode: 'closed', hitl: shellPolicy });
      const result = await callHook(handler, 'run_command', { command: 'cat /etc/passwd' });
      expect(result?.block).not.toBe(true);
    });
  });

  // ── Priority 100: code.execute (unconditional) ────────────────────────────

  describe('priority-100 unconditional forbid — code.execute', () => {
    it('TC-FGB-12: run_code is blocked in CLOSED mode (unconditional priority-100 forbid)', async () => {
      const handler = await loadPlugin({ mode: 'closed' });
      const result = await callHook(handler, 'run_code', { code: 'print("hello")' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/code|forbidden/i);
    });

    it('TC-FGB-13: run_code is blocked in OPEN mode — code.execute ships as a critical class in both modes', async () => {
      const handler = await loadPlugin({ mode: 'open' });
      const result = await callHook(handler, 'run_code', { code: '1 + 1' });
      expect(result?.block).toBe(true);
    });

    it('TC-FGB-14: python is blocked even when a HITL policy covers code.execute — priority-100 forbids cannot be overridden by HITL', async () => {
      const codePolicy: HitlPolicyConfig = {
        version: '1',
        policies: [
          {
            name: 'code-approvals',
            actions: ['code.execute'],
            approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
          },
        ],
      };
      const handler = await loadPlugin({ mode: 'closed', hitl: codePolicy });
      const result = await callHook(handler, 'python', { code: 'import os; os.system("id")' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/code|forbidden/i);
    });
  });

  // ── Priority 100: unknown_sensitive_action (CLOSED mode fail-closed) ──────

  describe('priority-100 unconditional forbid — unknown_sensitive_action (CLOSED mode)', () => {
    it('TC-FGB-15: an unrecognised tool is blocked in CLOSED mode (fail-closed catch-all)', async () => {
      const handler = await loadPlugin({ mode: 'closed' });
      const result = await callHook(handler, 'unrecognised_tool_xyz', { data: 'anything' });
      expect(result?.block).toBe(true);
    });

    it('TC-FGB-16: an unrecognised tool does NOT block in OPEN mode — unknown_sensitive_action is excluded from open-mode rules', async () => {
      const handler = await loadPlugin({ mode: 'open' });
      const result = await callHook(handler, 'unrecognised_tool_xyz', { data: 'anything' });
      expect(result?.block).not.toBe(true);
    });
  });

  // ── OPEN mode: CRITICAL_ACTION_CLASSES remain forbidden ───────────────────

  describe('OPEN mode — critical action classes block in both modes', () => {
    it('TC-FGB-17: read_secret (credential.read) blocks in OPEN mode', async () => {
      const handler = await loadPlugin({ mode: 'open' });
      const result = await callHook(handler, 'read_secret', { key: 'PROD_SECRET' });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/credential|approval/i);
    });

    it('TC-FGB-18: write_secret (credential.write) blocks in OPEN mode', async () => {
      const handler = await loadPlugin({ mode: 'open' });
      const result = await callHook(handler, 'write_secret', {
        key: 'PROD_SECRET',
        value: 'new-val',
      });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/credential|approval/i);
    });

    it('TC-FGB-19: pay (payment.initiate) blocks in OPEN mode', async () => {
      const handler = await loadPlugin({ mode: 'open' });
      const result = await callHook(handler, 'pay', { amount: 500 });
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/payment|approval/i);
    });
  });

  // ── Audit log: forbid decisions write structured policy entries ───────────

  describe('audit log — forbid decisions write structured policy entries', () => {
    it('TC-FGB-20: priority-90 forbid (shell.exec) writes a hitl-gated entry with priority=90', async () => {
      const handler = await loadPlugin({ mode: 'closed' });
      await callHook(handler, 'bash', { command: 'whoami' });
      const gatedForbids = auditEntries.filter(
        (e) => e['type'] === 'policy' && e['stage'] === 'hitl-gated',
      );
      expect(gatedForbids).toHaveLength(1);
      expect(gatedForbids[0]).toMatchObject({
        type: 'policy',
        effect: 'forbid',
        stage: 'hitl-gated',
        priority: 90,
        actionClass: 'shell.exec',
      });
    });

    it('TC-FGB-21: priority-90 HITL-gated forbid (filesystem.delete) writes a hitl-gated entry with priority=90', async () => {
      const handler = await loadPlugin({ mode: 'closed' });
      await callHook(handler, 'delete_file', { path: '/tmp/target.txt' });
      const gated = auditEntries.filter(
        (e) => e['type'] === 'policy' && e['stage'] === 'hitl-gated',
      );
      expect(gated).toHaveLength(1);
      expect(gated[0]).toMatchObject({
        type: 'policy',
        effect: 'forbid',
        stage: 'hitl-gated',
        priority: 90,
        actionClass: 'filesystem.delete',
      });
    });
  });
});

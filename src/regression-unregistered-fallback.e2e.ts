/**
 * Regression: unregistered tool fallback behaviour (W10)
 *
 * Tools whose names do not match any alias in the @openclaw/action-registry
 * are classified as `unknown_sensitive_action`. The enforcement pipeline
 * must apply the correct fallback for each mode:
 *
 *  CLOSED mode — unknown_sensitive_action carries an unconditional priority-100
 *    forbid rule. Unregistered tools are always blocked regardless of HITL config.
 *
 *  OPEN mode — the unknown_sensitive_action rule is intentionally excluded from
 *    OPEN_MODE_RULES (see default.ts). Unregistered tools fall through to the
 *    implicit permit, enabling zero-friction development with novel tools.
 *
 * Regression anchor — 23 Apr scenario:
 *   Operator-supplied rules.json entries can overlay the implicit permit in OPEN
 *   mode. A rules.json entry with effect: 'forbid' targeting a specific tool name
 *   (resource: 'tool', match: '<name>') blocks that tool even in OPEN mode,
 *   regardless of its registry status. This behaviour is validated by
 *   regression-rules-json-forbid.e2e.ts (TC-RRF-01…TC-RRF-05); the tests
 *   below cover additional surface area for unregistered tool patterns.
 *
 * Test IDs: TC-URF-01 … TC-URF-08 (Unregistered tool Fallback)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BeforeToolCallHandler,
  BeforeToolCallResult,
  HookContext,
  OpenclawPluginContext,
} from './index.js';
import type { HitlPolicyConfig } from './hitl/types.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';

// ─── Shared stubs ────────────────────────────────────────────────────────────

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

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
  hitl?: HitlPolicyConfig;
  /** Path to a temp rules.json file to inject via CLAWTHORITY_RULES_FILE. */
  jsonRulesFile?: string;
}

async function loadPlugin(opts: LoadOpts): Promise<BeforeToolCallHandler> {
  process.env.CLAWTHORITY_MODE = opts.mode;
  process.env.OPENAUTH_FORCE_ACTIVE = '1';

  if (opts.jsonRulesFile !== undefined) {
    process.env.CLAWTHORITY_RULES_FILE = opts.jsonRulesFile;
  } else {
    delete process.env.CLAWTHORITY_RULES_FILE;
  }

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
    default: { activate: (ctx: OpenclawPluginContext) => Promise<void> };
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
  if (captured === undefined) throw new Error('beforeToolCallHandler was not registered');
  return captured;
}

const HOOK_CTX: HookContext = { agentId: 'agent-urf-test', channelId: 'default' };

async function callHook(
  handler: BeforeToolCallHandler,
  toolName: string,
  params: Record<string, unknown> = {},
): Promise<BeforeToolCallResult | undefined> {
  const result = await handler({ toolName, params, source: 'user' }, HOOK_CTX);
  return result ?? undefined;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('unregistered tool fallback — regression tests', () => {
  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    auditEntries.length = 0;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.doUnmock('./hitl/parser.js');
  });

  // ── CLOSED mode: unknown tools are fail-closed ────────────────────────────

  it('TC-URF-01: a novel unregistered tool is blocked in CLOSED mode (fail-closed catch-all)', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    const result = await callHook(handler, 'novel_unregistered_tool_abc', { data: 'anything' });
    expect(result?.block).toBe(true);
  });

  it('TC-URF-02: a camelCase unregistered tool name is blocked in CLOSED mode', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    const result = await callHook(handler, 'MyCustomTool', { payload: '{}' });
    expect(result?.block).toBe(true);
  });

  it('TC-URF-03: an unregistered tool with underscore prefix is blocked in CLOSED mode', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    const result = await callHook(handler, '_internal_action_xyz', { params: {} });
    expect(result?.block).toBe(true);
  });

  it('TC-URF-04: an unregistered tool with a HITL policy for a different action is still blocked in CLOSED mode', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: {
        version: '1',
        policies: [
          {
            name: 'unrelated-policy',
            actions: ['filesystem.write'],
            approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
          },
        ],
      },
    });
    const result = await callHook(handler, 'unknown_exotic_operation', { target: 'x' });
    expect(result?.block).toBe(true);
  });

  // ── OPEN mode: unknown tools fall through to implicit permit ──────────────

  it('TC-URF-05: a novel unregistered tool is NOT blocked in OPEN mode (implicit permit)', async () => {
    const handler = await loadPlugin({ mode: 'open' });
    const result = await callHook(handler, 'novel_unregistered_tool_abc', { data: 'anything' });
    expect(result?.block).not.toBe(true);
  });

  it('TC-URF-06: a camelCase unregistered tool is NOT blocked in OPEN mode', async () => {
    const handler = await loadPlugin({ mode: 'open' });
    const result = await callHook(handler, 'MyCustomTool', { payload: '{}' });
    expect(result?.block).not.toBe(true);
  });

  // ── Audit log: CLOSED mode unregistered tool writes structured entry ──────

  it('TC-URF-07: unregistered tool in CLOSED mode writes a forbid audit entry with unknown_sensitive_action class', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    await callHook(handler, 'phantom_tool_zzz', { input: 'test' });
    const forbids = auditEntries.filter(
      (e) => e['type'] === 'policy' && e['effect'] === 'forbid',
    );
    expect(forbids.length).toBeGreaterThanOrEqual(1);
    // The action class for unregistered tools is unknown_sensitive_action
    const entry = forbids.find((e) => e['actionClass'] === 'unknown_sensitive_action');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      type: 'policy',
      effect: 'forbid',
      actionClass: 'unknown_sensitive_action',
    });
  });

  // ── 23 Apr regression: rules.json forbid blocks unregistered tool in OPEN ─

  it('TC-URF-08: rules.json tool-level forbid blocks an unregistered tool name even in OPEN mode', async () => {
    // Write a temp rules.json with a tool-level forbid for the specific unregistered tool.
    const tmpFile = join(tmpdir(), `urf-rules-${Date.now()}.json`);
    const rules = [
      {
        effect: 'forbid',
        resource: 'tool',
        match: 'dangerous_unlisted_tool',
        priority: 95,
        reason: 'This specific unregistered tool is explicitly blocked by operator policy.',
        tags: ['security', 'explicit-block'],
      },
    ];
    writeFileSync(tmpFile, JSON.stringify(rules, null, 2));

    try {
      const handler = await loadPlugin({ mode: 'open', jsonRulesFile: tmpFile });
      const result = await callHook(handler, 'dangerous_unlisted_tool', { cmd: 'rm -rf /' });
      // In OPEN mode, unregistered tools normally fall through to the implicit permit.
      // But an explicit rules.json forbid overrides the implicit permit.
      expect(result?.block).toBe(true);
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
    }
  });
});

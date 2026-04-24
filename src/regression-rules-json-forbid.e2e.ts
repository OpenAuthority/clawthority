/**
 * Regression test suite: rules.json forbid rules block correctly and emit audit
 *
 * Covers the 23 Apr scenario where a `tool:read` → forbid rule at priority 200
 * defined via CLAWTHORITY_RULES_FILE (resource/match form) was not blocking
 * the action and was not emitting a structured audit entry. These tests assert
 * the full path: rule loaded → action blocked → audit entry written.
 *
 * Rule form under test (resource/match):
 *   { resource: "tool", match: "read_file", effect: "forbid", priority: 200 }
 *
 * Priority model:
 *   priority >= 100 → unconditional forbid (cannot be overridden by HITL)
 *   priority 200    → unconditional forbid; higher value than built-in
 *                     priority-100 Cedar defaults but semantically identical
 *
 * Audit stage emitted for json-rules forbids: `json-rules`
 *
 *  TC-RRF-01  priority-200 json-rules forbid blocks read_file in OPEN mode
 *             (23 Apr scenario — filesystem.read is normally permitted in open mode;
 *             the operator-supplied json rule must override it)
 *  TC-RRF-02  priority-200 json-rules forbid emits an audit entry with
 *             stage='json-rules' and priority=200
 *  TC-RRF-03  priority ordering: priority-200 json-rules forbid wins over the
 *             implicit Cedar permit in open mode (without the rule, read_file
 *             passes; with it, read_file is blocked)
 *  TC-RRF-04  priority-200 json-rules forbid is unconditional — it blocks even
 *             when no HITL policy is configured (not HITL-gated)
 *  TC-RRF-05  priority-200 json-rules forbid blocks in CLOSED mode as well
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  BeforeToolCallHandler,
  BeforeToolCallResult,
  HookContext,
  OpenclawPluginContext,
} from './index.js';
import type { HitlPolicyConfig } from './hitl/types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Prevent real chokidar watchers from spinning up during unit-style e2e tests.
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// Capture audit entries without touching the on-disk audit log.
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
  jsonRules?: Array<Record<string, unknown>>;
}

const tempFiles = new Set<string>();

/**
 * Loads a fresh copy of the plugin with the given mode and optional JSON rules.
 * JSON rules are written to a temp file and pointed to via CLAWTHORITY_RULES_FILE.
 * Calls vi.resetModules() so each test starts from a clean module state.
 */
async function loadPlugin(opts: LoadOpts): Promise<BeforeToolCallHandler> {
  process.env.CLAWTHORITY_MODE = opts.mode;
  process.env.OPENAUTH_FORCE_ACTIVE = '1';

  if (opts.jsonRules !== undefined) {
    const tmpPath = join(
      tmpdir(),
      `oa-rrjf-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    await writeFile(tmpPath, JSON.stringify(opts.jsonRules), 'utf-8');
    process.env.CLAWTHORITY_RULES_FILE = tmpPath;
    tempFiles.add(tmpPath);
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

const HOOK_CTX: HookContext = { agentId: 'agent-rrjf-test', channelId: 'default' };

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
 * The 23 Apr regression rule: resource/match form targeting the read_file tool
 * at priority 200 (unconditional forbid — priority >= 100).
 *
 * Operator intent: block all `read_file` calls regardless of HITL configuration.
 */
const RULE_TOOL_READ_200: Record<string, unknown> = {
  resource: 'tool',
  match: 'read_file',
  effect: 'forbid',
  priority: 200,
  reason: '23-apr-regression: read_file blocked by operator priority-200 rule',
  tags: ['regression', 'audit'],
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('regression: rules.json forbid at priority 200 — 23 Apr scenario', () => {
  beforeEach(() => {
    auditEntries.length = 0;
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
  });

  afterEach(async () => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.doUnmock('./hitl/parser.js');
    for (const path of tempFiles) {
      await rm(path, { force: true }).catch(() => undefined);
    }
    tempFiles.clear();
  });

  // ── TC-RRF-01 ──────────────────────────────────────────────────────────────

  it(
    'TC-RRF-01: priority-200 json-rules forbid (tool:read) blocks read_file in OPEN mode',
    async () => {
      // In OPEN mode filesystem.read is normally permitted. The priority-200
      // operator rule in CLAWTHORITY_RULES_FILE must override the implicit permit.
      const handler = await loadPlugin({
        mode: 'open',
        jsonRules: [RULE_TOOL_READ_200],
      });

      const result = await callHook(handler, 'read_file', { path: '/etc/config' });

      expect(result?.block).toBe(true);
      expect(result?.blockReason).toMatch(/read_file|23-apr|regression|operator/i);
    },
  );

  // ── TC-RRF-02 ──────────────────────────────────────────────────────────────

  it(
    'TC-RRF-02: priority-200 json-rules forbid emits a structured audit entry with stage=json-rules and priority=200',
    async () => {
      const handler = await loadPlugin({
        mode: 'open',
        jsonRules: [RULE_TOOL_READ_200],
      });

      await callHook(handler, 'read_file', { path: '/etc/config' });

      // The audit log must contain exactly one json-rules forbid entry.
      const jsonForbids = auditEntries.filter(
        (e) => e['stage'] === 'json-rules' && e['effect'] === 'forbid',
      );
      expect(jsonForbids).toHaveLength(1);
      expect(jsonForbids[0]).toMatchObject({
        type: 'policy',
        effect: 'forbid',
        stage: 'json-rules',
        priority: 200,
      });
    },
  );

  // ── TC-RRF-03 ──────────────────────────────────────────────────────────────

  it(
    'TC-RRF-03: priority ordering — priority-200 json-rules forbid wins over the implicit Cedar permit in open mode',
    async () => {
      // Without any json rule, read_file is permitted in OPEN mode.
      const permissiveHandler = await loadPlugin({ mode: 'open' });
      const permissiveResult = await callHook(permissiveHandler, 'read_file', {
        path: '/etc/config',
      });
      expect(permissiveResult?.block).not.toBe(true);

      // With the priority-200 json-rules forbid loaded, the same call must block.
      const restrictiveHandler = await loadPlugin({
        mode: 'open',
        jsonRules: [RULE_TOOL_READ_200],
      });
      const restrictiveResult = await callHook(restrictiveHandler, 'read_file', {
        path: '/etc/config',
      });
      expect(restrictiveResult?.block).toBe(true);

      // The audit log must contain a json-rules forbid entry at priority 200.
      const jsonForbids = auditEntries.filter(
        (e) => e['stage'] === 'json-rules' && e['effect'] === 'forbid',
      );
      expect(jsonForbids).toHaveLength(1);
      expect(jsonForbids[0]).toMatchObject({ priority: 200 });
    },
  );

  // ── TC-RRF-04 ──────────────────────────────────────────────────────────────

  it(
    'TC-RRF-04: priority-200 json-rules forbid is unconditional — blocks even with no HITL policy configured',
    async () => {
      // No HITL policy is injected (hitl: undefined → ENOENT simulation).
      // Priority 200 >= UNCONDITIONAL_FORBID_PRIORITY (100) so HITL cannot release it.
      const handler = await loadPlugin({
        mode: 'open',
        jsonRules: [RULE_TOOL_READ_200],
      });

      const result = await callHook(handler, 'read_file', { path: '/home/user/notes.txt' });

      expect(result?.block).toBe(true);

      // The block must come from the json-rules stage (not hitl-gated stage).
      const jsonForbidEntry = auditEntries.find(
        (e) => e['stage'] === 'json-rules' && e['effect'] === 'forbid',
      );
      expect(jsonForbidEntry).toBeDefined();

      // No hitl-gated entry should be present — priority 200 is unconditional.
      const hitlGatedEntries = auditEntries.filter((e) => e['stage'] === 'hitl-gated');
      expect(hitlGatedEntries).toHaveLength(0);
    },
  );

  // ── TC-RRF-05 ──────────────────────────────────────────────────────────────

  it(
    'TC-RRF-05: priority-200 json-rules forbid blocks in CLOSED mode (not just OPEN mode)',
    async () => {
      const handler = await loadPlugin({
        mode: 'closed',
        jsonRules: [RULE_TOOL_READ_200],
      });

      const result = await callHook(handler, 'read_file', { path: '/etc/passwd' });

      expect(result?.block).toBe(true);
      const jsonForbidEntry = auditEntries.find(
        (e) => e['stage'] === 'json-rules' && e['effect'] === 'forbid' && e['priority'] === 200,
      );
      expect(jsonForbidEntry).toBeDefined();
    },
  );
});

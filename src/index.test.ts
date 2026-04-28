/**
 * Unit coverage for `beforeToolCallHandler` in `src/index.ts`.
 *
 * The e2e suites (`src/exec-reclassification.e2e.ts`,
 * `src/hitl-gated-forbid.e2e.ts`) already exercise the handler end-to-end,
 * but `vitest.config.ts` excludes `*.e2e.ts` from the unit-coverage report
 * so those cases don't count toward the `src/index.ts` threshold. This
 * file re-uses the same activation-and-invoke pattern under a `.test.ts`
 * name so the covered branches land in the unit-test coverage tally.
 *
 * Keep cases minimal — one per distinct handler path. Deep scenario
 * coverage (Rule 4/5/6/7/8 matrices, HITL approval release, audit entry
 * shape, priority-100 bypass) lives in the e2e files.
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

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Keep the activation code from spinning up real filesystem watchers.
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// Stub the audit logger so tests can assert the structured decision shape
// without writing to `data/audit.jsonl`.
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

// ─── Helpers ────────────────────────────────────────────────────────────────

interface LoadOpts {
  mode: 'open' | 'closed';
  hitl?: HitlPolicyConfig;
  jsonRules?: Array<Record<string, unknown>>;
  autoPermitRules?: Array<Record<string, unknown>>;
}

const tempFiles = new Set<string>();

async function loadPlugin(opts: LoadOpts): Promise<BeforeToolCallHandler> {
  process.env.CLAWTHORITY_MODE = opts.mode;
  process.env.OPENAUTH_FORCE_ACTIVE = '1';

  if (opts.jsonRules !== undefined) {
    const tmpPath = join(
      tmpdir(),
      `oa-unit-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    await writeFile(tmpPath, JSON.stringify(opts.jsonRules), 'utf-8');
    process.env.CLAWTHORITY_RULES_FILE = tmpPath;
    tempFiles.add(tmpPath);
  } else {
    delete process.env.CLAWTHORITY_RULES_FILE;
  }

  if (opts.autoPermitRules !== undefined) {
    const tmpPath = join(
      tmpdir(),
      `oa-ap-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    await writeFile(tmpPath, JSON.stringify(opts.autoPermitRules), 'utf-8');
    process.env.CLAWTHORITY_AUTO_PERMIT_STORE = tmpPath;
    tempFiles.add(tmpPath);
  } else {
    delete process.env.CLAWTHORITY_AUTO_PERMIT_STORE;
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

async function call(
  handler: BeforeToolCallHandler,
  toolName: string,
  params: Record<string, unknown> = {},
  source: 'user' | 'agent' | 'web' = 'user',
): Promise<BeforeToolCallResult | undefined> {
  const result = await handler({ toolName, params, source }, HOOK_CTX);
  return result ?? undefined;
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('beforeToolCallHandler — unit coverage', () => {
  beforeEach(() => {
    auditEntries.length = 0;
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    delete process.env.CLAWTHORITY_AUTO_PERMIT_STORE;
  });

  afterEach(async () => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    delete process.env.CLAWTHORITY_AUTO_PERMIT_STORE;
    vi.doUnmock('./hitl/parser.js');
    for (const path of tempFiles) {
      await rm(path, { force: true }).catch(() => undefined);
    }
    tempFiles.clear();
  });

  // ── Permit path (filesystem.read in OPEN mode) ────────────────────────────

  it('permits a filesystem.read call in OPEN mode and writes no audit entry', async () => {
    const handler = await loadPlugin({ mode: 'open' });
    const result = await call(handler, 'read_file', { path: '/tmp/notes.txt' });
    expect(result?.block).not.toBe(true);
    expect(auditEntries.filter((e) => e['type'] === 'policy')).toHaveLength(0);
  });

  // ── Cedar unconditional forbid (priority 100) ─────────────────────────────

  it('blocks shell.exec via the priority-100 critical forbid', async () => {
    const handler = await loadPlugin({ mode: 'open' });
    const result = await call(handler, 'bash', { command: 'ls' });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/shell|forbidden/i);
    const policyEntries = auditEntries.filter((e) => e['type'] === 'policy');
    expect(policyEntries).toHaveLength(1);
    expect(policyEntries[0]).toMatchObject({
      effect: 'forbid',
      stage: 'cedar',
      priority: 100,
      actionClass: 'shell.exec',
    });
  });

  // ── Stage-1 trust-gate block (untrusted source + high-risk action) ────────

  it('blocks an untrusted-source high-risk call at the Stage 1 trust gate', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    // `delete_file` normalises to filesystem.delete (high risk). Source 'web'
    // is treated as untrusted. Stage 1 rejects before any engine runs.
    const result = await call(handler, 'delete_file', { path: '/tmp/x' }, 'web');
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toBe('untrusted_source_high_risk');
    const trustEntry = auditEntries.find((e) => e['stage'] === 'stage1-trust');
    expect(trustEntry).toMatchObject({
      effect: 'forbid',
      stage: 'stage1-trust',
      actionClass: 'filesystem.delete',
    });
  });

  // ── HITL-gated Cedar forbid with no matching HITL policy ──────────────────

  it('upholds a priority-90 Cedar forbid when HITL is not configured', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    const result = await call(handler, 'delete_file', { path: '/tmp/x' });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/delete|approval/i);
    const entry = auditEntries.find((e) => e['stage'] === 'hitl-gated');
    expect(entry).toMatchObject({
      effect: 'forbid',
      stage: 'hitl-gated',
      priority: 90,
      actionClass: 'filesystem.delete',
    });
  });

  // ── HITL-gated Cedar forbid RELEASED by an unknown-channel approval ───────

  it('releases a priority-90 forbid when a matching HITL policy approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: {
        version: '1',
        policies: [
          {
            name: 'delete-approvals',
            actions: ['filesystem.delete'],
            // Unknown channel → dispatcher returns undefined → approved.
            approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
          },
        ],
      },
    });
    const result = await call(handler, 'delete_file', { path: '/tmp/x' });
    expect(result?.block).not.toBe(true);
    // Release path takes over HITL logging, so no `policy` entry is written.
    expect(auditEntries.filter((e) => e['type'] === 'policy')).toHaveLength(0);
  });

  // ── JSON-rules forbid (priority 100) ──────────────────────────────────────

  it('blocks via a user-supplied JSON rule (resource/match form)', async () => {
    const handler = await loadPlugin({
      mode: 'open',
      jsonRules: [
        {
          resource: 'tool',
          match: 'some_custom_tool',
          effect: 'forbid',
          reason: 'blocked by operator rule',
        },
      ],
    });
    const result = await call(handler, 'some_custom_tool', {});
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/operator|blocked/i);
    const entry = auditEntries.find((e) => e['stage'] === 'json-rules');
    expect(entry).toMatchObject({ effect: 'forbid', stage: 'json-rules' });
  });

  // ── Pre-existing HITL flow (Cedar permit + HITL policy match) ─────────────

  it('dispatches HITL on Cedar-permitted action when a policy matches (legacy flow)', async () => {
    const handler = await loadPlugin({
      mode: 'open',
      hitl: {
        version: '1',
        policies: [
          {
            name: 'read-approvals',
            actions: ['filesystem.read'],
            approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
          },
        ],
      },
    });
    const result = await call(handler, 'read_file', { path: '/tmp/x.txt' });
    // Unknown-channel dispatch returns undefined → approved → not blocked.
    expect(result?.block).not.toBe(true);
  });

  // Tests exercising Rules 4–8 (command-regex reclassification) were retired
  // alongside those rules in commit 403cb72. Surviving Rule 1–3 coverage lives
  // in `src/exec-reclassification.e2e.ts` and `src/enforcement/normalize.test.ts`.

  // ── Tool registry gate — pre-normalization check ──────────────────────────

  it('emits a registry warn for an unregistered tool and classifies it as unknown_sensitive_action', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const handler = await loadPlugin({ mode: 'open' });
      await call(handler, 'totally_unknown_tool_xyz', {});
      const registryWarns = warnSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && (args[0] as string).includes('[registry]'),
      );
      expect(registryWarns).toHaveLength(1);
      expect(registryWarns[0]![0]).toContain('totally_unknown_tool_xyz');
      expect(registryWarns[0]![0]).toContain('unknown_sensitive_action');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not emit a registry warn for a registered tool', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const handler = await loadPlugin({ mode: 'open' });
      await call(handler, 'read_file', { path: '/tmp/notes.txt' });
      const registryWarns = warnSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && (args[0] as string).includes('[registry]'),
      );
      expect(registryWarns).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // ── loadJsonRules: auto-permit merge (TC-LJR-AP-01) ───────────────────────

  it('activates without error when auto-permits.json is absent (missing file handled gracefully)', async () => {
    // Use a temp path that does not exist as the auto-permit store.
    // loadPlugin with an explicit autoPermitRules array pointing to a real
    // (but schema-invalid) path would work too, but the simplest case is to
    // verify that the default missing-file path is handled gracefully. We use
    // a jsonRules fixture so CLAWTHORITY_RULES_FILE is controlled and rules.json
    // path resolution in loadJsonRules cannot affect the outcome.
    const handler = await loadPlugin({ mode: 'open', jsonRules: [] });
    // Default data/auto-permits.json is absent; plugin must still activate.
    const result = await call(handler, 'read_file', { path: '/tmp/notes.txt' });
    expect(result?.block).not.toBe(true);
  });

  // ── loadJsonRules: auto-permit merge (TC-LJR-AP-02) ───────────────────────

  it('merges auto-permit rules from auto-permits.json and logs the count', async () => {
    const logMessages: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string') logMessages.push(args[0] as string);
    });
    try {
      // Provide an empty jsonRules array so CLAWTHORITY_RULES_FILE controls the
      // rules path; auto-permits are loaded from the separate temp file.
      await loadPlugin({
        mode: 'open',
        jsonRules: [],
        autoPermitRules: [
          {
            pattern: 'git commit *',
            method: 'default',
            createdAt: Date.now(),
            originalCommand: 'git commit -m "fix"',
          },
        ],
      });
      // logMessages collects every console.log call made during activate().
      // The merged auto-permit rule count must appear in at least one message.
      expect(logMessages.join('\n')).toMatch(/merged 1 auto-permit rule/);
    } finally {
      logSpy.mockRestore();
    }
  });
});

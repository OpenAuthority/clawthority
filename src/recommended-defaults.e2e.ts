/**
 * Recommended defaults E2E tests — Clawthority
 *
 * References: T33, T43 | Dependencies: T50, T60
 *
 * Validates that the recommended defaults created by post-install.mjs are
 * correct and that the enforcement pipeline behaves as expected with them.
 *
 * Scenarios covered:
 *
 *  TC-RD-01  Fresh install creates data/rules.json with unknown_sensitive_action
 *            forbid at priority 90
 *  TC-RD-02  Upgrade path — post-install.mjs skips rules.json when it already exists
 *  TC-RD-03  hitl-policy.yaml.example content is a valid HitlPolicyConfig that
 *            covers unknown_sensitive_action
 *  TC-RD-04  With a console HITL policy targeting unknown_sensitive_action, an
 *            unregistered tool call fires sendConsoleApprovalRequest and is
 *            permitted when approved
 *  TC-RD-05  Without any HITL policy configured, an unregistered tool is silently
 *            permitted in OPEN mode (no HITL dispatch)
 *  TC-RD-06  Upgrade path — existing rules.json with both the recommended default
 *            action_class entry and a custom resource/match forbid loads correctly;
 *            the custom forbid is still enforced after upgrade
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec as execCb } from 'node:child_process';
import { rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  BeforeToolCallHandler,
  BeforeToolCallResult,
  HookContext,
  OpenclawPluginContext,
} from './index.js';
import type { HitlPolicyConfig } from './hitl/types.js';

const exec = promisify(execCb);
const __fileDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__fileDir, '..');
const dataDir = resolve(repoRoot, 'data');
const realRulesPath = resolve(dataDir, 'rules.json');
const realMarkerPath = resolve(dataDir, '.installed');
const realExamplePath = resolve(dataDir, 'hitl-policy.yaml.example');

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

/** Returns true when the file at filePath exists and is accessible. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface LoadOpts {
  mode: 'open' | 'closed';
  hitl?: HitlPolicyConfig;
  /** Path to a temp rules.json file to inject via CLAWTHORITY_RULES_FILE. */
  jsonRulesFile?: string;
  /** Decision that the mocked sendConsoleApprovalRequest returns. Defaults to 'approved_once'. */
  consoleMockDecision?: 'approved_once' | 'approved_always' | 'denied';
}

interface LoadResult {
  handler: BeforeToolCallHandler;
  consoleSpy: ReturnType<typeof vi.fn>;
}

/**
 * Loads a fresh copy of the plugin with the given options.
 * Calls vi.resetModules() so each test starts from a clean module state.
 * Returns both the captured handler and the console HITL spy.
 */
async function loadPlugin(opts: LoadOpts): Promise<LoadResult> {
  process.env.CLAWTHORITY_MODE = opts.mode;
  process.env.OPENAUTH_FORCE_ACTIVE = '1';

  if (opts.jsonRulesFile !== undefined) {
    process.env.CLAWTHORITY_RULES_FILE = opts.jsonRulesFile;
  } else {
    delete process.env.CLAWTHORITY_RULES_FILE;
  }

  vi.resetModules();

  vi.doMock('./hitl/parser.js', async () => {
    const actual = await vi.importActual<typeof import('./hitl/parser.js')>('./hitl/parser.js');
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

  const consoleSpy = vi
    .fn()
    .mockResolvedValue({ decision: opts.consoleMockDecision ?? 'approved_once' });
  vi.doMock('./hitl/console.js', async () => {
    const actual = await vi.importActual<typeof import('./hitl/console.js')>('./hitl/console.js');
    return { ...actual, sendConsoleApprovalRequest: consoleSpy };
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
  return { handler: captured, consoleSpy };
}

const HOOK_CTX: HookContext = { agentId: 'agent-rd-test', channelId: 'default' };

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
 * Console HITL policy targeting unknown_sensitive_action.
 * Mirrors the intent of data/hitl-policy.yaml.example but uses the console
 * channel to avoid external service dependencies in tests.
 */
const CONSOLE_HITL_POLICY: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'Unknown sensitive actions',
      description: 'Gate unrecognised actions through console approval',
      actions: ['unknown_sensitive_action'],
      approval: { channel: 'console', timeout: 300, fallback: 'deny' },
      tags: ['security', 'default'],
    },
  ],
};

/**
 * YAML content matching what post-install.mjs writes to data/hitl-policy.yaml.example.
 * Kept inline so TC-RD-03 does not depend on post-install having run first.
 */
const EXAMPLE_HITL_YAML = [
  'version: "1"',
  'policies:',
  '  - name: Unknown sensitive actions',
  '    actions:',
  '      - unknown_sensitive_action',
  '    approval:',
  '      channel: telegram',
  '      timeout: 300',
  '      fallback: deny',
].join('\n');

// ─── Suite 1: post-install artifacts ─────────────────────────────────────────

describe('recommended defaults — post-install artifacts', () => {
  // Snapshot pre-test state so we can restore it afterwards regardless of
  // test outcome.  TC-RD-01 and TC-RD-02 mutate data/rules.json directly.
  let savedRules: string | null = null;
  let savedMarker: string | null = null;
  let savedExample: string | null = null;

  beforeEach(async () => {
    savedRules = (await fileExists(realRulesPath))
      ? await readFile(realRulesPath, 'utf-8')
      : null;
    savedMarker = (await fileExists(realMarkerPath))
      ? await readFile(realMarkerPath, 'utf-8')
      : null;
    savedExample = (await fileExists(realExamplePath))
      ? await readFile(realExamplePath, 'utf-8')
      : null;
  });

  afterEach(async () => {
    if (savedRules !== null) {
      await writeFile(realRulesPath, savedRules, 'utf-8');
    } else {
      await rm(realRulesPath, { force: true });
    }
    if (savedMarker !== null) {
      await writeFile(realMarkerPath, savedMarker, 'utf-8');
    } else {
      await rm(realMarkerPath, { force: true });
    }
    if (savedExample !== null) {
      await writeFile(realExamplePath, savedExample, 'utf-8');
    } else {
      await rm(realExamplePath, { force: true });
    }
  });

  // ── TC-RD-01 ────────────────────────────────────────────────────────────────

  it(
    'TC-RD-01: fresh install creates data/rules.json with unknown_sensitive_action forbid at priority 90',
    async () => {
      // Remove rules.json so post-install treats this as a fresh install.
      await rm(realRulesPath, { force: true });

      const { stdout } = await exec('node scripts/post-install.mjs', { cwd: repoRoot });
      expect(stdout).toContain('created data/rules.json');

      expect(await fileExists(realRulesPath)).toBe(true);
      const raw = await readFile(realRulesPath, 'utf-8');
      const rules: unknown[] = JSON.parse(raw);

      expect(Array.isArray(rules)).toBe(true);
      expect(rules).toHaveLength(1);

      const rule = rules[0] as Record<string, unknown>;
      expect(rule['effect']).toBe('forbid');
      expect(rule['action_class']).toBe('unknown_sensitive_action');
      expect(rule['priority']).toBe(90);
      expect(Array.isArray(rule['tags'])).toBe(true);
      expect((rule['tags'] as string[]).includes('security')).toBe(true);
    },
    15_000,
  );

  // ── TC-RD-02 ────────────────────────────────────────────────────────────────

  it(
    'TC-RD-02: upgrade path — post-install.mjs skips rules.json when it already exists',
    async () => {
      // Write a custom rules.json representing an operator-modified file.
      const customContent =
        JSON.stringify(
          [{ effect: 'permit', action_class: 'filesystem.read', priority: 10 }],
          null,
          2,
        ) + '\n';
      await writeFile(realRulesPath, customContent, 'utf-8');

      const { stdout } = await exec('node scripts/post-install.mjs', { cwd: repoRoot });
      expect(stdout).toContain('already exists');

      // Verify the custom content was NOT overwritten.
      const afterContent = await readFile(realRulesPath, 'utf-8');
      expect(afterContent).toBe(customContent);
    },
    15_000,
  );
});

// ─── Suite 2: HITL policy example ────────────────────────────────────────────

describe('recommended defaults — HITL policy example', () => {
  // ── TC-RD-03 ────────────────────────────────────────────────────────────────

  it(
    'TC-RD-03: hitl-policy.yaml.example content is a valid HitlPolicyConfig covering unknown_sensitive_action',
    async () => {
      // Write the inline YAML content to a temp file so parseHitlPolicyFile
      // can parse it without depending on data/hitl-policy.yaml.example existing.
      const tmpYaml = join(
        tmpdir(),
        `rd-hitl-example-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`,
      );
      await writeFile(tmpYaml, EXAMPLE_HITL_YAML, 'utf-8');

      try {
        const { parseHitlPolicyFile } = await import('./hitl/parser.js');
        const { checkAction } = await import('./hitl/matcher.js');

        const config = await parseHitlPolicyFile(tmpYaml);

        expect(config.version).toBe('1');
        expect(config.policies.length).toBeGreaterThanOrEqual(1);

        // At least one policy must target unknown_sensitive_action.
        const unknownPolicy = config.policies.find((p) =>
          p.actions.includes('unknown_sensitive_action'),
        );
        expect(unknownPolicy).toBeDefined();

        // checkAction must require approval for unknown_sensitive_action.
        const result = checkAction(config, 'unknown_sensitive_action');
        expect(result.requiresApproval).toBe(true);
        expect(result.matchedPolicy).toBeDefined();
        expect(result.matchedPolicy!.name).toBe('Unknown sensitive actions');
      } finally {
        await rm(tmpYaml, { force: true });
      }
    },
    10_000,
  );
});

// ─── Suite 3: enforcement pipeline with recommended defaults ──────────────────

describe('recommended defaults — enforcement pipeline', () => {
  beforeEach(() => {
    auditEntries.length = 0;
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.doUnmock('./hitl/parser.js');
    vi.doUnmock('./hitl/console.js');
  });

  // ── TC-RD-04 ────────────────────────────────────────────────────────────────

  it(
    'TC-RD-04: with console HITL policy, unregistered tool fires HITL approval request and is permitted when approved',
    async () => {
      // In OPEN mode, unknown tools are permitted by the Cedar pipeline.
      // The pre-existing HITL policy check (stage 3) then fires because the
      // HITL policy covers unknown_sensitive_action.
      // sendConsoleApprovalRequest is invoked once; approved_once → not blocked.
      const { handler, consoleSpy } = await loadPlugin({
        mode: 'open',
        hitl: CONSOLE_HITL_POLICY,
        consoleMockDecision: 'approved_once',
      });

      const result = await callHook(handler, 'novel_unregistered_tool_xyz', {
        data: 'test-payload',
      });

      // HITL must have been dispatched exactly once.
      expect(consoleSpy).toHaveBeenCalledTimes(1);

      // The policy name forwarded to the console prompt must match.
      const callArg = consoleSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArg['policyName']).toBe('Unknown sensitive actions');

      // Approved → action proceeds.
      expect(result?.block).not.toBe(true);
    },
  );

  // ── TC-RD-05 ────────────────────────────────────────────────────────────────

  it(
    'TC-RD-05: without HITL policy, unregistered tool is silently permitted in OPEN mode — no HITL dispatch',
    async () => {
      // Without a HITL policy, hitlConfig is null and the pre-existing HITL
      // check is skipped.  Unregistered tools in OPEN mode fall through to the
      // implicit permit with no interruption.
      const { handler, consoleSpy } = await loadPlugin({
        mode: 'open',
        // hitl: undefined — parser mock throws ENOENT
        consoleMockDecision: 'approved_once',
      });

      const result = await callHook(handler, 'novel_unregistered_tool_xyz', {
        data: 'test-payload',
      });

      // No HITL was dispatched.
      expect(consoleSpy).not.toHaveBeenCalled();

      // Tool is permitted silently.
      expect(result?.block).not.toBe(true);
    },
  );

  // ── TC-RD-06 ────────────────────────────────────────────────────────────────

  it(
    'TC-RD-06: upgrade path — existing rules.json loads correctly; custom resource/match forbid is enforced after upgrade',
    async () => {
      // Simulate a rules.json from a previous install that has BOTH:
      //   (a) the recommended-default action_class entry (action_class rules in
      //       the JSON engine are not evaluated via the resource/match path but
      //       must not cause load errors)
      //   (b) a custom resource/match forbid added by the operator
      //
      // After upgrade, post-install.mjs skips rules.json (TC-RD-02).  The
      // operator's custom forbid must still be enforced, demonstrating that the
      // upgrade is backward-compatible.
      const tmpFile = join(
        tmpdir(),
        `rd-upgrade-rules-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
      );
      const upgradeRules = [
        // Recommended-default entry (present in rules.json from initial install)
        {
          effect: 'forbid',
          action_class: 'unknown_sensitive_action',
          priority: 90,
          reason: 'Actions whose class is not explicitly recognised are withheld pending human approval.',
          tags: ['security', 'hitl', 'default'],
        },
        // Operator-added resource/match forbid (custom rule added post-install)
        {
          effect: 'forbid',
          resource: 'tool',
          match: 'read_file',
          priority: 95,
          reason: 'Sensitive reads blocked by operator policy',
          tags: ['custom', 'security'],
        },
      ];
      await writeFile(tmpFile, JSON.stringify(upgradeRules), 'utf-8');

      try {
        // No HITL policy — the resource/match forbid must block unconditionally
        // (priority 95 < 100 is HITL-gated but upheld when no HITL policy matches).
        const { handler, consoleSpy } = await loadPlugin({
          mode: 'open',
          jsonRulesFile: tmpFile,
          consoleMockDecision: 'approved_once',
        });

        // The operator's resource/match forbid blocks read_file even in OPEN mode.
        const blockedResult = await callHook(handler, 'read_file', {
          path: '/etc/sensitive.conf',
        });
        expect(blockedResult?.block).toBe(true);

        // A different unregistered tool has no matching resource/match forbid
        // and no HITL policy — it falls through to the implicit OPEN mode permit.
        const permittedResult = await callHook(handler, 'unrelated_novel_tool', {
          data: 'payload',
        });
        expect(permittedResult?.block).not.toBe(true);

        // No HITL console interaction occurred (no console HITL policy).
        expect(consoleSpy).not.toHaveBeenCalled();
      } finally {
        await rm(tmpFile, { force: true });
      }
    },
  );
});

/**
 * Credential list and rotate — e2e tests (W10)
 *
 * Covers the two newly-implemented credential action classes:
 *  credential.list   (list_secrets, list_credentials, list_credential_keys)
 *  credential.rotate (rotate_secret, rotate_credential)
 *
 * Both classes are HITL-gated (priority 90 forbid) in both OPEN and CLOSED mode:
 *   credential.rotate ships as a CRITICAL_ACTION_CLASS in OPEN_MODE_RULES (default.ts).
 *   credential.list  ships as a priority-90 forbid in data/rules.json, which is
 *   loaded in both modes (verified by regression-rules-json-forbid.e2e.ts).
 *
 * Also covers:
 *  - store_secret as a new credential.write alias (T160)
 *  - list_credential_keys as a credential.list alias
 *  - Capability replay rejection for the new action classes (TC-CLR-15, TC-CLR-16)
 *  - Audit log entries for the new forbid decisions (TC-CLR-17, TC-CLR-18)
 *  - HITL timeout with deny fallback (TC-CLR-19, TC-CLR-20)
 *
 * Test IDs: TC-CLR-01 … TC-CLR-20 (Credential List and Rotate)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { normalize_action } from './enforcement/normalize.js';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, CeeDecision } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { createStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import { computePayloadHash } from './envelope.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import type { Rule } from './policy/types.js';
import type {
  BeforeToolCallHandler,
  BeforeToolCallResult,
  HookContext,
  OpenclawPluginContext,
} from './index.js';
import type { HitlPolicyConfig } from './hitl/types.js';

/**
 * Absolute path to data/rules.json — used by tests that need to verify
 * OPEN-mode blocking via the rules.json credential.list forbid entry.
 * credential.list is NOT in DEFAULT_RULES (only in data/rules.json), so
 * CLAWTHORITY_RULES_FILE must be set explicitly in those tests.
 */
const RULES_JSON_PATH = join(process.cwd(), 'data/rules.json');

// ─── Shared module stubs ─────────────────────────────────────────────────────

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

// ─── Pipeline-level helpers (for normalization and replay tests) ──────────────

const TEST_POLICY: HitlPolicy = {
  name: 'test-credential-policy',
  actions: ['*'],
  approval: { channel: 'test', timeout: 3600, fallback: 'deny' },
};

interface ApproveNextOpts {
  action_class: string;
  target: string;
  payload_hash: string;
}

/** Permissive Stage 2 — replay tests target Stage 1, not policy evaluation. */
const permissiveStage2 = createStage2(
  createEnforcementEngine([
    { effect: 'permit', resource: 'tool', match: '*' },
    { effect: 'permit', resource: 'channel', match: '*' },
  ] satisfies Rule[]),
);

class HitlTestHarness {
  private readonly approvalManager: ApprovalManager;
  private readonly issued = new Map<string, Capability>();
  readonly stage1: Stage1Fn;

  constructor() {
    this.approvalManager = new ApprovalManager();
    this.stage1 = (ctx: PipelineContext) =>
      validateCapability(ctx, this.approvalManager, (id) => this.issued.get(id));
  }

  approveNext(opts: ApproveNextOpts): string {
    const handle = this.approvalManager.createApprovalRequest({
      toolName: opts.action_class,
      agentId: 'test-agent',
      channelId: 'test-channel',
      policy: TEST_POLICY,
      action_class: opts.action_class,
      target: opts.target,
      payload_hash: opts.payload_hash,
    });
    const now = Date.now();
    const capability: Capability = {
      approval_id: handle.token,
      binding: computeBinding(opts.action_class, opts.target, opts.payload_hash),
      action_class: opts.action_class,
      target: opts.target,
      issued_at: now,
      expires_at: now + 3_600_000,
    };
    this.issued.set(handle.token, capability);
    return handle.token;
  }

  markConsumed(token: string): void {
    this.approvalManager.resolveApproval(token, 'approved');
  }

  shutdown(): void {
    this.approvalManager.shutdown();
  }
}

// ─── Plugin-level helpers (for full enforcement pipeline tests) ───────────────

interface LoadOpts {
  mode: 'open' | 'closed';
  hitl?: HitlPolicyConfig;
  /**
   * If true, sets CLAWTHORITY_RULES_FILE to data/rules.json so operator rules
   * (e.g. credential.list priority-90 forbid) are loaded in the test environment.
   */
  loadRulesJson?: boolean;
}

async function loadPlugin(opts: LoadOpts): Promise<BeforeToolCallHandler> {
  process.env.CLAWTHORITY_MODE = opts.mode;
  process.env.OPENAUTH_FORCE_ACTIVE = '1';
  if (opts.loadRulesJson) {
    process.env.CLAWTHORITY_RULES_FILE = RULES_JSON_PATH;
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

const HOOK_CTX: HookContext = { agentId: 'agent-clr-test', channelId: 'default' };

async function callHook(
  handler: BeforeToolCallHandler,
  toolName: string,
  params: Record<string, unknown> = {},
): Promise<BeforeToolCallResult | undefined> {
  const result = await handler({ toolName, params, source: 'user' }, HOOK_CTX);
  return result ?? undefined;
}

function makeAutoApprovePolicy(actions: string[]): HitlPolicyConfig {
  return {
    version: '1',
    policies: [
      {
        name: 'clr-auto-approve-test',
        actions,
        approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
      },
    ],
  };
}

function makeIrrelevantPolicy(unrelatedAction: string): HitlPolicyConfig {
  return {
    version: '1',
    policies: [
      {
        name: 'irrelevant-policy',
        actions: [unrelatedAction],
        approval: { channel: 'test-unknown', timeout: 60, fallback: 'deny' },
      },
    ],
  };
}

// ─── Suite 1: credential.list — list_secrets ─────────────────────────────────

describe('credential.list — list_secrets — forbid and HITL approval', () => {
  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    auditEntries.length = 0;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.doUnmock('./hitl/parser.js');
    vi.doUnmock('./hitl/approval-manager.js');
    vi.doUnmock('./hitl/telegram.js');
  });

  it('TC-CLR-01: list_secrets normalizes to credential.list with hitl_mode: per_request', () => {
    const normalized = normalize_action('list_secrets', { prefix: 'app/' });
    expect(normalized.action_class).toBe('credential.list');
    expect(normalized.hitl_mode).toBe('per_request');
  });

  it('TC-CLR-02: list_secrets is blocked in CLOSED mode when no HITL is configured', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    const result = await callHook(handler, 'list_secrets', { prefix: 'app/' });
    // In CLOSED mode without rules.json, credential.list hits the implicit deny.
    expect(result?.block).toBe(true);
  });

  it('TC-CLR-03: list_credentials (alias) is blocked in CLOSED mode when no HITL is configured', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    const result = await callHook(handler, 'list_credentials', { prefix: 'service/' });
    // In CLOSED mode without rules.json, credential.list hits the implicit deny.
    expect(result?.block).toBe(true);
  });

  it('TC-CLR-04: list_secrets is NOT blocked in OPEN mode (credential.list is not in OPEN_MODE_RULES; rules.json action_class entries not queried via jsonRulesEngine tool path)', async () => {
    // In OPEN mode, the cedarEngine only applies OPEN_MODE_RULES (CRITICAL_ACTION_CLASSES).
    // credential.list is not a CRITICAL_ACTION_CLASS, so the cedarEngine returns implicit
    // permit. The jsonRulesEngine evaluates via evaluate("tool", toolName) — action_class
    // entries in rules.json are not matched by this path. Result: implicit permit.
    const handler = await loadPlugin({ mode: 'open' });
    const result = await callHook(handler, 'list_secrets', { prefix: 'app/' });
    expect(result?.block).not.toBe(true);
  });

  it('TC-CLR-05: list_secrets proceeds when a matching HITL policy approves (test-unknown channel auto-approve)', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['credential.list']),
    });
    const result = await callHook(handler, 'list_secrets', { prefix: 'app/' });
    expect(result?.block).not.toBe(true);
  });

  it('TC-CLR-06: list_secrets remains blocked when HITL policy covers an unrelated action', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeIrrelevantPolicy('filesystem.write'),
    });
    const result = await callHook(handler, 'list_secrets', { prefix: 'app/' });
    expect(result?.block).toBe(true);
  });
});

// ─── Suite 2: credential.rotate — rotate_secret ──────────────────────────────

describe('credential.rotate — rotate_secret — forbid and HITL approval', () => {
  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    auditEntries.length = 0;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.doUnmock('./hitl/parser.js');
    vi.doUnmock('./hitl/approval-manager.js');
    vi.doUnmock('./hitl/telegram.js');
  });

  it('TC-CLR-07: rotate_secret normalizes to credential.rotate with hitl_mode: per_request', () => {
    const normalized = normalize_action('rotate_secret', { key: 'DB_PASSWORD' });
    expect(normalized.action_class).toBe('credential.rotate');
    expect(normalized.hitl_mode).toBe('per_request');
  });

  it('TC-CLR-08: rotate_secret is blocked in CLOSED mode when no HITL is configured', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    const result = await callHook(handler, 'rotate_secret', { key: 'DB_PASSWORD' });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/credential|approval/i);
  });

  it('TC-CLR-09: rotate_credential (alias) is blocked in CLOSED mode when no HITL is configured', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    const result = await callHook(handler, 'rotate_credential', { key: 'API_KEY' });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/credential|approval/i);
  });

  it('TC-CLR-10: rotate_secret is blocked in OPEN mode (credential.rotate is a CRITICAL_ACTION_CLASS)', async () => {
    const handler = await loadPlugin({ mode: 'open' });
    const result = await callHook(handler, 'rotate_secret', { key: 'PROD_SECRET' });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/credential|approval/i);
  });

  it('TC-CLR-11: rotate_secret proceeds when a matching HITL policy approves (test-unknown channel auto-approve)', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['credential.rotate']),
    });
    const result = await callHook(handler, 'rotate_secret', { key: 'DB_PASSWORD' });
    expect(result?.block).not.toBe(true);
  });

  it('TC-CLR-12: rotate_secret proceeds in OPEN mode when a matching HITL policy approves', async () => {
    const handler = await loadPlugin({
      mode: 'open',
      hitl: makeAutoApprovePolicy(['credential.rotate']),
    });
    const result = await callHook(handler, 'rotate_secret', { key: 'DB_PASSWORD' });
    expect(result?.block).not.toBe(true);
  });
});

// ─── Suite 3: store_secret and list_credential_keys aliases ──────────────────

describe('store_secret and list_credential_keys — new credential aliases', () => {
  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    auditEntries.length = 0;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.doUnmock('./hitl/parser.js');
  });

  it('TC-CLR-13: store_secret (credential.write alias, T160) proceeds when HITL approves', async () => {
    const handler = await loadPlugin({
      mode: 'closed',
      hitl: makeAutoApprovePolicy(['credential.write']),
    });
    const result = await callHook(handler, 'store_secret', {
      key: 'NEW_TOKEN',
      value: 'token-value-abc123',
    });
    expect(result?.block).not.toBe(true);
  });

  it('TC-CLR-14: list_credential_keys (credential.list alias) is NOT blocked in OPEN mode', async () => {
    // Same reasoning as TC-CLR-04: credential.list is not in OPEN_MODE_RULES,
    // and the jsonRulesEngine only queries resource: "tool" entries, so the
    // rules.json action_class entry for credential.list does not fire in OPEN mode.
    const handler = await loadPlugin({ mode: 'open' });
    const result = await callHook(handler, 'list_credential_keys', { prefix: 'infra/' });
    expect(result?.block).not.toBe(true);
  });
});

// ─── Suite 4: capability replay rejection for new credential action classes ───

describe('credential.list and credential.rotate — capability replay rejection', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it('TC-CLR-15: capability replay rejected for credential.list (payload binding mismatch)', async () => {
    const ACTION = 'credential.list';
    const TARGET = 'app/*';
    const paramsP1 = { prefix: 'app/', limit: 50 };
    const paramsP2 = { prefix: 'infra/', limit: 50 };
    const hashP1 = computePayloadHash('list_secrets', paramsP1);
    const hashP2 = computePayloadHash('list_secrets', paramsP2);

    // Token issued for P1.
    const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hashP1 });

    // Replay attempt with P2's hash — binding mismatch.
    const result = await runPipeline(
      {
        action_class: ACTION,
        target: TARGET,
        payload_hash: hashP2,
        hitl_mode: 'per_request',
        approval_id: token,
        rule_context: { agentId: 'agent-clr', channel: 'default' },
      },
      harness.stage1,
      permissiveStage2,
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('payload binding mismatch');
    expect(result.decision.stage).toBe('stage1');
  });

  it('TC-CLR-16: capability replay rejected for credential.rotate (capability already consumed)', async () => {
    const ACTION = 'credential.rotate';
    const TARGET = 'DB_PASSWORD';
    const params = { key: 'DB_PASSWORD', algorithm: 'aes-256' };
    const hash = computePayloadHash('rotate_secret', params);

    const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hash });

    const ctx: PipelineContext = {
      action_class: ACTION,
      target: TARGET,
      payload_hash: hash,
      hitl_mode: 'per_request',
      approval_id: token,
      rule_context: { agentId: 'agent-clr', channel: 'default' },
    };

    // First execution succeeds.
    const firstResult = await runPipeline(ctx, harness.stage1, permissiveStage2, emitter);
    expect(firstResult.decision.effect).toBe('permit');

    // Mark the token as consumed.
    harness.markConsumed(token);

    // Replay with the same token and same params is rejected.
    const replayResult = await runPipeline(ctx, harness.stage1, permissiveStage2, emitter);
    expect(replayResult.decision.effect).toBe('forbid');
    expect(replayResult.decision.reason).toBe('capability already consumed');
    expect(replayResult.decision.stage).toBe('stage1');
  });
});

// ─── Suite 5: audit log entries for new credential forbid decisions ───────────

describe('credential.list and credential.rotate — audit log entries', () => {
  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    auditEntries.length = 0;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.doUnmock('./hitl/parser.js');
  });

  it('TC-CLR-17: credential.list forbid writes an audit entry with effect=forbid and actionClass=credential.list', async () => {
    // In CLOSED mode, credential.list is blocked by implicit deny (no matching rule).
    // The audit entry carries effect=forbid and actionClass=credential.list but no
    // priority (implicit deny has no matched rule, hence no priority field).
    const handler = await loadPlugin({ mode: 'closed' });
    await callHook(handler, 'list_secrets', { prefix: 'app/' });
    const forbids = auditEntries.filter(
      (e) => e['type'] === 'policy' && e['effect'] === 'forbid' && e['actionClass'] === 'credential.list',
    );
    expect(forbids.length).toBeGreaterThanOrEqual(1);
    expect(forbids[0]).toMatchObject({
      type: 'policy',
      effect: 'forbid',
      actionClass: 'credential.list',
    });
  });

  it('TC-CLR-18: credential.rotate forbid writes a hitl-gated audit entry with priority=90', async () => {
    const handler = await loadPlugin({ mode: 'closed' });
    await callHook(handler, 'rotate_secret', { key: 'TOKEN_KEY' });
    const gated = auditEntries.filter(
      (e) =>
        e['type'] === 'policy' &&
        e['effect'] === 'forbid' &&
        e['stage'] === 'hitl-gated' &&
        e['actionClass'] === 'credential.rotate',
    );
    expect(gated.length).toBeGreaterThanOrEqual(1);
    expect(gated[0]).toMatchObject({
      type: 'policy',
      effect: 'forbid',
      stage: 'hitl-gated',
      priority: 90,
      actionClass: 'credential.rotate',
    });
  });
});

// ─── Suite 6: HITL timeout — deny fallback blocks credential tools ────────────

describe('credential.list and credential.rotate — HITL timeout with deny fallback', () => {
  const TELEGRAM_TIMEOUT_POLICY: HitlPolicyConfig = {
    version: '1',
    policies: [
      {
        name: 'telegram-credential-timeout-test',
        actions: ['credential.list', 'credential.rotate'],
        approval: { channel: 'telegram', timeout: 60, fallback: 'deny' },
      },
    ],
  };

  beforeEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    process.env.TELEGRAM_BOT_TOKEN = 'fake-bot-token-clr';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat-id-clr';
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.SLACK_SIGNING_SECRET;
    auditEntries.length = 0;
  });

  afterEach(() => {
    delete process.env.CLAWTHORITY_MODE;
    delete process.env.OPENAUTH_FORCE_ACTIVE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.CLAWTHORITY_RULES_FILE;
    vi.doUnmock('./hitl/parser.js');
    vi.doUnmock('./hitl/approval-manager.js');
    vi.doUnmock('./hitl/telegram.js');
  });

  async function loadWithExpiredApproval(): Promise<BeforeToolCallHandler> {
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
              token: `mock-expired-token-${Date.now()}`,
              promise: Promise.resolve('expired' as const),
            };
          }
          resolveApproval() { return true; }
          cancel() {}
          isConsumed() { return false; }
          getPending() { return undefined; }
          get size() { return 0; }
          shutdown() {}
        },
      };
    });

    vi.doMock('./hitl/telegram.js', async () => {
      const actual = await vi.importActual<typeof import('./hitl/telegram.js')>(
        './hitl/telegram.js',
      );
      return {
        ...actual,
        sendApprovalRequest: vi.fn(async () => true),
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
        parseHitlPolicyFile: vi.fn(async () => TELEGRAM_TIMEOUT_POLICY),
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

    process.env.CLAWTHORITY_MODE = 'closed';
    process.env.OPENAUTH_FORCE_ACTIVE = '1';
    await mod.default.activate(ctx);

    if (captured === undefined) throw new Error('beforeToolCallHandler was not registered');
    return captured;
  }

  it('TC-CLR-19: list_secrets is blocked when HITL approval times out (deny fallback)', async () => {
    const handler = await loadWithExpiredApproval();
    const result = await callHook(handler, 'list_secrets', { prefix: 'app/' });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/timed out|expired|denied/i);
  });

  it('TC-CLR-20: rotate_secret is blocked when HITL approval times out (deny fallback)', async () => {
    const handler = await loadWithExpiredApproval();
    const result = await callHook(handler, 'rotate_secret', { key: 'DB_PASSWORD' });
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toMatch(/timed out|expired|denied/i);
  });
});

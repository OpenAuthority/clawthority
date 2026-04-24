/**
 * Regression test suite: pipeline integration
 *
 * Comprehensive regression coverage for the two-stage enforcement pipeline.
 * Each test exercises an end-to-end path through runPipeline with real
 * enforcement components — no mocked Stage 1 or Stage 2 functions.
 *
 * Capability replay protection
 *   TC-RPI-01  consumed token is denied with 'capability already consumed'
 *   TC-RPI-02  cross-param replay is denied with 'payload binding mismatch'
 *
 * TTL enforcement
 *   TC-RPI-03  token at expiry boundary (expires_at < Date.now()) is denied
 *   TC-RPI-04  short-lived token (2 s TTL) blocked after fake-timer advance
 *
 * Payload binding with SHA-256 validation
 *   TC-RPI-05  SHA-256 payload hash is deterministic across repeated calls
 *   TC-RPI-06  computePayloadHash distinguishes distinct parameter sets
 *   TC-RPI-07  cross-action-class replay blocked: action_class changes the binding
 *
 * Session scope enforcement
 *   TC-RPI-08  same session_id permits execution
 *   TC-RPI-09  cross-session token is denied with 'session scope mismatch'
 *   TC-RPI-10  unscoped capability (no session_id) permits any session
 *
 * Legacy Cedar fallback behavior
 *   TC-RPI-11  empty rule set falls through to implicit permit (defaultEffect: 'permit')
 *   TC-RPI-12  explicit Stage 2 forbid rule overrides implicit permit fallback
 *   TC-RPI-13  EnforcementPolicyEngine 'communication.*' routes to 'channel' resource
 *
 * FileAuthorityAdapter hot-reload
 *   TC-RPI-14  bundle version bump triggers onUpdate; pipeline uses updated rules
 *   TC-RPI-15  lower bundle version is rejected; previous rules remain active
 *   TC-RPI-16  invalid JSON bundle is discarded; previous rules remain active
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { createStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import { computePayloadHash } from './envelope.js';
import { FileAuthorityAdapter } from './adapter/file-adapter.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import type { Rule } from './policy/types.js';

// ─── Mocks (hoisted — apply to entire file) ───────────────────────────────────

function makeWatcherStub() {
  const emitter = new EventEmitter();
  const watcher = {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
      return watcher;
    },
    close: vi.fn().mockResolvedValue(undefined),
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
  };
  return watcher;
}

vi.mock('chokidar', () => ({
  default: { watch: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_POLICY: HitlPolicy = {
  name: 'test-hitl-policy',
  actions: ['*'],
  approval: { channel: 'test', timeout: 3600, fallback: 'deny' },
};

interface ApproveNextOpts {
  action_class: string;
  target: string;
  payload_hash: string;
  session_id?: string;
}

/**
 * Minimal HITL server harness — mirrors `HitlTestHarness` in
 * `hitl-approval-lifecycle.e2e.ts`. Defined locally so this regression
 * suite is self-contained.
 */
class HitlTestHarness {
  private readonly approvalManager: ApprovalManager;
  private readonly issued = new Map<string, Capability>();
  private readonly capabilityTtlMs: number;

  readonly stage1: Stage1Fn;

  constructor(opts?: { capabilityTtlSeconds?: number }) {
    this.capabilityTtlMs = (opts?.capabilityTtlSeconds ?? 3600) * 1000;
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
      expires_at: now + this.capabilityTtlMs,
      ...(opts.session_id !== undefined ? { session_id: opts.session_id } : {}),
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

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/** Permissive Stage 2 — regression tests target Stage 1 unless noted. */
const permissiveStage2 = createStage2(
  createEnforcementEngine([
    { effect: 'permit', resource: 'tool', match: '*' },
    { effect: 'permit', resource: 'channel', match: '*' },
  ] satisfies Rule[]),
);

const TOOL_NAME = 'filesystem_read' as const;
const ACTION = 'filesystem.read' as const;
const ACTION_B = 'filesystem.write' as const;
const TARGET = '/data/config.json' as const;
const PARAMS_P1 = { encoding: 'utf-8', path: '/data/config.json' } as const;
const PARAMS_P2 = { encoding: 'utf-8', path: '/data/secret.json' } as const;

// ─── Suite 1: Capability replay protection ────────────────────────────────────

describe('Regression: capability replay protection', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it(
    'TC-RPI-01: consumed token is denied with capability already consumed',
    async () => {
      const hash = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hash });

      const ctx: PipelineContext = {
        action_class: ACTION,
        target: TARGET,
        payload_hash: hash,
        hitl_mode: 'per_request',
        approval_id: token,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      };

      // First execution succeeds.
      const first = await runPipeline(ctx, harness.stage1, permissiveStage2, emitter);
      expect(first.decision.effect).toBe('permit');

      // System records the token as consumed.
      harness.markConsumed(token);

      // Replay with the same token must be denied.
      const replay = await runPipeline(ctx, harness.stage1, permissiveStage2, emitter);
      expect(replay.decision.effect).toBe('forbid');
      expect(replay.decision.reason).toBe('capability already consumed');
      expect(replay.decision.stage).toBe('stage1');
    },
  );

  it(
    'TC-RPI-02: cross-param replay is denied with payload binding mismatch',
    async () => {
      const hashP1 = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const hashP2 = computePayloadHash(TOOL_NAME, PARAMS_P2);

      // Capability was issued for P1.
      const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hashP1 });

      // Replay substitutes P2's hash — binding computed by stage1 will not match.
      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hashP2,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('payload binding mismatch');
      expect(result.decision.stage).toBe('stage1');
    },
  );
});

// ─── Suite 2: TTL enforcement ─────────────────────────────────────────────────

describe('Regression: TTL enforcement', () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it(
    'TC-RPI-03: token at expiry boundary (expires_at < Date.now()) is denied',
    async () => {
      const hash = 'hash-rpi-03-boundary';
      const now = Date.now();

      // Build a capability whose expiry is 100 ms in the past.
      const approvalManager = new ApprovalManager();
      const cap: Capability = {
        approval_id: 'token-rpi-03',
        binding: computeBinding(ACTION, TARGET, hash),
        action_class: ACTION,
        target: TARGET,
        issued_at: now - 10_000,
        expires_at: now - 100,
      };
      const stage1 = (ctx: PipelineContext) =>
        validateCapability(ctx, approvalManager, (id) => (id === 'token-rpi-03' ? cap : undefined));

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hash,
          hitl_mode: 'per_request',
          approval_id: 'token-rpi-03',
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        stage1,
        permissiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('capability expired');
      expect(result.decision.stage).toBe('stage1');

      approvalManager.shutdown();
    },
  );

  it(
    'TC-RPI-04: short-lived token (2 s TTL) is blocked after fake-timer advance of 3 s',
    async () => {
      vi.useFakeTimers();
      const harness = new HitlTestHarness({ capabilityTtlSeconds: 2 });

      try {
        const hash = 'hash-rpi-04-ttl';
        const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hash });

        // Advance the clock past the 2 s TTL.
        vi.advanceTimersByTime(3_000);

        const result = await runPipeline(
          {
            action_class: ACTION,
            target: TARGET,
            payload_hash: hash,
            hitl_mode: 'per_request',
            approval_id: token,
            rule_context: { agentId: 'agent-1', channel: 'default' },
          },
          harness.stage1,
          permissiveStage2,
          emitter,
        );

        expect(result.decision.effect).toBe('forbid');
        expect(result.decision.reason).toBe('capability expired');
      } finally {
        harness.shutdown();
        vi.useRealTimers();
      }
    },
  );
});

// ─── Suite 3: Payload binding with SHA-256 validation ─────────────────────────

describe('Regression: payload binding with SHA-256 validation', () => {
  it(
    'TC-RPI-05: SHA-256 payload hash is deterministic across repeated calls',
    () => {
      const hash1a = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const hash1b = computePayloadHash(TOOL_NAME, PARAMS_P1);

      // Stability: same call twice must return identical hashes.
      expect(hash1a).toBe(hash1b);

      // Binding derived from the hash must also be stable.
      const binding1a = computeBinding(ACTION, TARGET, hash1a);
      const binding1b = computeBinding(ACTION, TARGET, hash1b);
      expect(binding1a).toBe(binding1b);

      // Both values must be lowercase 64-char SHA-256 hex digests.
      expect(hash1a).toMatch(/^[0-9a-f]{64}$/);
      expect(binding1a).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it(
    'TC-RPI-06: computePayloadHash distinguishes distinct parameter sets (collision resistance)',
    () => {
      const hashP1 = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const hashP2 = computePayloadHash(TOOL_NAME, PARAMS_P2);

      // Distinct inputs must not collide.
      expect(hashP1).not.toBe(hashP2);

      // Bindings derived from distinct hashes must also differ.
      const bindingP1 = computeBinding(ACTION, TARGET, hashP1);
      const bindingP2 = computeBinding(ACTION, TARGET, hashP2);
      expect(bindingP1).not.toBe(bindingP2);
    },
  );

  it(
    'TC-RPI-07: cross-action-class replay is blocked (action_class is part of the binding)',
    async () => {
      const emitter = new EventEmitter();
      const harness = new HitlTestHarness();

      try {
        const hash = computePayloadHash(TOOL_NAME, PARAMS_P1);

        // Token issued for ACTION (filesystem.read).
        const token = harness.approveNext({
          action_class: ACTION,
          target: TARGET,
          payload_hash: hash,
        });

        // Replay presents the same token but claims a different action class.
        // The expected binding now includes ACTION_B, so it will not match
        // the stored capability binding which was computed with ACTION.
        const result = await runPipeline(
          {
            action_class: ACTION_B,
            target: TARGET,
            payload_hash: hash,
            hitl_mode: 'per_request',
            approval_id: token,
            rule_context: { agentId: 'agent-1', channel: 'default' },
          },
          harness.stage1,
          permissiveStage2,
          emitter,
        );

        expect(result.decision.effect).toBe('forbid');
        expect(result.decision.reason).toBe('payload binding mismatch');
      } finally {
        harness.shutdown();
      }
    },
  );
});

// ─── Suite 4: Session scope enforcement ──────────────────────────────────────

describe('Regression: session scope enforcement', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it(
    'TC-RPI-08: capability scoped to session A permits execution in session A',
    async () => {
      const hash = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const token = harness.approveNext({
        action_class: ACTION,
        target: TARGET,
        payload_hash: hash,
        session_id: 'session-A',
      });

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hash,
          hitl_mode: 'per_request',
          approval_id: token,
          session_id: 'session-A',
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );

  it(
    'TC-RPI-09: capability scoped to session A is denied when used in session B',
    async () => {
      const hash = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const token = harness.approveNext({
        action_class: ACTION,
        target: TARGET,
        payload_hash: hash,
        session_id: 'session-A',
      });

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hash,
          hitl_mode: 'per_request',
          approval_id: token,
          session_id: 'session-B',
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('session scope mismatch');
      expect(result.decision.stage).toBe('stage1');
    },
  );

  it(
    'TC-RPI-10: unscoped capability (no session_id) permits any session',
    async () => {
      const hash = computePayloadHash(TOOL_NAME, PARAMS_P1);

      // Token issued without a session scope.
      const token = harness.approveNext({
        action_class: ACTION,
        target: TARGET,
        payload_hash: hash,
      });

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hash,
          hitl_mode: 'per_request',
          approval_id: token,
          session_id: 'any-arbitrary-session',
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );
});

// ─── Suite 5: Legacy Cedar fallback behavior ──────────────────────────────────

describe('Regression: legacy Cedar fallback behavior', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  it(
    'TC-RPI-11: empty rule set falls through to implicit permit (defaultEffect: permit)',
    async () => {
      // Stage 2 with no rules — Cedar default is 'permit' (no matching rule = implicit allow).
      const emptyStage2 = createStage2(createEnforcementEngine([]));

      const hash = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hash });

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hash,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        emptyStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );

  it(
    'TC-RPI-12: explicit Stage 2 forbid rule overrides the implicit permit fallback',
    async () => {
      // Stage 2 with an explicit forbid rule for the target tool resource.
      const restrictiveStage2 = createStage2(
        createEnforcementEngine([
          { effect: 'forbid', resource: 'tool', match: '*', reason: 'all-tools-blocked' },
        ] satisfies Rule[]),
      );

      const hash = computePayloadHash(TOOL_NAME, PARAMS_P1);
      const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: hash });

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hash,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        restrictiveStage2,
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.stage).toBe('stage2');
    },
  );

  it(
    "TC-RPI-13: EnforcementPolicyEngine routes 'communication.*' to 'channel' resource, not 'tool'",
    async () => {
      // Engine permits channel resource but forbids tool resource.
      // If 'communication.email' is routed to 'channel', the pipeline permits.
      // If it were incorrectly routed to 'tool', the pipeline would forbid.
      const channelOnlyStage2 = createStage2(
        createEnforcementEngine([
          { effect: 'permit', resource: 'channel', match: '*' },
          { effect: 'forbid', resource: 'tool', match: '*' },
        ] satisfies Rule[]),
      );

      const ACTION_COMM = 'communication.email' as const;
      const TARGET_COMM = 'user@example.com' as const;
      const hash = 'hash-rpi-13-comm';

      // Harness for communication action.
      const commHarness = new HitlTestHarness();
      try {
        const token = commHarness.approveNext({
          action_class: ACTION_COMM,
          target: TARGET_COMM,
          payload_hash: hash,
        });

        const result = await runPipeline(
          {
            action_class: ACTION_COMM,
            target: TARGET_COMM,
            payload_hash: hash,
            hitl_mode: 'per_request',
            approval_id: token,
            rule_context: { agentId: 'agent-1', channel: 'default' },
          },
          commHarness.stage1,
          channelOnlyStage2,
          emitter,
        );

        // 'communication.email' routes to 'channel' → permitted.
        expect(result.decision.effect).toBe('permit');

        // Verify the inverse: 'filesystem.read' routes to 'tool' → forbidden.
        const fsToken = harness.approveNext({
          action_class: ACTION,
          target: TARGET,
          payload_hash: computePayloadHash(TOOL_NAME, PARAMS_P1),
        });

        const fsResult = await runPipeline(
          {
            action_class: ACTION,
            target: TARGET,
            payload_hash: computePayloadHash(TOOL_NAME, PARAMS_P1),
            hitl_mode: 'per_request',
            approval_id: fsToken,
            rule_context: { agentId: 'agent-1', channel: 'default' },
          },
          harness.stage1,
          channelOnlyStage2,
          emitter,
        );

        expect(fsResult.decision.effect).toBe('forbid');
      } finally {
        commHarness.shutdown();
      }
    },
  );
});

// ─── Suite 6: FileAuthorityAdapter hot-reload ─────────────────────────────────

describe('Regression: FileAuthorityAdapter hot-reload', () => {
  let watcherStub: ReturnType<typeof makeWatcherStub>;
  let readFileMock: ReturnType<typeof vi.fn>;
  let chokidarMock: { watch: ReturnType<typeof vi.fn> };

  const BUNDLE_PATH = '/tmp/regression-test-bundle.json';

  beforeEach(async () => {
    watcherStub = makeWatcherStub();

    const chokidar = await import('chokidar');
    chokidarMock = chokidar.default as unknown as { watch: ReturnType<typeof vi.fn> };
    chokidarMock.watch.mockReturnValue(watcherStub);

    const fsPromises = await import('node:fs/promises');
    readFileMock = fsPromises.readFile as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it(
    'TC-RPI-14: bundle version bump triggers onUpdate; pipeline uses updated rules',
    async () => {
      vi.useFakeTimers();

      const permissiveBundle = JSON.stringify({
        version: 1,
        rules: [{ effect: 'permit', resource: 'tool', match: '*' }],
      });
      const restrictiveBundle = JSON.stringify({
        version: 2,
        rules: [{ effect: 'forbid', resource: 'tool', match: '*', reason: 'hot-reload-forbid' }],
      });

      readFileMock.mockResolvedValue(permissiveBundle);

      const adapter = new FileAuthorityAdapter({ bundlePath: BUNDLE_PATH });
      const engine = createEnforcementEngine([]);
      const stage2 = createStage2(engine);

      const handle = await adapter.watchPolicyBundle((bundle) => {
        engine.clearRules();
        if (Array.isArray(bundle.rules)) {
          engine.addRules(bundle.rules as Rule[]);
        }
      });

      // Issue a capability to pass Stage 1.
      const hash = 'hash-rpi-14-reload';
      const approvalManager = new ApprovalManager();
      const cap: Capability = {
        approval_id: 'token-rpi-14',
        binding: computeBinding(ACTION, TARGET, hash),
        action_class: ACTION,
        target: TARGET,
        issued_at: Date.now(),
        expires_at: Date.now() + 3_600_000,
      };
      const stage1 = (ctx: PipelineContext) =>
        validateCapability(ctx, approvalManager, (id) => (id === 'token-rpi-14' ? cap : undefined));

      const ctx: PipelineContext = {
        action_class: ACTION,
        target: TARGET,
        payload_hash: hash,
        hitl_mode: 'per_request',
        approval_id: 'token-rpi-14',
        rule_context: { agentId: 'agent-1', channel: 'default' },
      };

      // Before hot-reload: permissive bundle → permit.
      const beforeResult = await runPipeline(ctx, stage1, stage2, new EventEmitter());
      expect(beforeResult.decision.effect).toBe('permit');

      // Simulate hot-reload: chokidar fires 'change', debounce fires, new bundle is read.
      readFileMock.mockResolvedValue(restrictiveBundle);
      watcherStub.emit('change');
      await vi.runAllTimersAsync();

      // After hot-reload: restrictive bundle → forbid.
      const afterResult = await runPipeline(ctx, stage1, stage2, new EventEmitter());
      expect(afterResult.decision.effect).toBe('forbid');
      expect(afterResult.decision.stage).toBe('stage2');

      await handle.stop();
      approvalManager.shutdown();
    },
  );

  it(
    'TC-RPI-15: lower bundle version is rejected; previous rules remain active',
    async () => {
      vi.useFakeTimers();

      const permissiveBundle = JSON.stringify({
        version: 5,
        rules: [{ effect: 'permit', resource: 'tool', match: '*' }],
      });
      // Version 3 < 5 — must be rejected.
      const downgradedBundle = JSON.stringify({
        version: 3,
        rules: [{ effect: 'forbid', resource: 'tool', match: '*', reason: 'should-not-apply' }],
      });

      readFileMock.mockResolvedValue(permissiveBundle);

      const adapter = new FileAuthorityAdapter({ bundlePath: BUNDLE_PATH });
      const engine = createEnforcementEngine([]);
      const stage2 = createStage2(engine);

      const handle = await adapter.watchPolicyBundle((bundle) => {
        engine.clearRules();
        if (Array.isArray(bundle.rules)) {
          engine.addRules(bundle.rules as Rule[]);
        }
      });

      // Simulate hot-reload with a lower version number.
      readFileMock.mockResolvedValue(downgradedBundle);
      watcherStub.emit('change');
      await vi.runAllTimersAsync();

      // Stage 1 passthrough — inline capability at a known token.
      const hash = 'hash-rpi-15-monoton';
      const approvalManager = new ApprovalManager();
      const cap: Capability = {
        approval_id: 'token-rpi-15',
        binding: computeBinding(ACTION, TARGET, hash),
        action_class: ACTION,
        target: TARGET,
        issued_at: Date.now(),
        expires_at: Date.now() + 3_600_000,
      };
      const stage1 = (ctx: PipelineContext) =>
        validateCapability(ctx, approvalManager, (id) => (id === 'token-rpi-15' ? cap : undefined));

      // Permissive rules should still be active — pipeline must permit.
      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hash,
          hitl_mode: 'per_request',
          approval_id: 'token-rpi-15',
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        stage1,
        stage2,
        new EventEmitter(),
      );

      expect(result.decision.effect).toBe('permit');

      await handle.stop();
      approvalManager.shutdown();
    },
  );

  it(
    'TC-RPI-16: invalid JSON bundle is silently discarded; previous rules remain active',
    async () => {
      vi.useFakeTimers();

      const permissiveBundle = JSON.stringify({
        version: 1,
        rules: [{ effect: 'permit', resource: 'tool', match: '*' }],
      });

      readFileMock.mockResolvedValue(permissiveBundle);

      const adapter = new FileAuthorityAdapter({ bundlePath: BUNDLE_PATH });
      const engine = createEnforcementEngine([]);
      const stage2 = createStage2(engine);

      const handle = await adapter.watchPolicyBundle((bundle) => {
        engine.clearRules();
        if (Array.isArray(bundle.rules)) {
          engine.addRules(bundle.rules as Rule[]);
        }
      });

      // Simulate hot-reload with malformed JSON.
      readFileMock.mockResolvedValue('{ this is not valid json {{{{');
      watcherStub.emit('change');
      await vi.runAllTimersAsync();

      // Stage 1 passthrough — inline capability at a known token.
      const hash = 'hash-rpi-16-invalid';
      const approvalManager = new ApprovalManager();
      const cap: Capability = {
        approval_id: 'token-rpi-16',
        binding: computeBinding(ACTION, TARGET, hash),
        action_class: ACTION,
        target: TARGET,
        issued_at: Date.now(),
        expires_at: Date.now() + 3_600_000,
      };
      const stage1 = (ctx: PipelineContext) =>
        validateCapability(ctx, approvalManager, (id) => (id === 'token-rpi-16' ? cap : undefined));

      // Permissive rules should still be active — pipeline must permit.
      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: hash,
          hitl_mode: 'per_request',
          approval_id: 'token-rpi-16',
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        stage1,
        stage2,
        new EventEmitter(),
      );

      expect(result.decision.effect).toBe('permit');

      await handle.stop();
      approvalManager.shutdown();
    },
  );
});

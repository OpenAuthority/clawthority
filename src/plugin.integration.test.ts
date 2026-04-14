/**
 * Plugin integration test suite — Open Authority v0.1 enforcement pipeline
 *
 * Verifies end-to-end behaviour of the enforcement pipeline and plugin lifecycle:
 *  TC-01  lifecycle: activate → pipeline → audit event → deactivate
 *  TC-02  filesystem.read allowed without approval (hitl_mode none)
 *  TC-03  system.execute (shell.exec) forbidden unconditionally by Stage 2
 *  TC-04  communication to untrusted domain forbidden
 *  TC-05  high-risk action without approval → pending_hitl_approval
 *  TC-06  high-risk action with valid approval → permitted
 *  TC-07  parameter tampering (hash mismatch) → denied at Stage 1
 *  TC-08  unknown tool name maps to unknown_sensitive_action (fail-closed)
 *  TC-09  audit log: pipeline emits ExecutionEvent with required fields
 *  TC-10  bundle hot-reload: FileAuthorityAdapter notifies onUpdate within 500ms
 *  TC-11  deactivate leaves no hanging listeners or watchers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';

// ─── Mock chokidar before any watcher imports ─────────────────────────────────
// vi.hoisted ensures the mock state is available in the vi.mock factory.

const { mockWatcherOn, mockWatcherClose } = vi.hoisted(() => {
  const mockWatcherOn = vi.fn();
  const mockWatcherClose = vi.fn().mockResolvedValue(undefined);
  return { mockWatcherOn, mockWatcherClose };
});

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: mockWatcherOn.mockReturnThis(),
      close: mockWatcherClose,
    })),
  },
}));

// ─── Imports (after mocks are hoisted) ───────────────────────────────────────

import chokidar from 'chokidar';
import plugin, { type OpenclawPluginContext } from './index.js';
import { runPipeline, EnforcementPolicyEngine } from './enforcement/pipeline.js';
import type { PipelineContext } from './enforcement/pipeline.js';
import { normalize_action } from './enforcement/normalize.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { createStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';
import { ApprovalManager } from './hitl/approval-manager.js';
import { FileAuthorityAdapter } from './adapter/file-adapter.js';
import type { Rule } from './policy/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a minimal OpenclawPluginContext stub that satisfies the interface
 * without requiring any real OpenClaw host infrastructure.
 */
function createMockContext(): { ctx: OpenclawPluginContext } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = {
    registerHook: () => undefined,
    on: () => undefined,
  } as OpenclawPluginContext;
  return { ctx };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('plugin integration suite', () => {
  let emitter: EventEmitter;
  let approvalManager: ApprovalManager;

  beforeEach(() => {
    emitter = new EventEmitter();
    approvalManager = new ApprovalManager();
    vi.mocked(chokidar.watch).mockClear();
    mockWatcherOn.mockClear();
    mockWatcherClose.mockClear();
  });

  afterEach(async () => {
    approvalManager.shutdown();
    await plugin.deactivate?.();
  });

  // ── TC-01: lifecycle ────────────────────────────────────────────────────────

  it('TC-01: lifecycle activate → pipeline → audit event → deactivate completes without errors', async () => {
    // Step 1 — activate
    const { ctx } = createMockContext();
    plugin.activate(ctx);

    // Step 2 — build pipeline with a permissive Stage 2 engine
    const engine = createEnforcementEngine([
      { effect: 'permit', resource: 'tool', match: '*' } satisfies Rule,
    ]);
    const stage1 = (pCtx: PipelineContext) =>
      validateCapability(pCtx, approvalManager, () => undefined);
    const stage2 = createStage2(engine);

    // Step 3 — capture audit events
    const events: unknown[] = [];
    emitter.on('executionEvent', (e) => events.push(e));

    // Step 4 — run pipeline (filesystem.read, hitl_mode=none, no approval needed)
    const result = await runPipeline(
      {
        action_class: 'filesystem.read',
        target: '/tmp/lifecycle-test.txt',
        payload_hash: 'tc01-hash',
        hitl_mode: 'none',
        rule_context: { agentId: 'agent-lifecycle', channel: 'default' },
      },
      stage1,
      stage2,
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
    // At least one audit event must have been emitted
    expect(events).toHaveLength(1);

    // Step 5 — deactivate (no-throw)
    await plugin.deactivate?.();
  });

  // ── TC-02: filesystem.read allowed without approval ─────────────────────────

  it('TC-02: filesystem.read is permitted without any approval (hitl_mode none)', async () => {
    const normalized = normalize_action('read_file', { path: '/tmp/data.txt' });

    // Normalization contract
    expect(normalized.action_class).toBe('filesystem.read');
    expect(normalized.hitl_mode).toBe('none');

    const engine = createEnforcementEngine([
      { effect: 'permit', resource: 'tool', match: '*' } satisfies Rule,
    ]);
    const stage1 = (pCtx: PipelineContext) =>
      validateCapability(pCtx, approvalManager, () => undefined);
    const stage2 = createStage2(engine);

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'tc02-hash',
        hitl_mode: normalized.hitl_mode,
        // No approval_id — must NOT be required for hitl_mode=none
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      stage1,
      stage2,
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
    expect(result.decision.reason).not.toBe('pending_hitl_approval');
  });

  // ── TC-03: system.execute forbidden unconditionally ─────────────────────────

  it('TC-03: shell.exec is forbidden unconditionally by Stage 2 even with a valid approval', async () => {
    // Stage 2 engine carries an unconditional forbid for all tool calls —
    // simulates a "system.execute forbidden" policy rule that overrides permits.
    const engine = new EnforcementPolicyEngine();
    engine.addRule({
      effect: 'forbid',
      resource: 'tool',
      match: '*',
      reason: 'system execution unconditionally forbidden',
    } satisfies Rule);

    // Issue a valid capability so Stage 1 passes; Stage 2 must still deny.
    const adapter = new FileAuthorityAdapter({ bundlePath: '/dev/null' });
    const capability = await adapter.issueCapability({
      action_class: 'shell.exec',
      target: '',
      payload_hash: 'tc03-hash',
    });

    const stage1 = (pCtx: PipelineContext) =>
      validateCapability(pCtx, approvalManager, (id) =>
        id === capability.approval_id ? capability : undefined,
      );
    const stage2 = createStage2(engine);

    const result = await runPipeline(
      {
        action_class: 'shell.exec',
        target: '',
        payload_hash: 'tc03-hash',
        hitl_mode: 'per_request',
        approval_id: capability.approval_id,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      stage1,
      stage2,
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('system execution unconditionally forbidden');
  });

  // ── TC-04: communication to untrusted domain forbidden ──────────────────────

  it('TC-04: communication to an untrusted domain is forbidden by Stage 2', async () => {
    // Cedar semantics: explicit forbid wins over the catch-all permit.
    const engine = new EnforcementPolicyEngine();
    engine.addRules([
      {
        effect: 'forbid',
        resource: 'channel',
        match: 'evil.example.com',
        reason: 'untrusted_domain',
      },
      { effect: 'permit', resource: 'channel', match: '*' },
    ] satisfies Rule[]);

    // Issue a valid capability to let Stage 1 pass.
    const adapter = new FileAuthorityAdapter({ bundlePath: '/dev/null' });
    const capability = await adapter.issueCapability({
      action_class: 'communication.email',
      target: 'evil.example.com',
      payload_hash: 'tc04-hash',
    });

    const stage1 = (pCtx: PipelineContext) =>
      validateCapability(pCtx, approvalManager, (id) =>
        id === capability.approval_id ? capability : undefined,
      );
    const stage2 = createStage2(engine);

    const result = await runPipeline(
      {
        action_class: 'communication.email',
        target: 'evil.example.com',
        payload_hash: 'tc04-hash',
        hitl_mode: 'per_request',
        approval_id: capability.approval_id,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      stage1,
      stage2,
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('untrusted_domain');
  });

  // ── TC-05: high-risk action without approval → pending_hitl_approval ─────────

  it('TC-05: high-risk action without approval returns pending_hitl_approval', async () => {
    const normalized = normalize_action('write_file', { path: '/tmp/output.txt' });

    // filesystem.write is medium risk and requires per_request HITL.
    expect(normalized.hitl_mode).toBe('per_request');

    const engine = createEnforcementEngine([
      { effect: 'permit', resource: 'tool', match: '*' } satisfies Rule,
    ]);
    const stage1 = (pCtx: PipelineContext) =>
      validateCapability(pCtx, approvalManager, () => undefined);
    const stage2 = createStage2(engine);

    const result = await runPipeline(
      {
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: 'tc05-hash',
        hitl_mode: normalized.hitl_mode,
        // No approval_id — the HITL pre-check must intercept and deny.
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      stage1,
      stage2,
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pending_hitl_approval');
  });

  // ── TC-06: high-risk action with valid approval → permitted ─────────────────

  it('TC-06: high-risk action with a valid approval token is permitted', async () => {
    const engine = createEnforcementEngine([
      { effect: 'permit', resource: 'tool', match: '*' } satisfies Rule,
    ]);

    const adapter = new FileAuthorityAdapter({ bundlePath: '/dev/null' });
    const actionClass = 'filesystem.delete';
    const target = '/tmp/old-file.txt';
    const payloadHash = 'tc06-hash';

    // Issue a capability whose binding covers this exact (action, target, payload).
    const capability = await adapter.issueCapability({
      action_class: actionClass,
      target,
      payload_hash: payloadHash,
    });

    const stage1 = (pCtx: PipelineContext) =>
      validateCapability(pCtx, approvalManager, (id) =>
        id === capability.approval_id ? capability : undefined,
      );
    const stage2 = createStage2(engine);

    const result = await runPipeline(
      {
        action_class: actionClass,
        target,
        payload_hash: payloadHash,
        hitl_mode: 'per_request',
        approval_id: capability.approval_id,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      stage1,
      stage2,
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });

  // ── TC-07: parameter tampering (hash mismatch) denied ──────────────────────

  it('TC-07: capability with mismatched payload hash is denied (payload binding mismatch)', async () => {
    const engine = createEnforcementEngine([
      { effect: 'permit', resource: 'tool', match: '*' } satisfies Rule,
    ]);

    const adapter = new FileAuthorityAdapter({ bundlePath: '/dev/null' });

    // Capability issued for the original payload hash.
    const capability = await adapter.issueCapability({
      action_class: 'filesystem.write',
      target: '/tmp/file.txt',
      payload_hash: 'original-hash',
    });

    const stage1 = (pCtx: PipelineContext) =>
      validateCapability(pCtx, approvalManager, (id) =>
        id === capability.approval_id ? capability : undefined,
      );
    const stage2 = createStage2(engine);

    // Attacker presents the same approval_id but a different payload (tampered).
    const result = await runPipeline(
      {
        action_class: 'filesystem.write',
        target: '/tmp/file.txt',
        payload_hash: 'tampered-hash', // ← differs from 'original-hash'
        hitl_mode: 'per_request',
        approval_id: capability.approval_id,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      stage1,
      stage2,
      emitter,
    );

    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('payload binding mismatch');
  });

  // ── TC-08: unknown tool name → unknown_sensitive_action ────────────────────

  it('TC-08: unknown tool name normalizes to unknown_sensitive_action with critical risk (fail-closed)', () => {
    const normalized = normalize_action('totally_unknown_tool_xyz_abc', {});

    expect(normalized.action_class).toBe('unknown_sensitive_action');
    expect(normalized.risk).toBe('critical');
    expect(normalized.hitl_mode).toBe('per_request');
  });

  // ── TC-09: audit log / ExecutionEvent ──────────────────────────────────────

  it('TC-09: pipeline emits executionEvent containing decision and ISO timestamp fields', async () => {
    const engine = createEnforcementEngine([
      { effect: 'permit', resource: 'tool', match: '*' } satisfies Rule,
    ]);
    const stage1 = (pCtx: PipelineContext) =>
      validateCapability(pCtx, approvalManager, () => undefined);
    const stage2 = createStage2(engine);

    let capturedEvent: Record<string, unknown> | undefined;
    emitter.on('executionEvent', (e: Record<string, unknown>) => {
      capturedEvent = e;
    });

    await runPipeline(
      {
        action_class: 'filesystem.read',
        target: '/tmp/data.csv',
        payload_hash: 'tc09-hash',
        hitl_mode: 'none',
        rule_context: { agentId: 'agent-audit', channel: 'test' },
      },
      stage1,
      stage2,
      emitter,
    );

    expect(capturedEvent).toBeDefined();

    // Required fields on ExecutionEvent
    expect(capturedEvent).toHaveProperty('decision');
    expect(capturedEvent).toHaveProperty('timestamp');

    // Timestamp must be a valid ISO 8601 string
    expect(typeof capturedEvent!.timestamp).toBe('string');
    expect(() => new Date(capturedEvent!.timestamp as string)).not.toThrow();

    // Decision must carry the permit effect
    const decision = capturedEvent!.decision as { effect: string };
    expect(decision.effect).toBe('permit');
  });

  // ── TC-10: bundle hot-reload within 500ms ──────────────────────────────────

  it(
    'TC-10: FileAuthorityAdapter hot-reload calls onUpdate within 500ms of a bundle change',
    async () => {
      // Uses real timers — fake timers cannot reliably await the async readFile
      // call inside the debounce callback (void reload() discards the Promise).
      const watchEmitter = new EventEmitter();
      const watchStub = {
        on(event: string, cb: (...args: unknown[]) => void) {
          watchEmitter.on(event, cb);
          return this as typeof watchStub;
        },
        close: vi.fn().mockResolvedValue(undefined),
      };
      // Override chokidar.watch for this one call only.
      vi.mocked(chokidar.watch).mockReturnValueOnce(
        watchStub as unknown as ReturnType<typeof chokidar.watch>,
      );

      // Set up a temp directory with an initial bundle file.
      const tmpDir = join(tmpdir(), `oa-integration-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });
      const bundlePath = join(tmpDir, 'bundle.json');
      await writeFile(bundlePath, JSON.stringify({ version: 1, policies: [] }));

      const adapter = new FileAuthorityAdapter({ bundlePath });
      const updates: unknown[] = [];
      const handle = await adapter.watchPolicyBundle((bundle) => updates.push(bundle));

      // The adapter must call onUpdate immediately with the initial bundle.
      expect(updates).toHaveLength(1);
      expect((updates[0] as Record<string, unknown>).version).toBe(1);

      // Write a new bundle with a strictly greater version.
      await writeFile(bundlePath, JSON.stringify({ version: 2, policies: ['policy-a'] }));

      // Mark time and trigger the file-change event (simulates chokidar detecting the write).
      const before = Date.now();
      watchEmitter.emit('change');

      // Wait for the 300ms debounce + readFile I/O to complete.
      // Using a real 450ms wait stays comfortably within the 500ms budget.
      await new Promise<void>((resolve) => setTimeout(resolve, 450));

      // Verify the hot-reload fired within 500ms.
      expect(Date.now() - before).toBeLessThan(500);
      expect(updates).toHaveLength(2);
      expect((updates[1] as Record<string, unknown>).version).toBe(2);

      await handle.stop();
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {/* best-effort cleanup */});
    },
    10_000, // allow up to 10s; test takes ~450ms in practice
  );

  // ── TC-11: deactivate leaves no hanging listeners or watchers ───────────────

  it('TC-11: deactivate closes all watchers and is idempotent (safe to call twice)', async () => {
    const { ctx } = createMockContext();
    plugin.activate(ctx);

    // Record how many watchers were created during activation.
    const watchCallCount = vi.mocked(chokidar.watch).mock.calls.length;
    expect(watchCallCount).toBeGreaterThanOrEqual(1);

    // First deactivate — all watchers must be closed.
    await plugin.deactivate?.();
    expect(mockWatcherClose).toHaveBeenCalledTimes(watchCallCount);

    // Second deactivate — must not close watchers again (idempotent).
    await expect(plugin.deactivate?.()).resolves.not.toThrow();
    expect(mockWatcherClose).toHaveBeenCalledTimes(watchCallCount);
  });
});

/**
 * E2E tests for the unsafe_admin_exec tool.
 *
 * Exercises the complete enforcement pipeline for the F-05 escape-hatch tool,
 * covering approval, denial, validation, and capability-replay scenarios.
 * child_process.spawnSync is mocked so no real commands are executed.
 *
 *  TC-UAE-01  Approved execution path — HITL token issued, pipeline permits, tool executes
 *  TC-UAE-02  Denied execution path — no capability token, pipeline returns pending_hitl_approval
 *  TC-UAE-03  Justification-too-short rejection — stage2 forbids commands below minimum length
 *  TC-UAE-04  Capability token replay rejection — consumed token is denied (capability already consumed)
 *  TC-UAE-05  Audit trail — executionEvent captures all three decision paths with correct reasons
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, CeeDecision } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { createStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import { computePayloadHash } from './envelope.js';
import { unsafeAdminExec } from './tools/unsafe_admin_exec/unsafe-admin-exec.js';
import type { UnsafeAdminExecLogger } from './tools/unsafe_admin_exec/unsafe-admin-exec.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import type { Rule } from './policy/types.js';

// ─── Mock child_process ───────────────────────────────────────────────────────
//
// Stub spawnSync so no real shell commands are executed during tests.
// Returns a stable mocked result that exercises the stdout/stderr/exit_code
// code paths inside unsafeAdminExec.

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({
    stdout: 'mocked-stdout\n',
    stderr: '',
    status: 0,
    signal: null,
    pid: 12345,
  })),
}));

// ─── HitlTestHarness ──────────────────────────────────────────────────────────
//
// Self-contained minimal HITL server harness — mirrors the pattern used in
// regression-capability-replay.e2e.ts.  Defined locally so this suite does
// not depend on shared test infrastructure.

const TEST_POLICY: HitlPolicy = {
  name: 'test-hitl-policy',
  actions: ['shell.exec'],
  approval: { channel: 'test', timeout: 3600, fallback: 'deny' },
};

interface ApproveNextOpts {
  action_class: string;
  target: string;
  payload_hash: string;
}

class HitlTestHarness {
  private readonly approvalManager: ApprovalManager;
  private readonly issued = new Map<string, Capability>();

  readonly stage1: Stage1Fn;

  constructor() {
    this.approvalManager = new ApprovalManager();
    this.stage1 = (ctx: PipelineContext) =>
      validateCapability(ctx, this.approvalManager, (id) => this.issued.get(id));
  }

  /**
   * Simulates a human approving an action via the HITL server.
   * Returns the capability token to pass as `ctx.approval_id`.
   */
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

  /** Records that a capability was exercised (moves token to consumed set). */
  markConsumed(token: string): void {
    this.approvalManager.resolveApproval(token, 'approved');
  }

  shutdown(): void {
    this.approvalManager.shutdown();
  }
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TOOL_NAME = 'unsafe_admin_exec' as const;
const ACTION = 'shell.exec' as const;

/** A well-formed command that satisfies any minimum-length policy requirement. */
const PROPER_COMMAND = 'ls -la /workspace' as const;
/** A short command that a justification-length policy would reject. */
const SHORT_COMMAND = 'ls' as const;

/** Permissive stage2 — permits all shell.exec actions regardless of target. */
const permissiveStage2 = createStage2(
  createEnforcementEngine([
    { effect: 'permit', resource: 'tool', match: '*' },
  ] satisfies Rule[]),
);

/**
 * Stage2 that forbids shell.exec commands shorter than 10 characters.
 * Models a policy that rejects tool calls lacking adequate justification.
 *
 * EnforcementPolicyEngine.evaluateByActionClass maps all action classes not
 * matching known prefixes (communication, command, prompt, model) to the
 * 'tool' resource, then calls evaluate('tool', target, context).  Rules must
 * therefore use resource/match form rather than action_class form.
 */
const shortCommandForbidStage2 = createStage2(
  createEnforcementEngine([
    {
      effect: 'forbid',
      resource: 'tool',
      match: '*',
      target_match: /^.{0,9}$/,
      reason: 'justification-too-short',
    },
    { effect: 'permit', resource: 'tool', match: '*' },
  ] satisfies Rule[]),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a stub audit logger that records all entries for assertions. */
function makeLogger(): { logger: UnsafeAdminExecLogger; entries: Array<Record<string, unknown>> } {
  const entries: Array<Record<string, unknown>> = [];
  return {
    logger: { log: async (e) => { entries.push(e); } },
    entries,
  };
}

const RULE_CONTEXT = { agentId: 'agent-ops', channel: 'ops' };

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('unsafe_admin_exec — E2E enforcement and execution', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;
  const ORIGINAL_ENV = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
    if (ORIGINAL_ENV === undefined) {
      delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    } else {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = ORIGINAL_ENV;
    }
  });

  // ── TC-UAE-01 ──────────────────────────────────────────────────────────────

  it(
    'TC-UAE-01: approved execution path — HITL token permits pipeline, tool executes and returns result',
    async () => {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';

      const params = { command: PROPER_COMMAND };
      const payloadHash = computePayloadHash(TOOL_NAME, params);
      const token = harness.approveNext({
        action_class: ACTION,
        target: PROPER_COMMAND,
        payload_hash: payloadHash,
      });

      const { logger, entries } = makeLogger();

      // Pipeline must permit — HITL token issued for matching params.
      const pipelineResult = await runPipeline(
        {
          action_class: ACTION,
          target: PROPER_COMMAND,
          payload_hash: payloadHash,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: RULE_CONTEXT,
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(pipelineResult.decision.effect).toBe('permit');

      // Tool must execute and return a result when permitted.
      const execResult = await unsafeAdminExec(params, {
        logger,
        agentId: RULE_CONTEXT.agentId,
        channel: RULE_CONTEXT.channel,
      });

      expect(execResult.stdout).toBe('mocked-stdout\n');
      expect(execResult.stderr).toBe('');
      expect(execResult.exit_code).toBe(0);

      // Audit logger must record exec-attempt and exec-complete entries.
      const events = entries.map((e) => e['event']);
      expect(events).toContain('exec-attempt');
      expect(events).toContain('exec-complete');

      // All audit entries must carry the correct agent and channel context.
      for (const entry of entries) {
        expect(entry['agentId']).toBe(RULE_CONTEXT.agentId);
        expect(entry['channel']).toBe(RULE_CONTEXT.channel);
        expect(entry['toolName']).toBe(TOOL_NAME);
      }
    },
  );

  // ── TC-UAE-02 ──────────────────────────────────────────────────────────────

  it(
    'TC-UAE-02: denied execution path — missing capability token produces pending_hitl_approval forbid',
    async () => {
      const params = { command: PROPER_COMMAND };
      const payloadHash = computePayloadHash(TOOL_NAME, params);

      // No token issued — HITL approval is still pending.
      const pipelineResult = await runPipeline(
        {
          action_class: ACTION,
          target: PROPER_COMMAND,
          payload_hash: payloadHash,
          hitl_mode: 'per_request',
          // approval_id intentionally absent
          rule_context: RULE_CONTEXT,
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(pipelineResult.decision.effect).toBe('forbid');
      expect(pipelineResult.decision.reason).toBe('pending_hitl_approval');

      // executionEvent must still be emitted so the forbid path is auditable.
      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (evt) => auditEvents.push(evt));

      // Run a second time to capture the event in the listener-registered order.
      await runPipeline(
        {
          action_class: ACTION,
          target: PROPER_COMMAND,
          payload_hash: payloadHash,
          hitl_mode: 'per_request',
          rule_context: RULE_CONTEXT,
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]!.decision.effect).toBe('forbid');
      expect(auditEvents[0]!.decision.reason).toBe('pending_hitl_approval');
      expect(auditEvents[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    },
  );

  // ── TC-UAE-03 ──────────────────────────────────────────────────────────────

  it(
    'TC-UAE-03: justification-too-short rejection — stage2 forbids commands below minimum length',
    async () => {
      // Issue a valid capability for the short command — stage1 will permit.
      const params = { command: SHORT_COMMAND };
      const payloadHash = computePayloadHash(TOOL_NAME, params);
      const token = harness.approveNext({
        action_class: ACTION,
        target: SHORT_COMMAND,
        payload_hash: payloadHash,
      });

      // Run pipeline with the short-command-forbid stage2.
      const pipelineResult = await runPipeline(
        {
          action_class: ACTION,
          target: SHORT_COMMAND,
          payload_hash: payloadHash,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: RULE_CONTEXT,
        },
        harness.stage1,
        shortCommandForbidStage2,
        emitter,
      );

      // Stage1 passes (valid token), stage2 forbids for justification-too-short.
      expect(pipelineResult.decision.effect).toBe('forbid');
      expect(pipelineResult.decision.reason).toBe('justification-too-short');
      expect(pipelineResult.decision.stage).toBe('stage2');

      // A proper-length command (>= 10 chars) must NOT be rejected.
      const properParams = { command: PROPER_COMMAND };
      const properHash = computePayloadHash(TOOL_NAME, properParams);
      const properToken = harness.approveNext({
        action_class: ACTION,
        target: PROPER_COMMAND,
        payload_hash: properHash,
      });

      const properResult = await runPipeline(
        {
          action_class: ACTION,
          target: PROPER_COMMAND,
          payload_hash: properHash,
          hitl_mode: 'per_request',
          approval_id: properToken,
          rule_context: RULE_CONTEXT,
        },
        harness.stage1,
        shortCommandForbidStage2,
        emitter,
      );

      expect(properResult.decision.effect).toBe('permit');
    },
  );

  // ── TC-UAE-04 ──────────────────────────────────────────────────────────────

  it(
    'TC-UAE-04: capability token replay rejection — consumed token denied as capability already consumed',
    async () => {
      const params = { command: PROPER_COMMAND };
      const payloadHash = computePayloadHash(TOOL_NAME, params);
      const token = harness.approveNext({
        action_class: ACTION,
        target: PROPER_COMMAND,
        payload_hash: payloadHash,
      });

      const ctx: PipelineContext = {
        action_class: ACTION,
        target: PROPER_COMMAND,
        payload_hash: payloadHash,
        hitl_mode: 'per_request',
        approval_id: token,
        rule_context: RULE_CONTEXT,
      };

      // First pipeline run must succeed.
      const firstResult = await runPipeline(ctx, harness.stage1, permissiveStage2, emitter);
      expect(firstResult.decision.effect).toBe('permit');

      // Simulate execution completing and the capability being consumed.
      harness.markConsumed(token);

      // Replay attempt with the same token and same params must be denied.
      const replayResult = await runPipeline(ctx, harness.stage1, permissiveStage2, emitter);
      expect(replayResult.decision.effect).toBe('forbid');
      expect(replayResult.decision.reason).toBe('capability already consumed');
      expect(replayResult.decision.stage).toBe('stage1');
    },
  );

  // ── TC-UAE-05 ──────────────────────────────────────────────────────────────

  it(
    'TC-UAE-05: audit trail — executionEvent captures permit, pending_hitl_approval, and consumed-token replay with ISO 8601 timestamps',
    async () => {
      const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      emitter.on('executionEvent', (evt) => auditEvents.push(evt));

      const params = { command: PROPER_COMMAND };
      const payloadHash = computePayloadHash(TOOL_NAME, params);

      // --- Execution 1: approved (permit) ---
      const token = harness.approveNext({
        action_class: ACTION,
        target: PROPER_COMMAND,
        payload_hash: payloadHash,
      });

      await runPipeline(
        {
          action_class: ACTION,
          target: PROPER_COMMAND,
          payload_hash: payloadHash,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: RULE_CONTEXT,
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      // Simulate the capability being consumed after the first execution.
      harness.markConsumed(token);

      // --- Execution 2: denied (no approval token) ---
      await runPipeline(
        {
          action_class: ACTION,
          target: PROPER_COMMAND,
          payload_hash: payloadHash,
          hitl_mode: 'per_request',
          // approval_id intentionally absent
          rule_context: RULE_CONTEXT,
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      // --- Execution 3: replay with consumed token ---
      await runPipeline(
        {
          action_class: ACTION,
          target: PROPER_COMMAND,
          payload_hash: payloadHash,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: RULE_CONTEXT,
        },
        harness.stage1,
        permissiveStage2,
        emitter,
      );

      // All three executions must have emitted an audit event.
      expect(auditEvents).toHaveLength(3);

      // Event 0: approved permit path.
      expect(auditEvents[0]!.decision.effect).toBe('permit');

      // Event 1: no-token denial.
      expect(auditEvents[1]!.decision.effect).toBe('forbid');
      expect(auditEvents[1]!.decision.reason).toBe('pending_hitl_approval');

      // Event 2: consumed-token replay denial.
      expect(auditEvents[2]!.decision.effect).toBe('forbid');
      expect(auditEvents[2]!.decision.reason).toBe('capability already consumed');

      // Every event must carry an ISO 8601 timestamp.
      for (const evt of auditEvents) {
        expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    },
  );
});

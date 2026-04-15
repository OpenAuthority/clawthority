/**
 * Destructive filesystem aliases e2e tests — Open Authority T14
 *
 * Proves that every alias added to filesystem.delete maps to the destructive_fs
 * intent group and triggers HITL (per_request) + forbid from a destructive_fs
 * forbid rule in Stage 2.
 *
 * TC-DFA-01  rm              → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-02  rm_rf           → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-03  unlink          → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-04  delete          → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-05  remove          → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-06  move_to_trash   → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-07  trash           → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-08  shred           → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-09  rmdir           → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-10  format          → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-11  empty_trash     → filesystem.delete, destructive_fs, hitl required, forbidden
 * TC-DFA-12  purge           → filesystem.delete, destructive_fs, hitl required, forbidden
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, Stage2Fn, CeeDecision } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { normalize_action } from './enforcement/normalize.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';

// ─── Stage 2 helper ──────────────────────────────────────────────────────────

/**
 * Stage 2 policy that forbids all actions with intent_group destructive_fs.
 * All other actions are permitted by default.
 */
function buildDestructiveFsForbidStage2(): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    if (ctx.intent_group === 'destructive_fs') {
      return { effect: 'forbid', reason: 'destructive_fs_forbidden', stage: 'stage2' };
    }
    return { effect: 'permit', reason: 'default_permit', stage: 'stage2' };
  };
}

// ─── HitlTestHarness ─────────────────────────────────────────────────────────

const TEST_POLICY: HitlPolicy = {
  name: 'test-hitl-policy',
  actions: ['*'],
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
    };

    this.issued.set(handle.token, capability);
    return handle.token;
  }

  shutdown(): void {
    this.approvalManager.shutdown();
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────────

const DESTRUCTIVE_ALIASES = [
  'rm',
  'rm_rf',
  'unlink',
  'delete',
  'remove',
  'move_to_trash',
  'trash',
  'shred',
  'rmdir',
  'format',
  'empty_trash',
  'purge',
] as const;

describe('destructive filesystem aliases — HITL and destructive_fs forbid', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  for (const [index, alias] of DESTRUCTIVE_ALIASES.entries()) {
    const tcId = `TC-DFA-${String(index + 1).padStart(2, '0')}`;

    it(
      `${tcId}: "${alias}" → filesystem.delete, destructive_fs intent, HITL per_request, forbidden by destructive_fs rule`,
      async () => {
        const normalized = normalize_action(alias, { path: '/tmp/target-file' });

        // Normalization assertions
        expect(normalized.action_class).toBe('filesystem.delete');
        expect(normalized.intent_group).toBe('destructive_fs');
        expect(normalized.hitl_mode).toBe('per_request');
        expect(normalized.risk).toBe('high');

        const HASH = `hash-dfa-${String(index + 1).padStart(2, '0')}`;
        const token = harness.approveNext({
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: HASH,
        });

        const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
        emitter.on('executionEvent', (e) => auditEvents.push(e));

        const stage2 = buildDestructiveFsForbidStage2();

        const result = await runPipeline(
          {
            action_class: normalized.action_class,
            target: normalized.target,
            payload_hash: HASH,
            hitl_mode: normalized.hitl_mode,
            intent_group: normalized.intent_group,
            approval_id: token,
            rule_context: { agentId: 'agent-1', channel: 'default' },
          },
          harness.stage1,
          stage2,
          emitter,
        );

        expect(result.decision.effect).toBe('forbid');
        expect(result.decision.reason).toBe('destructive_fs_forbidden');
        expect(auditEvents).toHaveLength(1);
        expect(auditEvents[0].decision.effect).toBe('forbid');
        expect(auditEvents[0].decision.reason).toBe('destructive_fs_forbidden');
      },
    );
  }
});

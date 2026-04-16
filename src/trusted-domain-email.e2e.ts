/**
 * Trusted domain email policy e2e tests
 *
 * Exercises send_email operations through the two-stage enforcement pipeline
 * with a domain-allowlist Stage 2 policy derived from the trusted-acme.json
 * bundle fixture.
 *
 *  TC-EMAIL-01  send_email to trusted acme.com domain with approval → permit
 *  TC-EMAIL-02  send_email to untrusted domain → forbid (untrusted_domain)
 *  TC-EMAIL-03  write_file reclassified to communication.external.send via
 *               email target → end-to-end permit for trusted domain
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, Stage2Fn } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { createStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';
import { normalize_action } from './enforcement/normalize.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import { FileAuthorityAdapter } from './adapter/file-adapter.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import type { Rule } from './policy/types.js';

// ─── Fixture ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TrustedAcmeFixture {
  name: string;
  version: number;
  description: string;
  trustedDomains: string[];
}

const trustedAcme: TrustedAcmeFixture = JSON.parse(
  readFileSync(join(__dirname, '../data/fixtures/trusted-acme.json'), 'utf-8'),
) as TrustedAcmeFixture;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a Stage 2 policy engine that permits only email targets whose domain
 * matches one of the provided trusted domains.
 *
 * Cedar semantics: an explicit `forbid` rule on `channel` resources matches
 * any target NOT ending with a trusted-domain address.  Trusted-domain
 * addresses find no matching rule and receive the engine's implicit `permit`.
 */
function buildDomainTrustStage2(trustedDomains: string[]): Stage2Fn {
  const escapedDomains = trustedDomains.map((d) => d.replace('.', '\\.'));
  const untrustedPattern = new RegExp(`^(?!.*@(${escapedDomains.join('|')})$)`);

  return createStage2(
    createEnforcementEngine([
      {
        effect: 'forbid',
        resource: 'channel',
        match: untrustedPattern,
        reason: 'untrusted_domain',
      },
    ] satisfies Rule[]),
  );
}

// ─── HitlTestHarness ─────────────────────────────────────────────────────────

/**
 * Minimal HITL policy used inside the harness.
 * Timeout is intentionally long so TTL never fires during standard tests.
 */
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

/**
 * Mock HITL server harness — mirrors the pattern established in
 * hitl-approval-lifecycle.e2e.ts.  Simulates human approval by pre-issuing
 * a capability token that Stage 1 accepts.
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
    };

    this.issued.set(handle.token, capability);
    return handle.token;
  }

  shutdown(): void {
    this.approvalManager.shutdown();
  }
}

// ─── Helpers (continued) ──────────────────────────────────────────────────────

/**
 * Builds a Stage 2 policy engine that both enforces domain trust AND
 * forbids any address in the provided per-address blocklist.
 *
 * The per-address forbid uses `target_match` to match a specific email address
 * exactly, demonstrating that target-level refinement works alongside domain-
 * level trust policies.  Cedar forbid-wins: even if the domain is trusted, a
 * blocklisted individual address is denied.
 */
function buildDomainTrustWithAddressBlockStage2(
  trustedDomains: string[],
  blockedAddresses: string[],
): Stage2Fn {
  const escapedDomains = trustedDomains.map((d) => d.replace('.', '\\.'));
  const untrustedPattern = new RegExp(`^(?!.*@(${escapedDomains.join('|')})$)`);

  const rules: Rule[] = [
    {
      effect: 'forbid',
      resource: 'channel',
      match: untrustedPattern,
      reason: 'untrusted_domain',
    },
    ...blockedAddresses.map((addr) => ({
      effect: 'forbid' as const,
      resource: 'channel' as const,
      match: '*',
      target_match: new RegExp(`^${addr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      reason: 'per_address_forbid',
    })),
  ];

  return createStage2(createEnforcementEngine(rules satisfies Rule[]));
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('trusted domain email policy', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  // ── TC-EMAIL-01 ─────────────────────────────────────────────────────────────

  it(
    'TC-EMAIL-01: send_email to trusted acme.com domain with approval is permitted',
    async () => {
      const ACTION = 'communication.email' as const;
      const TARGET = 'cto@acme.com' as const;
      const HASH = 'hash-email-01';

      const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: HASH });
      const stage2 = buildDomainTrustStage2(trustedAcme.trustedDomains);

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: HASH,
          hitl_mode: 'per_request',
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        stage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );

  // ── TC-EMAIL-02 ─────────────────────────────────────────────────────────────

  it(
    'TC-EMAIL-02: send_email to untrusted domain is denied with untrusted_domain',
    async () => {
      const ACTION = 'communication.email' as const;
      const TARGET = 'evil@attacker.net' as const;
      const HASH = 'hash-email-02';

      // Issue a capability via FileAuthorityAdapter so Stage 1 passes,
      // leaving Stage 2 to apply the domain trust policy.
      const approvalManager = new ApprovalManager();
      const adapter = new FileAuthorityAdapter({ bundlePath: '/dev/null' });
      const capability = await adapter.issueCapability({
        action_class: ACTION,
        target: TARGET,
        payload_hash: HASH,
      });

      const stage1: Stage1Fn = (pCtx: PipelineContext) =>
        validateCapability(pCtx, approvalManager, (id) =>
          id === capability.approval_id ? capability : undefined,
        );
      const stage2 = buildDomainTrustStage2(trustedAcme.trustedDomains);

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: HASH,
          hitl_mode: 'per_request',
          approval_id: capability.approval_id,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        stage1,
        stage2,
        emitter,
      );

      approvalManager.shutdown();

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('untrusted_domain');
    },
  );

  // ── TC-EMAIL-04 ─────────────────────────────────────────────────────────────

  it(
    'TC-EMAIL-04: send_email to per-address blocklisted target is denied even for trusted domain',
    async () => {
      const ACTION = 'communication.email' as const;
      // blocked@acme.com belongs to the trusted acme.com domain but is on the per-address blocklist
      const TARGET = 'blocked@acme.com' as const;
      const HASH = 'hash-email-04';

      const approvalManager = new ApprovalManager();
      const adapter = new FileAuthorityAdapter({ bundlePath: '/dev/null' });
      const capability = await adapter.issueCapability({
        action_class: ACTION,
        target: TARGET,
        payload_hash: HASH,
      });

      const stage1: Stage1Fn = (pCtx: PipelineContext) =>
        validateCapability(pCtx, approvalManager, (id) =>
          id === capability.approval_id ? capability : undefined,
        );

      // Stage 2: domain trust + per-address block for blocked@acme.com
      const stage2 = buildDomainTrustWithAddressBlockStage2(trustedAcme.trustedDomains, [
        TARGET,
      ]);

      const result = await runPipeline(
        {
          action_class: ACTION,
          target: TARGET,
          payload_hash: HASH,
          hitl_mode: 'per_request',
          approval_id: capability.approval_id,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        stage1,
        stage2,
        emitter,
      );

      approvalManager.shutdown();

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('per_address_forbid');

      // Sanity-check: a different trusted address is still permitted with the same policy
      const capability2 = await adapter.issueCapability({
        action_class: ACTION,
        target: 'cto@acme.com',
        payload_hash: 'hash-email-04b',
      });
      const approvalManager2 = new ApprovalManager();
      const stage1b: Stage1Fn = (pCtx: PipelineContext) =>
        validateCapability(pCtx, approvalManager2, (id) =>
          id === capability2.approval_id ? capability2 : undefined,
        );
      const result2 = await runPipeline(
        {
          action_class: ACTION,
          target: 'cto@acme.com',
          payload_hash: 'hash-email-04b',
          hitl_mode: 'per_request',
          approval_id: capability2.approval_id,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        stage1b,
        buildDomainTrustWithAddressBlockStage2(trustedAcme.trustedDomains, [TARGET]),
        emitter,
      );
      approvalManager2.shutdown();
      expect(result2.decision.effect).toBe('permit');
    },
  );

  // ── TC-EMAIL-03 ─────────────────────────────────────────────────────────────

  it(
    'TC-EMAIL-03: write_file with email target is reclassified to communication.external.send and permitted for trusted domain',
    async () => {
      const params = {
        to: 'cto@acme.com',
        subject: 'Monthly Report',
        body: 'Q1 results attached.',
      };
      const HASH = 'hash-email-03';

      // Verify reclassification: write_file + email target → communication.external.send
      const normalized = normalize_action('write_file', params);
      expect(normalized.action_class).toBe('communication.external.send');
      expect(normalized.target).toBe('cto@acme.com');

      // Run the full pipeline with the reclassified action class.
      const token = harness.approveNext({
        action_class: normalized.action_class,
        target: normalized.target,
        payload_hash: HASH,
      });
      const stage2 = buildDomainTrustStage2(trustedAcme.trustedDomains);

      const result = await runPipeline(
        {
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: HASH,
          hitl_mode: normalized.hitl_mode,
          approval_id: token,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        stage2,
        emitter,
      );

      expect(result.decision.effect).toBe('permit');
    },
  );
});

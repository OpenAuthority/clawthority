/**
 * Approve Always — end-to-end workflow tests
 *
 * Exercises the complete Approve Always flow from initial HITL trigger through
 * pattern derivation, auto-permit persistence, and subsequent command bypass.
 * Uses a temporary data directory per test for full isolation.
 *
 * Acceptance criteria:
 *   TC-AA-E2E-01  HITL fires for unknown_sensitive_action → pending_hitl_approval
 *   TC-AA-E2E-02  Approve Always click → derives pattern → saves rule to auto-permits.json
 *   TC-AA-E2E-03  Subsequent matching command bypasses HITL via persisted file rule
 *   TC-AA-E2E-04  Auto-permit rule persists across restarts (store re-load from file)
 *   TC-AA-E2E-05  Pattern matching edge cases: wildcard vs exact, flags-only command
 *   TC-AA-E2E-06  Non-matching command still triggers HITL after Approve Always for a different pattern
 *
 * References: T31, T41
 * Dependencies: T48 (pattern derivation), T58 (auto-permit store)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { runWithHitl } from './enforcement/hitl-dispatch.js';
import type { HitlDispatchOpts } from './enforcement/hitl-dispatch.js';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { createCombinedStage2, createEnforcementEngine } from './enforcement/stage2-policy.js';
import { ApprovalManager, computeBinding, uuidv7 } from './hitl/approval-manager.js';
import type { HitlPolicyConfig } from './hitl/types.js';
import type { Capability } from './adapter/types.js';
import type { Rule } from './policy/types.js';
import { derivePattern } from './auto-permits/pattern-derivation.js';
import {
  loadAutoPermitRulesFromFile,
  saveAutoPermitRules,
} from './auto-permits/store.js';
import { FileAutoPermitChecker } from './auto-permits/matcher.js';
import type { AutoPermit } from './models/auto-permit.js';

// ─── Shared constants ─────────────────────────────────────────────────────────

const CHANNEL_ID = 'test-channel-aa';
const AGENT_ID = 'agent-aa-e2e';

/**
 * HITL policy that covers `unknown_sensitive_action`.
 * Priority 90 places this in the HITL-gated tier so HITL can release it.
 */
const HITL_CONFIG: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'sensitive-action-approvals',
      actions: ['unknown_sensitive_action'],
      approval: { channel: 'test-mock', timeout: 60, fallback: 'deny' },
    },
  ],
};

/**
 * Cedar engine that forbids everything at priority 90 (HITL-gated tier).
 * HITL can release priority-90 forbids; it cannot release priority-100+ ones.
 */
const sensitiveActionEngine = createEnforcementEngine([
  {
    effect: 'forbid',
    resource: 'tool',
    match: '*',
    priority: 90,
    reason: 'sensitive-action-requires-approval',
  },
  {
    effect: 'permit',
    resource: 'channel',
    match: '*',
  },
] satisfies Rule[]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generates a unique temporary directory path for each test. */
function makeTmpDir(): string {
  const id = randomBytes(6).toString('hex');
  return join(tmpdir(), `approve-always-e2e-${id}`);
}

/** Returns the auto-permits.json path inside a temporary directory. */
function storePathFor(dir: string): string {
  return join(dir, 'auto-permits.json');
}

// ─── ApproveAlwaysHarness ─────────────────────────────────────────────────────

/**
 * Test harness for Approve Always E2E tests.
 *
 * Wires together:
 *  - A real `ApprovalManager` (so `listPending()` works correctly).
 *  - An in-memory capability store populated by `issueCapability`.
 *  - A Stage 1 function that validates capabilities from the store.
 *  - Pre-built `HitlDispatchOpts` ready for `runWithHitl`.
 *
 * The `approveAlways(token, storePath)` method simulates an operator clicking
 * the "Approve Always" button:
 *   1. Derives an auto-permit pattern from the pending command.
 *   2. Saves the rule to the temporary store.
 *   3. Registers session auto-approval on the real manager.
 *   4. Resolves the pending request as 'approved'.
 */
class ApproveAlwaysHarness {
  readonly manager: ApprovalManager;
  private readonly capabilityStore = new Map<string, Capability>();

  readonly stage1: Stage1Fn;

  constructor() {
    this.manager = new ApprovalManager();

    this.stage1 = (ctx: PipelineContext) =>
      validateCapability(
        ctx,
        this.manager,
        (id) => this.capabilityStore.get(id),
      );
  }

  /** Returns `HitlDispatchOpts` wired to this harness for use with `runWithHitl`. */
  buildOpts(hitlConfig: HitlPolicyConfig): HitlDispatchOpts {
    const self = this;
    return {
      hitlConfig,
      manager: this.manager,
      issueCapability: async (
        action_class: string,
        target: string,
        payload_hash: string,
        session_id?: string,
      ): Promise<Capability> => {
        const approval_id = uuidv7();
        const cap: Capability = {
          approval_id,
          binding: computeBinding(action_class, target, payload_hash),
          action_class,
          target,
          issued_at: Date.now(),
          expires_at: Date.now() + 3_600_000,
          ...(session_id !== undefined ? { session_id } : {}),
        };
        self.capabilityStore.set(approval_id, cap);
        return cap;
      },
      agentId: AGENT_ID,
      channelId: CHANNEL_ID,
    };
  }

  /**
   * Simulates an operator clicking "Approve Always" for the pending request
   * identified by `token`.
   *
   * 1. Looks up the pending request to get the original command (target).
   * 2. Derives an auto-permit pattern via `derivePattern`.
   * 3. Saves the rule to `storePath` (appending to any existing rules).
   * 4. Registers session auto-approval on the manager.
   * 5. Resolves the pending approval as 'approved'.
   *
   * Returns the `AutoPermit` record that was saved.
   */
  async approveAlways(token: string, storePath: string): Promise<AutoPermit> {
    const pending = this.manager.getPending(token);
    if (!pending) {
      throw new Error(`No pending request for token ${token}`);
    }

    // Derive pattern from the command.  For exec-type action classes the
    // target IS the command string (as set by the pipeline normaliser).
    const derived = derivePattern({ command: pending.target });
    const now = Date.now();
    const newRule: AutoPermit = {
      pattern: derived.pattern,
      method: derived.method,
      createdAt: now,
      originalCommand: pending.target,
      created_by: CHANNEL_ID,
      created_at: new Date(now).toISOString(),
      derived_from: pending.target,
    };

    // Load existing rules (ENOENT → empty), append new rule, persist.
    const existing = await loadAutoPermitRulesFromFile(storePath);
    await saveAutoPermitRules(
      storePath,
      [...existing.rules, newRule],
      existing.version + 1,
    );

    // Register session auto-approval (mirrors Slack / Telegram handler).
    this.manager.addSessionAutoApproval(CHANNEL_ID, pending.action_class);

    // Resolve the original HITL approval request as 'approved'.
    this.manager.resolveApproval(token, 'approved');

    return newRule;
  }

  shutdown(): void {
    this.manager.shutdown();
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Approve Always — end-to-end workflow', () => {
  let emitter: EventEmitter;
  let harness: ApproveAlwaysHarness;
  let tmpDir: string;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new ApproveAlwaysHarness();
    tmpDir = makeTmpDir();
  });

  afterEach(async () => {
    harness.shutdown();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── TC-AA-E2E-01 ─────────────────────────────────────────────────────────────

  it(
    'TC-AA-E2E-01: HITL fires for unknown_sensitive_action — returns pending_hitl_approval',
    async () => {
      // Stage 2 with no auto-permit rules; Stage 1 fires the HITL pre-check.
      const stage2 = createCombinedStage2(sensitiveActionEngine, null, 'bash');

      // Run the pipeline directly (not via runWithHitl) with hitl_mode
      // 'per_request' so Stage 1's HITL pre-check fires immediately.
      const result = await runPipeline(
        {
          action_class: 'unknown_sensitive_action',
          target: 'rm -rf /tmp/test-dir',
          payload_hash: 'hash-aa-01',
          hitl_mode: 'per_request',
          rule_context: { agentId: AGENT_ID, channel: CHANNEL_ID },
        },
        harness.stage1,
        stage2,
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('pending_hitl_approval');
    },
  );

  // ── TC-AA-E2E-02 ─────────────────────────────────────────────────────────────

  it(
    'TC-AA-E2E-02: Approve Always click derives pattern and saves rule to auto-permits.json',
    async () => {
      const storePath = storePathFor(tmpDir);
      const COMMAND = 'git commit -m "initial"';
      const opts = harness.buildOpts(HITL_CONFIG);

      // Run HITL dispatch in background — it will await the operator decision.
      const hitlPromise = runWithHitl(
        {
          action_class: 'unknown_sensitive_action',
          target: COMMAND,
          payload_hash: 'hash-aa-02',
          hitl_mode: 'per_request',
          rule_context: { agentId: AGENT_ID, channel: CHANNEL_ID },
        },
        harness.stage1,
        createCombinedStage2(sensitiveActionEngine, null, 'bash'),
        emitter,
        opts,
      );

      // Give runWithHitl time to create the approval request and block on it.
      await new Promise((r) => setTimeout(r, 20));

      // Retrieve the pending token via listPending().
      const pending = harness.manager.listPending();
      expect(pending).toHaveLength(1);
      const token = pending[0]!.token;

      // Simulate the operator clicking "Approve Always".
      const savedRule = await harness.approveAlways(token, storePath);

      // HITL dispatch resolves and re-runs the pipeline → permit.
      const result = await hitlPromise;
      expect(result.decision.effect).toBe('permit');

      // The derived pattern for 'git commit -m "initial"' is 'git commit *'.
      expect(savedRule.pattern).toBe('git commit *');
      expect(savedRule.method).toBe('default');
      expect(savedRule.originalCommand).toBe(COMMAND);

      // Verify the rule is persisted on disk.
      const loaded = await loadAutoPermitRulesFromFile(storePath);
      expect(loaded.found).toBe(true);
      expect(loaded.rules).toHaveLength(1);
      expect(loaded.rules[0]!.pattern).toBe('git commit *');
    },
  );

  // ── TC-AA-E2E-03 ─────────────────────────────────────────────────────────────

  it(
    'TC-AA-E2E-03: subsequent matching command bypasses HITL via persisted file rule',
    async () => {
      const storePath = storePathFor(tmpDir);
      const COMMAND = 'git commit -m "initial"';
      const opts = harness.buildOpts(HITL_CONFIG);

      // First request — goes through HITL, operator clicks Approve Always.
      const hitlPromise = runWithHitl(
        {
          action_class: 'unknown_sensitive_action',
          target: COMMAND,
          payload_hash: 'hash-aa-03a',
          hitl_mode: 'per_request',
          rule_context: { agentId: AGENT_ID, channel: CHANNEL_ID },
        },
        harness.stage1,
        createCombinedStage2(sensitiveActionEngine, null, 'bash'),
        emitter,
        opts,
      );

      await new Promise((r) => setTimeout(r, 20));
      const pending = harness.manager.listPending();
      expect(pending).toHaveLength(1);
      await harness.approveAlways(pending[0]!.token, storePath);
      await hitlPromise;

      // Reload the persisted rule and build a fresh FileAutoPermitChecker.
      const loaded = await loadAutoPermitRulesFromFile(storePath);
      const ruleChecker = new FileAutoPermitChecker(loaded.rules);

      // Build stage2 with the file rule checker.
      const stage2WithRules = createCombinedStage2(
        sensitiveActionEngine,
        null,
        'bash',
        undefined,
        ruleChecker,
      );

      // Second request via runWithHitl: the first pass runs with hitl_mode 'none',
      // so Stage 2 is reached and the auto-permit rule matches before any HITL
      // dispatch occurs.  The result is permit with no HITL interaction.
      const secondResult = await runWithHitl(
        {
          action_class: 'unknown_sensitive_action',
          target: 'git commit -m "fixup"',
          payload_hash: 'hash-aa-03b',
          hitl_mode: 'per_request',
          rule_context: { agentId: AGENT_ID, channel: CHANNEL_ID },
        },
        harness.stage1,
        stage2WithRules,
        emitter,
        harness.buildOpts(HITL_CONFIG),
      );

      expect(secondResult.decision.effect).toBe('permit');
      expect(secondResult.decision.reason).toBe('auto_permit_rule');
      expect(secondResult.decision.stage).toBe('auto-permit');
      expect(secondResult.decision.rule).toBe('git commit *');
    },
  );

  // ── TC-AA-E2E-04 ─────────────────────────────────────────────────────────────

  it(
    'TC-AA-E2E-04: auto-permit rule persists across restarts (store re-load)',
    async () => {
      const storePath = storePathFor(tmpDir);

      // Simulate a previous session writing a rule to the store.
      const storedRule: AutoPermit = {
        pattern: 'npm run *',
        method: 'default',
        createdAt: Date.now() - 60_000,
        originalCommand: 'npm run build',
        created_by: CHANNEL_ID,
        created_at: new Date(Date.now() - 60_000).toISOString(),
      };
      await saveAutoPermitRules(storePath, [storedRule], 1);

      // Simulate process restart: create a fresh harness (no in-memory state).
      const freshHarness = new ApproveAlwaysHarness();
      try {
        // Re-load rules from disk (startup path).
        const loaded = await loadAutoPermitRulesFromFile(storePath);
        expect(loaded.found).toBe(true);
        expect(loaded.rules).toHaveLength(1);
        expect(loaded.rules[0]!.pattern).toBe('npm run *');
        expect(loaded.version).toBe(1);

        const ruleChecker = new FileAutoPermitChecker(loaded.rules);
        const stage2WithRules = createCombinedStage2(
          sensitiveActionEngine,
          null,
          'bash',
          undefined,
          ruleChecker,
        );

        // Command matching the loaded rule should be permitted without HITL.
        // runWithHitl passes hitl_mode 'none' for the first pipeline pass so
        // Stage 2 is reached and the auto-permit rule matches immediately.
        const freshOpts = freshHarness.buildOpts(HITL_CONFIG);
        const result = await runWithHitl(
          {
            action_class: 'unknown_sensitive_action',
            target: 'npm run test',
            payload_hash: 'hash-aa-04',
            hitl_mode: 'per_request',
            rule_context: { agentId: AGENT_ID, channel: CHANNEL_ID },
          },
          freshHarness.stage1,
          stage2WithRules,
          emitter,
          freshOpts,
        );

        expect(result.decision.effect).toBe('permit');
        expect(result.decision.reason).toBe('auto_permit_rule');
        expect(result.decision.rule).toBe('npm run *');

        // Non-matching command should still block (HITL pre-check).
        const blockedResult = await runPipeline(
          {
            action_class: 'unknown_sensitive_action',
            target: 'npm install',
            payload_hash: 'hash-aa-04b',
            hitl_mode: 'per_request',
            rule_context: { agentId: AGENT_ID, channel: CHANNEL_ID },
          },
          freshHarness.stage1,
          stage2WithRules,
          emitter,
        );

        expect(blockedResult.decision.effect).toBe('forbid');
        expect(blockedResult.decision.reason).toBe('pending_hitl_approval');
      } finally {
        freshHarness.shutdown();
      }
    },
  );

  // ── TC-AA-E2E-05 ─────────────────────────────────────────────────────────────

  it(
    'TC-AA-E2E-05a: wildcard pattern permits all sub-commands with any arguments',
    async () => {
      const storePath = storePathFor(tmpDir);

      // Store a pre-built 'git *' wildcard rule. This would be derived from
      // a flags-only command like 'git -v' (no positional arg → 'git *').
      const gitWildcard: AutoPermit = {
        pattern: 'git *',
        method: 'default',
        createdAt: Date.now(),
        originalCommand: 'git status',
      };
      await saveAutoPermitRules(storePath, [gitWildcard], 1);

      const loaded = await loadAutoPermitRulesFromFile(storePath);
      const ruleChecker = new FileAutoPermitChecker(loaded.rules);

      // All 'git ...' commands should match 'git *'.
      expect(ruleChecker.matchCommand('git status')).not.toBeNull();
      expect(ruleChecker.matchCommand('git log --oneline')).not.toBeNull();
      expect(ruleChecker.matchCommand('git diff HEAD~1')).not.toBeNull();

      // 'npm install' should NOT match 'git *'.
      expect(ruleChecker.matchCommand('npm install')).toBeNull();
    },
  );

  it(
    'TC-AA-E2E-05b: exact pattern only permits the exact normalised command',
    async () => {
      const storePath = storePathFor(tmpDir);

      const exactRule: AutoPermit = {
        pattern: 'git status',
        method: 'exact',
        createdAt: Date.now(),
        originalCommand: 'git status',
      };
      await saveAutoPermitRules(storePath, [exactRule], 1);

      const loaded = await loadAutoPermitRulesFromFile(storePath);
      const ruleChecker = new FileAutoPermitChecker(loaded.rules);

      // Exact match.
      expect(ruleChecker.matchCommand('git status')).not.toBeNull();
      // With extra argument — must NOT match.
      expect(ruleChecker.matchCommand('git status --short')).toBeNull();
      // Different sub-command — must NOT match.
      expect(ruleChecker.matchCommand('git log')).toBeNull();
    },
  );

  it(
    'TC-AA-E2E-05c: flags-only command derives binary + wildcard pattern',
    () => {
      // 'ls -la' has only flag arguments (no positional) → derived pattern = 'ls *'.
      const derived = derivePattern({ command: 'ls -la' });
      expect(derived.pattern).toBe('ls *');
      expect(derived.method).toBe('default');
    },
  );

  it(
    'TC-AA-E2E-05d: binary-only command derives the binary itself as the pattern',
    () => {
      // 'git' with no arguments → pattern = 'git' (no wildcard).
      const derived = derivePattern({ command: 'git' });
      expect(derived.pattern).toBe('git');
      expect(derived.method).toBe('default');
    },
  );

  it(
    'TC-AA-E2E-05e: multiple auto-permit rules — first matching rule wins',
    async () => {
      const storePath = storePathFor(tmpDir);

      const rules: AutoPermit[] = [
        { pattern: 'git *', method: 'default', createdAt: Date.now(), originalCommand: 'git log' },
        { pattern: 'git commit *', method: 'default', createdAt: Date.now(), originalCommand: 'git commit -m "x"' },
      ];
      await saveAutoPermitRules(storePath, rules, 1);

      const loaded = await loadAutoPermitRulesFromFile(storePath);
      const ruleChecker = new FileAutoPermitChecker(loaded.rules);

      // Both 'git *' and 'git commit *' would match; the first one in the list wins.
      const matched = ruleChecker.matchCommand('git commit -m "fix"');
      expect(matched).not.toBeNull();
      expect(matched!.pattern).toBe('git *');
    },
  );

  // ── TC-AA-E2E-06 ─────────────────────────────────────────────────────────────

  it(
    'TC-AA-E2E-06: non-matching command still triggers HITL after Approve Always for a different pattern',
    async () => {
      const storePath = storePathFor(tmpDir);

      // Store a rule for 'git commit *' only.
      const rule: AutoPermit = {
        pattern: 'git commit *',
        method: 'default',
        createdAt: Date.now(),
        originalCommand: 'git commit -m "init"',
      };
      await saveAutoPermitRules(storePath, [rule], 1);

      const loaded = await loadAutoPermitRulesFromFile(storePath);
      const ruleChecker = new FileAutoPermitChecker(loaded.rules);

      const stage2WithRules = createCombinedStage2(
        sensitiveActionEngine,
        null,
        'bash',
        undefined,
        ruleChecker,
      );

      // 'npm install' does NOT match 'git commit *'.
      // Stage 1 HITL pre-check fires first (per_request mode, no approval_id).
      const result = await runPipeline(
        {
          action_class: 'unknown_sensitive_action',
          target: 'npm install',
          payload_hash: 'hash-aa-06',
          hitl_mode: 'per_request',
          rule_context: { agentId: AGENT_ID, channel: CHANNEL_ID },
        },
        harness.stage1,
        stage2WithRules,
        emitter,
      );

      expect(result.decision.effect).toBe('forbid');
      expect(result.decision.reason).toBe('pending_hitl_approval');
    },
  );
});

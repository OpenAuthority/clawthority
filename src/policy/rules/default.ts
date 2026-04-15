import type { Rule } from '../types.js';
import { detectSensitiveData } from '../../enforcement/pii-classifier.js';

/**
 * Baseline action-class policy rules for the Open Authority openclaw plugin.
 *
 * Rules are evaluated by Stage 2 using action_class semantics.  Priority
 * determines evaluation order — lower numbers are evaluated first.
 *
 * Priority tiers:
 *   10  — permitted baseline actions (unconditional permit)
 *   90  — sensitive actions requiring HITL approval (forbid pending approval)
 *   100 — unconditionally forbidden actions (hard forbid, no override)
 *
 * Per-agent overrides and extensions live in sibling rule files (e.g.
 * support.ts) and are merged over these defaults via mergeRules() in index.ts.
 */
const DEFAULT_RULES: Rule[] = [

  // ─── Priority 10: Permitted baseline actions ────────────────────────────────

  /**
   * Permit filesystem read operations for all agents.
   * Read-only access carries no mutation risk.
   */
  {
    action_class: 'filesystem.read',
    effect: 'permit',
    priority: 10,
    reason: 'Filesystem read operations are permitted for all agents',
    tags: ['filesystem', 'read-only'],
  },

  /**
   * Permit browser navigation for all agents.
   * Navigation alone does not mutate state or exfiltrate credentials.
   */
  {
    action_class: 'browser.navigate',
    effect: 'permit',
    priority: 10,
    reason: 'Browser navigation is permitted for all agents',
    tags: ['browser'],
  },

  // ─── Priority 90: Sensitive actions requiring HITL approval ─────────────────

  /**
   * Forbid payment transfer actions pending HITL approval.
   * Financial transfers must be explicitly approved by a human operator.
   */
  {
    action_class: 'payment.transfer',
    effect: 'forbid',
    priority: 90,
    reason: 'Payment transfers require human-in-the-loop approval',
    tags: ['payment', 'hitl'],
  },

  /**
   * Forbid payment initiation pending HITL approval.
   */
  {
    action_class: 'payment.initiate',
    effect: 'forbid',
    priority: 90,
    reason: 'Payment initiation requires human-in-the-loop approval',
    tags: ['payment', 'hitl'],
  },

  /**
   * Forbid credential access pending HITL approval.
   * Reading credentials can expose secrets; require explicit human approval.
   */
  {
    action_class: 'credential.access',
    effect: 'forbid',
    priority: 90,
    reason: 'Credential access requires human-in-the-loop approval',
    tags: ['credential', 'hitl'],
  },

  /**
   * Forbid credential write operations pending HITL approval.
   */
  {
    action_class: 'credential.write',
    effect: 'forbid',
    priority: 90,
    reason: 'Credential write operations require human-in-the-loop approval',
    tags: ['credential', 'hitl'],
  },

  /**
   * Forbid any outbound action whose payload contains card data, pending HITL approval.
   * Applies to all channels in the `external_send` intent group (email, Slack, webhook).
   * Blocks execution until a human operator explicitly approves the action.
   */
  {
    intent_group: 'external_send',
    effect: 'forbid',
    priority: 90,
    reason: 'Action payload contains card data; human-in-the-loop approval required',
    tags: ['pii', 'card-data', 'hitl'],
    condition: (ctx) => {
      const payload = ctx.metadata?.payload;
      if (typeof payload !== 'string' || payload.length === 0) return false;
      const result = detectSensitiveData(payload);
      return result.categories.includes('credit_card');
    },
  },

  // ─── Priority 100: Unconditionally forbidden actions ────────────────────────

  /**
   * Unconditionally forbid system execution.
   * Direct shell/process execution bypasses all command-level policy.
   */
  {
    action_class: 'system.execute',
    effect: 'forbid',
    priority: 100,
    reason: 'System execution is unconditionally forbidden',
    tags: ['system', 'security'],
  },

  /**
   * Unconditionally forbid account permission changes.
   * Privilege escalation must never be performed autonomously.
   */
  {
    action_class: 'account.permission.change',
    effect: 'forbid',
    priority: 100,
    reason: 'Account permission changes are unconditionally forbidden',
    tags: ['account', 'security'],
  },

  /**
   * Unconditionally forbid any action classified as unknown and sensitive.
   * Fail-closed: unrecognised high-risk actions are blocked by default.
   */
  {
    action_class: 'unknown_sensitive_action',
    effect: 'forbid',
    priority: 100,
    reason: 'Unknown sensitive actions are unconditionally forbidden',
    tags: ['security'],
  },

];

export default DEFAULT_RULES;

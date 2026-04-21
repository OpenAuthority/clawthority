import type { Rule } from '../types.js';
import { detectSensitiveData } from '../../enforcement/pii-classifier.js';

/**
 * Baseline action-class policy rules for the Clawthority openclaw plugin.
 *
 * Rules are evaluated by Stage 2 using action_class semantics.  Priority
 * determines evaluation order — lower numbers are evaluated first.
 *
 * Priority tiers:
 *   10  — permitted baseline actions (unconditional permit)
 *   90  — sensitive actions requiring HITL approval ("HITL-gated forbid":
 *         the rule's `forbid` defers to the HITL policy in
 *         `hitl-policy.yaml`. If a policy matches the action class AND the
 *         operator approves, the tool call proceeds. If no HITL policy
 *         matches, or HITL is not configured, the forbid is upheld. See
 *         `beforeToolCallHandler` in `src/index.ts` for the routing logic.)
 *   100 — unconditionally forbidden actions (hard forbid, no HITL override)
 *
 * All `action_class` values must correspond to entries in the normalization
 * registry at `src/enforcement/normalize.ts`; a rule targeting a class the
 * normalizer never produces is dead code that silently never matches real
 * traffic.
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

  // ─── Priority 90: Sensitive actions requiring HITL approval ─────────────────

  /**
   * Forbid payment initiation pending HITL approval.
   * Financial transactions must be explicitly approved by a human operator.
   */
  {
    action_class: 'payment.initiate',
    effect: 'forbid',
    priority: 90,
    reason: 'Payment initiation requires human-in-the-loop approval',
    tags: ['payment', 'hitl'],
  },

  /**
   * Forbid credential reads pending HITL approval.
   * Reading credentials can expose secrets; require explicit human approval.
   */
  {
    action_class: 'credential.read',
    effect: 'forbid',
    priority: 90,
    reason: 'Credential reads require human-in-the-loop approval',
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
   * Forbid filesystem delete operations.
   * Destructive filesystem actions are high-risk and should require explicit
   * operator approval. Active in CLOSED mode; add a data/rules.json entry
   * with action_class: filesystem.delete to enforce this in OPEN mode too.
   */
  {
    action_class: 'filesystem.delete',
    effect: 'forbid',
    priority: 90,
    reason: 'Filesystem delete operations require human-in-the-loop approval',
    tags: ['filesystem', 'destructive', 'hitl'],
  },

  /**
   * Unconditionally forbid shell execution.
   * Direct shell invocation bypasses all command-level policy.
   */
  {
    action_class: 'shell.exec',
    effect: 'forbid',
    priority: 100,
    reason: 'Shell execution is unconditionally forbidden',
    tags: ['system', 'security'],
  },

  /**
   * Unconditionally forbid arbitrary code execution.
   * Running agent-generated code bypasses all parameter-level policy.
   */
  {
    action_class: 'code.execute',
    effect: 'forbid',
    priority: 100,
    reason: 'Arbitrary code execution is unconditionally forbidden',
    tags: ['system', 'security'],
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

/**
 * Action classes that remain forbidden even in `open` mode.
 *
 * These are the unconditional-forbid tier: shell/code execution bypass
 * parameter policy entirely, payment/credential operations are
 * cross-cutting high-risk.
 *
 * NOTE: `unknown_sensitive_action` is intentionally excluded from OPEN mode.
 * In OPEN mode, unrecognised tools fall through to the implicit permit —
 * that is the definition of OPEN mode. Including unknown_sensitive_action
 * here would block every OpenClaw tool not in the normalizer registry
 * (e.g. process, cron, sessions_*, message, image), breaking normal usage.
 * Use CLOSED mode if you want fail-closed behaviour for unknown tools.
 */
const CRITICAL_ACTION_CLASSES = new Set<string>([
  'shell.exec',
  'code.execute',
  'payment.initiate',
  'credential.read',
  'credential.write',
]);

/**
 * Rule subset loaded when the plugin runs in `open` mode.
 *
 * Derived from {@link DEFAULT_RULES} by filtering to the action classes
 * in {@link CRITICAL_ACTION_CLASSES}. Sharing the source literals keeps
 * open-mode enforcement behaviour identical to closed-mode for those
 * classes — same priority, same reason, same tags.
 */
export const OPEN_MODE_RULES: Rule[] = DEFAULT_RULES.filter(
  (r) => r.action_class !== undefined && CRITICAL_ACTION_CLASSES.has(r.action_class)
);

export default DEFAULT_RULES;

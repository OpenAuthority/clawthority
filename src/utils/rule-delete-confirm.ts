/**
 * Contextual confirmation dialog utilities for policy rule deletion.
 *
 * Assembles the full context needed to render a delete-confirmation dialog:
 *   - Formatted rule structure (via `formatRuleStructure`)
 *   - Recent audit hits for the rule, when available
 *   - A typed-confirmation challenge text derived from the rule
 *
 * Orchestrates the three companion utilities:
 *   - `rule-display.ts`           — rule structure rendering
 *   - `confirm-input-validator.ts` — typed confirmation validation
 *
 * This module is UI-agnostic: it produces plain data structures that any
 * rendering layer (web, terminal, approval message) can consume.
 */

import type { Rule } from '../policy/types.js';
import { formatRuleStructure } from './rule-display.js';
import type { RuleDisplayResult } from './rule-display.js';
import { validateConfirmationInput } from './confirm-input-validator.js';

// ─── Audit hit ────────────────────────────────────────────────────────────────

/**
 * A single record of the rule being triggered in the audit log.
 *
 * Audit hits are surfaced in the confirmation dialog so the user can assess
 * the impact of deleting the rule (e.g. "This rule blocked 12 requests in the
 * last 7 days").
 */
export interface AuditHit {
  /**
   * ISO 8601 timestamp of when the rule was matched.
   * Example: `"2024-03-15T14:23:01Z"`
   */
  timestamp: string;
  /**
   * The action or tool call that matched this rule.
   * Example: `"filesystem.delete"`, `"rm_rf"`
   */
  action: string;
  /** The effect the rule applied: `'permit'` or `'forbid'`. */
  effect: 'permit' | 'forbid';
  /** Optional agent ID that triggered the match. */
  agentId?: string;
}

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * All contextual data needed to render and drive a rule-deletion dialog.
 *
 * Build this once per delete attempt with `buildDeleteConfirmContext` and pass
 * it to `processDeleteConfirm` on each input change event.
 */
export interface DeleteConfirmContext {
  /** Structured display of the rule being deleted. */
  ruleDisplay: RuleDisplayResult;
  /**
   * Recent audit hits for this rule, sorted newest-first.
   * Empty array when no audit data was supplied.
   */
  auditHits: AuditHit[];
  /**
   * `true` when `auditHits` is non-empty.
   * Callers use this flag to conditionally render the audit-hits section.
   */
  hasAuditHits: boolean;
  /**
   * The exact text the user must type to unlock the delete button.
   *
   * Derived deterministically from the rule's primary selector:
   *   - action_class rule → `"{effect}:{action_class}"` e.g. `"forbid:filesystem.delete"`
   *   - intent_group rule → `"{effect}:{intent_group}"` e.g. `"forbid:destructive_fs"`
   *   - resource rule     → `"{effect}:{resource}"` or `"{effect}:{resource}:{match}"`
   *   - unconditional     → `"{effect}:unconditional"`
   */
  confirmationText: string;
  /**
   * Human-readable prompt shown above the confirmation input field.
   * Example: `'Type "forbid:filesystem.delete" to confirm deletion.'`
   */
  prompt: string;
}

// ─── Outcome ──────────────────────────────────────────────────────────────────

/**
 * Result of a single confirmation evaluation.
 *
 * - `'proceed'` — Typed value matched; deletion may proceed.
 * - `'pending'` — Typed value is empty or mismatched; delete is blocked.
 * - `'cancel'`  — User cancelled; deletion must not proceed.
 */
export type DeleteConfirmOutcome = 'proceed' | 'cancel' | 'pending';

/**
 * Returned by `processDeleteConfirm` and `cancelDeleteConfirm`.
 */
export interface DeleteConfirmResult {
  /** Whether to proceed with deletion, keep waiting, or cancel. */
  outcome: DeleteConfirmOutcome;
  /**
   * Error message to display below the confirmation input.
   * `null` when `outcome` is `'proceed'` or `'cancel'`, or when the field
   * is still empty (`'pending'` with no input yet).
   */
  message: string | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function deriveConfirmationText(rule: Rule): string {
  const e = rule.effect;

  if (rule.action_class !== undefined) {
    return `${e}:${rule.action_class}`;
  }

  if (rule.intent_group !== undefined) {
    return `${e}:${rule.intent_group}`;
  }

  if (rule.resource !== undefined) {
    if (rule.match !== undefined) {
      const matchStr = rule.match instanceof RegExp ? rule.match.toString() : rule.match;
      return `${e}:${rule.resource}:${matchStr}`;
    }
    return `${e}:${rule.resource}`;
  }

  return `${e}:unconditional`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Assembles the full context for a rule-deletion confirmation dialog.
 *
 * Call once when the user initiates a delete action; store the returned
 * context and pass it to `processDeleteConfirm` on each input change.
 *
 * @param rule       The policy rule the user wants to delete.
 * @param auditHits  Optional recent audit hits for the rule (newest-first).
 *                   When omitted, `hasAuditHits` is `false` and `auditHits`
 *                   is an empty array.
 * @returns          A `DeleteConfirmContext` ready to drive the dialog UI.
 *
 * @example
 * const ctx = buildDeleteConfirmContext(rule, recentHits);
 * // Render ctx.ruleDisplay.text, ctx.auditHits, ctx.prompt in the dialog.
 * // On each keystroke: const result = processDeleteConfirm(ctx, inputValue);
 */
export function buildDeleteConfirmContext(
  rule: Rule,
  auditHits?: AuditHit[],
): DeleteConfirmContext {
  const ruleDisplay = formatRuleStructure(rule);
  const hits = auditHits ?? [];
  const confirmationText = deriveConfirmationText(rule);

  return {
    ruleDisplay,
    auditHits: hits,
    hasAuditHits: hits.length > 0,
    confirmationText,
    prompt: `Type "${confirmationText}" to confirm deletion.`,
  };
}

/**
 * Evaluates the user's typed confirmation value against the required text.
 *
 * Call this on every input change event. Use the returned `outcome` to
 * enable or disable the delete button, and `message` for field-level
 * validation feedback.
 *
 * The delete button should be enabled only when `outcome === 'proceed'`.
 *
 * @param context     The context returned by `buildDeleteConfirmContext`.
 * @param typedValue  The current value in the confirmation input field.
 * @returns           A `DeleteConfirmResult` with the outcome and optional error.
 *
 * @example
 * const result = processDeleteConfirm(ctx, inputValue);
 * setDeleteEnabled(result.outcome === 'proceed');
 * setFieldError(result.message);
 */
export function processDeleteConfirm(
  context: DeleteConfirmContext,
  typedValue: string,
): DeleteConfirmResult {
  const validation = validateConfirmationInput(typedValue, context.confirmationText);

  if (validation.confirmed) {
    return { outcome: 'proceed', message: null };
  }

  return { outcome: 'pending', message: validation.message };
}

/**
 * Returns a cancel result when the user dismisses the dialog.
 *
 * Deletion must not proceed when this is returned. No confirmation text
 * is required — the user simply chose to cancel.
 *
 * @returns `DeleteConfirmResult` with `outcome: 'cancel'` and `message: null`.
 *
 * @example
 * // When the user clicks Cancel or presses Escape:
 * const result = cancelDeleteConfirm();
 * // result.outcome === 'cancel' — do not delete the rule.
 */
export function cancelDeleteConfirm(): DeleteConfirmResult {
  return { outcome: 'cancel', message: null };
}

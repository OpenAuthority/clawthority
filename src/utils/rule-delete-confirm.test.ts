/**
 * rule-delete-confirm — test suite
 *
 * Covers all public functions in rule-delete-confirm.ts:
 *   buildDeleteConfirmContext  — assembles dialog context from a rule + audit hits
 *   processDeleteConfirm       — evaluates typed confirmation against required text
 *   cancelDeleteConfirm        — returns a cancel result without deletion
 */
import { describe, it, expect } from 'vitest';
import {
  buildDeleteConfirmContext,
  processDeleteConfirm,
  cancelDeleteConfirm,
} from './rule-delete-confirm.js';
import type {
  AuditHit,
  DeleteConfirmContext,
  DeleteConfirmResult,
} from './rule-delete-confirm.js';
import type { Rule } from '../policy/types.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const actionClassRule: Rule = {
  effect: 'forbid',
  action_class: 'filesystem.delete',
  reason: 'Block all deletes',
  tags: ['filesystem', 'security'],
};

const intentGroupRule: Rule = {
  effect: 'forbid',
  intent_group: 'destructive_fs',
  reason: 'Destructive filesystem operations are unconditionally forbidden',
};

const resourceMatchRule: Rule = {
  effect: 'permit',
  resource: 'file',
  match: '/tmp/*',
};

const resourceNoMatchRule: Rule = {
  effect: 'forbid',
  resource: 'credential',
};

const unconditionalRule: Rule = {
  effect: 'forbid',
};

const sampleHits: AuditHit[] = [
  { timestamp: '2024-03-15T14:23:01Z', action: 'rm_rf', effect: 'forbid', agentId: 'agent-1' },
  { timestamp: '2024-03-15T09:10:00Z', action: 'delete', effect: 'forbid' },
];

// ─── buildDeleteConfirmContext ─────────────────────────────────────────────────

describe('buildDeleteConfirmContext', () => {
  // ── ruleDisplay ──────────────────────────────────────────────────────────────

  it('includes formatted ruleDisplay from formatRuleStructure', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule);
    expect(ctx.ruleDisplay).toBeDefined();
    expect(ctx.ruleDisplay.fields.length).toBeGreaterThan(0);
  });

  it('ruleDisplay contains the Effect field', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule);
    const effectField = ctx.ruleDisplay.fields.find((f) => f.label === 'Effect');
    expect(effectField?.value).toBe('forbid');
  });

  it('ruleDisplay.text is a non-empty string', () => {
    const ctx = buildDeleteConfirmContext(resourceMatchRule);
    expect(typeof ctx.ruleDisplay.text).toBe('string');
    expect(ctx.ruleDisplay.text.length).toBeGreaterThan(0);
  });

  it('ruleDisplay.ariaDescription is a non-empty string', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule);
    expect(ctx.ruleDisplay.ariaDescription.length).toBeGreaterThan(0);
  });

  it('ruleDisplay reflects action_class field for action-class rules', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule);
    const field = ctx.ruleDisplay.fields.find((f) => f.label === 'Action class');
    expect(field?.value).toBe('filesystem.delete');
  });

  it('ruleDisplay reflects intent_group field for intent-group rules', () => {
    const ctx = buildDeleteConfirmContext(intentGroupRule);
    const field = ctx.ruleDisplay.fields.find((f) => f.label === 'Intent group');
    expect(field?.value).toBe('destructive_fs');
  });

  it('ruleDisplay reflects resource and match for resource rules', () => {
    const ctx = buildDeleteConfirmContext(resourceMatchRule);
    const resourceField = ctx.ruleDisplay.fields.find((f) => f.label === 'Resource');
    const matchField = ctx.ruleDisplay.fields.find((f) => f.label === 'Match');
    expect(resourceField?.value).toBe('file');
    expect(matchField?.value).toBe('/tmp/*');
  });

  // ── auditHits ────────────────────────────────────────────────────────────────

  it('auditHits defaults to empty array when omitted', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule);
    expect(ctx.auditHits).toEqual([]);
  });

  it('auditHits contains provided hits', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule, sampleHits);
    expect(ctx.auditHits).toHaveLength(2);
    expect(ctx.auditHits[0]?.action).toBe('rm_rf');
    expect(ctx.auditHits[1]?.action).toBe('delete');
  });

  it('auditHits preserves all hit fields', () => {
    const hit: AuditHit = {
      timestamp: '2024-01-01T00:00:00Z',
      action: 'filesystem.delete',
      effect: 'forbid',
      agentId: 'agent-42',
    };
    const ctx = buildDeleteConfirmContext(actionClassRule, [hit]);
    expect(ctx.auditHits[0]).toEqual(hit);
  });

  it('auditHits works with an explicitly passed empty array', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule, []);
    expect(ctx.auditHits).toEqual([]);
  });

  // ── hasAuditHits ─────────────────────────────────────────────────────────────

  it('hasAuditHits is false when no audit hits are provided', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule);
    expect(ctx.hasAuditHits).toBe(false);
  });

  it('hasAuditHits is false when empty array is provided', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule, []);
    expect(ctx.hasAuditHits).toBe(false);
  });

  it('hasAuditHits is true when audit hits are provided', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule, sampleHits);
    expect(ctx.hasAuditHits).toBe(true);
  });

  it('hasAuditHits is true for a single audit hit', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule, [sampleHits[0]!]);
    expect(ctx.hasAuditHits).toBe(true);
  });

  // ── confirmationText derivation ───────────────────────────────────────────────

  it('derives confirmationText as "forbid:filesystem.delete" for action_class rule', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule);
    expect(ctx.confirmationText).toBe('forbid:filesystem.delete');
  });

  it('derives confirmationText as "forbid:destructive_fs" for intent_group rule', () => {
    const ctx = buildDeleteConfirmContext(intentGroupRule);
    expect(ctx.confirmationText).toBe('forbid:destructive_fs');
  });

  it('derives confirmationText as "permit:file:/tmp/*" for resource+match rule', () => {
    const ctx = buildDeleteConfirmContext(resourceMatchRule);
    expect(ctx.confirmationText).toBe('permit:file:/tmp/*');
  });

  it('derives confirmationText as "forbid:credential" for resource-only rule (no match)', () => {
    const ctx = buildDeleteConfirmContext(resourceNoMatchRule);
    expect(ctx.confirmationText).toBe('forbid:credential');
  });

  it('derives confirmationText as "forbid:unconditional" for unconditional rule', () => {
    const ctx = buildDeleteConfirmContext(unconditionalRule);
    expect(ctx.confirmationText).toBe('forbid:unconditional');
  });

  it('derives confirmationText using rule effect correctly for permit rule', () => {
    const permitRule: Rule = { effect: 'permit', action_class: 'filesystem.read' };
    const ctx = buildDeleteConfirmContext(permitRule);
    expect(ctx.confirmationText).toBe('permit:filesystem.read');
  });

  it('includes RegExp match in confirmationText when match is a RegExp', () => {
    const regexpRule: Rule = { effect: 'forbid', resource: 'file', match: /^\/etc\/.*/ };
    const ctx = buildDeleteConfirmContext(regexpRule);
    // RegExp.toString() produces "/^\/etc\/.*/" — just verify structure
    expect(ctx.confirmationText).toMatch(/^forbid:file:/);
    expect(ctx.confirmationText).toContain('/^');
  });

  // ── prompt ────────────────────────────────────────────────────────────────────

  it('prompt contains the confirmation text', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule);
    expect(ctx.prompt).toContain(ctx.confirmationText);
  });

  it('prompt instructs the user to type the confirmation text', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule);
    expect(ctx.prompt).toContain('Type');
    expect(ctx.prompt).toContain('confirm deletion');
  });

  it('prompt wraps confirmationText in quotes', () => {
    const ctx = buildDeleteConfirmContext(intentGroupRule);
    expect(ctx.prompt).toContain(`"${ctx.confirmationText}"`);
  });
});

// ─── processDeleteConfirm ─────────────────────────────────────────────────────

describe('processDeleteConfirm', () => {
  let ctx: DeleteConfirmContext;

  // Build a fresh context before each group
  ctx = buildDeleteConfirmContext(actionClassRule, sampleHits);

  // ── proceed ───────────────────────────────────────────────────────────────────

  it('returns outcome "proceed" when typed value exactly matches confirmationText', () => {
    const result = processDeleteConfirm(ctx, ctx.confirmationText);
    expect(result.outcome).toBe('proceed');
  });

  it('returns null message when outcome is "proceed"', () => {
    const result = processDeleteConfirm(ctx, ctx.confirmationText);
    expect(result.message).toBeNull();
  });

  it('proceed works for intent_group rule confirmation text', () => {
    const igCtx = buildDeleteConfirmContext(intentGroupRule);
    const result = processDeleteConfirm(igCtx, 'forbid:destructive_fs');
    expect(result.outcome).toBe('proceed');
  });

  it('proceed works for resource+match rule confirmation text', () => {
    const rmCtx = buildDeleteConfirmContext(resourceMatchRule);
    const result = processDeleteConfirm(rmCtx, 'permit:file:/tmp/*');
    expect(result.outcome).toBe('proceed');
  });

  it('proceed works for unconditional rule', () => {
    const uCtx = buildDeleteConfirmContext(unconditionalRule);
    const result = processDeleteConfirm(uCtx, 'forbid:unconditional');
    expect(result.outcome).toBe('proceed');
  });

  // ── pending — empty input ─────────────────────────────────────────────────────

  it('returns outcome "pending" when typed value is empty', () => {
    const result = processDeleteConfirm(ctx, '');
    expect(result.outcome).toBe('pending');
  });

  it('returns null message when typed value is empty (no error yet)', () => {
    const result = processDeleteConfirm(ctx, '');
    expect(result.message).toBeNull();
  });

  // ── pending — mismatch ────────────────────────────────────────────────────────

  it('returns outcome "pending" when typed value does not match', () => {
    const result = processDeleteConfirm(ctx, 'wrong-text');
    expect(result.outcome).toBe('pending');
  });

  it('returns a non-null message when typed value is a mismatch', () => {
    const result = processDeleteConfirm(ctx, 'wrong-text');
    expect(result.message).not.toBeNull();
    expect(result.message!.length).toBeGreaterThan(0);
  });

  it('mismatch message contains the required confirmation text', () => {
    const result = processDeleteConfirm(ctx, 'wrong');
    expect(result.message).toContain(ctx.confirmationText);
  });

  it('returns "pending" for case-insensitive near-miss (case-sensitive match required)', () => {
    const igCtx = buildDeleteConfirmContext(intentGroupRule);
    const result = processDeleteConfirm(igCtx, 'FORBID:DESTRUCTIVE_FS');
    expect(result.outcome).toBe('pending');
  });

  it('returns "pending" for prefix of confirmation text', () => {
    const result = processDeleteConfirm(ctx, 'forbid:filesystem');
    expect(result.outcome).toBe('pending');
  });

  it('returns "pending" for confirmation text with extra whitespace', () => {
    const result = processDeleteConfirm(ctx, `${ctx.confirmationText} `);
    expect(result.outcome).toBe('pending');
  });

  // ── delete is blocked until confirmed ────────────────────────────────────────

  it('delete must not proceed when outcome is "pending"', () => {
    const emptyResult = processDeleteConfirm(ctx, '');
    const mismatchResult = processDeleteConfirm(ctx, 'almost-right');
    expect(emptyResult.outcome).not.toBe('proceed');
    expect(mismatchResult.outcome).not.toBe('proceed');
  });
});

// ─── cancelDeleteConfirm ──────────────────────────────────────────────────────

describe('cancelDeleteConfirm', () => {
  it('returns outcome "cancel"', () => {
    const result = cancelDeleteConfirm();
    expect(result.outcome).toBe('cancel');
  });

  it('returns null message', () => {
    const result = cancelDeleteConfirm();
    expect(result.message).toBeNull();
  });

  it('outcome is not "proceed" (deletion must not happen on cancel)', () => {
    const result = cancelDeleteConfirm();
    expect(result.outcome).not.toBe('proceed');
  });

  it('outcome is not "pending"', () => {
    const result = cancelDeleteConfirm();
    expect(result.outcome).not.toBe('pending');
  });

  it('cancel result satisfies DeleteConfirmResult shape', () => {
    const result: DeleteConfirmResult = cancelDeleteConfirm();
    expect(typeof result.outcome).toBe('string');
    expect(result.message).toBeNull();
  });

  it('can be called without any context (no arguments)', () => {
    expect(() => cancelDeleteConfirm()).not.toThrow();
  });
});

// ─── Integration: full dialog flow ────────────────────────────────────────────

describe('full dialog flow', () => {
  it('builds context, processes empty input, processes mismatch, then proceeds on match', () => {
    const ctx = buildDeleteConfirmContext(actionClassRule, sampleHits);

    // Initial state: field empty
    const emptyResult = processDeleteConfirm(ctx, '');
    expect(emptyResult.outcome).toBe('pending');
    expect(emptyResult.message).toBeNull();

    // User starts typing — mismatch
    const midResult = processDeleteConfirm(ctx, 'forbid:filesystem');
    expect(midResult.outcome).toBe('pending');
    expect(midResult.message).not.toBeNull();

    // User completes the text — proceed
    const finalResult = processDeleteConfirm(ctx, ctx.confirmationText);
    expect(finalResult.outcome).toBe('proceed');
    expect(finalResult.message).toBeNull();
  });

  it('cancel at any point returns "cancel" and message is null', () => {
    buildDeleteConfirmContext(actionClassRule);
    const result = cancelDeleteConfirm();
    expect(result.outcome).toBe('cancel');
    expect(result.message).toBeNull();
  });

  it('dialog with audit hits: hasAuditHits is true and auditHits accessible', () => {
    const ctx = buildDeleteConfirmContext(intentGroupRule, sampleHits);
    expect(ctx.hasAuditHits).toBe(true);
    expect(ctx.auditHits).toHaveLength(2);
    // Confirm deletion still works normally
    const result = processDeleteConfirm(ctx, ctx.confirmationText);
    expect(result.outcome).toBe('proceed');
  });

  it('dialog without audit hits: hasAuditHits is false and auditHits is empty', () => {
    const ctx = buildDeleteConfirmContext(unconditionalRule);
    expect(ctx.hasAuditHits).toBe(false);
    expect(ctx.auditHits).toHaveLength(0);
    // Confirm deletion still works normally
    const result = processDeleteConfirm(ctx, 'forbid:unconditional');
    expect(result.outcome).toBe('proceed');
  });
});

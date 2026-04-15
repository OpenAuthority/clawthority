/**
 * validateCommitMessage — test suite
 *
 * Covers all validation paths in commit-validator.ts:
 *   validateCommitMessage — validates commit message structure and content
 */
import { describe, it, expect } from 'vitest';
import { validateCommitMessage } from './commit-validator.js';
import type { CommitValidationResult } from './commit-validator.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function valid(result: CommitValidationResult): boolean {
  return result.valid;
}

function errorFields(result: CommitValidationResult): string[] {
  return result.errors.map((e) => e.field);
}

function errorMessages(result: CommitValidationResult): string[] {
  return result.errors.map((e) => e.message);
}

// ─── validateCommitMessage ────────────────────────────────────────────────────

describe('validateCommitMessage', () => {
  // ── empty and whitespace ─────────────────────────────────────────────────

  it('returns invalid for an empty string', () => {
    const result = validateCommitMessage('');
    expect(valid(result)).toBe(false);
    expect(errorFields(result)).toContain('format');
  });

  it('returns invalid for a whitespace-only string', () => {
    const result = validateCommitMessage('   ');
    expect(valid(result)).toBe(false);
    expect(errorFields(result)).toContain('format');
  });

  it('includes a non-empty error message for empty input', () => {
    const result = validateCommitMessage('');
    expect(result.errors[0]?.message.length).toBeGreaterThan(0);
  });

  // ── format validation ────────────────────────────────────────────────────

  it('returns invalid when the message has no colon separator', () => {
    const result = validateCommitMessage('feat add new feature');
    expect(valid(result)).toBe(false);
    expect(errorFields(result)).toContain('format');
  });

  it('returns invalid when the separator is missing a space after colon', () => {
    const result = validateCommitMessage('feat:add new feature');
    expect(valid(result)).toBe(false);
    expect(errorFields(result)).toContain('format');
  });

  it('returns invalid for a bare colon with no type', () => {
    const result = validateCommitMessage(': add something');
    expect(valid(result)).toBe(false);
    expect(errorFields(result)).toContain('format');
  });

  it('includes a descriptive format error message', () => {
    const result = validateCommitMessage('bad message');
    const msg = result.errors[0]?.message ?? '';
    expect(msg).toMatch(/format/i);
  });

  // ── type validation ──────────────────────────────────────────────────────

  it('accepts all valid commit types without a type error', () => {
    const types = ['feat', 'fix', 'test', 'chore', 'docs', 'refactor', 'perf'] as const;
    for (const t of types) {
      const result = validateCommitMessage(`${t}: do something`);
      expect(errorFields(result)).not.toContain('type');
    }
  });

  it('returns a type error for an unknown type', () => {
    const result = validateCommitMessage('wip: some work');
    expect(valid(result)).toBe(false);
    expect(errorFields(result)).toContain('type');
  });

  it('includes the unknown type name in the error message', () => {
    const result = validateCommitMessage('wip: some work');
    const msg = errorMessages(result).find((m) => m.includes('wip')) ?? '';
    expect(msg.length).toBeGreaterThan(0);
  });

  it('lists valid types in the type error message', () => {
    const result = validateCommitMessage('style: reformat');
    const msg = errorMessages(result).find((m) => m.includes('feat')) ?? '';
    expect(msg.length).toBeGreaterThan(0);
  });

  it('returns invalid for uppercase type', () => {
    const result = validateCommitMessage('Feat: add something');
    expect(valid(result)).toBe(false);
  });

  // ── scope validation ─────────────────────────────────────────────────────

  it('returns valid when a non-empty scope is provided', () => {
    const result = validateCommitMessage('feat(utils): add helper');
    expect(valid(result)).toBe(true);
    expect(result.parts?.scope).toBe('utils');
  });

  it('returns valid when scope is omitted entirely', () => {
    const result = validateCommitMessage('feat: add helper');
    expect(valid(result)).toBe(true);
    expect(result.parts?.scope).toBeUndefined();
  });

  it('returns a scope error when parentheses are present but empty', () => {
    const result = validateCommitMessage('feat(): add helper');
    expect(valid(result)).toBe(false);
    expect(errorFields(result)).toContain('scope');
  });

  it('returns a scope error when scope contains only whitespace', () => {
    const result = validateCommitMessage('feat(  ): add helper');
    expect(valid(result)).toBe(false);
    expect(errorFields(result)).toContain('scope');
  });

  it('includes a descriptive scope error message', () => {
    const result = validateCommitMessage('feat(): something');
    const msg = result.errors.find((e) => e.field === 'scope')?.message ?? '';
    expect(msg).toMatch(/scope/i);
  });

  // ── subject validation ───────────────────────────────────────────────────

  it('returns a subject error when subject is empty after separator', () => {
    // The format regex requires at least one character after ": ", so this
    // should fail at format level — but if it somehow matched, subject check fires.
    const result = validateCommitMessage('feat:  ');
    expect(valid(result)).toBe(false);
  });

  it('accepts a multi-word subject', () => {
    const result = validateCommitMessage('feat(policy): add cedar action_class matching');
    expect(valid(result)).toBe(true);
    expect(result.parts?.subject).toBe('add cedar action_class matching');
  });

  // ── parts extraction ─────────────────────────────────────────────────────

  it('populates parts.type on success', () => {
    const result = validateCommitMessage('fix(auth): correct token expiry');
    expect(result.parts?.type).toBe('fix');
  });

  it('populates parts.scope on success when scope is provided', () => {
    const result = validateCommitMessage('refactor(hitl): simplify approval flow');
    expect(result.parts?.scope).toBe('hitl');
  });

  it('leaves parts.scope undefined when scope is omitted', () => {
    const result = validateCommitMessage('chore: update deps');
    expect(result.parts?.scope).toBeUndefined();
  });

  it('populates parts.subject on success', () => {
    const result = validateCommitMessage('docs: update contributing guide');
    expect(result.parts?.subject).toBe('update contributing guide');
  });

  it('does not populate parts when validation fails', () => {
    const result = validateCommitMessage('bad message');
    expect(result.parts).toBeUndefined();
  });

  // ── errors array contract ────────────────────────────────────────────────

  it('returns an empty errors array on success', () => {
    const result = validateCommitMessage('feat(utils): add commit validator');
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid: false when errors is non-empty', () => {
    const result = validateCommitMessage('unknown: something');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // ── multi-line messages ───────────────────────────────────────────────────

  it('validates only the first line of a multi-line message', () => {
    const message = 'feat(utils): add commit validator\n\nLonger body explaining the change.';
    const result = validateCommitMessage(message);
    expect(valid(result)).toBe(true);
    expect(result.parts?.subject).toBe('add commit validator');
  });

  it('returns invalid when the first line of a multi-line message is malformed', () => {
    const message = 'bad first line\n\nfeat(utils): valid second line';
    const result = validateCommitMessage(message);
    expect(valid(result)).toBe(false);
  });

  // ── real-world examples from the repository ──────────────────────────────

  it('accepts "feat(utils): add generateDeltaSummary report generator"', () => {
    const result = validateCommitMessage('feat(utils): add generateDeltaSummary report generator');
    expect(valid(result)).toBe(true);
  });

  it('accepts "fix(policy): correct cedar forbid-wins evaluation order"', () => {
    const result = validateCommitMessage(
      'fix(policy): correct cedar forbid-wins evaluation order',
    );
    expect(valid(result)).toBe(true);
  });

  it('accepts "chore(ci): add coverage to .gitignore"', () => {
    const result = validateCommitMessage('chore(ci): add coverage to .gitignore');
    expect(valid(result)).toBe(true);
  });

  it('accepts "perf: reduce wasm bundle load time"', () => {
    const result = validateCommitMessage('perf: reduce wasm bundle load time');
    expect(valid(result)).toBe(true);
  });
});

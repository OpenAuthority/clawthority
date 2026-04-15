/**
 * validateConfirmationInput — test suite
 *
 * Covers all validation paths in confirm-input-validator.ts:
 *   validateConfirmationInput — validates typed confirmation against expected text
 */
import { describe, it, expect } from 'vitest';
import { validateConfirmationInput } from './confirm-input-validator.js';
import type { ConfirmInputResult } from './confirm-input-validator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function confirmed(result: ConfirmInputResult): boolean {
  return result.confirmed;
}

function status(result: ConfirmInputResult): string {
  return result.status;
}

// ─── validateConfirmationInput ────────────────────────────────────────────────

describe('validateConfirmationInput', () => {
  // ── empty input ───────────────────────────────────────────────────────────

  it('returns confirmed: false for empty typed value', () => {
    const result = validateConfirmationInput('', 'my-rule');
    expect(confirmed(result)).toBe(false);
  });

  it('returns status "empty" for empty typed value', () => {
    const result = validateConfirmationInput('', 'my-rule');
    expect(status(result)).toBe('empty');
  });

  it('returns null message for empty typed value', () => {
    const result = validateConfirmationInput('', 'my-rule');
    expect(result.message).toBeNull();
  });

  // ── exact match ───────────────────────────────────────────────────────────

  it('returns confirmed: true when typed value exactly matches expected text', () => {
    const result = validateConfirmationInput('my-rule', 'my-rule');
    expect(confirmed(result)).toBe(true);
  });

  it('returns status "match" when typed value exactly matches', () => {
    const result = validateConfirmationInput('my-rule', 'my-rule');
    expect(status(result)).toBe('match');
  });

  it('returns null message when typed value matches', () => {
    const result = validateConfirmationInput('my-rule', 'my-rule');
    expect(result.message).toBeNull();
  });

  // ── mismatch ──────────────────────────────────────────────────────────────

  it('returns confirmed: false when typed value does not match', () => {
    const result = validateConfirmationInput('wrong-rule', 'my-rule');
    expect(confirmed(result)).toBe(false);
  });

  it('returns status "mismatch" when typed value does not match', () => {
    const result = validateConfirmationInput('wrong-rule', 'my-rule');
    expect(status(result)).toBe('mismatch');
  });

  it('returns a non-null error message for mismatch', () => {
    const result = validateConfirmationInput('wrong-rule', 'my-rule');
    expect(result.message).not.toBeNull();
    expect(result.message!.length).toBeGreaterThan(0);
  });

  it('includes the expected text in the mismatch error message', () => {
    const result = validateConfirmationInput('wrong', 'my-rule');
    expect(result.message).toContain('my-rule');
  });

  // ── case sensitivity ──────────────────────────────────────────────────────

  it('returns mismatch for uppercase variant of expected text', () => {
    const result = validateConfirmationInput('MY-RULE', 'my-rule');
    expect(confirmed(result)).toBe(false);
    expect(status(result)).toBe('mismatch');
  });

  it('returns mismatch for title-case variant', () => {
    const result = validateConfirmationInput('My-Rule', 'my-rule');
    expect(confirmed(result)).toBe(false);
    expect(status(result)).toBe('mismatch');
  });

  it('returns match for exact same case', () => {
    const result = validateConfirmationInput('Block-PII-Reads', 'Block-PII-Reads');
    expect(confirmed(result)).toBe(true);
  });

  it('returns mismatch when expected text is uppercase and typed is lowercase', () => {
    const result = validateConfirmationInput('block-pii-reads', 'Block-PII-Reads');
    expect(confirmed(result)).toBe(false);
  });

  // ── partial match ─────────────────────────────────────────────────────────

  it('returns mismatch for a prefix of the expected text', () => {
    const result = validateConfirmationInput('my-', 'my-rule');
    expect(confirmed(result)).toBe(false);
    expect(status(result)).toBe('mismatch');
  });

  it('returns mismatch for a suffix of the expected text', () => {
    const result = validateConfirmationInput('rule', 'my-rule');
    expect(confirmed(result)).toBe(false);
  });

  it('returns mismatch when expected text has trailing content not typed', () => {
    const result = validateConfirmationInput('my-rule', 'my-rule-extra');
    expect(confirmed(result)).toBe(false);
  });

  it('returns mismatch when typed value has extra trailing whitespace', () => {
    const result = validateConfirmationInput('my-rule ', 'my-rule');
    expect(confirmed(result)).toBe(false);
  });

  it('returns mismatch when typed value has leading whitespace', () => {
    const result = validateConfirmationInput(' my-rule', 'my-rule');
    expect(confirmed(result)).toBe(false);
  });

  // ── real-world rule name examples ─────────────────────────────────────────

  it('confirms "block-filesystem-writes" when typed exactly', () => {
    const result = validateConfirmationInput(
      'block-filesystem-writes',
      'block-filesystem-writes',
    );
    expect(confirmed(result)).toBe(true);
  });

  it('confirms "permit:read:s3:logs" when typed exactly', () => {
    const result = validateConfirmationInput('permit:read:s3:logs', 'permit:read:s3:logs');
    expect(confirmed(result)).toBe(true);
  });

  it('returns mismatch for a close-but-wrong rule name', () => {
    const result = validateConfirmationInput(
      'block-filesystem-read',
      'block-filesystem-writes',
    );
    expect(confirmed(result)).toBe(false);
    expect(result.message).toContain('block-filesystem-writes');
  });

  // ── expectedText edge cases ───────────────────────────────────────────────

  it('handles expectedText with special regex characters correctly', () => {
    const expected = 'rule.name+special(chars)';
    const result = validateConfirmationInput(expected, expected);
    expect(confirmed(result)).toBe(true);
  });

  it('returns mismatch when expected text contains spaces and typed does not', () => {
    const result = validateConfirmationInput('my rule', 'my rule name');
    expect(confirmed(result)).toBe(false);
  });
});

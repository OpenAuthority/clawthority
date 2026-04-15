/**
 * Typed confirmation input validation utility.
 *
 * Provides `validateConfirmationInput` — a pure function that checks whether
 * a user's typed value exactly matches the required confirmation text before
 * a destructive action (e.g. deleting a rule) is permitted.
 *
 * Implements real-time, case-sensitive string comparison intended for use with
 * controlled input components. The delete button should be enabled only when
 * `confirmed` is `true`.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The status of the confirmation input at the current moment.
 *
 * - `'empty'`    — The user has not typed anything yet; no error shown.
 * - `'mismatch'` — The typed value is non-empty but does not match; show error.
 * - `'match'`    — The typed value exactly matches; the action may proceed.
 */
export type ConfirmInputStatus = 'empty' | 'mismatch' | 'match';

/**
 * Result returned by `validateConfirmationInput` for each keystroke.
 */
export interface ConfirmInputResult {
  /**
   * Whether the user's input exactly matches the required confirmation text.
   * The delete (or other destructive action) button must be enabled only when
   * this is `true`.
   */
  confirmed: boolean;
  /** The classification of the current input state. */
  status: ConfirmInputStatus;
  /**
   * Human-readable message to display beneath the input field.
   * `null` when `status` is `'empty'` or `'match'` — callers should show
   * no error in those cases.
   */
  message: string | null;
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Validates a typed confirmation value against the required confirmation text.
 *
 * Comparison is case-sensitive and requires an exact full-string match.
 * The result is designed for real-time use: call this function on every
 * input change event and reflect `confirmed` in the disabled state of the
 * delete button.
 *
 * @param typedValue   The current value in the confirmation input field.
 * @param expectedText The exact text the user must type to confirm (e.g. rule name).
 * @returns            A `ConfirmInputResult` describing validity and display state.
 *
 * @example
 * // In a controlled input handler:
 * const result = validateConfirmationInput(inputValue, ruleName);
 * setDeleteEnabled(result.confirmed);
 * setErrorMessage(result.message);
 */
export function validateConfirmationInput(
  typedValue: string,
  expectedText: string,
): ConfirmInputResult {
  // ── Empty input: no error, button disabled ────────────────────────────────

  if (typedValue === '') {
    return { confirmed: false, status: 'empty', message: null };
  }

  // ── Exact match (case-sensitive): button enabled ──────────────────────────

  if (typedValue === expectedText) {
    return { confirmed: true, status: 'match', message: null };
  }

  // ── Non-empty mismatch: show error, button disabled ───────────────────────

  return {
    confirmed: false,
    status: 'mismatch',
    message: `Text does not match. Type "${expectedText}" exactly to confirm.`,
  };
}

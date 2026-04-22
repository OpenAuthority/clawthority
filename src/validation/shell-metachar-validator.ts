/**
 * Shell metacharacter validator.
 *
 * Implements Universal Rule 3 from the normalize_action reclassification
 * pipeline (D-06): any typed (string) parameter value containing a shell
 * metacharacter causes the effective risk level to be raised to `critical`.
 *
 * The validator is tool-type-agnostic — it scans all top-level string values
 * in the params record regardless of action class, matching the behaviour of
 * `hasShellMetacharsInParams` in normalize.ts.
 *
 * @see T89
 */

import type { RiskLevel } from '@openclaw/action-registry';

export type { RiskLevel };

// ─── Default metacharacter pattern ────────────────────────────────────────────

/**
 * Default shell metacharacter regex.
 *
 * Mirrors the `SHELL_METACHAR_RE` constant used by normalize.ts (Universal Rule 3).
 *
 * Matches: ; | & > < ` $ ( ) { } [ ] \
 */
export const DEFAULT_SHELL_METACHAR_PATTERN: RegExp = /[;|&><`$(){}[\]\\]/;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Options for constructing a `ShellMetacharValidator`.
 */
export interface ShellMetacharValidatorOptions {
  /**
   * Custom regex pattern to use for metacharacter detection.
   * Defaults to `DEFAULT_SHELL_METACHAR_PATTERN` when not supplied.
   *
   * If the pattern has the `g` (global) or `y` (sticky) flag, `lastIndex`
   * is reset before each string test to avoid false negatives caused by
   * regex state carry-over.
   */
  pattern?: RegExp;
}

/**
 * Result returned by `ShellMetacharValidator.validate()`.
 */
export interface ShellMetacharValidationResult {
  /** `true` when shell metacharacters were detected in at least one typed parameter. */
  triggered: boolean;
  /**
   * Effective risk level assessment:
   *   - `'critical'` when metacharacters are detected (Universal Rule 3).
   *   - `null`       when all params are clean.
   *
   * Callers should apply this to override the base risk from the action
   * registry entry when `triggered` is `true`.
   */
  risk: 'critical' | null;
  /**
   * Names of the parameter keys whose string values matched the metacharacter
   * pattern. Empty array when `triggered` is `false`.
   */
  matchedParams: string[];
}

// ─── ShellMetacharValidator ───────────────────────────────────────────────────

/**
 * Validates tool call parameters for shell metacharacters.
 *
 * Implements Universal Rule 3 from the normalize_action reclassification
 * pipeline: when any typed (string) parameter value contains a shell
 * metacharacter the effective risk level must be `critical`.
 *
 * Works across all tool types — the scanner is action-class-agnostic and
 * inspects every top-level string value in the supplied params record.
 *
 * The metacharacter pattern is configurable at construction time via
 * `ShellMetacharValidatorOptions.pattern`. The default pattern mirrors
 * the one used in normalize.ts:
 *
 *   `/[;|&><\`$(){}[\]\\]/`
 *
 * @example
 * ```ts
 * const validator = new ShellMetacharValidator();
 *
 * const clean = validator.validate({ path: '/home/user/file.txt' });
 * // clean.triggered === false, clean.risk === null
 *
 * const dangerous = validator.validate({ command: 'echo hello; rm -rf /' });
 * // dangerous.triggered === true
 * // dangerous.risk === 'critical'
 * // dangerous.matchedParams === ['command']
 * ```
 *
 * @example Custom pattern
 * ```ts
 * const strict = new ShellMetacharValidator({ pattern: /[;|&]/ });
 * const result = strict.validate({ arg: 'foo&bar' });
 * // result.triggered === true, result.risk === 'critical'
 * ```
 */
export class ShellMetacharValidator {
  private readonly pattern: RegExp;

  constructor(options: ShellMetacharValidatorOptions = {}) {
    this.pattern = options.pattern ?? DEFAULT_SHELL_METACHAR_PATTERN;
  }

  /**
   * Scans all top-level string parameter values for shell metacharacters.
   *
   * Non-string values (numbers, booleans, objects, arrays, null) are skipped —
   * only `typeof val === 'string'` entries are tested. This matches the
   * semantics of `hasShellMetacharsInParams` in normalize.ts.
   *
   * @param params  Tool call parameters (raw input record).
   * @returns       A `ShellMetacharValidationResult` describing the outcome.
   */
  validate(params: Record<string, unknown>): ShellMetacharValidationResult {
    const matchedParams: string[] = [];

    for (const [key, val] of Object.entries(params)) {
      if (typeof val !== 'string') continue;
      // Reset lastIndex for stateful (global / sticky) regexes to prevent
      // false negatives caused by carry-over state from the previous iteration.
      this.pattern.lastIndex = 0;
      if (this.pattern.test(val)) {
        matchedParams.push(key);
      }
    }

    const triggered = matchedParams.length > 0;
    return {
      triggered,
      risk: triggered ? 'critical' : null,
      matchedParams,
    };
  }
}

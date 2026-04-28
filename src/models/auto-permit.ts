/**
 * Data model for auto-permit records.
 *
 * An auto-permit is created when the system automatically grants a permit for
 * a command pattern derived from a command that was approved by the user (e.g.
 * via the "Approve Always" action). The record captures the derived pattern
 * together with provenance metadata so that the origin of every auto-permit
 * can be audited.
 *
 * @module
 */

import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { DerivationMethodSchema } from '../auto-permits/index.js';
import type { DerivationMethod } from '../auto-permits/index.js';

// Re-export for consumers that import from models only.
export type { DerivationMethod };

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * TypeBox schema for a stored auto-permit record.
 *
 * Every auto-permit written to the auto-permit store must conform to this
 * schema.  The `pattern` and `originalCommand` fields capture what was stored
 * and what triggered the storage, respectively.  `intentHint` carries optional
 * user-supplied context that improves auditability without affecting matching
 * behaviour.
 */
export const AutoPermitSchema = Type.Object({
  /**
   * The permit pattern string derived from the original command.
   *
   * Validated by the derivation engine before storage; guaranteed to conform
   * to the pattern grammar (non-empty, no consecutive spaces, wildcard only as
   * last token).
   */
  pattern: Type.String({ minLength: 1 }),

  /**
   * Derivation method used to produce {@link pattern}.
   *
   * - `'default'` — binary + first-positional + `*` wildcard (permissive).
   * - `'exact'`   — normalised token join, no wildcards (strict).
   */
  method: DerivationMethodSchema,

  /**
   * Unix-millisecond timestamp at which the auto-permit record was created.
   *
   * Set by the permit store at write time; callers must not supply this value
   * themselves so that the timestamp always reflects the actual storage instant.
   */
  createdAt: Type.Number({ minimum: 0 }),

  /**
   * The original command string that triggered the creation of this auto-permit.
   *
   * Preserved verbatim (including surrounding whitespace) for audit purposes.
   * Used to reconstruct the derivation context if the pattern is later
   * reviewed or revoked.
   */
  originalCommand: Type.String({ minLength: 1 }),

  /**
   * Optional free-text hint describing the user's intent when approving the
   * command.
   *
   * Captured from session context or user input at the time of "Approve Always"
   * and stored alongside the pattern.  Not used for matching; exists solely to
   * give human reviewers additional context when auditing the permit store.
   *
   * @example `"deploy to staging"`, `"run linter before commit"`
   */
  intentHint: Type.Optional(Type.String()),

  /**
   * Identifies the operator or HITL channel that triggered the "Approve Always"
   * action creating this auto-permit record.
   *
   * Set to the `operatorId` when available (e.g. the Telegram user ID or Slack
   * actor), falling back to the channel identifier (e.g. `"telegram"`,
   * `"slack"`) when no operator identity is present.
   */
  created_by: Type.Optional(Type.String({ minLength: 1 })),

  /**
   * ISO-8601 timestamp string at which the auto-permit record was created.
   *
   * Human-readable complement to the numeric {@link createdAt} unix-ms field.
   * Both fields represent the same storage instant; prefer `createdAt` for
   * numeric comparisons and `created_at` for display and audit output.
   *
   * @example `"2024-11-14T12:34:56.789Z"`
   */
  created_at: Type.Optional(Type.String({ minLength: 1 })),

  /**
   * The original command string from which {@link pattern} was derived.
   *
   * Snake_case alias for {@link originalCommand}, included for readability and
   * consistency with the bundle.json rule field naming convention.  Both fields
   * carry the same value; `originalCommand` is kept for backward compatibility.
   */
  derived_from: Type.Optional(Type.String({ minLength: 1 })),
});

export type AutoPermit = Static<typeof AutoPermitSchema>;

// ── Type guard ────────────────────────────────────────────────────────────────

/**
 * Type-guard that checks whether `value` conforms to {@link AutoPermitSchema}.
 *
 * Useful when loading stored permits from an external source (e.g. a JSON
 * file or database row) before trusting them at runtime.
 *
 * @example
 * ```ts
 * const raw: unknown = JSON.parse(stored);
 * if (!isAutoPermit(raw)) throw new Error('Corrupt auto-permit record');
 * console.log(raw.pattern); // typed as string
 * ```
 */
export function isAutoPermit(value: unknown): value is AutoPermit {
  return Value.Check(AutoPermitSchema, value);
}

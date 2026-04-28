/**
 * Auto-permit file format validation.
 *
 * Validates the auto-permit store file schema (both versioned envelope and
 * legacy flat-array format) and individual permit entries using TypeBox.
 * Follows the validation pattern established in `src/policy/loader.ts`.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { AutoPermitSchema } from '../models/auto-permit.js';
import type { AutoPermit } from '../models/auto-permit.js';

// ── Error class ───────────────────────────────────────────────────────────────

/**
 * Thrown by callers who need to surface fatal auto-permit load errors (e.g.
 * unrecoverable I/O failures).  Content-level issues (invalid envelope schema,
 * individual entry failures, checksum mismatches) are reported via
 * {@link AutoPermitFileValidationResult} instead so that a single bad record
 * does not prevent the rest of the store from loading.
 */
export class AutoPermitLoadError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'AutoPermitLoadError';
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

/**
 * TypeBox schema for the versioned auto-permit store envelope.
 *
 * Matches the format written by `saveAutoPermitRules`:
 * `{ version: number, rules: unknown[], checksum?: string }`.
 *
 * Individual rule entries within `rules` are validated separately using
 * {@link AutoPermitSchema} so that per-entry errors can be attributed to their
 * source index.
 */
export const AutoPermitFileSchema = Type.Object({
  version: Type.Number(),
  rules: Type.Array(Type.Unknown()),
  checksum: Type.Optional(Type.String()),
});

export type AutoPermitFile = Static<typeof AutoPermitFileSchema>;

// ── Validation result ─────────────────────────────────────────────────────────

/** Per-entry validation failure within the `rules` array. */
export interface AutoPermitEntryError {
  /** Zero-based index of the entry within the `rules` array. */
  index: number;
  /** TypeBox error messages for this entry. */
  errors: string[];
}

/**
 * Detailed result of validating a parsed auto-permit store file.
 *
 * Callers should log {@link envelopeErrors} at `error` level (the file
 * structure is unusable) and {@link entryErrors} at `warn` level (individual
 * permit entries are skipped but the rest of the store is intact).
 */
export interface AutoPermitFileValidationResult {
  /** Whether the file envelope matched {@link AutoPermitFileSchema}. */
  envelopeValid: boolean;
  /** TypeBox error messages for the envelope (non-empty when `envelopeValid` is `false`). */
  envelopeErrors: string[];
  /** Validated auto-permit records. */
  rules: AutoPermit[];
  /** Number of rule entries that failed validation and were skipped. */
  skipped: number;
  /** Per-entry validation failures (empty when all entries conform to {@link AutoPermitSchema}). */
  entryErrors: AutoPermitEntryError[];
  /** Store format version (`0` for legacy flat-array; the envelope value for versioned files). */
  version: number;
  /** SHA-256 checksum from the file envelope, if present. */
  checksum?: string;
  /**
   * Whether the content was in the legacy flat-array format (pre-versioning).
   * A legacy file should be migrated to the versioned envelope on next save.
   */
  isLegacy: boolean;
  /**
   * Whether a `checksum` was present in the envelope and did not match the
   * SHA-256 digest of the serialised `rules` array.  `false` when no checksum
   * was present or when the checksum matches.
   */
  checksumMismatch: boolean;
}

// ── validateAutoPermitContent ─────────────────────────────────────────────────

/**
 * Validates a parsed (JSON.parse'd) auto-permit store value.
 *
 * Supports both the versioned envelope `{ version, rules, checksum? }` and the
 * legacy flat-array format.  Unrecognised structures are reported via
 * {@link AutoPermitFileValidationResult.envelopeErrors} with detailed TypeBox
 * messages.
 *
 * Individual rule entries are validated with {@link AutoPermitSchema}.  Invalid
 * entries are collected in {@link AutoPermitFileValidationResult.entryErrors}
 * and skipped; valid entries are returned in
 * {@link AutoPermitFileValidationResult.rules}.
 *
 * When a `checksum` field is present in the versioned envelope it is verified
 * against `SHA-256(JSON.stringify(rules))`.  A mismatch sets
 * {@link AutoPermitFileValidationResult.checksumMismatch} to `true`.
 *
 * Never throws — all issues are captured in the returned result.
 *
 * @param parsed The value produced by `JSON.parse` on the store file content.
 * @returns A detailed {@link AutoPermitFileValidationResult}.
 */
export function validateAutoPermitContent(parsed: unknown): AutoPermitFileValidationResult {
  // Legacy flat-array format (version 0, pre-versioning).
  if (Array.isArray(parsed)) {
    return buildRulesResult(parsed, 0, undefined, true);
  }

  // Versioned envelope — validate against TypeBox schema.
  if (!Value.Check(AutoPermitFileSchema, parsed)) {
    const errors = [...Value.Errors(AutoPermitFileSchema, parsed)].map(
      (e) => `${e.path || '(root)'}: ${e.message}`,
    );
    return {
      envelopeValid: false,
      envelopeErrors: errors,
      rules: [],
      skipped: 0,
      entryErrors: [],
      version: 0,
      isLegacy: false,
      checksumMismatch: false,
    };
  }

  const { version, rules: rawRules, checksum } = parsed as AutoPermitFile;
  return buildRulesResult(rawRules, version, checksum, false);
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates each entry in `rawRules` against {@link AutoPermitSchema},
 * verifies the optional `checksum`, and returns a fully-populated
 * {@link AutoPermitFileValidationResult}.
 */
function buildRulesResult(
  rawRules: unknown[],
  version: number,
  checksum: string | undefined,
  isLegacy: boolean,
): AutoPermitFileValidationResult {
  const rules: AutoPermit[] = [];
  const entryErrors: AutoPermitEntryError[] = [];

  for (let i = 0; i < rawRules.length; i++) {
    const entry = rawRules[i];
    if (Value.Check(AutoPermitSchema, entry)) {
      rules.push(entry);
    } else {
      const errors = [...Value.Errors(AutoPermitSchema, entry)].map(
        (e) => `${e.path || '(root)'}: ${e.message}`,
      );
      entryErrors.push({ index: i, errors });
    }
  }

  // Verify checksum when present.
  let checksumMismatch = false;
  if (checksum !== undefined) {
    const expected = createHash('sha256')
      .update(JSON.stringify(rawRules))
      .digest('hex');
    checksumMismatch = checksum !== expected;
  }

  return {
    envelopeValid: true,
    envelopeErrors: [],
    rules,
    skipped: rawRules.length - rules.length,
    entryErrors,
    version,
    ...(checksum !== undefined ? { checksum } : {}),
    isLegacy,
    checksumMismatch,
  };
}

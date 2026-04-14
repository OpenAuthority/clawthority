import { createHash } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// ─── TypeBox schemas ──────────────────────────────────────────────────────────

const TBundleRule = Type.Object({
  effect: Type.Union([Type.Literal('permit'), Type.Literal('forbid')]),
  resource: Type.Optional(Type.String({ minLength: 1 })),
  action_class: Type.Optional(Type.String({ minLength: 1 })),
  match: Type.Optional(Type.String()),
  reason: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  rateLimit: Type.Optional(Type.Object({
    maxCalls: Type.Number({ minimum: 1 }),
    windowSeconds: Type.Number({ minimum: 1 }),
  })),
});

const TBundle = Type.Object({
  version: Type.Number({ minimum: 1 }),
  rules: Type.Array(TBundleRule),
  checksum: Type.String(),
});

/** Exported solely for type-sentinel usage in test files. */
export type BundleRule = Static<typeof TBundleRule>;

/** A validated bundle as accepted by {@link validateBundle}. */
export type ValidBundle = Static<typeof TBundle>;

// ─── Result type ─────────────────────────────────────────────────────────────

/** Result returned by {@link validateBundle}. */
export interface BundleValidationResult {
  valid: boolean;
  error?: string;
}

// ─── Validator ───────────────────────────────────────────────────────────────

/**
 * Validates a policy bundle object for structural integrity, version
 * monotonicity, and checksum correctness.
 *
 * Checks performed in order:
 * 1. JSON schema validation — `version` (number ≥ 1), `rules` (array),
 *    `checksum` (string) are all required.
 * 2. Per-rule semantic check — each rule must carry `effect` plus at least
 *    one of `action_class` or `resource`.
 * 3. Version monotonicity — `bundle.version` must be strictly greater than
 *    `currentVersion` to prevent rollback attacks.
 * 4. Checksum verification — `bundle.checksum` must equal the SHA-256 hex
 *    digest of `JSON.stringify(bundle.rules)`.
 *
 * @param bundle       Untrusted bundle object (typically parsed JSON).
 * @param currentVersion The version number of the currently-loaded bundle.
 * @returns {@link BundleValidationResult} with `valid: true` on success, or
 *          `valid: false` and a descriptive `error` string on failure.
 */
export function validateBundle(bundle: unknown, currentVersion: number): BundleValidationResult {
  // ── 1. Schema validation ──────────────────────────────────────────────────
  if (!Value.Check(TBundle, bundle)) {
    const errors = [...Value.Errors(TBundle, bundle)].map(
      (e) => `${e.path}: ${e.message}`,
    );
    return { valid: false, error: `Schema validation failed: ${errors.join('; ')}` };
  }

  // ── 2. Per-rule semantic check ────────────────────────────────────────────
  for (let i = 0; i < bundle.rules.length; i++) {
    const rule = bundle.rules[i]!;
    if (rule.action_class === undefined && rule.resource === undefined) {
      return {
        valid: false,
        error: `Rule at index ${i} must have either action_class or resource`,
      };
    }
  }

  // ── 3. Version monotonicity ───────────────────────────────────────────────
  if (bundle.version <= currentVersion) {
    return {
      valid: false,
      error: `Bundle version ${bundle.version} must be greater than current version ${currentVersion}`,
    };
  }

  // ── 4. Checksum verification ──────────────────────────────────────────────
  const expected = createHash('sha256')
    .update(JSON.stringify(bundle.rules))
    .digest('hex');
  if (bundle.checksum !== expected) {
    return {
      valid: false,
      error: `Checksum mismatch: expected ${expected}, got ${bundle.checksum}`,
    };
  }

  return { valid: true };
}

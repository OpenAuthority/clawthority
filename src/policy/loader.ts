import { readFile } from 'node:fs/promises';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// ─── TypeBox schemas ──────────────────────────────────────────────────────────

const TRateLimitSchema = Type.Object({
  maxCalls: Type.Number({ minimum: 1 }),
  windowSeconds: Type.Number({ minimum: 1 }),
});

/**
 * TypeBox schema for a single rule entry in a loaded JSON policy bundle.
 * The `match` field is always a string in JSON (RegExp patterns are
 * represented by their source text and must be reconstructed by the caller).
 * The `condition` field is omitted because functions are not JSON-serializable.
 */
const TLoadedRule = Type.Object({
  effect: Type.Union([Type.Literal('permit'), Type.Literal('forbid')]),
  resource: Type.String({ minLength: 1 }),
  match: Type.String(),
  reason: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  rateLimit: Type.Optional(TRateLimitSchema),
  action_class: Type.Optional(Type.String()),
});

/**
 * TypeBox schema for a complete JSON policy bundle file.
 * `version` is required; all other fields are optional.
 */
const TLoadedBundle = Type.Object({
  version: Type.Number({ minimum: 1 }),
  rules: Type.Optional(Type.Array(TLoadedRule)),
  checksum: Type.Optional(Type.String()),
});

// ─── Exported types ───────────────────────────────────────────────────────────

/** A single rule as parsed from a JSON policy bundle (no condition functions). */
export type LoadedRule = Static<typeof TLoadedRule>;

/** A complete policy bundle as parsed from a JSON file. */
export type LoadedPolicyBundle = Static<typeof TLoadedBundle>;

// ─── Error class ─────────────────────────────────────────────────────────────

/** Thrown by {@link loadPolicyFile} on any I/O, parse, or validation failure. */
export class PolicyLoadError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'PolicyLoadError';
  }
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Reads a JSON policy bundle from disk and validates it against the
 * {@link TLoadedBundle} schema.
 *
 * Fails closed: any I/O error, JSON parse failure, or schema violation causes
 * a {@link PolicyLoadError} to be thrown. The caller always receives a
 * fully-typed {@link LoadedPolicyBundle} or an exception — never a partial or
 * unvalidated value.
 *
 * @param filePath Absolute or relative path to the JSON policy bundle file.
 * @returns The validated policy bundle.
 * @throws {@link PolicyLoadError} when the file cannot be read, parsed, or validated.
 */
export async function loadPolicyFile(filePath: string): Promise<LoadedPolicyBundle> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new PolicyLoadError(`Failed to read policy file: ${filePath}`, err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new PolicyLoadError(`Failed to parse policy file as JSON: ${filePath}`, err);
  }

  if (!Value.Check(TLoadedBundle, parsed)) {
    const errors = [...Value.Errors(TLoadedBundle, parsed)].map(
      (e) => `${e.path}: ${e.message}`,
    );
    throw new PolicyLoadError(
      `Policy validation failed (${filePath}): ${errors.join('; ')}`,
    );
  }

  return parsed;
}

/**
 * Pattern derivation engine for auto-permits.
 *
 * Derives permit patterns from command examples using a configurable strategy.
 * The default strategy is `binary + first-positional + *`, which produces a
 * permissive pattern that covers all invocations of a command with the same
 * top-level sub-command. An `exact` strategy produces a strict pattern with no
 * wildcards, matching only the normalised command verbatim.
 *
 * All derived patterns are validated before being returned so that only
 * well-formed patterns are eligible for storage in the auto-permit store.
 *
 * @module
 */

import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// ── Schemas ───────────────────────────────────────────────────────────────────

/**
 * Supported derivation methods.
 *
 * - `'default'` — binary + first-positional + `*` wildcard (permissive).
 * - `'exact'`   — normalised token join, no wildcards (strict).
 */
export const DerivationMethodSchema = Type.Union([
  Type.Literal('default'),
  Type.Literal('exact'),
]);

export type DerivationMethod = Static<typeof DerivationMethodSchema>;

/** Input options for {@link derivePattern}. */
export const DerivePatternOptsSchema = Type.Object({
  /** Raw command string to derive a pattern from. */
  command: Type.String({ minLength: 1 }),
  /**
   * Derivation strategy.  Defaults to `'default'` when omitted.
   */
  method: Type.Optional(DerivationMethodSchema),
});

export type DerivePatternOpts = Static<typeof DerivePatternOptsSchema>;

/**
 * A derived permit pattern with audit metadata.
 *
 * Returned by {@link derivePattern} after the pattern has passed validation.
 * All fields are safe to serialise for audit log entries.
 */
export const DerivedPatternSchema = Type.Object({
  /** The derived pattern string, suitable for storage in the auto-permit store. */
  pattern: Type.String({ minLength: 1 }),
  /** Derivation method used to produce the pattern. */
  method: DerivationMethodSchema,
  /** The command binary (first token). */
  binary: Type.String({ minLength: 1 }),
  /**
   * First positional argument (first non-flag token after the binary).
   * Absent when the command has no positional arguments.
   */
  firstPositional: Type.Optional(Type.String()),
  /** The original command string exactly as provided by the caller. */
  originalCommand: Type.String(),
  /** Number of tokens in the parsed command. */
  tokenCount: Type.Number({ minimum: 1 }),
  /** Unix-millisecond timestamp at which derivation occurred. */
  derivedAt: Type.Number({ minimum: 0 }),
});

export type DerivedPattern = Static<typeof DerivedPatternSchema>;

// ── Error ─────────────────────────────────────────────────────────────────────

/** Thrown by {@link derivePattern} when derivation or validation fails. */
export class PatternDerivationError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'PatternDerivationError';
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Result of {@link validatePattern}. */
export interface PatternValidationResult {
  valid: boolean;
  errors: string[];
}

/** Regex that a valid non-wildcard token must satisfy (no spaces, no `*`). */
const VALID_TOKEN_RE = /^[^\s*]+$/;

/**
 * Validates a permit pattern before storage.
 *
 * A valid pattern must:
 * - Be non-empty and free of leading/trailing whitespace.
 * - Contain no consecutive spaces (empty tokens).
 * - Have a binary (first token) that contains no spaces or wildcard characters.
 * - Place the wildcard `*` only as the final token, if present at all.
 *
 * This function is used internally by {@link derivePattern} and is also
 * exported for callers that want to validate patterns programmatically before
 * passing them to storage.
 */
export function validatePattern(pattern: string): PatternValidationResult {
  const errors: string[] = [];

  if (pattern.trim() === '') {
    errors.push('Pattern must not be empty');
    return { valid: false, errors };
  }

  if (pattern !== pattern.trim()) {
    errors.push('Pattern must not have leading or trailing whitespace');
  }

  const tokens = pattern.split(' ');

  if (tokens.some((t) => t === '')) {
    errors.push('Pattern must not contain consecutive spaces');
  }

  const binary = tokens[0];
  if (binary === undefined || !VALID_TOKEN_RE.test(binary)) {
    errors.push(
      'Binary (first token) must be a non-empty string without spaces or wildcards',
    );
  }

  const wildcardIndex = tokens.indexOf('*');
  if (wildcardIndex !== -1 && wildcardIndex !== tokens.length - 1) {
    errors.push('Wildcard (*) must only appear as the last token');
  }

  return { valid: errors.length === 0, errors };
}

// ── Tokeniser ─────────────────────────────────────────────────────────────────

/**
 * Splits a shell-like command string into tokens.
 *
 * Single- and double-quoted groups are treated as single tokens (quotes are
 * stripped).  Unquoted spaces act as delimiters.  Consecutive unquoted spaces
 * are collapsed.
 *
 * Examples:
 * ```
 * tokenize('git commit')              → ['git', 'commit']
 * tokenize('git commit -m "my msg"')  → ['git', 'commit', '-m', 'my msg']
 * tokenize("git tag -a v1 -m 'tag'")  → ['git', 'tag', '-a', 'v1', '-m', 'tag']
 * ```
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;

  for (const ch of command) {
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === ' ' && !inDouble && !inSingle) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

// ── Engine ────────────────────────────────────────────────────────────────────

/**
 * Derives a permit pattern from a command string.
 *
 * **Default derivation** (`method: 'default'`):
 * Uses the `binary + first-positional + *` strategy:
 * - Binary only (no arguments) → pattern equals the binary alone (`git`).
 * - Binary + flags only (no positional arg) → `binary *` (e.g. `ls *`).
 * - Binary + positional arg (± further args) → `binary positional *`
 *   (e.g. `git commit *`).
 *
 * The first positional argument is the first token after the binary that does
 * not start with a `-` character.  Flag-like arguments (e.g. `-m`, `--amend`)
 * are skipped during the search.
 *
 * **Exact derivation** (`method: 'exact'`):
 * Reconstructs the normalised command from its parsed tokens joined by a
 * single space.  No wildcards are added, producing a strict exact-match
 * pattern.
 *
 * The derived pattern is validated before returning.  If validation fails a
 * {@link PatternDerivationError} is thrown — this prevents malformed patterns
 * from reaching the auto-permit store.
 *
 * @param opts Derivation options including the raw command and optional method.
 * @returns The derived pattern together with audit metadata.
 * @throws {@link PatternDerivationError} when the command is empty after
 *   tokenisation or when the derived pattern fails validation.
 */
export function derivePattern(opts: DerivePatternOpts): DerivedPattern {
  const method = opts.method ?? 'default';
  const command = opts.command.trim();

  const tokens = tokenize(command);

  if (tokens.length === 0) {
    throw new PatternDerivationError(
      'Command must not be empty after tokenisation',
    );
  }

  const binary = tokens[0]!;

  // Locate the first positional argument (non-flag token) after the binary.
  let firstPositional: string | undefined;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (!tok.startsWith('-')) {
      firstPositional = tok;
      break;
    }
  }

  let pattern: string;

  if (method === 'default') {
    if (tokens.length === 1) {
      // No arguments — the binary alone is the pattern.
      pattern = binary;
    } else if (firstPositional !== undefined) {
      // Binary + first positional + wildcard suffix.
      pattern = `${binary} ${firstPositional} *`;
    } else {
      // Binary with only flag arguments — wildcard covers all flag variations.
      pattern = `${binary} *`;
    }
  } else {
    // Exact: join normalised tokens without any wildcard.
    pattern = tokens.join(' ');
  }

  const validation = validatePattern(pattern);
  if (!validation.valid) {
    throw new PatternDerivationError(
      `Derived pattern failed validation: ${validation.errors.join('; ')}`,
    );
  }

  const derivedAt = Date.now();

  return {
    pattern,
    method,
    binary,
    ...(firstPositional !== undefined ? { firstPositional } : {}),
    originalCommand: opts.command,
    tokenCount: tokens.length,
    derivedAt,
  };
}

/**
 * Type-guard that checks whether a value conforms to {@link DerivedPatternSchema}.
 *
 * Useful when loading stored patterns from an external source (e.g. a
 * persistence layer) before trusting them at runtime.
 */
export function isDerivedPattern(value: unknown): value is DerivedPattern {
  return Value.Check(DerivedPatternSchema, value);
}

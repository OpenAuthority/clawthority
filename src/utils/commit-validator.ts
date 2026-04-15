/**
 * Commit message validation utility.
 *
 * Provides `validateCommitMessage` — a pure function that checks whether a
 * commit message conforms to the project's Conventional Commits format:
 *
 *   <type>(<scope>): <subject>
 *   <type>: <subject>
 *
 * Returns a structured result with per-field errors and, on success, the
 * parsed commit parts. Intended for use in Definition of Done checks and
 * pre-commit tooling.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Recognised commit type identifiers. */
export type CommitType =
  | 'feat'
  | 'fix'
  | 'test'
  | 'chore'
  | 'docs'
  | 'refactor'
  | 'perf';

/** Which structural field the validation error relates to. */
export type CommitValidationField = 'format' | 'type' | 'scope' | 'subject';

/** A single validation error with the field it pertains to and a human-readable message. */
export interface CommitValidationError {
  /** The structural field that failed validation. */
  field: CommitValidationField;
  /** Human-readable description of the validation failure. */
  message: string;
}

/** The parsed structural parts of a valid commit message. */
export interface CommitMessageParts {
  /** Commit type (e.g. `feat`, `fix`). */
  type: CommitType;
  /** Optional scope in parentheses (e.g. `utils`, `policy`). `undefined` when omitted. */
  scope: string | undefined;
  /** Subject line — the imperative description following `: `. */
  subject: string;
}

/** Result returned by `validateCommitMessage`. */
export interface CommitValidationResult {
  /** `true` when the message passes all checks with no errors. */
  valid: boolean;
  /** Ordered list of validation errors. Empty when `valid` is `true`. */
  errors: CommitValidationError[];
  /**
   * Parsed commit parts — present only when `valid` is `true`.
   * Callers can use this to inspect type, scope, and subject without
   * re-parsing the message.
   */
  parts?: CommitMessageParts;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** All recognised commit types for this project. */
const VALID_TYPES: ReadonlySet<string> = new Set<CommitType>([
  'feat',
  'fix',
  'test',
  'chore',
  'docs',
  'refactor',
  'perf',
]);

/**
 * Matches the first line of a Conventional Commit message.
 *
 * Groups:
 *   1 — type       (required, lowercase alpha)
 *   2 — scope      (optional, inside parentheses, non-empty)
 *   3 — subject    (required, non-empty text after `: `)
 */
const COMMIT_PATTERN = /^([a-z]+)(?:\(([^)]*)\))?: (.+)$/;

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Validates that a commit message conforms to the project's Conventional
 * Commits format: `<type>(<scope>): <subject>` or `<type>: <subject>`.
 *
 * Checks performed:
 *   - Message is not empty
 *   - Overall format matches the expected pattern
 *   - Type is one of the recognised values
 *   - Scope, when parentheses are present, is not blank
 *   - Subject is not blank
 *
 * @param message  The raw commit message string (first line is validated).
 * @returns        A `CommitValidationResult` with `valid`, `errors`, and
 *                 optionally `parts` when the message is well-formed.
 */
export function validateCommitMessage(message: string): CommitValidationResult {
  // ── Edge case: empty or whitespace-only ───────────────────────────────────

  if (message.trim() === '') {
    return {
      valid: false,
      errors: [{ field: 'format', message: 'Commit message must not be empty.' }],
    };
  }

  // ── Format check ─────────────────────────────────────────────────────────

  // Validate only the first line (subject line) of the commit message.
  const firstLine = message.split('\n')[0]!.trim();
  const match = COMMIT_PATTERN.exec(firstLine);

  if (match === null) {
    return {
      valid: false,
      errors: [
        {
          field: 'format',
          message:
            'Commit message must follow the format "<type>(<scope>): <subject>" or "<type>: <subject>".',
        },
      ],
    };
  }

  const [, rawType, rawScope, subject] = match as [string, string, string | undefined, string];

  const errors: CommitValidationError[] = [];

  // ── Type check ────────────────────────────────────────────────────────────

  if (!VALID_TYPES.has(rawType)) {
    errors.push({
      field: 'type',
      message: `Unknown commit type "${rawType}". Must be one of: ${[...VALID_TYPES].join(', ')}.`,
    });
  }

  // ── Scope check ───────────────────────────────────────────────────────────

  if (rawScope !== undefined && rawScope.trim() === '') {
    errors.push({
      field: 'scope',
      message: 'Scope must not be empty when parentheses are present.',
    });
  }

  // ── Subject check ─────────────────────────────────────────────────────────

  if (subject.trim() === '') {
    errors.push({
      field: 'subject',
      message: 'Commit subject must not be empty.',
    });
  }

  // ── Result ────────────────────────────────────────────────────────────────

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    parts: {
      type: rawType as CommitType,
      scope: rawScope,
      subject,
    },
  };
}

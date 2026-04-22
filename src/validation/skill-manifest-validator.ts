/**
 * F-05 tool manifest schema validator.
 *
 * Provides the `ToolManifest` interface and `validateToolManifest` — a pure
 * function that checks whether a tool manifest conforms to the F-05 schema.
 *
 * F-05 schema requires:
 *   - name         (string)
 *   - version      (string)
 *   - action_class (registered taxonomy entry, dot-separated)
 *   - params       (JSON Schema object: { type: "object", properties: {...} })
 *   - result       (JSON Schema object: { type: "object", properties: {...} })
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** A JSON Schema fragment describing an object shape. */
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  [key: string]: unknown;
}

/** A fully-typed F-05 tool manifest. */
export interface ToolManifest {
  /** Unique tool name (lowercase, kebab-case or snake_case). */
  name: string;
  /** Semantic version string (e.g. "1.0.0"). */
  version: string;
  /** Registered action taxonomy entry (e.g. "vcs.write"). */
  action_class: string;
  /** JSON Schema describing the tool's input parameters. */
  params: JsonSchemaObject;
  /** JSON Schema describing the tool's result payload. */
  result: JsonSchemaObject;
}

/** Structured validation outcome from `validateToolManifest`. */
export interface ManifestValidationResult {
  /** `true` when all F-05 constraints are satisfied. */
  valid: boolean;
  /** Ordered list of constraint violation messages. Empty when `valid` is `true`. */
  errors: string[];
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Validates a value against the F-05 tool manifest schema.
 *
 * Checks performed:
 *   - `name`: non-empty string
 *   - `version`: non-empty string
 *   - `action_class`: non-empty dot-separated string
 *   - `params`: object with `type === "object"` and `properties` object
 *   - `result`: object with `type === "object"` and `properties` object
 *
 * @param manifest  The value to validate (typically an imported manifest object).
 * @returns         A `ManifestValidationResult` with `valid` and `errors`.
 */
export function validateToolManifest(manifest: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (typeof manifest !== 'object' || manifest === null) {
    return { valid: false, errors: ['Manifest must be a non-null object.'] };
  }

  const m = manifest as Record<string, unknown>;

  // ── name ─────────────────────────────────────────────────────────────────

  if (typeof m['name'] !== 'string' || m['name'].trim() === '') {
    errors.push('name: must be a non-empty string.');
  }

  // ── version ───────────────────────────────────────────────────────────────

  if (typeof m['version'] !== 'string' || m['version'].trim() === '') {
    errors.push('version: must be a non-empty string.');
  }

  // ── action_class ──────────────────────────────────────────────────────────

  if (typeof m['action_class'] !== 'string' || m['action_class'].trim() === '') {
    errors.push('action_class: must be a non-empty string.');
  }

  // ── params ────────────────────────────────────────────────────────────────

  validateJsonSchemaObject(m['params'], 'params', errors);

  // ── result ────────────────────────────────────────────────────────────────

  validateJsonSchemaObject(m['result'], 'result', errors);

  return { valid: errors.length === 0, errors };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function validateJsonSchemaObject(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (typeof value !== 'object' || value === null) {
    errors.push(`${field}: must be an object with type "object" and a properties map.`);
    return;
  }

  const obj = value as Record<string, unknown>;

  if (obj['type'] !== 'object') {
    errors.push(`${field}.type: must be the string "object".`);
  }

  if (typeof obj['properties'] !== 'object' || obj['properties'] === null || Array.isArray(obj['properties'])) {
    errors.push(`${field}.properties: must be a non-null, non-array object.`);
  }
}

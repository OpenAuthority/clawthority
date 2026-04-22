/**
 * F-05 tool manifest schema validator.
 *
 * Provides the `ToolManifest` interface and two validators:
 *   - `validateToolManifest` — pure function enforcing the F-05 schema
 *   - `SkillManifestValidator` — class enforcing registry-aware constraints
 *     (registered action class, exec wrapper detection, risk/HITL alignment)
 *
 * F-05 schema requires:
 *   - name               (string)
 *   - version            (string)
 *   - action_class       (registered taxonomy entry, dot-separated)
 *   - risk_tier          (RiskLevel)
 *   - default_hitl_mode  (HitlModeNorm)
 *   - params             (JSON Schema object with additionalProperties: false)
 *   - result             (JSON Schema object)
 *
 * Registry-aware constraints (E-01, E-03, E-05):
 *   - E-01: action_class must be registered in @openclaw/action-registry
 *   - E-03: tool name must not be a reserved exec wrapper name;
 *           action_class "shell.exec" is forbidden in skill manifests
 *   - E-05: risk_tier and default_hitl_mode must align with registry defaults
 */

import { REGISTRY } from '@openclaw/action-registry';
import type { RiskLevel, HitlModeNorm } from '@openclaw/action-registry';

export type { RiskLevel, HitlModeNorm };

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_RISK_TIERS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'critical']);
const VALID_HITL_MODES: ReadonlySet<string> = new Set(['none', 'per_request', 'session_approval']);

/** ISO-8601 date-only pattern (YYYY-MM-DD). */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reserved tool names that are exec wrapper aliases.
 * Mirrors the SHELL_WRAPPER_TOOL_NAMES set used by normalize.ts at runtime.
 */
const EXEC_WRAPPER_TOOL_NAMES: ReadonlySet<string> = new Set([
  'exec',
  'bash',
  'shell_exec',
  'run_command',
  'execute_command',
  'run_terminal_cmd',
  'terminal_exec',
  'cmd',
  'sh',
  'zsh',
]);

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
  /** Risk level for this tool. Must align with the registry default for the action_class. */
  risk_tier: RiskLevel;
  /** HITL mode for this tool. Must align with the registry default for the action_class. */
  default_hitl_mode: HitlModeNorm;
  /**
   * Optional hint naming the primary target resource key within `params.properties`.
   * Used by the enforcement layer before falling back to TARGET_KEYS_BY_CLASS.
   */
  target_field?: string;
  /** JSON Schema describing the tool's input parameters. Must include additionalProperties: false. */
  params: JsonSchemaObject;
  /** JSON Schema describing the tool's result payload. */
  result: JsonSchemaObject;
  /**
   * Escape hatch for legacy tools during a migration period.
   * Must be `true`. Requires the `until` field to be set.
   * Registry-aware checks (E-01, E-03, E-05) are bypassed while the deadline is active.
   */
  unsafe_legacy?: true;
  /**
   * Migration deadline in YYYY-MM-DD format.
   * Required when `unsafe_legacy` is `true`.
   * Past this date, validation fails in CLOSED mode.
   */
  until?: string;
}

/** Structured validation outcome from `validateToolManifest` and `SkillManifestValidator`. */
export interface ManifestValidationResult {
  /** `true` when all constraints are satisfied. */
  valid: boolean;
  /** Ordered list of constraint violation messages. Empty when `valid` is `true`. */
  errors: string[];
}

// ─── F-05 Schema Validator ────────────────────────────────────────────────────

/**
 * Validates a value against the F-05 tool manifest schema.
 *
 * Checks performed:
 *   - `name`: non-empty string
 *   - `version`: non-empty string
 *   - `action_class`: non-empty dot-separated string
 *   - `risk_tier`: valid RiskLevel value ("low" | "medium" | "high" | "critical")
 *   - `default_hitl_mode`: valid HitlModeNorm value ("none" | "per_request" | "session_approval")
 *   - `params`: object with type "object", properties map, and additionalProperties: false
 *   - `result`: object with type "object" and properties map
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

  // ── risk_tier ─────────────────────────────────────────────────────────────

  if (!VALID_RISK_TIERS.has(m['risk_tier'] as string)) {
    errors.push(
      'risk_tier: must be one of "low", "medium", "high", "critical".',
    );
  }

  // ── default_hitl_mode ─────────────────────────────────────────────────────

  if (!VALID_HITL_MODES.has(m['default_hitl_mode'] as string)) {
    errors.push(
      'default_hitl_mode: must be one of "none", "per_request", "session_approval".',
    );
  }

  // ── params ────────────────────────────────────────────────────────────────

  validateJsonSchemaObject(m['params'], 'params', true, errors);

  // ── result ────────────────────────────────────────────────────────────────

  validateJsonSchemaObject(m['result'], 'result', false, errors);

  // ── unsafe_legacy / until ─────────────────────────────────────────────────

  if (m['unsafe_legacy'] !== undefined) {
    if (m['unsafe_legacy'] !== true) {
      errors.push('unsafe_legacy: must be the boolean true when present.');
    } else {
      const until = m['until'];
      if (typeof until !== 'string' || until.trim() === '') {
        errors.push(
          'until: required when unsafe_legacy is true; must be a YYYY-MM-DD date string.',
        );
      } else if (!isValidDateString(until)) {
        errors.push(`until: "${until}" is not a valid YYYY-MM-DD date.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Returns true when `s` is a valid YYYY-MM-DD date string. */
function isValidDateString(s: string): boolean {
  if (!DATE_PATTERN.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

/** Returns true when the given YYYY-MM-DD date is strictly before today (deadline has passed). */
function isDeadlinePast(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(dateStr);
  deadline.setHours(0, 0, 0, 0);
  return deadline < today;
}

function validateJsonSchemaObject(
  value: unknown,
  field: string,
  requireAdditionalPropertiesFalse: boolean,
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

  if (
    typeof obj['properties'] !== 'object' ||
    obj['properties'] === null ||
    Array.isArray(obj['properties'])
  ) {
    errors.push(`${field}.properties: must be a non-null, non-array object.`);
  }

  if (requireAdditionalPropertiesFalse && obj['additionalProperties'] !== false) {
    errors.push(
      `${field}.additionalProperties: must be false to prevent unexpected parameter injection.`,
    );
  }
}

// ─── SkillManifestValidator ───────────────────────────────────────────────────

/** Options for `SkillManifestValidator`. */
export interface SkillManifestValidatorOptions {
  /**
   * When `true`, the validator operates in OPEN mode: past `unsafe_legacy` deadlines
   * produce warnings instead of errors. Defaults to `process.env.OPENAUTHORITY_MODE === "OPEN"`.
   */
  openMode?: boolean;
}

/**
 * Build-time validator for skill manifests.
 *
 * Extends basic F-05 schema compliance with registry-aware rules:
 *
 *   E-01: action_class must be registered in @openclaw/action-registry.
 *   E-03: tool name must not be a reserved exec wrapper name (exec, bash,
 *         shell_exec, run_command, …); action_class "shell.exec" is also
 *         forbidden in skill manifests.
 *   E-05: risk_tier and default_hitl_mode must align with the registry
 *         default_risk and default_hitl_mode for the declared action_class.
 *
 * When a manifest declares `unsafe_legacy: true` with a valid `until` date:
 *   - Registry-aware checks (E-01, E-03, E-05) are bypassed while the deadline is active.
 *   - A warning is always logged to `console.warn`.
 *   - Past the deadline, validation fails in CLOSED mode (default); OPEN mode
 *     demotes the failure to an additional warning.
 *
 * Violations are caught at manifest parse time, not at execution time.
 */
export class SkillManifestValidator {
  private readonly openMode: boolean;

  constructor(opts?: SkillManifestValidatorOptions) {
    this.openMode = opts?.openMode ?? process.env['OPENAUTHORITY_MODE'] === 'OPEN';
  }

  /**
   * Validates a skill manifest against the full registry-aware rule set.
   *
   * Runs F-05 schema checks first; if those fail, returns immediately without
   * running registry-aware checks (registry checks assume a structurally
   * valid manifest).
   *
   * When `unsafe_legacy: true` is set and the `until` deadline is active,
   * registry-aware checks are skipped and a warning is logged.
   *
   * @param manifest  The value to validate.
   * @returns         A `ManifestValidationResult` with `valid` and `errors`.
   */
  validate(manifest: unknown): ManifestValidationResult {
    const schemaResult = validateToolManifest(manifest);
    if (!schemaResult.valid) return schemaResult;

    const m = manifest as ToolManifest;

    // ── unsafe_legacy bypass ──────────────────────────────────────────────────

    if (m.unsafe_legacy === true && typeof m.until === 'string') {
      const deadlinePast = isDeadlinePast(m.until);

      console.warn(
        `[OpenAuthority] unsafe_legacy: "${m.name}" is operating in legacy mode until ${m.until}. Migrate before deadline.`,
      );

      if (deadlinePast) {
        if (this.openMode) {
          console.warn(
            `[OpenAuthority] unsafe_legacy: deadline "${m.until}" for "${m.name}" has passed (OPEN mode — allowed with warning).`,
          );
          return { valid: true, errors: [] };
        }
        return {
          valid: false,
          errors: [
            `unsafe_legacy: deadline "${m.until}" has passed for "${m.name}". ` +
              `Legacy mode is no longer permitted in CLOSED mode. Migrate to a supported action_class.`,
          ],
        };
      }

      // Deadline still active — bypass registry checks.
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];

    // E-01: action_class must be registered
    const entry = REGISTRY.find((e) => e.action_class === m.action_class);
    if (entry === undefined) {
      errors.push(
        `action_class: "${m.action_class}" is not a registered action class.`,
      );
    }

    // E-03: shell.exec action_class is not permitted in skill manifests
    if (m.action_class === 'shell.exec') {
      errors.push(
        `action_class: "shell.exec" is not permitted in skill manifests. ` +
          `Use a more specific registered action class.`,
      );
    }

    // E-03: exec wrapper tool names are reserved and cannot be registered as skills
    if (EXEC_WRAPPER_TOOL_NAMES.has(m.name.toLowerCase())) {
      errors.push(
        `name: "${m.name}" is a reserved exec wrapper tool name and cannot be registered as a skill manifest.`,
      );
    }

    // E-05: risk_tier and default_hitl_mode must align with registry defaults
    if (entry !== undefined) {
      if (m.risk_tier !== entry.default_risk) {
        errors.push(
          `risk_tier: "${m.risk_tier}" does not match the registry default ` +
            `"${entry.default_risk}" for action_class "${m.action_class}".`,
        );
      }

      if (m.default_hitl_mode !== entry.default_hitl_mode) {
        errors.push(
          `default_hitl_mode: "${m.default_hitl_mode}" does not match the registry default ` +
            `"${entry.default_hitl_mode}" for action_class "${m.action_class}".`,
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

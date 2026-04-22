/**
 * Agent obfuscation detector.
 *
 * Detects obfuscation attempts in MCP tool call parameters using two
 * complementary mechanisms:
 *
 *   1. Strict JSON schema validation — enforces `additionalProperties: false`
 *      per F-05, preventing unexpected parameter injection beyond the declared
 *      schema (reports `schema_missing_strict` and `extra_properties`).
 *
 *   2. Cedar-style typed field rules — evaluates a set of predicate rules
 *      over individual typed parameter values. Built-in rules detect:
 *        - null bytes             (OBF-001, critical)
 *        - control characters     (OBF-002, high)
 *        - bidi text overrides    (OBF-003, high)
 *        - oversized values       (OBF-004, high)
 *      Prototype-pollution key detection (OBF-PP, critical) and type-
 *      confusion detection (OBF-TC, high) are applied as separate passes.
 *
 *   Cedar semantics apply: every matching `forbid` rule contributes a
 *   violation; `blocked: true` is set when any violation is present.
 *   Multiple violations are always fully reported (no short-circuit).
 *
 * Integration:
 *   - F-05: params schema must declare `additionalProperties: false`; the
 *           detector enforces this at call time, complementing the manifest-
 *           time enforcement in `SkillManifestValidator`.
 *   - E-01: tool registration is enforced upstream by MCPToolGate (T177);
 *           the obfuscation detector assumes the tool is already verified
 *           and focuses solely on parameter content.
 *
 * @see T89
 * @see T177
 */

import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { JsonSchemaObject } from './skill-manifest-validator.js';

export type { JsonSchemaObject };

// ─── TypeBox schema for F-05 strict params structure ─────────────────────────

/**
 * TypeBox schema for validating that a JSON Schema object satisfies the
 * F-05 strictness requirement.
 *
 * A conforming schema must have:
 *   - `type: 'object'`
 *   - a `properties` record
 *   - `additionalProperties: false`
 *
 * Used by {@link AgentObfuscationDetector.detect} to pre-validate the
 * supplied schema before running obfuscation checks.
 */
const TStrictParamsSchema = Type.Object(
  {
    type: Type.Literal('object'),
    properties: Type.Record(Type.String(), Type.Any()),
    additionalProperties: Type.Literal(false),
  },
  { additionalProperties: true }, // other JSON Schema keywords (title, $schema, …) are allowed
);

type StrictParamsSchema = Static<typeof TStrictParamsSchema>;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Category of obfuscation violation detected by {@link AgentObfuscationDetector}.
 *
 * - `schema_missing_strict`: schema lacks `additionalProperties: false` (F-05)
 * - `extra_properties`:      params contain keys not declared in the schema
 * - `null_byte`:             a string value contains a null byte (`\0`)
 * - `control_chars`:         a string value contains non-printable control chars
 * - `prototype_pollution`:   a param key is a known prototype-pollution vector
 * - `encoding_pattern`:      a string value contains suspicious encoding sequences
 * - `oversized_value`:       a string value exceeds the configured maximum length
 * - `type_confusion`:        a value's type differs from the schema-declared type
 */
export type ObfuscationKind =
  | 'schema_missing_strict'
  | 'extra_properties'
  | 'null_byte'
  | 'control_chars'
  | 'prototype_pollution'
  | 'encoding_pattern'
  | 'oversized_value'
  | 'type_confusion';

/** A single obfuscation violation detected in a tool call. */
export interface ObfuscationViolation {
  /** Violation category. */
  kind: ObfuscationKind;
  /**
   * Parameter key that triggered the violation.
   * `'schema'` is used for schema-level (non-field) violations.
   */
  field: string;
  /** Human-readable violation message. */
  message: string;
  /** Risk level assessed for this violation. */
  risk: 'high' | 'critical';
}

/** Result returned by {@link AgentObfuscationDetector.detect}. */
export interface ObfuscationDetectionResult {
  /**
   * `true` when at least one violation was detected; the tool call should
   * be blocked. `false` when all checks passed cleanly.
   */
  blocked: boolean;
  /** Ordered list of violations. Empty when `blocked` is `false`. */
  violations: ObfuscationViolation[];
}

/**
 * A Cedar-style typed-field predicate rule.
 *
 * When `when(value)` returns `true`, the rule fires with `effect: 'forbid'`
 * and contributes a violation to the detection result.
 *
 * The `field` property is either a specific parameter key (exact match, case-
 * sensitive) or `'*'` to apply the rule to every parameter field.
 */
export interface CedarFieldRule {
  /** Unique rule identifier (e.g. `'OBF-001'`). */
  id: string;
  /** Human-readable rule description used in violation messages. */
  description: string;
  /**
   * Parameter key this rule applies to.
   * Use `'*'` to apply the rule to all parameter fields.
   */
  field: string;
  /**
   * Predicate that returns `true` when the rule condition is satisfied
   * (i.e. when a violation should be reported for this field/value pair).
   */
  when: (value: unknown) => boolean;
  /** Effect — always `'forbid'` for obfuscation detection rules. */
  effect: 'forbid';
  /** Violation kind to report when this rule fires. */
  kind: ObfuscationKind;
  /** Risk level to associate with violations produced by this rule. */
  risk: 'high' | 'critical';
}

/** Options for constructing an {@link AgentObfuscationDetector}. */
export interface AgentObfuscationDetectorOptions {
  /**
   * Maximum allowed length for a string parameter value, in characters.
   * String values longer than this limit trigger an `oversized_value`
   * violation. Defaults to {@link DEFAULT_MAX_STRING_LENGTH} (4096).
   */
  maxStringLength?: number;
  /**
   * Additional Cedar-style field rules appended after the built-in rule set.
   * Custom rules extend — never replace — the built-in rules.
   */
  additionalRules?: ReadonlyArray<CedarFieldRule>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default maximum string value length (characters) before `oversized_value` fires. */
export const DEFAULT_MAX_STRING_LENGTH = 4096;

/**
 * Known prototype-pollution parameter key names.
 *
 * These keys can corrupt an object's prototype chain when assigned as own
 * properties (e.g. via JSON.parse), making them a critical injection vector
 * in tool call parameter records.
 */
export const PROTOTYPE_POLLUTION_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

/**
 * Regex matching non-printable ASCII control characters.
 *
 * Matches codepoints 0x01–0x08, 0x0B, 0x0C, 0x0E–0x1F, and 0x7F (DEL).
 * Tab (0x09), newline (0x0A), and carriage return (0x0D) are intentionally
 * excluded to avoid false positives on multi-line text fields such as file
 * content or commit messages.
 */
export const CONTROL_CHAR_PATTERN: RegExp = /[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/**
 * Regex matching Unicode bidirectional text override characters.
 *
 * These characters can visually reverse or reorder displayed text, hiding
 * malicious content from human reviewers while it is processed normally by
 * the underlying system (CVE-2021-42574 "Trojan Source" class).
 *
 * Matches:
 *   - U+200E / U+200F — LEFT-TO-RIGHT MARK / RIGHT-TO-LEFT MARK
 *   - U+202A–U+202E   — LTR/RTL embedding and override characters
 *   - U+2066–U+2069   — Isolate directional characters
 */
export const BIDI_OVERRIDE_PATTERN: RegExp = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

// ─── Built-in Cedar-style rules ───────────────────────────────────────────────

/**
 * Built-in Cedar-style typed-field rules applied by every
 * `AgentObfuscationDetector` instance.
 *
 * Evaluation is ordered but exhaustive: all matching rules contribute
 * violations. The `oversized_value` rule (OBF-004) is constructed at init
 * time from the configurable `maxStringLength` option and is not listed here.
 */
export const BUILT_IN_CEDAR_RULES: ReadonlyArray<CedarFieldRule> = [
  {
    id: 'OBF-001',
    description: 'Null bytes are forbidden in string parameters.',
    field: '*',
    when: (v) => typeof v === 'string' && v.includes('\0'),
    effect: 'forbid',
    kind: 'null_byte',
    risk: 'critical',
  },
  {
    id: 'OBF-002',
    description: 'Non-printable control characters are forbidden in string parameters.',
    field: '*',
    when: (v) => typeof v === 'string' && CONTROL_CHAR_PATTERN.test(v),
    effect: 'forbid',
    kind: 'control_chars',
    risk: 'high',
  },
  {
    id: 'OBF-003',
    description:
      'Unicode bidirectional text override characters are forbidden ' +
      '(encoding obfuscation / Trojan Source).',
    field: '*',
    when: (v) => typeof v === 'string' && BIDI_OVERRIDE_PATTERN.test(v),
    effect: 'forbid',
    kind: 'encoding_pattern',
    risk: 'high',
  },
];

// ─── Internal helper ──────────────────────────────────────────────────────────

/**
 * Returns `true` when `value`'s runtime type conforms to the JSON Schema
 * `declaredType` string. Returns `true` for unknown/unrecognised types to
 * avoid false positives.
 */
function typeConforms(value: unknown, declaredType: string): boolean {
  switch (declaredType) {
    case 'string':  return typeof value === 'string';
    case 'number':  return typeof value === 'number';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null':    return value === null;
    case 'array':   return Array.isArray(value);
    case 'object':  return (
      typeof value === 'object' && value !== null && !Array.isArray(value)
    );
    default:        return true; // unrecognised type — do not flag
  }
}

// ─── AgentObfuscationDetector ─────────────────────────────────────────────────

/**
 * Detects obfuscation attempts in MCP tool call parameters.
 *
 * Uses strict JSON schema validation (F-05) and Cedar-style typed field
 * rules to identify and block suspicious tool calls before execution.
 *
 * @example
 * ```ts
 * const detector = new AgentObfuscationDetector();
 *
 * const schema: JsonSchemaObject = {
 *   type: 'object',
 *   properties: { path: { type: 'string' } },
 *   additionalProperties: false,
 * };
 *
 * // Clean call — passes
 * const clean = detector.detect('read_file', { path: '/etc/hosts' }, schema);
 * // clean.blocked === false
 *
 * // Extra property injection — blocked
 * const injected = detector.detect(
 *   'read_file',
 *   { path: '/etc/hosts', __proto__: { admin: true } },
 *   schema,
 * );
 * // injected.blocked === true
 * // injected.violations[0].kind === 'extra_properties'
 * // injected.violations[1].kind === 'prototype_pollution'
 * ```
 */
export class AgentObfuscationDetector {
  private readonly rules: ReadonlyArray<CedarFieldRule>;
  private readonly maxStringLength: number;

  constructor(options: AgentObfuscationDetectorOptions = {}) {
    this.maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;

    // OBF-004: oversized_value rule — constructed here to capture maxStringLength
    const oversizedRule: CedarFieldRule = {
      id: 'OBF-004',
      description: `String values exceeding ${this.maxStringLength} characters are blocked.`,
      field: '*',
      when: (v) => typeof v === 'string' && v.length > this.maxStringLength,
      effect: 'forbid',
      kind: 'oversized_value',
      risk: 'high',
    };

    this.rules = [
      ...BUILT_IN_CEDAR_RULES,
      oversizedRule,
      ...(options.additionalRules ?? []),
    ];
  }

  /**
   * Inspects a tool call for obfuscation attempts.
   *
   * Evaluation order:
   *   1. Schema strictness (F-05) — `additionalProperties: false` required.
   *   2. Extra properties — no keys outside `schema.properties`.
   *   3. Prototype-pollution keys — no keys in {@link PROTOTYPE_POLLUTION_KEYS}.
   *   4. Cedar typed-field rules — applied to every (key, value) pair.
   *   5. Type conformance — values must match their declared schema type.
   *
   * Steps 2–5 are exhaustive: all violations are collected and returned.
   * Step 1 causes an early return when the schema itself is non-conforming
   * because property-level checks are unsafe without a verified schema.
   *
   * @param toolName  Name of the tool being called (included in messages).
   * @param params    Raw tool call parameter record.
   * @param schema    The tool's F-05 params schema (from the tool manifest).
   * @returns         Detection result with `blocked` flag and violation list.
   */
  detect(
    toolName: string,
    params: Record<string, unknown>,
    schema: JsonSchemaObject,
  ): ObfuscationDetectionResult {
    const violations: ObfuscationViolation[] = [];

    // ── 1. Schema strictness (F-05) ──────────────────────────────────────────

    if (!Value.Check(TStrictParamsSchema, schema)) {
      violations.push({
        kind: 'schema_missing_strict',
        field: 'schema',
        message:
          `Tool "${toolName}": schema must declare type "object", a properties map, ` +
          `and additionalProperties: false (F-05 requirement).`,
        risk: 'high',
      });
      // Property-level checks require a verified strict schema — exit early.
      return { blocked: true, violations };
    }

    const strictSchema = schema as unknown as StrictParamsSchema;
    const declaredProperties = strictSchema.properties;

    // ── 2. Extra properties ───────────────────────────────────────────────────

    for (const key of Object.keys(params)) {
      if (!Object.prototype.hasOwnProperty.call(declaredProperties, key)) {
        violations.push({
          kind: 'extra_properties',
          field: key,
          message:
            `Tool "${toolName}": unexpected parameter "${key}" is not declared ` +
            `in the schema (additionalProperties: false).`,
          risk: 'high',
        });
      }
    }

    // ── 3. Prototype-pollution keys ───────────────────────────────────────────

    for (const key of Object.keys(params)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
        violations.push({
          kind: 'prototype_pollution',
          field: key,
          message:
            `Tool "${toolName}": parameter key "${key}" is a known prototype-pollution ` +
            `vector and is always forbidden (OBF-PP).`,
          risk: 'critical',
        });
      }
    }

    // ── 4. Cedar typed-field rules ────────────────────────────────────────────

    for (const [key, val] of Object.entries(params)) {
      for (const rule of this.rules) {
        if (rule.field !== '*' && rule.field !== key) continue;
        if (rule.when(val)) {
          violations.push({
            kind: rule.kind,
            field: key,
            message: `[${rule.id}] Tool "${toolName}", field "${key}": ${rule.description}`,
            risk: rule.risk,
          });
        }
      }
    }

    // ── 5. Type conformance ───────────────────────────────────────────────────

    for (const [key, val] of Object.entries(params)) {
      const propSchema = declaredProperties[key];
      if (typeof propSchema !== 'object' || propSchema === null) continue;
      const declaredType = (propSchema as Record<string, unknown>)['type'];
      if (typeof declaredType !== 'string') continue;

      if (!typeConforms(val, declaredType)) {
        const actualType = Array.isArray(val)
          ? 'array'
          : val === null
          ? 'null'
          : typeof val;
        violations.push({
          kind: 'type_confusion',
          field: key,
          message:
            `[OBF-TC] Tool "${toolName}", field "${key}": declared type is ` +
            `"${declaredType}" but received "${actualType}".`,
          risk: 'high',
        });
      }
    }

    return {
      blocked: violations.length > 0,
      violations,
    };
  }
}

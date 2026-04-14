import { writeFile } from 'node:fs/promises';
import type { Rule } from './types.js';
import allRules from './rules.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single rule serialized to a JSON-safe representation.
 *
 * Because {@link Rule} may carry a `condition` function and a `RegExp` match,
 * neither of which survive JSON round-tripping, this interface replaces them
 * with JSON-safe equivalents:
 * - `match` is the string source (for RegExp patterns) or the original string.
 * - `matchIsRegExp` signals whether the original `match` was a RegExp.
 * - `hasCondition` signals whether the original rule carried a condition function.
 */
export interface ExportedRule {
  effect: 'permit' | 'forbid';
  resource?: string;
  match?: string;
  matchIsRegExp: boolean;
  hasCondition: boolean;
  reason?: string;
  tags?: string[];
  rateLimit?: { maxCalls: number; windowSeconds: number };
  action_class?: string;
  priority?: number;
}

/**
 * The complete manifest written to `builtin-rules.json`.
 * Consumers should treat this as a read-only snapshot; rules with
 * `hasCondition: true` cannot be faithfully reconstructed from JSON alone.
 */
export interface BuiltinRulesManifest {
  /** Schema version of this manifest format. Currently `'1.0.0'`. */
  schemaVersion: string;
  /** ISO 8601 timestamp when this manifest was generated. */
  generatedAt: string;
  /** Total number of rules in the manifest (equals `rules.length`). */
  ruleCount: number;
  /** All built-in rules (default + per-agent overrides) in evaluation order. */
  rules: ExportedRule[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serializeRule(rule: Rule): ExportedRule {
  const isRegExp = rule.match instanceof RegExp;
  const exported: ExportedRule = {
    effect: rule.effect,
    ...(rule.resource !== undefined ? { resource: rule.resource } : {}),
    ...(rule.match !== undefined ? { match: isRegExp ? (rule.match as RegExp).source : (rule.match as string) } : {}),
    matchIsRegExp: isRegExp,
    hasCondition: typeof rule.condition === 'function',
  };

  if (rule.reason !== undefined) exported.reason = rule.reason;
  if (rule.tags !== undefined) exported.tags = rule.tags;
  if (rule.rateLimit !== undefined) exported.rateLimit = rule.rateLimit;
  if (rule.action_class !== undefined) exported.action_class = rule.action_class;
  if (rule.priority !== undefined) exported.priority = rule.priority;

  return exported;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Builds a {@link BuiltinRulesManifest} from the merged set of built-in rules
 * (default + all per-agent overrides).
 *
 * The returned object is fully JSON-serializable. Rules that carry condition
 * functions or RegExp patterns are represented faithfully via the `hasCondition`
 * and `matchIsRegExp` flags so downstream consumers can handle them correctly.
 *
 * @returns A snapshot manifest ready for `JSON.stringify`.
 */
export function exportBuiltinRules(): BuiltinRulesManifest {
  const rules = allRules.map(serializeRule);
  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    ruleCount: rules.length,
    rules,
  };
}

/**
 * Calls {@link exportBuiltinRules} and writes the resulting JSON to
 * `outputPath` (pretty-printed, 2-space indent).
 *
 * @param outputPath Absolute or relative path for the output file.
 *                   The file is created or overwritten.
 */
export async function writeBuiltinRulesJson(outputPath: string): Promise<void> {
  const manifest = exportBuiltinRules();
  await writeFile(outputPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

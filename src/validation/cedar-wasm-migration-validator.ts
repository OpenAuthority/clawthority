/**
 * Cedar-WASM migration scope validator.
 *
 * Provides `validateCedarWasmMigrationScope` — a pure function that scans
 * source code for patterns indicating Cedar-WASM migration work. Such work
 * belongs exclusively on the `spike-implement-cedar-via-wasm` branch and must
 * not appear in main; see docs/roadmap.md §Future for the planned migration
 * timeline.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Out-of-scope categories detected by the Cedar-WASM migration validator. */
export type CedarWasmCategory = 'branch-reference' | 'wasm-migration';

/** A single scope violation detected in source code. */
export interface CedarWasmViolation {
  /** The category that was detected. */
  category: CedarWasmCategory;
  /** Human-readable description of the violation. */
  message: string;
  /** The matched substring that triggered the violation. */
  match: string;
  /** 1-based line number where the match begins. */
  line: number;
}

/** Result returned by `validateCedarWasmMigrationScope`. */
export interface CedarWasmValidationResult {
  /** `true` when no Cedar-WASM migration patterns are detected. */
  valid: boolean;
  /** Ordered list of violations. Empty when `valid` is `true`. */
  violations: CedarWasmViolation[];
}

// ─── Pattern tables ───────────────────────────────────────────────────────────

interface MigrationPattern {
  pattern: RegExp;
  label: string;
}

/**
 * Patterns that reference the Cedar-WASM migration spike branch.
 *
 * Any reference to `spike-implement-cedar-via-wasm` in source code indicates
 * work that belongs on the spike branch, not main. See docs/roadmap.md §Future
 * for the planned migration timeline.
 */
const BRANCH_REFERENCE_PATTERNS: ReadonlyArray<MigrationPattern> = [
  {
    pattern: /spike[_-]?implement[_-]?cedar[_-]?via[_-]?wasm/i,
    label: 'spike-implement-cedar-via-wasm branch reference',
  },
  {
    pattern: /implement[_-]?cedar[_-]?via[_-]?wasm/i,
    label: 'cedar-via-wasm branch reference',
  },
];

/**
 * Patterns that indicate a Cedar-WASM migration implementation.
 *
 * Migration work introduces new WASM-based evaluation engines or wrappers to
 * replace the current Cedar policy engine. Such patterns should only appear on
 * the `spike-implement-cedar-via-wasm` branch; see docs/roadmap.md §Future.
 * Does NOT match the existing `@cedar-policy/cedar-wasm` package usage or
 * normal Cedar evaluation already in the codebase.
 */
const WASM_MIGRATION_PATTERNS: ReadonlyArray<MigrationPattern> = [
  { pattern: /\bwasm[_-]?migration\b/i, label: 'WASM migration reference' },
  {
    pattern: /\bcedar[_-]?wasm[_-]?migrat/i,
    label: 'Cedar-WASM migration implementation',
  },
  { pattern: /\bmigrateToWasm\b/i, label: 'migrate-to-WASM function' },
  { pattern: /\bwasm[_-]?evaluator\b/i, label: 'WASM evaluator class' },
  {
    pattern: /\bcedar[_-]?wasm[_-]?engine\b/i,
    label: 'Cedar-WASM engine identifier',
  },
  {
    pattern: /\bwasm[_-]?authori[sz]/i,
    label: 'WASM authorization implementation',
  },
];

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Scans source code for patterns that indicate Cedar-WASM migration work.
 *
 * Checks `source` against two sets of patterns (branch-reference,
 * wasm-migration) and collects a violation for each match found. Migration
 * work belongs on the `spike-implement-cedar-via-wasm` branch, not main.
 * Each violation includes the 1-based line number of the match and a message
 * referencing docs/roadmap.md §Future and proper branch usage.
 *
 * @param source  Raw source code string to scan.
 * @returns       A result with `valid` flag and any `violations`.
 */
export function validateCedarWasmMigrationScope(
  source: string,
): CedarWasmValidationResult {
  const violations: CedarWasmViolation[] = [];

  collectViolations(source, 'branch-reference', BRANCH_REFERENCE_PATTERNS, violations);
  collectViolations(source, 'wasm-migration', WASM_MIGRATION_PATTERNS, violations);

  return { valid: violations.length === 0, violations };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function collectViolations(
  source: string,
  category: CedarWasmCategory,
  patterns: ReadonlyArray<MigrationPattern>,
  out: CedarWasmViolation[],
): void {
  for (const { pattern, label } of patterns) {
    const globalPattern = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g',
    );
    let m: RegExpExecArray | null;
    while ((m = globalPattern.exec(source)) !== null) {
      out.push({
        category,
        message: `Out-of-scope Cedar-WASM migration pattern detected: ${label}. Use the spike-implement-cedar-via-wasm branch for this work. See docs/roadmap.md §Future.`,
        match: m[0],
        line: lineOf(source, m.index),
      });
    }
  }
}

/** Returns the 1-based line number of the character at `index` in `source`. */
function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

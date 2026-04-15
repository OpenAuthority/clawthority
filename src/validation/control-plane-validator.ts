/**
 * Multi-tenant control plane scope validator.
 *
 * Provides `validateControlPlaneScope` — a pure function that scans source
 * code for patterns indicating a multi-tenant or control plane implementation.
 * Both are out of scope for the current project; see the "Future" section of
 * docs/roadmap.md for when these features are planned.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Out-of-scope categories detected by the control plane validator. */
export type ControlPlaneCategory = 'multi-tenant' | 'control-plane';

/** A single scope violation detected in source code. */
export interface ControlPlaneViolation {
  /** The category that was detected. */
  category: ControlPlaneCategory;
  /** Human-readable description of the violation. */
  message: string;
  /** The matched substring that triggered the violation. */
  match: string;
  /** 1-based line number where the match begins. */
  line: number;
}

/** Result returned by `validateControlPlaneScope`. */
export interface ControlPlaneValidationResult {
  /** `true` when no multi-tenant or control plane patterns are detected. */
  valid: boolean;
  /** Ordered list of violations. Empty when `valid` is `true`. */
  violations: ControlPlaneViolation[];
}

// ─── Pattern tables ───────────────────────────────────────────────────────────

interface CategoryPattern {
  pattern: RegExp;
  label: string;
}

/**
 * Patterns that indicate a multi-tenant implementation.
 *
 * Multi-tenant features are planned for a future Control Plane API
 * (see docs/roadmap.md §Future). Matches constructs that introduce
 * per-tenant isolation, tenant management, or tenancy-aware logic.
 */
const MULTI_TENANT_PATTERNS: ReadonlyArray<CategoryPattern> = [
  { pattern: /\bmulti[_-]?tenant/i, label: 'multi-tenant identifier' },
  {
    pattern: /\btenant[_-]?(?:id|manager|service|repo(?:sitory)?|store|isolation|aware|context|schema|config|namespace)\b/i,
    label: 'tenant-scoped construct',
  },
  { pattern: /\bper[_-]?tenant\b/i, label: 'per-tenant pattern' },
  { pattern: /\btenancy\b/i, label: 'tenancy reference' },
];

/**
 * Patterns that indicate a control plane implementation.
 *
 * Control plane features (policy CRUD API, database-backed storage,
 * centralized audit log aggregation) are planned for a future release
 * (see docs/roadmap.md §Future).
 */
const CONTROL_PLANE_PATTERNS: ReadonlyArray<CategoryPattern> = [
  { pattern: /\bcontrol[_-]?plane\b/i, label: 'control-plane reference' },
  {
    pattern: /\bpolicy[_-]?management[_-]?(?:service|api|server)\b/i,
    label: 'policy management service/API',
  },
  { pattern: /\bpolicy[_-]?crud\b/i, label: 'policy CRUD reference' },
  {
    pattern: /\bprogrammatic[_-]?policy\b/i,
    label: 'programmatic policy management',
  },
  { pattern: /\bcentralized[_-]?audit\b/i, label: 'centralized audit log' },
  { pattern: /\baudit[_-]?aggregat/i, label: 'audit log aggregation' },
];

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Scans source code for patterns that would implement multi-tenant or control
 * plane features.
 *
 * Checks `source` against two sets of patterns (multi-tenant, control-plane)
 * and collects a violation for each match found. Each violation includes the
 * 1-based line number of the match and a message referencing docs/roadmap.md.
 *
 * @param source  Raw source code string to scan.
 * @returns       A result with `valid` flag and any `violations`.
 */
export function validateControlPlaneScope(
  source: string,
): ControlPlaneValidationResult {
  const violations: ControlPlaneViolation[] = [];

  collectViolations(source, 'multi-tenant', MULTI_TENANT_PATTERNS, violations);
  collectViolations(source, 'control-plane', CONTROL_PLANE_PATTERNS, violations);

  return { valid: violations.length === 0, violations };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function collectViolations(
  source: string,
  category: ControlPlaneCategory,
  patterns: ReadonlyArray<CategoryPattern>,
  out: ControlPlaneViolation[],
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
        message: `Out-of-scope ${category} pattern detected: ${label}. See docs/roadmap.md §Future.`,
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

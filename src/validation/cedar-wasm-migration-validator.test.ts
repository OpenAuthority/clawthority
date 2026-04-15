/**
 * validateCedarWasmMigrationScope — test suite
 *
 * Covers all acceptance criteria for the Cedar-WASM migration scope validator:
 *   TC-CWM-01: Detects spike-implement-cedar-via-wasm branch references
 *   TC-CWM-02: Identifies WASM migration implementation patterns
 *   TC-CWM-03: Returns violations with specific line numbers
 *   TC-CWM-04: Violation messages reference docs/roadmap.md §Future and branch guidance
 *   TC-CWM-05: Does not flag legitimate in-scope code
 */

import { describe, it, expect } from 'vitest';
import {
  validateCedarWasmMigrationScope,
} from './cedar-wasm-migration-validator.js';
import type {
  CedarWasmValidationResult,
} from './cedar-wasm-migration-validator.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function clean(): CedarWasmValidationResult {
  return { valid: true, violations: [] };
}

// ─── TC-CWM-01: Branch reference detection ───────────────────────────────────

describe('TC-CWM-01: branch reference detection', () => {
  it('flags spike-implement-cedar-via-wasm branch name in a comment', () => {
    const result = validateCedarWasmMigrationScope(
      '// See spike-implement-cedar-via-wasm for this feature',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('branch-reference');
  });

  it('flags spike_implement_cedar_via_wasm (snake_case variant)', () => {
    const result = validateCedarWasmMigrationScope(
      '// branch: spike_implement_cedar_via_wasm',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('branch-reference');
  });

  it('flags implement-cedar-via-wasm branch reference in a string', () => {
    const result = validateCedarWasmMigrationScope(
      'const branch = "implement-cedar-via-wasm";',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('branch-reference');
  });

  it('flags implementCedarViaWasm (camelCase variant)', () => {
    const result = validateCedarWasmMigrationScope(
      '// tracked on implementCedarViaWasm spike',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('branch-reference');
  });

  it('reports branch-reference category for all branch patterns', () => {
    const result = validateCedarWasmMigrationScope(
      '// spike-implement-cedar-via-wasm\n// implement-cedar-via-wasm',
    );
    const categories = result.violations.map((v) => v.category);
    expect(categories.every((c) => c === 'branch-reference')).toBe(true);
  });
});

// ─── TC-CWM-02: WASM migration pattern detection ──────────────────────────────

describe('TC-CWM-02: WASM migration pattern detection', () => {
  it('flags wasmMigration identifier (camelCase)', () => {
    const result = validateCedarWasmMigrationScope('const wasmMigration = {};');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('wasm-migration');
  });

  it('flags wasm_migration identifier (snake_case)', () => {
    const result = validateCedarWasmMigrationScope('const wasm_migration = true;');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('wasm-migration');
  });

  it('flags cedarWasmMigration identifier (camelCase)', () => {
    const result = validateCedarWasmMigrationScope(
      'class CedarWasmMigration {}',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('wasm-migration');
  });

  it('flags migrateToWasm function reference', () => {
    const result = validateCedarWasmMigrationScope(
      'async function migrateToWasm() {}',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('wasm-migration');
  });

  it('flags WasmEvaluator class reference', () => {
    const result = validateCedarWasmMigrationScope(
      'const evaluator = new WasmEvaluator(config);',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('wasm-migration');
  });

  it('flags cedarWasmEngine identifier', () => {
    const result = validateCedarWasmMigrationScope(
      'const cedarWasmEngine = await loadEngine();',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('wasm-migration');
  });

  it('flags cedar_wasm_engine identifier (snake_case)', () => {
    const result = validateCedarWasmMigrationScope(
      'const cedar_wasm_engine = init();',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('wasm-migration');
  });

  it('flags wasmAuthorize function reference', () => {
    const result = validateCedarWasmMigrationScope(
      'const result = wasmAuthorize(req, entities, policies);',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('wasm-migration');
  });

  it('flags wasm_authorise (British spelling)', () => {
    const result = validateCedarWasmMigrationScope(
      'function wasm_authorise(request) {}',
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('wasm-migration');
  });
});

// ─── TC-CWM-03: Violations include specific line numbers ──────────────────────

describe('TC-CWM-03: violations include specific line numbers', () => {
  it('reports line 1 for a match on the first line', () => {
    const result = validateCedarWasmMigrationScope(
      '// spike-implement-cedar-via-wasm',
    );
    expect(result.violations[0]!.line).toBe(1);
  });

  it('reports line 2 for a match on the second line', () => {
    const source = 'const x = 1;\nconst wasmMigration = {};';
    const result = validateCedarWasmMigrationScope(source);
    expect(result.violations[0]!.line).toBe(2);
  });

  it('reports line 3 for a match on the third line', () => {
    const source = 'const a = 1;\nconst b = 2;\nconst cedarWasmEngine = init();';
    const result = validateCedarWasmMigrationScope(source);
    expect(result.violations[0]!.line).toBe(3);
  });

  it('reports correct lines when violations span different lines', () => {
    const source =
      '// spike-implement-cedar-via-wasm\nconst x = 2;\nconst wasmMigration = {};';
    const result = validateCedarWasmMigrationScope(source);
    const lines = result.violations.map((v) => v.line);
    expect(lines).toContain(1);
    expect(lines).toContain(3);
  });

  it('exposes the matched source substring in the violation', () => {
    const source = 'const cedarWasmEngine = init();';
    const { violations } = validateCedarWasmMigrationScope(source);
    expect(violations[0]!.match).toBeTruthy();
    expect(source).toContain(violations[0]!.match);
  });
});

// ─── TC-CWM-04: Violation messages reference roadmap and branch guidance ──────

describe('TC-CWM-04: violation messages reference docs/roadmap.md §Future and branch guidance', () => {
  it('branch-reference violation message references docs/roadmap.md §Future', () => {
    const { violations } = validateCedarWasmMigrationScope(
      '// spike-implement-cedar-via-wasm',
    );
    expect(violations[0]!.message).toContain('docs/roadmap.md §Future');
  });

  it('wasm-migration violation message references docs/roadmap.md §Future', () => {
    const { violations } = validateCedarWasmMigrationScope(
      'const wasmMigration = {};',
    );
    expect(violations[0]!.message).toContain('docs/roadmap.md §Future');
  });

  it('violation message references the spike-implement-cedar-via-wasm branch', () => {
    const { violations } = validateCedarWasmMigrationScope(
      'const wasmMigration = {};',
    );
    expect(violations[0]!.message).toContain('spike-implement-cedar-via-wasm');
  });

  it('violation message includes a human-readable label', () => {
    const { violations } = validateCedarWasmMigrationScope(
      'const cedarWasmEngine = init();',
    );
    expect(violations[0]!.message.length).toBeGreaterThan(30);
  });

  it('returns multiple violations when multiple patterns match', () => {
    const source =
      '// spike-implement-cedar-via-wasm\nconst wasmMigration = {};';
    const { violations } = validateCedarWasmMigrationScope(source);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    const categories = violations.map((v) => v.category);
    expect(categories).toContain('branch-reference');
    expect(categories).toContain('wasm-migration');
  });
});

// ─── TC-CWM-05: Legitimate in-scope code is not flagged ──────────────────────

describe('TC-CWM-05: legitimate in-scope code is not flagged', () => {
  it('returns valid:true and empty violations for clean source', () => {
    const result = validateCedarWasmMigrationScope('const x = 42;');
    expect(result).toEqual(clean());
  });

  it('returns valid:true for empty string', () => {
    const result = validateCedarWasmMigrationScope('');
    expect(result).toEqual(clean());
  });

  it('does not flag the existing Cedar engine evaluation call', () => {
    const result = validateCedarWasmMigrationScope(
      'const decision = cedarEngine.isAuthorized(request, entities, policies);',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag a dynamic import of the @cedar-policy/cedar-wasm package', () => {
    const result = validateCedarWasmMigrationScope(
      "const { isAuthorized } = await import('@cedar-policy/cedar-wasm/nodejs');",
    );
    expect(result).toEqual(clean());
  });

  it('does not flag the cedar-wasm package name in a package.json reference', () => {
    const result = validateCedarWasmMigrationScope(
      '"@cedar-policy/cedar-wasm": "^4.9.1"',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag policy file loading from YAML', () => {
    const result = validateCedarWasmMigrationScope(
      'const policies = loadPoliciesFromYaml(configPath);',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag the ApprovalManager or HitlDecision types', () => {
    const result = validateCedarWasmMigrationScope(
      'const mgr = new ApprovalManager();\nexport type HitlDecision = "approved" | "denied";',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag a CedarEngine class that does not reference WASM migration', () => {
    const result = validateCedarWasmMigrationScope(
      'class CedarEngine { evaluate(req: Request) {} }',
    );
    expect(result).toEqual(clean());
  });
});

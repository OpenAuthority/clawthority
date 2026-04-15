/**
 * validateControlPlaneScope — test suite
 *
 * Covers all acceptance criteria for the multi-tenant control plane scope
 * validator:
 *   TC-MTC-01: Detects multi-tenant patterns in code
 *   TC-MTC-02: Identifies control plane terminology usage
 *   TC-MTC-03: Returns violations with specific locations (line numbers)
 *   TC-MTC-04: Violation messages reference docs/roadmap.md §Future
 *   TC-MTC-05: Does not flag legitimate in-scope code
 */

import { describe, it, expect } from 'vitest';
import {
  validateControlPlaneScope,
} from './control-plane-validator.js';
import type {
  ControlPlaneValidationResult,
} from './control-plane-validator.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function clean(): ControlPlaneValidationResult {
  return { valid: true, violations: [] };
}

// ─── TC-MTC-01: Multi-tenant pattern detection ────────────────────────────────

describe('TC-MTC-01: multi-tenant pattern detection', () => {
  it('flags multiTenant identifier (camelCase)', () => {
    const result = validateControlPlaneScope('const multiTenant = true;');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });

  it('flags multi-tenant identifier (kebab-case in string)', () => {
    const result = validateControlPlaneScope('const mode = "multi-tenant";');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });

  it('flags multi_tenant identifier (snake_case)', () => {
    const result = validateControlPlaneScope('const multi_tenant = {};');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });

  it('flags tenantId field', () => {
    const result = validateControlPlaneScope('const tenantId = uuid();');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });

  it('flags tenant_id field (snake_case)', () => {
    const result = validateControlPlaneScope('record.tenant_id = ctx.id;');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });

  it('flags TenantManager class reference', () => {
    const result = validateControlPlaneScope('new TenantManager(config)');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });

  it('flags TenantService class reference', () => {
    const result = validateControlPlaneScope('class TenantService {}');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });

  it('flags tenantIsolation construct', () => {
    const result = validateControlPlaneScope('config.tenantIsolation = true;');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });

  it('flags per-tenant pattern', () => {
    const result = validateControlPlaneScope('// per-tenant rate limits');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });

  it('flags perTenant pattern (camelCase)', () => {
    const result = validateControlPlaneScope('const perTenant = {};');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });

  it('flags tenancy reference', () => {
    const result = validateControlPlaneScope('// supports multi-tenancy via tenancy model');
    expect(result.valid).toBe(false);
    const categories = result.violations.map((v) => v.category);
    expect(categories).toContain('multi-tenant');
  });

  it('flags tenantSchema reference', () => {
    const result = validateControlPlaneScope('const tenantSchema = buildSchema();');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('multi-tenant');
  });
});

// ─── TC-MTC-02: Control plane terminology detection ───────────────────────────

describe('TC-MTC-02: control plane terminology detection', () => {
  it('flags controlPlane identifier (camelCase)', () => {
    const result = validateControlPlaneScope('const controlPlane = new ControlPlane();');
    expect(result.valid).toBe(false);
    const categories = result.violations.map((v) => v.category);
    expect(categories).toContain('control-plane');
  });

  it('flags control_plane identifier (snake_case)', () => {
    const result = validateControlPlaneScope('type: "control_plane"');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('control-plane');
  });

  it('flags control-plane identifier (kebab in string)', () => {
    const result = validateControlPlaneScope('const mode = "control-plane";');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('control-plane');
  });

  it('flags policyManagementService reference', () => {
    const result = validateControlPlaneScope('const svc = new PolicyManagementService();');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('control-plane');
  });

  it('flags policy_management_api reference (snake_case)', () => {
    const result = validateControlPlaneScope('const url = policy_management_api + "/v1";');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('control-plane');
  });

  it('flags policyCrud reference', () => {
    const result = validateControlPlaneScope('// policyCrud endpoints');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('control-plane');
  });

  it('flags policy_crud reference (snake_case)', () => {
    const result = validateControlPlaneScope('router.use("/policy_crud", handler);');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('control-plane');
  });

  it('flags programmaticPolicy reference', () => {
    const result = validateControlPlaneScope('// programmaticPolicy management');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('control-plane');
  });

  it('flags centralizedAudit reference', () => {
    const result = validateControlPlaneScope('const log = centralizedAudit.write(e);');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('control-plane');
  });

  it('flags auditAggregation reference', () => {
    const result = validateControlPlaneScope('const agg = new AuditAggregation();');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('control-plane');
  });

  it('flags audit_aggregator reference (snake_case)', () => {
    const result = validateControlPlaneScope('const a = audit_aggregator.flush();');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.category).toBe('control-plane');
  });
});

// ─── TC-MTC-03: Violations include specific locations ─────────────────────────

describe('TC-MTC-03: violations include specific line numbers', () => {
  it('reports line 1 for a match on the first line', () => {
    const result = validateControlPlaneScope('const controlPlane = {};');
    expect(result.violations[0]!.line).toBe(1);
  });

  it('reports line 2 for a match on the second line', () => {
    const source = 'const x = 1;\nconst controlPlane = {};';
    const result = validateControlPlaneScope(source);
    expect(result.violations[0]!.line).toBe(2);
  });

  it('reports line 3 for a match on the third line', () => {
    const source = 'const a = 1;\nconst b = 2;\nconst tenantId = uuid();';
    const result = validateControlPlaneScope(source);
    expect(result.violations[0]!.line).toBe(3);
  });

  it('reports correct line when multiple violations span different lines', () => {
    const source = 'const tenantId = x;\nconst y = 2;\nconst controlPlane = {};';
    const result = validateControlPlaneScope(source);
    const lines = result.violations.map((v) => v.line);
    expect(lines).toContain(1);
    expect(lines).toContain(3);
  });

  it('exposes the matched source substring', () => {
    const source = 'const controlPlane = {};';
    const { violations } = validateControlPlaneScope(source);
    expect(violations[0]!.match).toBeTruthy();
    expect(source).toContain(violations[0]!.match);
  });
});

// ─── TC-MTC-04: Violation messages reference roadmap.md §Future ───────────────

describe('TC-MTC-04: violation messages reference roadmap.md §Future', () => {
  it('multi-tenant violation message references docs/roadmap.md', () => {
    const { violations } = validateControlPlaneScope('const tenantId = x;');
    expect(violations[0]!.message).toContain('docs/roadmap.md');
  });

  it('multi-tenant violation message references §Future', () => {
    const { violations } = validateControlPlaneScope('const tenantId = x;');
    expect(violations[0]!.message).toContain('Future');
  });

  it('control-plane violation message references docs/roadmap.md', () => {
    const { violations } = validateControlPlaneScope('const controlPlane = {};');
    expect(violations[0]!.message).toContain('docs/roadmap.md');
  });

  it('control-plane violation message references §Future', () => {
    const { violations } = validateControlPlaneScope('const controlPlane = {};');
    expect(violations[0]!.message).toContain('Future');
  });

  it('violation message includes a human-readable label', () => {
    const { violations } = validateControlPlaneScope('const controlPlane = {};');
    expect(violations[0]!.message.length).toBeGreaterThan(20);
  });

  it('returns multiple violations when multiple patterns match', () => {
    const source = 'const tenantId = x;\nconst controlPlane = {};';
    const { violations } = validateControlPlaneScope(source);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    const categories = violations.map((v) => v.category);
    expect(categories).toContain('multi-tenant');
    expect(categories).toContain('control-plane');
  });
});

// ─── TC-MTC-05: Legitimate in-scope code is not flagged ──────────────────────

describe('TC-MTC-05: legitimate in-scope code is not flagged', () => {
  it('returns valid:true and empty violations for clean source', () => {
    const result = validateControlPlaneScope('const x = 42;');
    expect(result).toEqual(clean());
  });

  it('returns valid:true for empty string', () => {
    const result = validateControlPlaneScope('');
    expect(result).toEqual(clean());
  });

  it('does not flag the policy engine Cedar evaluation', () => {
    const result = validateControlPlaneScope(
      'const decision = cedarEngine.isAuthorized(request, entities, policies);',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag ApprovalManager', () => {
    const result = validateControlPlaneScope(
      'const mgr = new ApprovalManager(); mgr.createApproval(opts);',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag policy file loading', () => {
    const result = validateControlPlaneScope(
      'const policies = loadPoliciesFromYaml(configPath);',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag the hot-reload watcher', () => {
    const result = validateControlPlaneScope(
      'chokidar.watch(policyDir).on("change", reloadPolicies);',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag HitlDecision type', () => {
    const result = validateControlPlaneScope(
      'export type HitlDecision = "approved" | "denied" | "expired";',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag rate limit policy rule fields', () => {
    const result = validateControlPlaneScope(
      'const rule = { effect: "permit", rate_limit: { max: 10, window: 60 } };',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag audit log writes for the local single-tenant audit trail', () => {
    // "audit_log" alone (no "centralized" prefix, no "aggregat") is in-scope.
    const result = validateControlPlaneScope(
      'auditLog.write({ action, principal, resource, decision });',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag the dashboard server (Express app reference)', () => {
    const result = validateControlPlaneScope(
      'app.get("/dashboard", dashboardHandler);',
    );
    expect(result).toEqual(clean());
  });
});

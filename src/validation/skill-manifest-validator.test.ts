/**
 * Skill manifest validator tests.
 *
 * Verifies that `validateToolManifest` correctly enforces the F-05 schema,
 * that `SkillManifestValidator` enforces registry-aware constraints, and that
 * all first-party tool manifests satisfy both validators (TC-SMV-Contract).
 *
 * Test IDs:
 *   TC-SMV-01: Non-object inputs are rejected
 *   TC-SMV-02: Required top-level string fields are validated
 *   TC-SMV-03: params and result JSON Schema objects are validated
 *   TC-SMV-04: A fully valid manifest passes
 *   TC-SMV-05: risk_tier, default_hitl_mode, and params.additionalProperties validation
 *   TC-SMV-06: SkillManifestValidator — action_class registration (E-01)
 *   TC-SMV-07: SkillManifestValidator — exec wrapper detection (E-03)
 *   TC-SMV-08: SkillManifestValidator — risk/HITL alignment with registry (E-05)
 *   TC-SMV-Contract: All first-party tool manifests validate against F-05 and registry rules
 */

import { describe, it, expect } from 'vitest';
import {
  validateToolManifest,
  SkillManifestValidator,
  type ToolManifest,
} from './skill-manifest-validator.js';
import { REGISTRY } from '@openclaw/action-registry';
import { gitAddManifest } from '../tools/git_add/manifest.js';
import { gitLogManifest } from '../tools/git_log/manifest.js';
import { gitDiffManifest } from '../tools/git_diff/manifest.js';
import { gitStatusManifest } from '../tools/git_status/manifest.js';
import { editFileManifest } from '../tools/edit_file/manifest.js';
import { readFileManifest } from '../tools/read_file/manifest.js';
import { writeFileManifest } from '../tools/write_file/manifest.js';
import { listDirManifest } from '../tools/list_dir/manifest.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function validManifest(): ToolManifest {
  return {
    name: 'test-tool',
    version: '1.0.0',
    action_class: 'vcs.write',
    risk_tier: 'medium',
    default_hitl_mode: 'per_request',
    params: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
    result: {
      type: 'object',
      properties: { stagedPaths: { type: 'array' } },
    },
  };
}

// ─── TC-SMV-01: Non-object inputs ────────────────────────────────────────────

describe('TC-SMV-01: non-object inputs are rejected', () => {
  it('rejects null', () => {
    const r = validateToolManifest(null);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rejects a string', () => {
    const r = validateToolManifest('not-an-object');
    expect(r.valid).toBe(false);
  });

  it('rejects a number', () => {
    const r = validateToolManifest(42);
    expect(r.valid).toBe(false);
  });

  it('rejects undefined', () => {
    const r = validateToolManifest(undefined);
    expect(r.valid).toBe(false);
  });
});

// ─── TC-SMV-02: Required string fields ───────────────────────────────────────

describe('TC-SMV-02: required top-level string fields are validated', () => {
  it('rejects missing name', () => {
    const m = { ...validManifest(), name: undefined };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('rejects empty name', () => {
    const m = { ...validManifest(), name: '   ' };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('rejects missing version', () => {
    const m = { ...validManifest(), version: undefined };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('rejects empty action_class', () => {
    const m = { ...validManifest(), action_class: '' };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('action_class'))).toBe(true);
  });

  it('rejects non-string action_class', () => {
    const m = { ...validManifest(), action_class: 123 };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('action_class'))).toBe(true);
  });
});

// ─── TC-SMV-03: params and result schema objects ──────────────────────────────

describe('TC-SMV-03: params and result JSON Schema objects are validated', () => {
  it('rejects params that is null', () => {
    const m = { ...validManifest(), params: null };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('params'))).toBe(true);
  });

  it('rejects params.type that is not "object"', () => {
    const m = { ...validManifest(), params: { type: 'array', properties: {}, additionalProperties: false } };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('params.type'))).toBe(true);
  });

  it('rejects params missing properties', () => {
    const m = { ...validManifest(), params: { type: 'object', additionalProperties: false } };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('params.properties'))).toBe(true);
  });

  it('rejects result.type that is not "object"', () => {
    const m = { ...validManifest(), result: { type: 'string', properties: {} } };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('result.type'))).toBe(true);
  });

  it('rejects result.properties that is an array', () => {
    const m = { ...validManifest(), result: { type: 'object', properties: [] } };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('result.properties'))).toBe(true);
  });

  it('accepts empty properties object with additionalProperties: false in params', () => {
    const m = {
      ...validManifest(),
      params: { type: 'object' as const, properties: {}, additionalProperties: false as const },
      result: { type: 'object' as const, properties: {} },
    };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(true);
  });
});

// ─── TC-SMV-04: valid manifest passes ────────────────────────────────────────

describe('TC-SMV-04: a fully valid manifest passes', () => {
  it('accepts a complete valid manifest', () => {
    const r = validateToolManifest(validManifest());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('errors array is empty when manifest is valid', () => {
    const { errors } = validateToolManifest(validManifest());
    expect(errors).toEqual([]);
  });
});

// ─── TC-SMV-05: risk_tier, default_hitl_mode, params.additionalProperties ─────

describe('TC-SMV-05: risk_tier, default_hitl_mode, and params.additionalProperties validation', () => {
  it('rejects missing risk_tier', () => {
    const m = { ...validManifest(), risk_tier: undefined };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('risk_tier'))).toBe(true);
  });

  it('rejects invalid risk_tier value', () => {
    const m = { ...validManifest(), risk_tier: 'extreme' };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('risk_tier'))).toBe(true);
  });

  it('accepts all valid risk_tier values', () => {
    for (const tier of ['low', 'medium', 'high', 'critical'] as const) {
      const m = { ...validManifest(), risk_tier: tier };
      const r = validateToolManifest(m);
      expect(r.errors.some((e) => e.includes('risk_tier'))).toBe(false);
    }
  });

  it('rejects missing default_hitl_mode', () => {
    const m = { ...validManifest(), default_hitl_mode: undefined };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('default_hitl_mode'))).toBe(true);
  });

  it('rejects invalid default_hitl_mode value', () => {
    const m = { ...validManifest(), default_hitl_mode: 'always' };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('default_hitl_mode'))).toBe(true);
  });

  it('accepts all valid default_hitl_mode values', () => {
    for (const mode of ['none', 'per_request', 'session_approval'] as const) {
      const m = { ...validManifest(), default_hitl_mode: mode };
      const r = validateToolManifest(m);
      expect(r.errors.some((e) => e.includes('default_hitl_mode'))).toBe(false);
    }
  });

  it('rejects params without additionalProperties: false', () => {
    const m = {
      ...validManifest(),
      params: { type: 'object' as const, properties: {} },
    };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('params.additionalProperties'))).toBe(true);
  });

  it('rejects params with additionalProperties: true', () => {
    const m = {
      ...validManifest(),
      params: { type: 'object' as const, properties: {}, additionalProperties: true },
    };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('params.additionalProperties'))).toBe(true);
  });

  it('does not enforce additionalProperties: false on result', () => {
    const m = {
      ...validManifest(),
      result: { type: 'object' as const, properties: {} },
    };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(true);
  });
});

// ─── TC-SMV-06: SkillManifestValidator — action_class registration (E-01) ─────

describe('TC-SMV-06: SkillManifestValidator — action_class registration (E-01)', () => {
  const smv = new SkillManifestValidator();

  it('rejects an unregistered action_class', () => {
    const m = { ...validManifest(), action_class: 'custom.unknown' };
    const r = smv.validate(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('custom.unknown'))).toBe(true);
  });

  it('rejects action_class: shell.exec (E-03)', () => {
    const m = {
      ...validManifest(),
      action_class: 'shell.exec',
      risk_tier: 'high' as const,
      default_hitl_mode: 'per_request' as const,
    };
    const r = smv.validate(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('shell.exec'))).toBe(true);
  });

  it('accepts all registered action_class values except shell.exec', () => {
    for (const entry of REGISTRY) {
      if (entry.action_class === 'shell.exec') continue;
      const m = {
        ...validManifest(),
        action_class: entry.action_class,
        risk_tier: entry.default_risk,
        default_hitl_mode: entry.default_hitl_mode,
      };
      const r = smv.validate(m);
      expect(
        r.errors.some((e) => e.includes('not a registered action class')),
        `Expected ${entry.action_class} to be accepted: ${JSON.stringify(r.errors)}`,
      ).toBe(false);
    }
  });

  it('returns schema errors when manifest is structurally invalid (no registry check)', () => {
    const r = smv.validate(null);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Manifest must be a non-null object.');
  });
});

// ─── TC-SMV-07: SkillManifestValidator — exec wrapper detection (E-03) ────────

describe('TC-SMV-07: SkillManifestValidator — exec wrapper detection (E-03)', () => {
  const smv = new SkillManifestValidator();

  const execWrapperNames = [
    'exec', 'bash', 'shell_exec', 'run_command', 'execute_command',
    'run_terminal_cmd', 'terminal_exec', 'cmd', 'sh', 'zsh',
  ];

  for (const toolName of execWrapperNames) {
    it(`rejects tool named "${toolName}"`, () => {
      const m = { ...validManifest(), name: toolName };
      const r = smv.validate(m);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes(toolName))).toBe(true);
    });
  }

  it('exec wrapper detection is case-insensitive', () => {
    const m = { ...validManifest(), name: 'BASH' };
    const r = smv.validate(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('reserved exec wrapper'))).toBe(true);
  });

  it('accepts legitimate non-exec tool names', () => {
    for (const toolName of ['git_add', 'read_file', 'list_dir', 'web_search']) {
      const m = { ...validManifest(), name: toolName };
      const r = smv.validate(m);
      expect(
        r.errors.some((e) => e.includes('reserved exec wrapper')),
        `Expected "${toolName}" to be accepted`,
      ).toBe(false);
    }
  });
});

// ─── TC-SMV-08: SkillManifestValidator — risk/HITL alignment (E-05) ──────────

describe('TC-SMV-08: SkillManifestValidator — risk/HITL alignment with registry (E-05)', () => {
  const smv = new SkillManifestValidator();

  it('rejects risk_tier that does not match the registry default', () => {
    const m = { ...validManifest(), action_class: 'vcs.write', risk_tier: 'low' as const };
    const r = smv.validate(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('risk_tier') && e.includes('"low"'))).toBe(true);
  });

  it('rejects default_hitl_mode that does not match the registry default', () => {
    const m = {
      ...validManifest(),
      action_class: 'vcs.write',
      risk_tier: 'medium' as const,
      default_hitl_mode: 'none' as const,
    };
    const r = smv.validate(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('default_hitl_mode') && e.includes('"none"'))).toBe(true);
  });

  it('accepts risk_tier and default_hitl_mode matching registry defaults for vcs.write', () => {
    const m = {
      ...validManifest(),
      action_class: 'vcs.write',
      risk_tier: 'medium' as const,
      default_hitl_mode: 'per_request' as const,
    };
    const r = smv.validate(m);
    expect(r.valid).toBe(true);
  });

  it('accepts risk_tier and default_hitl_mode matching registry defaults for vcs.read', () => {
    const m = {
      ...validManifest(),
      action_class: 'vcs.read',
      risk_tier: 'low' as const,
      default_hitl_mode: 'none' as const,
    };
    const r = smv.validate(m);
    expect(r.valid).toBe(true);
  });

  it('error message includes registry default when risk_tier mismatches', () => {
    const m = { ...validManifest(), action_class: 'vcs.write', risk_tier: 'critical' as const };
    const r = smv.validate(m);
    expect(r.errors.some((e) => e.includes('"medium"') && e.includes('vcs.write'))).toBe(true);
  });
});

// ─── TC-SMV-Contract: first-party manifests validate against F-05 and registry ─

describe('TC-SMV-Contract: first-party tool manifests validate against F-05 schema and registry rules', () => {
  const smv = new SkillManifestValidator();

  const firstPartyManifests = [
    { name: 'gitAddManifest', manifest: gitAddManifest },
    { name: 'gitLogManifest', manifest: gitLogManifest },
    { name: 'gitDiffManifest', manifest: gitDiffManifest },
    { name: 'gitStatusManifest', manifest: gitStatusManifest },
    { name: 'editFileManifest', manifest: editFileManifest },
    { name: 'readFileManifest', manifest: readFileManifest },
    { name: 'writeFileManifest', manifest: writeFileManifest },
    { name: 'listDirManifest', manifest: listDirManifest },
  ];

  for (const { name, manifest } of firstPartyManifests) {
    it(`${name} passes F-05 schema validation`, () => {
      const result = validateToolManifest(manifest);
      expect(result.valid, JSON.stringify(result.errors, null, 2)).toBe(true);
    });

    it(`${name} passes SkillManifestValidator registry checks`, () => {
      const result = smv.validate(manifest);
      expect(result.valid, JSON.stringify(result.errors, null, 2)).toBe(true);
    });
  }
});

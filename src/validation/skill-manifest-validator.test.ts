/**
 * Skill manifest validator tests.
 *
 * Verifies that `validateToolManifest` correctly enforces the F-05 schema,
 * and that all first-party tool manifests satisfy the schema (TC-SMV-Contract).
 *
 * Test IDs:
 *   TC-SMV-01: Non-object inputs are rejected
 *   TC-SMV-02: Required top-level string fields are validated
 *   TC-SMV-03: params and result JSON Schema objects are validated
 *   TC-SMV-04: A fully valid manifest passes
 *   TC-SMV-Contract: All first-party tool manifests validate against F-05
 */

import { describe, it, expect } from 'vitest';
import {
  validateToolManifest,
  type ToolManifest,
} from './skill-manifest-validator.js';
import { gitAddManifest } from '../tools/git_add/manifest.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function validManifest(): ToolManifest {
  return {
    name: 'test-tool',
    version: '1.0.0',
    action_class: 'vcs.write',
    params: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' } } },
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
    const m = { ...validManifest(), params: { type: 'array', properties: {} } };
    const r = validateToolManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('params.type'))).toBe(true);
  });

  it('rejects params missing properties', () => {
    const m = { ...validManifest(), params: { type: 'object' } };
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

  it('accepts empty properties object', () => {
    const m = {
      ...validManifest(),
      params: { type: 'object' as const, properties: {} },
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

// ─── TC-SMV-Contract: first-party manifests validate against F-05 ─────────────

describe('TC-SMV-Contract: first-party tool manifests validate against F-05 schema', () => {
  it('gitAddManifest validates against the F-05 schema', () => {
    const result = validateToolManifest(gitAddManifest);
    expect(result.valid, JSON.stringify(result.errors, null, 2)).toBe(true);
  });
});

/**
 * Validates that the Cedar JSON schema for OpenAuthority parses correctly
 * using the @cedar-policy/cedar-wasm/nodejs runtime.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'cedar', 'schema.cedarschema.json');

// ---------------------------------------------------------------------------
// Local schema shape helpers (avoids relying on unstable package types)
// ---------------------------------------------------------------------------

interface SchemaNamespace {
  entityTypes: Record<string, { shape?: { attributes?: Record<string, { required?: boolean }> } }>;
  actions: Record<string, { appliesTo?: { principalTypes?: string[]; resourceTypes?: string[] } }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cedar/schema.cedarschema.json', () => {
  let schema: Record<string, SchemaNamespace>;

  // (1) JSON loads without throwing
  it('loads JSON without throwing', () => {
    expect(() => {
      const raw = readFileSync(SCHEMA_PATH, 'utf-8');
      JSON.parse(raw);
    }).not.toThrow();
  });

  beforeAll(() => {
    const raw = readFileSync(SCHEMA_PATH, 'utf-8');
    schema = JSON.parse(raw) as Record<string, SchemaNamespace>;
  });

  // (2) checkParseSchema returns { type: 'success' }
  it('passes checkParseSchema with type: success', async () => {
    const { checkParseSchema } = await import('@cedar-policy/cedar-wasm/nodejs');
    const result = checkParseSchema(schema);
    expect(result).toEqual({ type: 'success' });
  });

  // (3) Structural assertions on entity types and action IDs
  it('defines the OpenAuthority namespace', () => {
    expect(schema).toHaveProperty('OpenAuthority');
  });

  it('defines Agent entity type', () => {
    expect(schema['OpenAuthority']?.entityTypes).toHaveProperty('Agent');
  });

  it('defines Resource entity type', () => {
    expect(schema['OpenAuthority']?.entityTypes).toHaveProperty('Resource');
  });

  it('defines RequestAccess action', () => {
    expect(schema['OpenAuthority']?.actions).toHaveProperty('RequestAccess');
  });

  it('Agent entity has required agentId and channel attributes', () => {
    const attrs = schema['OpenAuthority']?.entityTypes?.['Agent']?.shape?.attributes;
    expect(attrs).toHaveProperty('agentId');
    expect(attrs).toHaveProperty('channel');
  });

  it('Agent entity has optional verified, userId, sessionId attributes', () => {
    const attrs = schema['OpenAuthority']?.entityTypes?.['Agent']?.shape?.attributes;
    expect(attrs?.['verified']?.required).toBe(false);
    expect(attrs?.['userId']?.required).toBe(false);
    expect(attrs?.['sessionId']?.required).toBe(false);
  });

  it('RequestAccess applies to Agent principals and Resource resources', () => {
    const appliesTo = schema['OpenAuthority']?.actions?.['RequestAccess']?.appliesTo;
    expect(appliesTo?.principalTypes).toContain('Agent');
    expect(appliesTo?.resourceTypes).toContain('Resource');
  });
});

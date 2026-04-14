/**
 * Tests for buildEntities() — Cedar entity hydration from RuleContext.
 */
import { describe, it, expect } from 'vitest';
import { buildEntities, buildResourceEntity } from './cedar-entities.js';
import type { CedarEntity } from './cedar-entities.js';
import type { RuleContext } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides?: Partial<RuleContext>): RuleContext {
  return { agentId: 'agent-1', channel: 'default', ...overrides };
}

// ---------------------------------------------------------------------------
// buildEntities
// ---------------------------------------------------------------------------

describe('buildEntities', () => {
  it('returns an array with exactly one entity', () => {
    const entities = buildEntities(makeContext());
    expect(entities).toHaveLength(1);
  });

  it('maps agentId to OpenAuthority::Agent entity uid', () => {
    const entities = buildEntities(makeContext({ agentId: 'my-agent' }));
    expect(entities[0].uid).toEqual({ type: 'OpenAuthority::Agent', id: 'my-agent' });
  });

  it('includes agentId as a plain string attribute on the entity', () => {
    const entities = buildEntities(makeContext({ agentId: 'my-agent' }));
    expect(entities[0].attrs['agentId']).toBe('my-agent');
  });

  it('includes channel as a plain string attribute on the entity', () => {
    const entities = buildEntities(makeContext({ channel: 'prod' }));
    expect(entities[0].attrs['channel']).toBe('prod');
  });

  it('returns an Agent entity with an empty parents array', () => {
    const entities = buildEntities(makeContext());
    expect(entities[0].parents).toEqual([]);
  });

  // ── Optional fields ───────────────────────────────────────────────────────

  it('omits verified attribute when not provided', () => {
    const entities = buildEntities(makeContext());
    expect(entities[0].attrs).not.toHaveProperty('verified');
  });

  it('includes verified as a plain boolean true', () => {
    const entities = buildEntities(makeContext({ verified: true }));
    expect(entities[0].attrs['verified']).toBe(true);
  });

  it('includes verified as a plain boolean false', () => {
    const entities = buildEntities(makeContext({ verified: false }));
    expect(entities[0].attrs['verified']).toBe(false);
  });

  it('omits userId attribute when not provided', () => {
    const entities = buildEntities(makeContext());
    expect(entities[0].attrs).not.toHaveProperty('userId');
  });

  it('includes userId as a plain string attribute when provided', () => {
    const entities = buildEntities(makeContext({ userId: 'user-42' }));
    expect(entities[0].attrs['userId']).toBe('user-42');
  });

  it('omits sessionId attribute when not provided', () => {
    const entities = buildEntities(makeContext());
    expect(entities[0].attrs).not.toHaveProperty('sessionId');
  });

  it('includes sessionId as a plain string attribute when provided', () => {
    const entities = buildEntities(makeContext({ sessionId: 'sess-abc' }));
    expect(entities[0].attrs['sessionId']).toBe('sess-abc');
  });

  it('includes all optional fields when all are provided', () => {
    const entities = buildEntities(
      makeContext({ verified: true, userId: 'u1', sessionId: 's1' }),
    );
    const attrs = entities[0].attrs;
    expect(attrs['verified']).toBe(true);
    expect(attrs['userId']).toBe('u1');
    expect(attrs['sessionId']).toBe('s1');
  });

  // ── Shape of required attributes ─────────────────────────────────────────

  it('always has agentId and channel attributes regardless of optional fields', () => {
    const entities = buildEntities(makeContext({ agentId: 'a', channel: 'c' }));
    const attrs = entities[0].attrs;
    expect(attrs['agentId']).toBeDefined();
    expect(attrs['channel']).toBeDefined();
  });

  it('entity uid type is always "OpenAuthority::Agent"', () => {
    const entities = buildEntities(makeContext({ agentId: 'anything' }));
    expect(entities[0].uid.type).toBe('OpenAuthority::Agent');
  });

  it('entity uid id matches the agentId', () => {
    const entities = buildEntities(makeContext({ agentId: 'x-agent-7' }));
    expect(entities[0].uid.id).toBe('x-agent-7');
  });

  // ── Return value is a fresh array each call ───────────────────────────────

  it('returns a new array on each call', () => {
    const ctx = makeContext();
    const a = buildEntities(ctx);
    const b = buildEntities(ctx);
    expect(a).not.toBe(b);
  });

  it('returned entity satisfies the CedarEntity shape', () => {
    const entities = buildEntities(makeContext());
    const entity = entities[0] as CedarEntity;
    expect(entity).toHaveProperty('uid');
    expect(entity).toHaveProperty('attrs');
    expect(entity).toHaveProperty('parents');
  });
});

// ---------------------------------------------------------------------------
// buildResourceEntity
// ---------------------------------------------------------------------------

describe('buildResourceEntity', () => {
  it('returns a Resource entity with the correct uid', () => {
    const entity = buildResourceEntity('file', 'read_file', 'filesystem.read');
    expect(entity.uid).toEqual({ type: 'OpenAuthority::Resource', id: 'file:read_file' });
  });

  it('includes actionClass as a plain string attribute', () => {
    const entity = buildResourceEntity('tool', 'bash', 'system.execute');
    expect(entity.attrs['actionClass']).toBe('system.execute');
  });

  it('uid id concatenates resourceType and resourceName with colon', () => {
    const entity = buildResourceEntity('payment', 'transfer_funds', 'payment.transfer');
    expect(entity.uid.id).toBe('payment:transfer_funds');
  });

  it('uid type is always "OpenAuthority::Resource"', () => {
    const entity = buildResourceEntity('credential', 'get_secret', 'credential.access');
    expect(entity.uid.type).toBe('OpenAuthority::Resource');
  });

  it('parents array is empty', () => {
    const entity = buildResourceEntity('web', 'navigate', 'browser.navigate');
    expect(entity.parents).toEqual([]);
  });

  it('satisfies the CedarEntity shape', () => {
    const entity = buildResourceEntity('file', 'read_file', 'filesystem.read') as CedarEntity;
    expect(entity).toHaveProperty('uid');
    expect(entity).toHaveProperty('attrs');
    expect(entity).toHaveProperty('parents');
  });
});

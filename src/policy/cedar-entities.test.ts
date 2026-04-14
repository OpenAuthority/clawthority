/**
 * Tests for buildEntities() — Cedar entity hydration from RuleContext.
 */
import { describe, it, expect } from 'vitest';
import { buildEntities } from './cedar-entities.js';
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

  it('maps agentId to Agent entity uid', () => {
    const entities = buildEntities(makeContext({ agentId: 'my-agent' }));
    expect(entities[0].uid).toEqual({ type: 'Agent', id: 'my-agent' });
  });

  it('includes agentId as a String attribute on the entity', () => {
    const entities = buildEntities(makeContext({ agentId: 'my-agent' }));
    expect(entities[0].attrs['agentId']).toEqual({ String: 'my-agent' });
  });

  it('includes channel as a String attribute on the entity', () => {
    const entities = buildEntities(makeContext({ channel: 'prod' }));
    expect(entities[0].attrs['channel']).toEqual({ String: 'prod' });
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

  it('includes verified as a Bool attribute when true', () => {
    const entities = buildEntities(makeContext({ verified: true }));
    expect(entities[0].attrs['verified']).toEqual({ Bool: true });
  });

  it('includes verified as a Bool attribute when false', () => {
    const entities = buildEntities(makeContext({ verified: false }));
    expect(entities[0].attrs['verified']).toEqual({ Bool: false });
  });

  it('omits userId attribute when not provided', () => {
    const entities = buildEntities(makeContext());
    expect(entities[0].attrs).not.toHaveProperty('userId');
  });

  it('includes userId as a String attribute when provided', () => {
    const entities = buildEntities(makeContext({ userId: 'user-42' }));
    expect(entities[0].attrs['userId']).toEqual({ String: 'user-42' });
  });

  it('omits sessionId attribute when not provided', () => {
    const entities = buildEntities(makeContext());
    expect(entities[0].attrs).not.toHaveProperty('sessionId');
  });

  it('includes sessionId as a String attribute when provided', () => {
    const entities = buildEntities(makeContext({ sessionId: 'sess-abc' }));
    expect(entities[0].attrs['sessionId']).toEqual({ String: 'sess-abc' });
  });

  it('includes all optional fields when all are provided', () => {
    const entities = buildEntities(
      makeContext({ verified: true, userId: 'u1', sessionId: 's1' }),
    );
    const attrs = entities[0].attrs;
    expect(attrs['verified']).toEqual({ Bool: true });
    expect(attrs['userId']).toEqual({ String: 'u1' });
    expect(attrs['sessionId']).toEqual({ String: 's1' });
  });

  // ── Shape of required attributes ─────────────────────────────────────────

  it('always has agentId and channel attributes regardless of optional fields', () => {
    const entities = buildEntities(makeContext({ agentId: 'a', channel: 'c' }));
    const attrs = entities[0].attrs;
    expect(attrs['agentId']).toBeDefined();
    expect(attrs['channel']).toBeDefined();
  });

  it('entity uid type is always "Agent"', () => {
    const entities = buildEntities(makeContext({ agentId: 'anything' }));
    expect(entities[0].uid.type).toBe('Agent');
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

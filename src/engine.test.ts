/**
 * Phase 1 unit tests – core ABAC engine, rule evaluation, and audit logging
 *
 * Covers:
 *   1. evaluateRule & sortRulesByPriority  (src/rules.ts)
 *   2. PolicyEngine (ABAC)                (src/engine.ts)
 *   3. AuditLogger                        (src/audit.ts)
 *   4. consoleAuditHandler                (src/audit.ts)
 *   5. JsonlAuditLogger                   (src/audit.ts)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { evaluateRule, sortRulesByPriority } from './rules.js';
import { PolicyEngine } from './engine.js';
import { AuditLogger, consoleAuditHandler, JsonlAuditLogger } from './audit.js';
import type { TPolicy, TEvaluationContext, TPolicyRule } from './types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<TEvaluationContext> = {}): TEvaluationContext {
  return {
    subject: { role: 'user', id: 'user-1' },
    resource: { type: 'document', id: 'doc-1' },
    action: 'read',
    ...overrides,
  };
}

function makeRule(overrides: Partial<TPolicyRule> = {}): TPolicyRule {
  return {
    id: 'rule-1',
    name: 'Test rule',
    effect: 'allow',
    conditions: [],
    ...overrides,
  };
}

function makePolicy(overrides: Partial<TPolicy> = {}): TPolicy {
  return {
    id: 'policy-1',
    name: 'Test policy',
    version: '1.0',
    rules: [],
    defaultEffect: 'deny',
    ...overrides,
  };
}

// ─── 1. evaluateRule ─────────────────────────────────────────────────────────

describe('evaluateRule', () => {
  it('returns true when there are no conditions', () => {
    expect(evaluateRule(makeRule({ conditions: [] }), makeContext())).toBe(true);
  });

  describe('eq operator', () => {
    it('matches when field equals value', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'eq', value: 'read' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(true);
    });

    it('does not match when field differs', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'eq', value: 'write' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(false);
    });

    it('resolves nested fields via dot notation', () => {
      const rule = makeRule({ conditions: [{ field: 'subject.role', operator: 'eq', value: 'admin' }] });
      expect(evaluateRule(rule, makeContext({ subject: { role: 'admin', id: 'u1' } }))).toBe(true);
      expect(evaluateRule(rule, makeContext({ subject: { role: 'user', id: 'u1' } }))).toBe(false);
    });

    it('resolves environment fields via dot notation', () => {
      const rule = makeRule({ conditions: [{ field: 'environment.region', operator: 'eq', value: 'us-east-1' }] });
      expect(evaluateRule(rule, makeContext({ environment: { region: 'us-east-1' } }))).toBe(true);
      expect(evaluateRule(rule, makeContext({ environment: { region: 'eu-west-1' } }))).toBe(false);
    });

    it('returns false when nested path does not exist', () => {
      const rule = makeRule({ conditions: [{ field: 'subject.missing', operator: 'eq', value: 'x' }] });
      expect(evaluateRule(rule, makeContext())).toBe(false);
    });

    it('resolves resource fields via dot notation', () => {
      const rule = makeRule({ conditions: [{ field: 'resource.type', operator: 'eq', value: 'document' }] });
      expect(evaluateRule(rule, makeContext())).toBe(true);
    });
  });

  describe('neq operator', () => {
    it('matches when field does not equal value', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'neq', value: 'delete' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(true);
    });

    it('does not match when field equals value', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'neq', value: 'read' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(false);
    });
  });

  describe('in operator', () => {
    it('matches when field value is in the array', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'in', value: ['read', 'write'] }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(true);
    });

    it('does not match when field value is absent from the array', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'in', value: ['write', 'delete'] }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(false);
    });

    it('returns false when value is not an array', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'in', value: 'read' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(false);
    });
  });

  describe('nin operator', () => {
    it('matches when field value is not in the array', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'nin', value: ['write', 'delete'] }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(true);
    });

    it('does not match when field value is in the array', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'nin', value: ['read', 'write'] }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(false);
    });

    it('returns false when value is not an array', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'nin', value: 'write' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(false);
    });
  });

  describe('contains operator', () => {
    it('matches when string field contains the substring', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'contains', value: 'rea' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(true);
    });

    it('does not match when substring is absent', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'contains', value: 'xyz' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(false);
    });

    it('returns false when field value is not a string', () => {
      const rule = makeRule({ conditions: [{ field: 'subject.id', operator: 'contains', value: '1' }] });
      expect(evaluateRule(rule, makeContext({ subject: { id: 1 } }))).toBe(false);
    });
  });

  describe('startsWith operator', () => {
    it('matches when field starts with the prefix', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'startsWith', value: 're' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(true);
    });

    it('does not match when field does not start with the prefix', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'startsWith', value: 'wr' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(false);
    });

    it('returns false when field value is not a string', () => {
      const rule = makeRule({ conditions: [{ field: 'subject.id', operator: 'startsWith', value: '1' }] });
      expect(evaluateRule(rule, makeContext({ subject: { id: 1 } }))).toBe(false);
    });
  });

  describe('regex operator', () => {
    it('matches when field matches the regex pattern', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'regex', value: '^rea' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(true);
    });

    it('does not match when field does not match the pattern', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'regex', value: '^wri' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(false);
    });

    it('supports complex alternation patterns', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'regex', value: '(read|write)' }] });
      expect(evaluateRule(rule, makeContext({ action: 'read' }))).toBe(true);
      expect(evaluateRule(rule, makeContext({ action: 'delete' }))).toBe(false);
    });

    it('returns false when field value is not a string', () => {
      const rule = makeRule({ conditions: [{ field: 'subject.id', operator: 'regex', value: '\\d+' }] });
      expect(evaluateRule(rule, makeContext({ subject: { id: 123 } }))).toBe(false);
    });
  });

  describe('unknown operator', () => {
    it('returns false for unrecognised operators', () => {
      const rule = makeRule({ conditions: [{ field: 'action', operator: 'unknown' as never, value: 'read' }] });
      expect(evaluateRule(rule, makeContext())).toBe(false);
    });
  });

  describe('AND semantics (multiple conditions)', () => {
    it('returns true when all conditions pass', () => {
      const rule = makeRule({
        conditions: [
          { field: 'action', operator: 'eq', value: 'read' },
          { field: 'subject.role', operator: 'eq', value: 'admin' },
        ],
      });
      expect(evaluateRule(rule, makeContext({ action: 'read', subject: { role: 'admin', id: 'u1' } }))).toBe(true);
    });

    it('returns false when any one condition fails', () => {
      const rule = makeRule({
        conditions: [
          { field: 'action', operator: 'eq', value: 'read' },
          { field: 'subject.role', operator: 'eq', value: 'admin' },
        ],
      });
      expect(evaluateRule(rule, makeContext({ action: 'read', subject: { role: 'user', id: 'u1' } }))).toBe(false);
    });

    it('short-circuits on first failing condition', () => {
      // If the first condition fails, remaining ones don't run — but we can
      // only verify the net result here since evaluateCondition is private.
      const rule = makeRule({
        conditions: [
          { field: 'action', operator: 'eq', value: 'write' }, // fails
          { field: 'subject.role', operator: 'eq', value: 'admin' },
        ],
      });
      expect(evaluateRule(rule, makeContext({ action: 'read', subject: { role: 'admin', id: 'u1' } }))).toBe(false);
    });
  });
});

// ─── 2. sortRulesByPriority ───────────────────────────────────────────────────

describe('sortRulesByPriority', () => {
  it('returns an empty array for an empty input', () => {
    expect(sortRulesByPriority([])).toEqual([]);
  });

  it('sorts rules by descending priority', () => {
    const rules: TPolicyRule[] = [
      makeRule({ id: 'r1', priority: 1 }),
      makeRule({ id: 'r3', priority: 100 }),
      makeRule({ id: 'r2', priority: 50 }),
    ];
    const sorted = sortRulesByPriority(rules);
    expect(sorted.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
  });

  it('treats undefined priority as 0', () => {
    const rules: TPolicyRule[] = [
      makeRule({ id: 'r1', priority: undefined }),
      makeRule({ id: 'r2', priority: 10 }),
    ];
    const sorted = sortRulesByPriority(rules);
    expect(sorted[0]?.id).toBe('r2');
    expect(sorted[1]?.id).toBe('r1');
  });

  it('returns a new array without mutating the input', () => {
    const rules: TPolicyRule[] = [
      makeRule({ id: 'r1', priority: 1 }),
      makeRule({ id: 'r2', priority: 100 }),
    ];
    const originalOrder = rules.map((r) => r.id);
    sortRulesByPriority(rules);
    expect(rules.map((r) => r.id)).toEqual(originalOrder);
  });

  it('preserves relative order of equal-priority rules (stable sort)', () => {
    const rules: TPolicyRule[] = [
      makeRule({ id: 'r1', priority: 5 }),
      makeRule({ id: 'r2', priority: 5 }),
      makeRule({ id: 'r3', priority: 5 }),
    ];
    const sorted = sortRulesByPriority(rules);
    expect(sorted.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('handles a single rule without error', () => {
    const rules = [makeRule({ id: 'solo', priority: 42 })];
    const sorted = sortRulesByPriority(rules);
    expect(sorted).toHaveLength(1);
    expect(sorted[0]?.id).toBe('solo');
  });

  it('places priority-0 rule after a higher-priority rule', () => {
    const rules: TPolicyRule[] = [
      makeRule({ id: 'low', priority: 0 }),
      makeRule({ id: 'high', priority: 99 }),
    ];
    const sorted = sortRulesByPriority(rules);
    expect(sorted[0]?.id).toBe('high');
    expect(sorted[1]?.id).toBe('low');
  });
});

// ─── 3. PolicyEngine (ABAC) ──────────────────────────────────────────────────

describe('PolicyEngine (ABAC)', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  describe('addPolicy / getPolicy', () => {
    it('stores and retrieves a policy by id', () => {
      const policy = makePolicy({ id: 'p1' });
      engine.addPolicy(policy);
      expect(engine.getPolicy('p1')).toBe(policy);
    });

    it('returns undefined for an unknown policy id', () => {
      expect(engine.getPolicy('unknown')).toBeUndefined();
    });

    it('overwrites an existing policy with the same id', () => {
      engine.addPolicy(makePolicy({ id: 'p1', name: 'Original' }));
      engine.addPolicy(makePolicy({ id: 'p1', name: 'Updated' }));
      expect(engine.getPolicy('p1')?.name).toBe('Updated');
      expect(engine.listPolicies()).toHaveLength(1);
    });
  });

  describe('removePolicy', () => {
    it('removes a policy and returns true', () => {
      engine.addPolicy(makePolicy({ id: 'p1' }));
      expect(engine.removePolicy('p1')).toBe(true);
      expect(engine.getPolicy('p1')).toBeUndefined();
    });

    it('returns false when the policy does not exist', () => {
      expect(engine.removePolicy('nonexistent')).toBe(false);
    });
  });

  describe('listPolicies', () => {
    it('returns all added policies', () => {
      const p1 = makePolicy({ id: 'p1' });
      const p2 = makePolicy({ id: 'p2' });
      engine.addPolicy(p1);
      engine.addPolicy(p2);
      const list = engine.listPolicies();
      expect(list).toHaveLength(2);
      expect(list).toContain(p1);
      expect(list).toContain(p2);
    });

    it('returns an empty array when no policies are registered', () => {
      expect(engine.listPolicies()).toEqual([]);
    });
  });

  describe('evaluate', () => {
    it('throws when the policy is not found', async () => {
      await expect(engine.evaluate('nonexistent', makeContext())).rejects.toThrow(
        'Policy not found: nonexistent',
      );
    });

    it('applies default deny when no rules match and defaultEffect is deny', async () => {
      engine.addPolicy(makePolicy({ id: 'p1', defaultEffect: 'deny', rules: [] }));
      const result = await engine.evaluate('p1', makeContext());
      expect(result.allowed).toBe(false);
      expect(result.effect).toBe('deny');
      expect(result.reason).toMatch(/no matching rule/i);
    });

    it('applies default allow when no rules match and defaultEffect is allow', async () => {
      engine.addPolicy(makePolicy({ id: 'p1', defaultEffect: 'allow', rules: [] }));
      const result = await engine.evaluate('p1', makeContext());
      expect(result.allowed).toBe(true);
      expect(result.effect).toBe('allow');
      expect(result.reason).toMatch(/no matching rule/i);
    });

    it('returns the id of the matched rule', async () => {
      const policy = makePolicy({
        id: 'p1',
        defaultEffect: 'deny',
        rules: [makeRule({ id: 'allow-read', effect: 'allow', conditions: [{ field: 'action', operator: 'eq', value: 'read' }] })],
      });
      engine.addPolicy(policy);
      const result = await engine.evaluate('p1', makeContext({ action: 'read' }));
      expect(result.allowed).toBe(true);
      expect(result.matchedRuleId).toBe('allow-read');
    });

    it('evaluates the highest-priority rule first', async () => {
      const policy = makePolicy({
        id: 'p1',
        defaultEffect: 'deny',
        rules: [
          makeRule({ id: 'low-deny', effect: 'deny', conditions: [], priority: 1 }),
          makeRule({ id: 'high-allow', effect: 'allow', conditions: [], priority: 100 }),
        ],
      });
      engine.addPolicy(policy);
      const result = await engine.evaluate('p1', makeContext());
      expect(result.matchedRuleId).toBe('high-allow');
      expect(result.allowed).toBe(true);
    });

    it('skips non-matching rules and evaluates lower-priority matching one', async () => {
      const policy = makePolicy({
        id: 'p1',
        defaultEffect: 'deny',
        rules: [
          makeRule({ id: 'high-write', effect: 'allow', conditions: [{ field: 'action', operator: 'eq', value: 'write' }], priority: 100 }),
          makeRule({ id: 'low-read', effect: 'allow', conditions: [{ field: 'action', operator: 'eq', value: 'read' }], priority: 10 }),
        ],
      });
      engine.addPolicy(policy);
      const result = await engine.evaluate('p1', makeContext({ action: 'read' }));
      expect(result.matchedRuleId).toBe('low-read');
    });

    it('includes rule description as reason when matched', async () => {
      const policy = makePolicy({
        id: 'p1',
        defaultEffect: 'deny',
        rules: [makeRule({ effect: 'allow', conditions: [], description: 'Permit all reads' })],
      });
      engine.addPolicy(policy);
      const result = await engine.evaluate('p1', makeContext());
      expect(result.reason).toBe('Permit all reads');
    });

    it('omits reason when matched rule has no description', async () => {
      const policy = makePolicy({
        id: 'p1',
        defaultEffect: 'deny',
        rules: [makeRule({ effect: 'allow', conditions: [] })],
      });
      engine.addPolicy(policy);
      const result = await engine.evaluate('p1', makeContext());
      expect(result.reason).toBeUndefined();
    });

    it('omits matchedRuleId when falling through to the default effect', async () => {
      engine.addPolicy(makePolicy({ id: 'p1', defaultEffect: 'deny', rules: [] }));
      const result = await engine.evaluate('p1', makeContext());
      expect(result.matchedRuleId).toBeUndefined();
    });

    it('calls the audit logger on each evaluation', async () => {
      const auditLogger = new AuditLogger();
      const handler = vi.fn();
      auditLogger.addHandler(handler);
      const engineWithAudit = new PolicyEngine({ auditLogger });
      engineWithAudit.addPolicy(makePolicy({ id: 'p1', defaultEffect: 'allow', rules: [] }));
      await engineWithAudit.evaluate('p1', makeContext());
      expect(handler).toHaveBeenCalledOnce();
      const entry = handler.mock.calls[0]![0];
      expect(entry.policyId).toBe('p1');
      expect(entry.result.allowed).toBe(true);
    });

    it('operates correctly without an audit logger', async () => {
      engine.addPolicy(makePolicy({ id: 'p1', defaultEffect: 'allow', rules: [] }));
      await expect(engine.evaluate('p1', makeContext())).resolves.toBeDefined();
    });

    it('deny rule evaluated against a non-matching context returns default allow', async () => {
      const policy = makePolicy({
        id: 'p1',
        defaultEffect: 'allow',
        rules: [makeRule({ id: 'deny-delete', effect: 'deny', conditions: [{ field: 'action', operator: 'eq', value: 'delete' }] })],
      });
      engine.addPolicy(policy);
      const result = await engine.evaluate('p1', makeContext({ action: 'read' }));
      expect(result.allowed).toBe(true);
      expect(result.matchedRuleId).toBeUndefined();
    });
  });

  describe('evaluateAll', () => {
    it('returns results for all registered policies', async () => {
      engine.addPolicy(makePolicy({ id: 'p1', defaultEffect: 'allow', rules: [] }));
      engine.addPolicy(makePolicy({ id: 'p2', defaultEffect: 'deny', rules: [] }));
      const results = await engine.evaluateAll(makeContext());
      expect(results.size).toBe(2);
      expect(results.get('p1')?.allowed).toBe(true);
      expect(results.get('p2')?.allowed).toBe(false);
    });

    it('returns an empty Map when no policies are registered', async () => {
      const results = await engine.evaluateAll(makeContext());
      expect(results.size).toBe(0);
    });

    it('calls the audit logger once per policy', async () => {
      const auditLogger = new AuditLogger();
      const handler = vi.fn();
      auditLogger.addHandler(handler);
      const engineWithAudit = new PolicyEngine({ auditLogger });
      engineWithAudit.addPolicy(makePolicy({ id: 'p1', defaultEffect: 'allow', rules: [] }));
      engineWithAudit.addPolicy(makePolicy({ id: 'p2', defaultEffect: 'deny', rules: [] }));
      await engineWithAudit.evaluateAll(makeContext());
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});

// ─── 4. AuditLogger ──────────────────────────────────────────────────────────

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  it('invokes a registered handler with a correctly shaped AuditEntry', async () => {
    const handler = vi.fn();
    logger.addHandler(handler);
    const policy = makePolicy();
    const context = makeContext();
    const result = { allowed: true, effect: 'allow' as const };
    await logger.log(policy, context, result);

    expect(handler).toHaveBeenCalledOnce();
    const entry = handler.mock.calls[0]![0];
    expect(entry.policyId).toBe(policy.id);
    expect(entry.policyName).toBe(policy.name);
    expect(entry.context).toBe(context);
    expect(entry.result).toBe(result);
    expect(typeof entry.timestamp).toBe('string');
  });

  it('timestamp is a valid ISO 8601 date-time string', async () => {
    const handler = vi.fn();
    logger.addHandler(handler);
    await logger.log(makePolicy(), makeContext(), { allowed: true, effect: 'allow' });
    const { timestamp } = handler.mock.calls[0]![0];
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });

  it('invokes all registered handlers', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();
    logger.addHandler(h1);
    logger.addHandler(h2);
    logger.addHandler(h3);
    await logger.log(makePolicy(), makeContext(), { allowed: false, effect: 'deny' });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
    expect(h3).toHaveBeenCalledOnce();
  });

  it('does not invoke a handler after it has been removed', async () => {
    const handler = vi.fn();
    logger.addHandler(handler);
    logger.removeHandler(handler);
    await logger.log(makePolicy(), makeContext(), { allowed: true, effect: 'allow' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('removing one handler does not affect others', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    logger.addHandler(h1);
    logger.addHandler(h2);
    logger.removeHandler(h1);
    await logger.log(makePolicy(), makeContext(), { allowed: true, effect: 'allow' });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('removeHandler is a no-op when the handler was never added', () => {
    expect(() => logger.removeHandler(vi.fn())).not.toThrow();
  });

  it('awaits async handlers before resolving', async () => {
    const order: number[] = [];
    logger.addHandler(async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
      order.push(1);
    });
    await logger.log(makePolicy(), makeContext(), { allowed: true, effect: 'allow' });
    expect(order).toEqual([1]);
  });

  it('runs multiple async handlers concurrently (Promise.all semantics)', async () => {
    // Three handlers with different delays; Promise.all runs them in parallel
    // so the fastest finishes first regardless of registration order.
    const order: number[] = [];
    logger.addHandler(async () => { await new Promise<void>((r) => setTimeout(r, 30)); order.push(0); });
    logger.addHandler(async () => { await new Promise<void>((r) => setTimeout(r, 10)); order.push(1); });
    logger.addHandler(async () => { await new Promise<void>((r) => setTimeout(r, 20)); order.push(2); });
    await logger.log(makePolicy(), makeContext(), { allowed: true, effect: 'allow' });
    expect(order).toEqual([1, 2, 0]);
  });

  it('passes the deny result correctly to handlers', async () => {
    const handler = vi.fn();
    logger.addHandler(handler);
    const result = { allowed: false, effect: 'deny' as const, matchedRuleId: 'block-rule', reason: 'Blocked' };
    await logger.log(makePolicy(), makeContext(), result);
    expect(handler.mock.calls[0]![0].result).toMatchObject({ allowed: false, matchedRuleId: 'block-rule' });
  });
});

// ─── 5. consoleAuditHandler ──────────────────────────────────────────────────

describe('consoleAuditHandler', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('logs ALLOW for permitted decisions', () => {
    consoleAuditHandler({
      timestamp: '2024-01-01T00:00:00.000Z',
      policyId: 'p1',
      policyName: 'Test',
      context: makeContext({ action: 'read' }),
      result: { allowed: true, effect: 'allow' },
    });
    expect(consoleSpy).toHaveBeenCalledOnce();
    const msg = consoleSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('ALLOW');
    expect(msg).toContain('p1');
    expect(msg).toContain('read');
  });

  it('logs DENY for denied decisions', () => {
    consoleAuditHandler({
      timestamp: '2024-01-01T00:00:00.000Z',
      policyId: 'p1',
      policyName: 'Test',
      context: makeContext({ action: 'delete' }),
      result: { allowed: false, effect: 'deny' },
    });
    const msg = consoleSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('DENY');
    expect(msg).toContain('delete');
  });

  it('includes rule=<id> when matchedRuleId is present', () => {
    consoleAuditHandler({
      timestamp: '2024-01-01T00:00:00.000Z',
      policyId: 'p1',
      policyName: 'Test',
      context: makeContext({ action: 'read' }),
      result: { allowed: true, effect: 'allow', matchedRuleId: 'allow-read' },
    });
    expect(consoleSpy.mock.calls[0]![0]).toContain('rule=allow-read');
  });

  it('omits rule= when matchedRuleId is absent', () => {
    consoleAuditHandler({
      timestamp: '2024-01-01T00:00:00.000Z',
      policyId: 'p1',
      policyName: 'Test',
      context: makeContext(),
      result: { allowed: true, effect: 'allow' },
    });
    expect(consoleSpy.mock.calls[0]![0]).not.toContain('rule=');
  });

  it('includes the timestamp in the log line', () => {
    const ts = '2024-06-15T12:00:00.000Z';
    consoleAuditHandler({
      timestamp: ts,
      policyId: 'p1',
      policyName: 'Test',
      context: makeContext(),
      result: { allowed: true, effect: 'allow' },
    });
    expect(consoleSpy.mock.calls[0]![0]).toContain(ts);
  });

  it('includes the policy id in the log line', () => {
    consoleAuditHandler({
      timestamp: '2024-01-01T00:00:00.000Z',
      policyId: 'my-policy-id',
      policyName: 'Test',
      context: makeContext(),
      result: { allowed: false, effect: 'deny' },
    });
    expect(consoleSpy.mock.calls[0]![0]).toContain('my-policy-id');
  });
});

// ─── 6. JsonlAuditLogger ─────────────────────────────────────────────────────

describe('JsonlAuditLogger', () => {
  let tmpFile: string;

  const baseEntry = {
    ts: '2024-01-01T00:00:00.000Z',
    effect: 'permit',
    resource: 'tool',
    match: 'read_file',
    reason: 'Allowed',
    agentId: 'agent-1',
    channel: 'default',
  } as const;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  });

  afterEach(async () => {
    if (existsSync(tmpFile)) {
      await rm(tmpFile, { force: true });
    }
  });

  it('writes a valid JSON entry to the log file', async () => {
    const logger = new JsonlAuditLogger({ logFile: tmpFile });
    await logger.log(baseEntry);
    const content = await readFile(tmpFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.effect).toBe('permit');
    expect(parsed.agentId).toBe('agent-1');
    expect(parsed.match).toBe('read_file');
    expect(parsed.ts).toBe('2024-01-01T00:00:00.000Z');
  });

  it('terminates each entry with a newline', async () => {
    const logger = new JsonlAuditLogger({ logFile: tmpFile });
    await logger.log(baseEntry);
    const content = await readFile(tmpFile, 'utf-8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('appends multiple entries, one per line (JSONL format)', async () => {
    const logger = new JsonlAuditLogger({ logFile: tmpFile });
    await logger.log({ ...baseEntry, agentId: 'a1', effect: 'permit' });
    await logger.log({ ...baseEntry, agentId: 'a2', effect: 'forbid' });
    const content = await readFile(tmpFile, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).agentId).toBe('a1');
    expect(JSON.parse(lines[1]!).agentId).toBe('a2');
  });

  it('creates parent directories when they do not exist', async () => {
    const deepPath = join(
      tmpdir(),
      `audit-dir-${Date.now()}`,
      'nested',
      'deep',
      'audit.jsonl',
    );
    try {
      const logger = new JsonlAuditLogger({ logFile: deepPath });
      await logger.log(baseEntry);
      const content = await readFile(deepPath, 'utf-8');
      expect(JSON.parse(content.trim()).effect).toBe('permit');
    } finally {
      await rm(deepPath, { force: true });
    }
  });

  it('writes a HitlDecisionEntry correctly', async () => {
    const logger = new JsonlAuditLogger({ logFile: tmpFile });
    await logger.log({
      ts: '2024-01-01T00:00:00.000Z',
      type: 'hitl',
      decision: 'approved',
      token: 'tok-abc123',
      toolName: 'email.send',
      agentId: 'agent-1',
      channel: 'slack',
      policyName: 'Email mutations',
      timeoutSeconds: 300,
    });
    const content = await readFile(tmpFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe('hitl');
    expect(parsed.decision).toBe('approved');
    expect(parsed.token).toBe('tok-abc123');
    expect(parsed.policyName).toBe('Email mutations');
    expect(parsed.timeoutSeconds).toBe(300);
  });

  it('includes rateLimit when provided in a PolicyDecisionEntry', async () => {
    const logger = new JsonlAuditLogger({ logFile: tmpFile });
    await logger.log({
      ...baseEntry,
      rateLimit: { limited: false, maxCalls: 10, windowSeconds: 60, currentCount: 3 },
    });
    const content = await readFile(tmpFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.rateLimit).toEqual({ limited: false, maxCalls: 10, windowSeconds: 60, currentCount: 3 });
  });

  it('writes HitlDecisionEntry with "expired" decision', async () => {
    const logger = new JsonlAuditLogger({ logFile: tmpFile });
    await logger.log({
      ts: '2024-01-01T00:00:00.000Z',
      type: 'hitl',
      decision: 'expired',
      token: 'tok-xyz',
      toolName: 'db.migrate',
      agentId: 'agent-2',
      channel: 'console',
      policyName: 'DB ops',
      timeoutSeconds: 60,
    });
    const parsed = JSON.parse((await readFile(tmpFile, 'utf-8')).trim());
    expect(parsed.decision).toBe('expired');
  });

  it('does not throw when write fails and logs to console.error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Null byte in path triggers an OS-level error
    const logger = new JsonlAuditLogger({ logFile: '/\0invalid/path.jsonl' });
    await expect(logger.log(baseEntry)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

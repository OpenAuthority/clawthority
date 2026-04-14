import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from './engine.js';
import type { Rule, RuleContext } from './types.js';

const ctx: RuleContext = {
  agentId: 'agent-1',
  channel: 'default',
};

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  describe('default effect (implicit permit)', () => {
    it('returns permit when no rules are loaded', () => {
      const result = engine.evaluate('tool', 'read_file', ctx);
      expect(result.effect).toBe('permit');
    });

    it('returns permit when no rules match the resource type', () => {
      engine.addRule({ effect: 'permit', resource: 'command', match: '*' });
      const result = engine.evaluate('tool', 'read_file', ctx);
      expect(result.effect).toBe('permit');
    });

    it('returns permit when no rules match the resource name', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: 'write_file' });
      const result = engine.evaluate('tool', 'read_file', ctx);
      expect(result.effect).toBe('permit');
    });

    it('includes implicit permit reason', () => {
      const result = engine.evaluate('tool', 'read_file', ctx);
      expect(result.reason).toMatch(/implicit permit/i);
    });

    it('does not include a matchedRule on implicit permit', () => {
      const result = engine.evaluate('tool', 'read_file', ctx);
      expect(result.matchedRule).toBeUndefined();
    });
  });

  describe('explicit deny mode (defaultEffect: forbid)', () => {
    let strictEngine: PolicyEngine;

    beforeEach(() => {
      strictEngine = new PolicyEngine({ defaultEffect: 'forbid' });
    });

    it('returns forbid when no rules are loaded', () => {
      const result = strictEngine.evaluate('tool', 'read_file', ctx);
      expect(result.effect).toBe('forbid');
    });

    it('returns forbid when no rules match', () => {
      strictEngine.addRule({ effect: 'permit', resource: 'command', match: '*' });
      const result = strictEngine.evaluate('tool', 'read_file', ctx);
      expect(result.effect).toBe('forbid');
    });

    it('includes implicit deny reason', () => {
      const result = strictEngine.evaluate('tool', 'read_file', ctx);
      expect(result.reason).toMatch(/implicit deny/i);
    });

    it('still permits when a rule matches', () => {
      strictEngine.addRule({ effect: 'permit', resource: 'tool', match: 'read_file' });
      expect(strictEngine.evaluate('tool', 'read_file', ctx).effect).toBe('permit');
    });
  });

  describe('rule matching', () => {
    it('matches exact string', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: 'read_file' });
      expect(engine.evaluate('tool', 'read_file', ctx).effect).toBe('permit');
      // write_file has no rule, but default is permit so it's also allowed
      expect(engine.evaluate('tool', 'write_file', ctx).effect).toBe('permit');
    });

    it('wildcard * matches any resource name', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
      expect(engine.evaluate('tool', 'read_file', ctx).effect).toBe('permit');
      expect(engine.evaluate('tool', 'anything_at_all', ctx).effect).toBe('permit');
    });

    it('matches RegExp pattern', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: /^read_/ });
      expect(engine.evaluate('tool', 'read_file', ctx).effect).toBe('permit');
      expect(engine.evaluate('tool', 'read_dir', ctx).effect).toBe('permit');
      // write_file has no matching rule, but default is permit
      expect(engine.evaluate('tool', 'write_file', ctx).effect).toBe('permit');
    });

    it('wildcard does not cross resource types', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
      // no command rules, but default is permit
      expect(engine.evaluate('command', 'ls', ctx).effect).toBe('permit');
    });

    it('matches all resource types', () => {
      const resources = ['tool', 'command', 'channel', 'prompt'] as const;
      for (const resource of resources) {
        engine.addRule({ effect: 'permit', resource, match: 'test' });
        expect(engine.evaluate(resource, 'test', ctx).effect).toBe('permit');
      }
    });
  });

  describe('Cedar semantics: forbid wins', () => {
    it('forbid beats permit when both match', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
      engine.addRule({ effect: 'forbid', resource: 'tool', match: 'delete_file' });
      expect(engine.evaluate('tool', 'read_file', ctx).effect).toBe('permit');
      expect(engine.evaluate('tool', 'delete_file', ctx).effect).toBe('forbid');
    });

    it('forbid wins regardless of rule registration order', () => {
      engine.addRule({ effect: 'forbid', resource: 'tool', match: 'delete_file' });
      engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
      expect(engine.evaluate('tool', 'delete_file', ctx).effect).toBe('forbid');
    });

    it('single forbid overrides multiple permit rules', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: 'delete_file' });
      engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
      engine.addRule({ effect: 'forbid', resource: 'tool', match: 'delete_file' });
      expect(engine.evaluate('tool', 'delete_file', ctx).effect).toBe('forbid');
    });
  });

  describe('condition functions', () => {
    it('skips rule when condition returns false', () => {
      engine.addRule({
        effect: 'permit',
        resource: 'tool',
        match: 'read_file',
        condition: () => false,
      });
      // condition fails, falls through to default (permit)
      expect(engine.evaluate('tool', 'read_file', ctx).effect).toBe('permit');
    });

    it('applies rule when condition returns true', () => {
      engine.addRule({
        effect: 'permit',
        resource: 'tool',
        match: 'read_file',
        condition: () => true,
      });
      expect(engine.evaluate('tool', 'read_file', ctx).effect).toBe('permit');
    });

    it('receives the full RuleContext', () => {
      const captured: RuleContext[] = [];
      engine.addRule({
        effect: 'permit',
        resource: 'tool',
        match: 'probe',
        condition: (c) => { captured.push(c); return true; },
      });
      engine.evaluate('tool', 'probe', ctx);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toBe(ctx);
    });

    it('filters access based on agentId', () => {
      const adminCtx: RuleContext = { agentId: 'admin', channel: 'secure' };
      engine.addRule({
        effect: 'permit',
        resource: 'tool',
        match: 'admin_tool',
        condition: (c) => c.agentId === 'admin',
      });
      expect(engine.evaluate('tool', 'admin_tool', adminCtx).effect).toBe('permit');
      // condition fails for non-admin, falls through to default (permit)
      expect(engine.evaluate('tool', 'admin_tool', ctx).effect).toBe('permit');
    });

    it('forbid condition takes priority over permit with no condition', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
      engine.addRule({
        effect: 'forbid',
        resource: 'tool',
        match: 'risky_tool',
        condition: (c) => c.agentId !== 'admin',
      });
      const adminCtx: RuleContext = { agentId: 'admin', channel: 'any' };
      // admin bypasses the forbid condition, so permit applies
      expect(engine.evaluate('tool', 'risky_tool', adminCtx).effect).toBe('permit');
      // non-admin hits the forbid
      expect(engine.evaluate('tool', 'risky_tool', ctx).effect).toBe('forbid');
    });

    it('condition-gated permit with strict engine denies on failure', () => {
      const strictEngine = new PolicyEngine({ defaultEffect: 'forbid' });
      strictEngine.addRule({
        effect: 'permit',
        resource: 'tool',
        match: 'admin_tool',
        condition: (c) => c.agentId === 'admin',
      });
      expect(strictEngine.evaluate('tool', 'admin_tool', ctx).effect).toBe('forbid');
    });
  });

  describe('decision metadata', () => {
    it('includes reason from matched permit rule', () => {
      engine.addRule({
        effect: 'permit',
        resource: 'tool',
        match: 'read_file',
        reason: 'Read access is allowed',
      });
      const result = engine.evaluate('tool', 'read_file', ctx);
      expect(result.reason).toBe('Read access is allowed');
    });

    it('includes reason from matched forbid rule', () => {
      engine.addRule({
        effect: 'forbid',
        resource: 'tool',
        match: 'delete_file',
        reason: 'Deletion is blocked',
      });
      const result = engine.evaluate('tool', 'delete_file', ctx);
      expect(result.reason).toBe('Deletion is blocked');
    });

    it('includes matchedRule reference for permit', () => {
      const rule: Rule = { effect: 'permit', resource: 'tool', match: 'read_file' };
      engine.addRule(rule);
      expect(engine.evaluate('tool', 'read_file', ctx).matchedRule).toBe(rule);
    });

    it('includes matchedRule reference for forbid', () => {
      const rule: Rule = { effect: 'forbid', resource: 'tool', match: '*' };
      engine.addRule(rule);
      expect(engine.evaluate('tool', 'anything', ctx).matchedRule).toBe(rule);
    });
  });

  describe('addRules', () => {
    it('adds multiple rules at once', () => {
      engine.addRules([
        { effect: 'permit', resource: 'tool', match: 'read_file' },
        { effect: 'forbid', resource: 'tool', match: 'delete_file' },
      ]);
      expect(engine.evaluate('tool', 'read_file', ctx).effect).toBe('permit');
      expect(engine.evaluate('tool', 'delete_file', ctx).effect).toBe('forbid');
    });
  });

  describe('clearRules', () => {
    it('removes all rules, reverting to default effect', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
      engine.clearRules();
      // default is permit, so still permit after clearing
      expect(engine.evaluate('tool', 'anything', ctx).effect).toBe('permit');
    });

    it('removes all rules, reverting to forbid in strict mode', () => {
      const strictEngine = new PolicyEngine({ defaultEffect: 'forbid' });
      strictEngine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
      strictEngine.clearRules();
      expect(strictEngine.evaluate('tool', 'anything', ctx).effect).toBe('forbid');
    });
  });

  describe('evaluateByActionClass', () => {
    const actionClassCases: Array<[string, string]> = [
      ['filesystem.read',          'file'],
      ['filesystem.write',         'file'],
      ['communication.email',      'external'],
      ['communication.http',       'external'],
      ['payment.charge',           'payment'],
      ['payment.refund',           'payment'],
      ['system.exec',              'system'],
      ['system.kill',              'system'],
      ['credential.read',          'credential'],
      ['credential.write',         'credential'],
      ['browser.navigate',         'web'],
      ['browser.screenshot',       'web'],
      ['memory.read',              'memory'],
      ['memory.write',             'memory'],
      ['unknown_sensitive_action', 'unknown'],
      ['unrecognised.anything',    'unknown'],
    ];

    for (const [actionClass, expectedResource] of actionClassCases) {
      it(`maps '${actionClass}' → '${expectedResource}' resource`, () => {
        engine.addRule({ effect: 'forbid', resource: expectedResource as never, match: '*' });
        const result = engine.evaluateByActionClass(actionClass, 'some_name', ctx);
        expect(result.effect).toBe('forbid');
        expect(result.matchedRule?.resource).toBe(expectedResource);
      });
    }

    it('delegates to evaluate and respects rules on the mapped resource', () => {
      engine.addRule({ effect: 'permit', resource: 'file', match: 'safe_path' });
      engine.addRule({ effect: 'forbid', resource: 'file', match: 'dangerous_path' });
      expect(engine.evaluateByActionClass('filesystem.read', 'safe_path', ctx).effect).toBe('permit');
      expect(engine.evaluateByActionClass('filesystem.write', 'dangerous_path', ctx).effect).toBe('forbid');
    });

    it('returns the configured default effect when no rule matches', () => {
      const strictEngine = new PolicyEngine({ defaultEffect: 'forbid' });
      const result = strictEngine.evaluateByActionClass('filesystem.read', 'anything', ctx);
      expect(result.effect).toBe('forbid');
    });
  });

  describe('rate limiting', () => {
    it('allows calls within the rate limit', () => {
      engine.addRule({
        effect: 'permit', resource: 'tool', match: 'api_call',
        rateLimit: { maxCalls: 3, windowSeconds: 60 },
      });
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('permit');
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('permit');
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('permit');
    });

    it('synthesizes forbid when rate limit is exceeded', () => {
      engine.addRule({
        effect: 'permit', resource: 'tool', match: 'api_call',
        rateLimit: { maxCalls: 2, windowSeconds: 60 },
      });
      engine.evaluate('tool', 'api_call', ctx); // call 1
      engine.evaluate('tool', 'api_call', ctx); // call 2
      const result = engine.evaluate('tool', 'api_call', ctx); // call 3
      expect(result.effect).toBe('forbid');
      expect(result.reason).toMatch(/rate limit exceeded/i);
    });

    it('tracks calls per agentId independently', () => {
      const ctx2: RuleContext = { agentId: 'agent-2', channel: 'default' };
      engine.addRule({
        effect: 'permit', resource: 'tool', match: 'api_call',
        rateLimit: { maxCalls: 1, windowSeconds: 60 },
      });
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('permit');
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('forbid');
      // agent-2 has its own counter
      expect(engine.evaluate('tool', 'api_call', ctx2).effect).toBe('permit');
    });

    it('tracks calls per resource name independently', () => {
      engine.addRule({
        effect: 'permit', resource: 'tool', match: '*',
        rateLimit: { maxCalls: 1, windowSeconds: 60 },
      });
      expect(engine.evaluate('tool', 'tool_a', ctx).effect).toBe('permit');
      expect(engine.evaluate('tool', 'tool_a', ctx).effect).toBe('forbid');
      // different resource name has its own counter
      expect(engine.evaluate('tool', 'tool_b', ctx).effect).toBe('permit');
    });

    it('allows calls again after the window expires', async () => {
      engine.addRule({
        effect: 'permit', resource: 'tool', match: 'api_call',
        rateLimit: { maxCalls: 1, windowSeconds: 0.05 }, // 50 ms window
      });
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('permit');
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('forbid');
      await new Promise(resolve => setTimeout(resolve, 60));
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('permit');
    });

    it('includes rate limit status in the decision when within limit', () => {
      engine.addRule({
        effect: 'permit', resource: 'tool', match: 'api_call',
        rateLimit: { maxCalls: 5, windowSeconds: 60 },
      });
      const result = engine.evaluate('tool', 'api_call', ctx);
      expect(result.rateLimit).toBeDefined();
      expect(result.rateLimit!.limited).toBe(false);
      expect(result.rateLimit!.maxCalls).toBe(5);
      expect(result.rateLimit!.windowSeconds).toBe(60);
      expect(result.rateLimit!.currentCount).toBe(1);
      expect(result.rateLimit!.oldestCallExpiresAt).toBeGreaterThan(Date.now());
    });

    it('includes limited=true in rate limit status when exceeded', () => {
      engine.addRule({
        effect: 'permit', resource: 'tool', match: 'api_call',
        rateLimit: { maxCalls: 1, windowSeconds: 60 },
      });
      engine.evaluate('tool', 'api_call', ctx);
      const result = engine.evaluate('tool', 'api_call', ctx);
      expect(result.rateLimit!.limited).toBe(true);
      expect(result.rateLimit!.currentCount).toBe(1);
    });

    it('explicit forbid wins without rate limit check', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: '*',
        rateLimit: { maxCalls: 0, windowSeconds: 60 } });
      engine.addRule({ effect: 'forbid', resource: 'tool', match: 'banned_tool' });
      const result = engine.evaluate('tool', 'banned_tool', ctx);
      expect(result.effect).toBe('forbid');
      expect(result.matchedRule?.effect).toBe('forbid');
      expect(result.rateLimit).toBeUndefined();
    });

    it('cleanup removes expired window entries', async () => {
      engine.addRule({
        effect: 'permit', resource: 'tool', match: 'api_call',
        rateLimit: { maxCalls: 1, windowSeconds: 0.05 }, // 50 ms window
      });
      engine.evaluate('tool', 'api_call', ctx);
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('forbid');
      await new Promise(resolve => setTimeout(resolve, 60));
      engine.cleanup();
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('permit');
    });

    it('clearRules resets rate limit tracking', () => {
      const rule: Rule = {
        effect: 'permit', resource: 'tool', match: 'api_call',
        rateLimit: { maxCalls: 1, windowSeconds: 60 },
      };
      engine.addRule(rule);
      engine.evaluate('tool', 'api_call', ctx);
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('forbid');
      engine.clearRules();
      engine.addRule(rule); // re-add the same rule object; tracking should be reset
      expect(engine.evaluate('tool', 'api_call', ctx).effect).toBe('permit');
    });

    it('omits rateLimit from decisions for rules without rateLimit config', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: 'read_file' });
      const result = engine.evaluate('tool', 'read_file', ctx);
      expect(result.rateLimit).toBeUndefined();
    });
  });
});

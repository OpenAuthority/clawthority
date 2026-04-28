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

  describe('evaluateByActionClass — action_class field matching', () => {
    it('matches a rule by action_class field and returns forbid', () => {
      const rule: Rule = { effect: 'forbid', action_class: 'filesystem.read', reason: 'reads_blocked' };
      engine.addRule(rule);
      const result = engine.evaluateByActionClass('filesystem.read', '/tmp/file', ctx);
      expect(result.effect).toBe('forbid');
      expect(result.reason).toBe('reads_blocked');
      expect(result.matchedRule).toBe(rule);
    });

    it('matches a rule by action_class field and returns permit', () => {
      const rule: Rule = { effect: 'permit', action_class: 'filesystem.read', reason: 'reads_ok' };
      engine.addRule(rule);
      const result = engine.evaluateByActionClass('filesystem.read', '/tmp/file', ctx);
      expect(result.effect).toBe('permit');
      expect(result.reason).toBe('reads_ok');
      expect(result.matchedRule).toBe(rule);
    });

    it('action_class forbid wins over resource-based permit', () => {
      const forbidRule: Rule = { effect: 'forbid', action_class: 'filesystem.read', reason: 'ac_forbid' };
      engine.addRule({ effect: 'permit', resource: 'file', match: '*' });
      engine.addRule(forbidRule);
      const result = engine.evaluateByActionClass('filesystem.read', '/tmp/file', ctx);
      expect(result.effect).toBe('forbid');
      expect(result.reason).toBe('ac_forbid');
      expect(result.matchedRule).toBe(forbidRule);
    });

    it('resource-based forbid wins over action_class permit', () => {
      const resourceForbid: Rule = { effect: 'forbid', resource: 'file', match: '*', reason: 'res_forbid' };
      engine.addRule({ effect: 'permit', action_class: 'filesystem.read', reason: 'ac_permit' });
      engine.addRule(resourceForbid);
      const result = engine.evaluateByActionClass('filesystem.read', '/tmp/file', ctx);
      expect(result.effect).toBe('forbid');
      expect(result.reason).toBe('res_forbid');
      expect(result.matchedRule).toBe(resourceForbid);
    });

    it('does not match action_class rule for a different action class', () => {
      engine.addRule({ effect: 'forbid', action_class: 'filesystem.write', reason: 'writes_blocked' });
      const strictEngine = new PolicyEngine({ defaultEffect: 'forbid' });
      strictEngine.addRule({ effect: 'forbid', action_class: 'filesystem.write', reason: 'writes_blocked' });
      // filesystem.read doesn't match filesystem.write rule
      const result = strictEngine.evaluateByActionClass('filesystem.read', '/tmp/file', ctx);
      expect(result.effect).toBe('forbid');
      expect(result.reason).toMatch(/implicit deny/i);
      expect(result.matchedRule).toBeUndefined();
    });

    it('condition functions apply to action_class rules', () => {
      engine.addRule({
        effect: 'forbid',
        action_class: 'filesystem.read',
        reason: 'restricted',
        condition: (c) => c.agentId === 'restricted-agent',
      });
      const restrictedCtx: RuleContext = { agentId: 'restricted-agent', channel: 'default' };
      expect(engine.evaluateByActionClass('filesystem.read', '/tmp/x', restrictedCtx).effect).toBe('forbid');
      // condition fails for normal agent → falls through to implicit permit
      expect(engine.evaluateByActionClass('filesystem.read', '/tmp/x', ctx).effect).toBe('permit');
    });

    it('Cedar semantics: action_class forbid wins over action_class permit for same action_class', () => {
      engine.addRule({ effect: 'permit', action_class: 'filesystem.read', reason: 'baseline_permit' });
      engine.addRule({ effect: 'forbid', action_class: 'filesystem.read', reason: 'read_blocked' });
      const result = engine.evaluateByActionClass('filesystem.read', '/tmp/file', ctx);
      expect(result.effect).toBe('forbid');
      expect(result.reason).toBe('read_blocked');
    });

    it('action_class permit includes matchedRule reference', () => {
      const rule: Rule = { effect: 'permit', action_class: 'payment.transfer', reason: 'approved' };
      engine.addRule(rule);
      const result = engine.evaluateByActionClass('payment.transfer', 'acct-123', ctx);
      expect(result.matchedRule).toBe(rule);
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

  describe('evaluateByIntentGroup', () => {
    it('returns permit with no-opinion reason when no rules have the given intent_group', () => {
      engine.addRule({ effect: 'forbid', resource: 'tool', match: '*' });
      const result = engine.evaluateByIntentGroup('destructive_fs', ctx);
      expect(result.effect).toBe('permit');
      expect(result.reason).toMatch(/no matching intent_group rule/i);
      expect(result.matchedRule).toBeUndefined();
    });

    it('forbids when a rule with matching intent_group has effect forbid', () => {
      engine.addRule({ effect: 'forbid', intent_group: 'destructive_fs', reason: 'no_delete_allowed' });
      const result = engine.evaluateByIntentGroup('destructive_fs', ctx);
      expect(result.effect).toBe('forbid');
      expect(result.reason).toBe('no_delete_allowed');
    });

    it('permits when a rule with matching intent_group has effect permit', () => {
      engine.addRule({ effect: 'permit', intent_group: 'web_access', reason: 'web_allowed' });
      const result = engine.evaluateByIntentGroup('web_access', ctx);
      expect(result.effect).toBe('permit');
      expect(result.reason).toBe('web_allowed');
    });

    it('Cedar semantics: forbid wins over permit for same intent_group', () => {
      engine.addRule({ effect: 'permit', intent_group: 'destructive_fs', reason: 'baseline_permit' });
      engine.addRule({ effect: 'forbid', intent_group: 'destructive_fs', reason: 'delete_blocked' });
      const result = engine.evaluateByIntentGroup('destructive_fs', ctx);
      expect(result.effect).toBe('forbid');
      expect(result.reason).toBe('delete_blocked');
    });

    it('ignores rules with a different intent_group', () => {
      engine.addRule({ effect: 'forbid', intent_group: 'external_send', reason: 'comms_blocked' });
      const result = engine.evaluateByIntentGroup('destructive_fs', ctx);
      expect(result.effect).toBe('permit');
    });

    it('applies condition function to intent_group rules', () => {
      engine.addRule({
        effect: 'forbid',
        intent_group: 'destructive_fs',
        reason: 'restricted',
        condition: (c) => c.agentId === 'restricted-agent',
      });
      const restrictedCtx: RuleContext = { agentId: 'restricted-agent', channel: 'default' };
      expect(engine.evaluateByIntentGroup('destructive_fs', restrictedCtx).effect).toBe('forbid');
      // non-matching condition → no opinion
      expect(engine.evaluateByIntentGroup('destructive_fs', ctx).effect).toBe('permit');
    });

    it('includes matchedRule reference in the decision', () => {
      const rule: Rule = { effect: 'forbid', intent_group: 'credential_access', reason: 'secrets_blocked' };
      engine.addRule(rule);
      const result = engine.evaluateByIntentGroup('credential_access', ctx);
      expect(result.matchedRule).toBe(rule);
    });

    it('ignores rules without intent_group even when they match resource/name', () => {
      engine.addRule({ effect: 'forbid', resource: 'tool', match: '*' });
      const result = engine.evaluateByIntentGroup('destructive_fs', ctx);
      expect(result.effect).toBe('permit');
    });
  });

  describe('target matching — target_match regex and target_in array', () => {
    it('TC-TM-01: target_match regex blocks matching email addresses', () => {
      engine.addRule({ effect: 'permit', resource: 'external', match: '*' });
      engine.addRule({
        effect: 'forbid',
        resource: 'external',
        match: '*',
        target_match: /^blocked@evil\.com$/,
        reason: 'blocked_address',
      });
      // Matching address is forbidden
      const blocked = engine.evaluate('external', 'blocked@evil.com', ctx);
      expect(blocked.effect).toBe('forbid');
      expect(blocked.reason).toBe('blocked_address');
      // Non-matching address is permitted by the wildcard permit rule
      expect(engine.evaluate('external', 'safe@acme.com', ctx).effect).toBe('permit');
    });

    it('TC-TM-02: target_in array blocks listed targets', () => {
      engine.addRule({
        effect: 'forbid',
        action_class: 'communication.email',
        target_in: ['spam@blocked.com', 'abuse@badactor.net'],
        reason: 'blocked_address_list',
      });
      const r1 = engine.evaluateByActionClass('communication.email', 'spam@blocked.com', ctx);
      expect(r1.effect).toBe('forbid');
      expect(r1.reason).toBe('blocked_address_list');

      const r2 = engine.evaluateByActionClass('communication.email', 'abuse@badactor.net', ctx);
      expect(r2.effect).toBe('forbid');
      expect(r2.reason).toBe('blocked_address_list');

      // Target not in the list falls through to implicit permit
      const r3 = engine.evaluateByActionClass('communication.email', 'good@trusted.com', ctx);
      expect(r3.effect).toBe('permit');
    });

    it('target_match does not prevent non-matching targets from passing through', () => {
      const strictEngine = new PolicyEngine({ defaultEffect: 'forbid' });
      strictEngine.addRule({
        effect: 'forbid',
        resource: 'external',
        match: '*',
        target_match: /@evil\.com$/,
        reason: 'evil_domain',
      });
      // Non-evil.com address: target_match skips this rule, falls to implicit deny
      const result = strictEngine.evaluate('external', 'safe@acme.com', ctx);
      expect(result.effect).toBe('forbid');
      expect(result.matchedRule).toBeUndefined(); // no matched rule — implicit deny
      expect(result.reason).toMatch(/implicit deny/i);
    });

    it('target_in matching is case-insensitive', () => {
      engine.addRule({
        effect: 'forbid',
        resource: 'external',
        match: '*',
        target_in: ['BLOCKED@EVIL.COM'],
        reason: 'case_insensitive_block',
      });
      expect(engine.evaluate('external', 'blocked@evil.com', ctx).effect).toBe('forbid');
      expect(engine.evaluate('external', 'BLOCKED@EVIL.COM', ctx).effect).toBe('forbid');
    });

    it('target_match works with action_class rules in evaluateByActionClass', () => {
      engine.addRule({
        effect: 'forbid',
        action_class: 'communication.email',
        target_match: /^specific@target\.com$/,
        reason: 'targeted_block',
      });
      const blocked = engine.evaluateByActionClass('communication.email', 'specific@target.com', ctx);
      expect(blocked.effect).toBe('forbid');
      expect(blocked.reason).toBe('targeted_block');
      // Other targets are not affected
      const allowed = engine.evaluateByActionClass('communication.email', 'other@target.com', ctx);
      expect(allowed.effect).toBe('permit');
    });

    it('target_match string permits exact-match target and blocks others', () => {
      const strictEngine = new PolicyEngine({ defaultEffect: 'forbid' });
      strictEngine.addRule({
        effect: 'permit',
        resource: 'external',
        match: '*',
        target_match: 'allowed@acme.com',
      });
      expect(strictEngine.evaluate('external', 'allowed@acme.com', ctx).effect).toBe('permit');
      // Different address: target_match filters it out, falls to implicit deny
      expect(strictEngine.evaluate('external', 'other@acme.com', ctx).effect).toBe('forbid');
    });

    it('target_in with empty array never matches', () => {
      const strictEngine = new PolicyEngine({ defaultEffect: 'forbid' });
      strictEngine.addRule({
        effect: 'permit',
        resource: 'external',
        match: '*',
        target_in: [],
      });
      expect(strictEngine.evaluate('external', 'anything@example.com', ctx).effect).toBe('forbid');
    });

    it('TC-TM-07: target param enables command-specific matching within a tool type', () => {
      engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
      engine.addRule({
        effect: 'forbid',
        resource: 'tool',
        match: 'Bash',
        target_match: /^docker run.*--privileged/,
        reason: 'privileged_docker',
      });
      // Same tool name 'Bash', but command contains --privileged → forbidden
      const blocked = engine.evaluate('tool', 'Bash', ctx, 'docker run --privileged nginx');
      expect(blocked.effect).toBe('forbid');
      expect(blocked.reason).toBe('privileged_docker');
      // Same tool, safe command → target_match skips the forbid rule, permit wins
      const allowed = engine.evaluate('tool', 'Bash', ctx, 'docker run nginx');
      expect(allowed.effect).toBe('permit');
    });

    it('TC-TM-08: omitting target falls back to resourceName for target_match (backward compat)', () => {
      engine.addRule({
        effect: 'forbid',
        resource: 'external',
        match: '*',
        target_match: /^blocked@evil\.com$/,
        reason: 'blocked',
      });
      // Old-style call without target — target_match is checked against resourceName
      expect(engine.evaluate('external', 'blocked@evil.com', ctx).effect).toBe('forbid');
      expect(engine.evaluate('external', 'safe@ok.com', ctx).effect).toBe('permit');
    });

    it('TC-TM-09: target_in matches against the explicit target, not resourceName', () => {
      const strictEngine = new PolicyEngine({ defaultEffect: 'forbid' });
      strictEngine.addRule({
        effect: 'permit',
        resource: 'tool',
        match: 'Bash',
        target_in: ['git status', 'git log'],
      });
      expect(strictEngine.evaluate('tool', 'Bash', ctx, 'git status').effect).toBe('permit');
      expect(strictEngine.evaluate('tool', 'Bash', ctx, 'git log').effect).toBe('permit');
      // Command not in the list → rule is skipped, implicit deny in strict mode
      expect(strictEngine.evaluate('tool', 'Bash', ctx, 'rm -rf /').effect).toBe('forbid');
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

  describe('intent_group blocks action without action_class rule', () => {
    it('evaluateByIntentGroup external_send forbids when intent_group rule is loaded', () => {
      engine.addRule({ effect: 'forbid', intent_group: 'external_send', reason: 'no_external_comms' });
      const result = engine.evaluateByIntentGroup('external_send', ctx);
      expect(result.effect).toBe('forbid');
      expect(result.reason).toBe('no_external_comms');
    });

    it('intent_group external_send blocks communication.slack even with no action_class rule', () => {
      // Load only an intent_group rule — no action_class rule for communication.slack
      engine.addRule({ effect: 'forbid', intent_group: 'external_send', reason: 'comms_blocked' });

      // Without an action_class rule, evaluateByActionClass permits communication.slack
      const actionClassResult = engine.evaluateByActionClass('communication.slack', '#general', ctx);
      expect(actionClassResult.effect).toBe('permit');

      // The intent_group rule blocks via evaluateByIntentGroup
      const intentGroupResult = engine.evaluateByIntentGroup('external_send', ctx);
      expect(intentGroupResult.effect).toBe('forbid');
      expect(intentGroupResult.reason).toBe('comms_blocked');
    });

    it('intent_group rule blocks all external_send actions (email and slack)', () => {
      engine.addRule({ effect: 'forbid', intent_group: 'external_send', reason: 'no_external_send' });
      // Both communication.email and communication.slack share intent_group external_send
      expect(engine.evaluateByIntentGroup('external_send', ctx).effect).toBe('forbid');
    });

    it('matched rule reference is set on the intent_group forbid decision', () => {
      const rule: Rule = { effect: 'forbid', intent_group: 'external_send', reason: 'comms_blocked' };
      engine.addRule(rule);
      const result = engine.evaluateByIntentGroup('external_send', ctx);
      expect(result.matchedRule).toBe(rule);
    });
  });

  // Regression test for Issue #1: exec blocks were blocking everything.
  // Confirms that common actions are permitted by default when no explicit rules apply.
  describe('regression: default-permit for common actions (Issue #1)', () => {
    it('permits filesystem.read when no rules exist', () => {
      const result = engine.evaluateByActionClass('filesystem.read', '/home/user/file.txt', ctx);
      expect(result.effect).toBe('permit');
    });

    it('permits network.request when no rules exist', () => {
      const result = engine.evaluateByActionClass('network.request', 'https://example.com', ctx);
      expect(result.effect).toBe('permit');
    });

    it('permits shell.exec when no rules exist', () => {
      const result = engine.evaluateByActionClass('shell.exec', 'ls -la', ctx);
      expect(result.effect).toBe('permit');
    });

    it('permits all three actions when unrelated forbid rules are loaded', () => {
      engine.addRule({ effect: 'forbid', resource: 'payment', match: '*', reason: 'payments_blocked' });
      expect(engine.evaluateByActionClass('filesystem.read', '/tmp/data', ctx).effect).toBe('permit');
      expect(engine.evaluateByActionClass('network.request', 'https://api.example.com', ctx).effect).toBe('permit');
      expect(engine.evaluateByActionClass('shell.exec', 'echo hello', ctx).effect).toBe('permit');
    });
  });
});

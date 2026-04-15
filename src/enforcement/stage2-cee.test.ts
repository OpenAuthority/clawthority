/**
 * Stage 2 CEE (Constraint Enforcement Engine) — test suite
 *
 * Covers all enforcement scenarios for createStage2:
 *   1. Normal filesystem.read on regular path → permit
 *   2. filesystem.write on ~/.ssh/ → forbid (protected_path)
 *   3. communication.external.send to untrusted domain → forbid (untrusted_domain)
 *   4. Engine exception → forbid (stage2_error)
 *   5. PolicyEngine forbid decisions propagate correctly
 *   6. Protected path prefix matching via RegExp rule
 *   7. Reason defaults to effect string when engine returns no reason
 *   8. Engine receives correct action_class, target, and rule_context
 */
import { describe, it, expect, vi } from 'vitest';
import { createStage2, createEnforcementEngine } from './stage2-policy.js';
import { EnforcementPolicyEngine } from './pipeline.js';
import type { PipelineContext } from './pipeline.js';
import type { Rule } from '../policy/types.js';
import defaultRules from '../policy/rules/default.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    action_class: 'filesystem.read',
    target: '/tmp/safe.txt',
    payload_hash: 'abc123',
    hitl_mode: 'none',
    rule_context: { agentId: 'agent-1', channel: 'test' },
    ...overrides,
  };
}

// ─── createStage2 ─────────────────────────────────────────────────────────────

describe('createStage2', () => {
  // ── 1. Normal permit path ────────────────────────────────────────────────

  it('permits a normal filesystem.read on a regular path', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockReturnValue({
      effect: 'permit',
      reason: 'allowed',
    });
    const stage2 = createStage2(engine);
    const result = await stage2(makeCtx());
    expect(result.effect).toBe('permit');
    expect(result.reason).toBe('allowed');
    expect(result.stage).toBe('stage2');
  });

  // ── 2. Protected path forbid ─────────────────────────────────────────────

  it('forbids filesystem.write on ~/.ssh/ with protected_path reason', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockReturnValue({
      effect: 'forbid',
      reason: 'protected_path',
    });
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCtx({ action_class: 'filesystem.write', target: '/home/user/.ssh/id_rsa' }),
    );
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('protected_path');
    expect(result.stage).toBe('stage2');
  });

  // ── 3. Untrusted domain forbid ───────────────────────────────────────────

  it('forbids communication.external.send to an untrusted domain', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockReturnValue({
      effect: 'forbid',
      reason: 'untrusted_domain',
    });
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCtx({ action_class: 'communication.external.send', target: 'evil.example.com' }),
    );
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('untrusted_domain');
    expect(result.stage).toBe('stage2');
  });

  // ── 4. Exception handling (fail closed) ──────────────────────────────────

  it('fails closed with stage2_error when engine throws', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockImplementation(() => {
      throw new Error('engine failure');
    });
    const stage2 = createStage2(engine);
    const result = await stage2(makeCtx());
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('stage2_error');
    expect(result.stage).toBe('stage2');
  });

  // ── 5. Forbid propagation ─────────────────────────────────────────────────

  it('propagates engine forbid decisions with arbitrary custom reason', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockReturnValue({
      effect: 'forbid',
      reason: 'policy_violation',
    });
    const stage2 = createStage2(engine);
    const result = await stage2(makeCtx());
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('policy_violation');
    expect(result.stage).toBe('stage2');
  });

  it('defaults reason to effect string when engine returns no reason', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockReturnValue({ effect: 'permit' });
    const stage2 = createStage2(engine);
    const result = await stage2(makeCtx());
    expect(result.effect).toBe('permit');
    expect(result.reason).toBe('permit');
    expect(result.stage).toBe('stage2');
  });

  it('defaults reason to "forbid" string when engine forbids with no reason', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockReturnValue({ effect: 'forbid' });
    const stage2 = createStage2(engine);
    const result = await stage2(makeCtx());
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('forbid');
    expect(result.stage).toBe('stage2');
  });

  // ── 6. Protected path prefix matching via real engine + RegExp rule ───────

  it('forbids write matching ~/.ssh/ prefix via RegExp rule', async () => {
    const engine = new EnforcementPolicyEngine();
    const rules: Rule[] = [
      {
        effect: 'forbid',
        resource: 'tool',
        match: /^(\/home\/[^/]+|~)\/\.ssh\//,
        reason: 'protected_path',
      },
    ];
    engine.addRules(rules);
    const stage2 = createStage2(engine);

    const results = await Promise.all([
      stage2(makeCtx({ action_class: 'filesystem.write', target: '/home/alice/.ssh/id_rsa' })),
      stage2(makeCtx({ action_class: 'filesystem.write', target: '/home/bob/.ssh/config' })),
      stage2(makeCtx({ action_class: 'filesystem.write', target: '/home/carol/.ssh/authorized_keys' })),
    ]);

    for (const r of results) {
      expect(r.effect).toBe('forbid');
      expect(r.reason).toBe('protected_path');
      expect(r.stage).toBe('stage2');
    }
  });

  it('permits reads on non-protected paths when a blanket permit rule is present', async () => {
    const engine = new EnforcementPolicyEngine();
    const rules: Rule[] = [
      {
        effect: 'forbid',
        resource: 'tool',
        match: /^(\/home\/[^/]+|~)\/\.ssh\//,
        reason: 'protected_path',
      },
      {
        effect: 'permit',
        resource: 'tool',
        match: '*',
        reason: 'default_permit',
      },
    ];
    engine.addRules(rules);
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCtx({ action_class: 'filesystem.read', target: '/tmp/safe-file.txt' }),
    );
    expect(result.effect).toBe('permit');
  });

  it('forbids writes to exactly matched protected path via string rule', async () => {
    const engine = new EnforcementPolicyEngine();
    const rules: Rule[] = [
      {
        effect: 'forbid',
        resource: 'tool',
        match: '/etc/passwd',
        reason: 'protected_path',
      },
    ];
    engine.addRules(rules);
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCtx({ action_class: 'filesystem.write', target: '/etc/passwd' }),
    );
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('protected_path');
  });

  it('permits write to different path when only a specific path is protected', async () => {
    const engine = new EnforcementPolicyEngine();
    const rules: Rule[] = [
      {
        effect: 'forbid',
        resource: 'tool',
        match: '/etc/passwd',
        reason: 'protected_path',
      },
    ];
    engine.addRules(rules);
    const stage2 = createStage2(engine);
    // No matching rule → implicit permit (defaultEffect defaults to 'permit')
    const result = await stage2(
      makeCtx({ action_class: 'filesystem.write', target: '/tmp/output.txt' }),
    );
    expect(result.effect).toBe('permit');
  });

  // ── 7. Domain forbid via real engine + channel resource ───────────────────

  it('forbids external.send to blocked domain via channel rule', async () => {
    const engine = new EnforcementPolicyEngine();
    const rules: Rule[] = [
      {
        effect: 'forbid',
        resource: 'channel',
        match: 'evil.example.com',
        reason: 'untrusted_domain',
      },
    ];
    engine.addRules(rules);
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCtx({ action_class: 'communication.external.send', target: 'evil.example.com' }),
    );
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('untrusted_domain');
    expect(result.stage).toBe('stage2');
  });

  // ── 8. Correct arguments forwarded to engine ─────────────────────────────

  it('forwards action_class, target, and rule_context verbatim to the engine', async () => {
    const engine = new EnforcementPolicyEngine();
    const spy = vi.spyOn(engine, 'evaluateByActionClass').mockReturnValue({
      effect: 'permit',
      reason: 'ok',
    });
    const ctx = makeCtx({
      action_class: 'communication.external.send',
      target: 'trusted.example.com',
      rule_context: { agentId: 'agent-42', channel: 'prod' },
    });
    const stage2 = createStage2(engine);
    await stage2(ctx);
    expect(spy).toHaveBeenCalledWith(
      'communication.external.send',
      'trusted.example.com',
      { agentId: 'agent-42', channel: 'prod' },
    );
  });

  it('stage is always "stage2" regardless of engine outcome', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockReturnValueOnce({ effect: 'permit', reason: 'p' })
      .mockReturnValueOnce({ effect: 'forbid', reason: 'f' });
    const stage2 = createStage2(engine);
    const [permit, forbid] = await Promise.all([stage2(makeCtx()), stage2(makeCtx())]);
    expect(permit.stage).toBe('stage2');
    expect(forbid.stage).toBe('stage2');
  });

  // ── 9. Intent group evaluation ────────────────────────────────────────────

  it('forbids when an intent_group rule forbids even if action_class evaluation permits', async () => {
    const engine = new EnforcementPolicyEngine();
    engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
    engine.addRule({ effect: 'forbid', intent_group: 'destructive_fs', reason: 'no_deletion' });

    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCtx({ action_class: 'filesystem.delete', target: '/tmp/test.txt', intent_group: 'destructive_fs' }),
    );
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('no_deletion');
    expect(result.stage).toBe('stage2');
  });

  it('permits when intent_group rule permits and action_class evaluation permits', async () => {
    const engine = new EnforcementPolicyEngine();
    engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
    engine.addRule({ effect: 'permit', intent_group: 'web_access', reason: 'web_ok' });

    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCtx({ action_class: 'web.fetch', target: 'https://example.com', intent_group: 'web_access' }),
    );
    expect(result.effect).toBe('permit');
    expect(result.stage).toBe('stage2');
  });

  it('skips intent_group evaluation when ctx.intent_group is undefined', async () => {
    const engine = new EnforcementPolicyEngine();
    engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
    engine.addRule({ effect: 'forbid', intent_group: 'destructive_fs', reason: 'blocked' });
    const igSpy = vi.spyOn(engine, 'evaluateByIntentGroup');

    const stage2 = createStage2(engine);
    const result = await stage2(makeCtx({ action_class: 'filesystem.delete', target: '/tmp/x' }));
    expect(igSpy).not.toHaveBeenCalled();
    expect(result.effect).toBe('permit');
  });

  it('action_class forbid wins before intent_group is evaluated', async () => {
    const engine = new EnforcementPolicyEngine();
    // EnforcementPolicyEngine maps filesystem.* → 'tool', so use resource: 'tool'
    engine.addRule({ effect: 'forbid', resource: 'tool', match: '*', reason: 'all_files_blocked' });
    engine.addRule({ effect: 'permit', intent_group: 'destructive_fs', reason: 'intent_permits' });
    const igSpy = vi.spyOn(engine, 'evaluateByIntentGroup');

    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCtx({ action_class: 'filesystem.delete', target: '/tmp/x', intent_group: 'destructive_fs' }),
    );
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('all_files_blocked');
    expect(igSpy).not.toHaveBeenCalled();
  });

  it('all aliases for same intent_group apply the same intent_group policy', async () => {
    const engine = new EnforcementPolicyEngine();
    engine.addRule({ effect: 'permit', resource: 'tool', match: '*' });
    engine.addRule({ effect: 'forbid', intent_group: 'external_send', reason: 'comms_blocked' });

    const stage2 = createStage2(engine);
    const [emailResult, slackResult] = await Promise.all([
      stage2(makeCtx({ action_class: 'communication.email', target: 'user@example.com', intent_group: 'external_send' })),
      stage2(makeCtx({ action_class: 'communication.slack', target: '#general', intent_group: 'external_send' })),
    ]);
    expect(emailResult.effect).toBe('forbid');
    expect(emailResult.reason).toBe('comms_blocked');
    expect(slackResult.effect).toBe('forbid');
    expect(slackResult.reason).toBe('comms_blocked');
  });
});

// ─── PII blocking — card data (integration) ───────────────────────────────────

describe('PII blocking — card data (integration)', () => {
  const CARD_NUMBER = '4111111111111111';
  const CLEAN_PAYLOAD = 'Order #12345 for customer Alice — total $99.00';

  function makeCardCtx(
    action_class: string,
    target: string,
    payload?: string,
  ): PipelineContext {
    return {
      action_class,
      target,
      payload_hash: 'abc',
      hitl_mode: 'none',
      intent_group: 'external_send',
      rule_context: {
        agentId: 'agent-1',
        channel: 'test',
        metadata: payload !== undefined ? { payload } : undefined,
      },
    };
  }

  // ── Forbid each channel with sensitive payload ────────────────────────────

  it('forbids communication.email when payload contains a card number', async () => {
    const engine = createEnforcementEngine(defaultRules);
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCardCtx('communication.email', 'user@example.com', `Please charge card ${CARD_NUMBER}`),
    );
    expect(result.effect).toBe('forbid');
    expect(result.stage).toBe('stage2');
  });

  it('forbids communication.slack when payload contains a card number', async () => {
    const engine = createEnforcementEngine(defaultRules);
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCardCtx('communication.slack', '#payments', `Card: ${CARD_NUMBER}`),
    );
    expect(result.effect).toBe('forbid');
    expect(result.stage).toBe('stage2');
  });

  it('forbids communication.webhook when payload contains a card number', async () => {
    const engine = createEnforcementEngine(defaultRules);
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCardCtx('communication.webhook', 'https://hook.example.com', `card_number=${CARD_NUMBER}`),
    );
    expect(result.effect).toBe('forbid');
    expect(result.stage).toBe('stage2');
  });

  // ── Permit with clean payload ────────────────────────────────────────────

  it('permits communication.email when payload contains no card data', async () => {
    const engine = createEnforcementEngine(defaultRules);
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCardCtx('communication.email', 'user@example.com', CLEAN_PAYLOAD),
    );
    expect(result.effect).toBe('permit');
  });

  // ── Permit when no payload field is present ──────────────────────────────

  it('permits communication.email when no payload metadata is present', async () => {
    const engine = createEnforcementEngine(defaultRules);
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCardCtx('communication.email', 'user@example.com', undefined),
    );
    expect(result.effect).toBe('permit');
  });

  // ── Combined: all three external_send channels forbid the same card string ─

  it('all three external_send channels forbid the same card payload', async () => {
    const engine = createEnforcementEngine(defaultRules);
    const stage2 = createStage2(engine);
    const payload = `Sending card ${CARD_NUMBER} to processor`;

    const [emailResult, slackResult, webhookResult] = await Promise.all([
      stage2(makeCardCtx('communication.email', 'user@example.com', payload)),
      stage2(makeCardCtx('communication.slack', '#alerts', payload)),
      stage2(makeCardCtx('communication.webhook', 'https://hook.example.com', payload)),
    ]);

    expect(emailResult.effect).toBe('forbid');
    expect(slackResult.effect).toBe('forbid');
    expect(webhookResult.effect).toBe('forbid');
  });
});

// ─── createEnforcementEngine ─────────────────────────────────────────────────

describe('createEnforcementEngine', () => {
  it('returns an EnforcementPolicyEngine instance', () => {
    const engine = createEnforcementEngine();
    expect(engine).toBeInstanceOf(EnforcementPolicyEngine);
  });

  it('returns engine with no rules when called with no arguments', () => {
    const engine = createEnforcementEngine();
    expect(engine.rules).toHaveLength(0);
  });

  it('returns engine with no rules when called with empty array', () => {
    const engine = createEnforcementEngine([]);
    expect(engine.rules).toHaveLength(0);
  });

  it('loads provided rules into the engine', () => {
    const rules: Rule[] = [
      { effect: 'permit', resource: 'tool', match: '*' },
      { effect: 'forbid', resource: 'channel', match: 'blocked.com', reason: 'blocked' },
    ];
    const engine = createEnforcementEngine(rules);
    expect(engine.rules).toHaveLength(2);
  });
});

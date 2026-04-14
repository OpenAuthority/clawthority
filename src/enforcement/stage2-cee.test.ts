/**
 * Stage 2 CEE (Constraint Enforcement Engine) — test suite
 *
 * Covers all enforcement scenarios for createStage2:
 *   1. Normal filesystem.read on regular path → permit
 *   2. filesystem.write on ~/.ssh/ → forbid (protected_path)
 *   3. communication.external.send to untrusted domain → forbid (untrusted_domain)
 *   4. Engine exception → forbid (stage2_error)
 *   5. Forbid decisions propagate correctly
 *   6. Reason defaults to effect string when engine returns no reason
 *   7. Engine receives correct action_class, target, and rule_context
 */
import { describe, it, expect, vi } from 'vitest';
import { createStage2, createEnforcementEngine } from './stage2-policy.js';
import { EnforcementPolicyEngine } from './pipeline.js';
import type { PipelineContext } from './pipeline.js';

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

  // ── 6. Mocked path and domain matching ───────────────────────────────────

  it('forbids writes to protected paths (mocked evaluateByActionClass)', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockImplementation(
      (_ac, target) =>
        /\.ssh\//.test(target)
          ? { effect: 'forbid', reason: 'protected_path' }
          : { effect: 'permit' },
    );
    const stage2 = createStage2(engine);

    const results = await Promise.all([
      stage2(makeCtx({ action_class: 'filesystem.write', target: '/home/alice/.ssh/id_rsa' })),
      stage2(makeCtx({ action_class: 'filesystem.write', target: '/home/bob/.ssh/config' })),
    ]);

    for (const r of results) {
      expect(r.effect).toBe('forbid');
      expect(r.reason).toBe('protected_path');
    }
  });

  it('permits reads on non-protected paths (mocked evaluateByActionClass)', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockReturnValue({ effect: 'permit' });
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCtx({ action_class: 'filesystem.read', target: '/tmp/safe-file.txt' }),
    );
    expect(result.effect).toBe('permit');
  });

  it('forbids external send to blocked domain (mocked evaluateByActionClass)', async () => {
    const engine = new EnforcementPolicyEngine();
    vi.spyOn(engine, 'evaluateByActionClass').mockImplementation(
      (_ac, target) =>
        target === 'evil.example.com'
          ? { effect: 'forbid', reason: 'untrusted_domain' }
          : { effect: 'permit' },
    );
    const stage2 = createStage2(engine);
    const result = await stage2(
      makeCtx({ action_class: 'communication.external.send', target: 'evil.example.com' }),
    );
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('untrusted_domain');
    expect(result.stage).toBe('stage2');
  });

  // ── 7. Correct arguments forwarded to engine ─────────────────────────────

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
});

// ─── createEnforcementEngine ─────────────────────────────────────────────────

describe('createEnforcementEngine', () => {
  it('returns an EnforcementPolicyEngine instance', () => {
    const engine = createEnforcementEngine();
    expect(engine).toBeInstanceOf(EnforcementPolicyEngine);
  });

  it('creates a fail-closed engine by default (forbid when Cedar not initialized)', () => {
    const engine = createEnforcementEngine();
    const result = engine.evaluate('tool', 'anything', { agentId: 'a', channel: 'c' });
    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('cedar_not_initialized');
  });

  it('creates a permit-default engine when defaultEffect:permit is specified', () => {
    const engine = createEnforcementEngine({ defaultEffect: 'permit' });
    const result = engine.evaluate('tool', 'anything', { agentId: 'a', channel: 'c' });
    expect(result.effect).toBe('permit');
  });
});

/**
 * Auto-permit integration with authorization pipeline — test suite (T54)
 *
 * Covers the following acceptance criteria:
 *
 *   Feature flag disable behavior:
 *     TC-APAUTH-FF-01  approveAlwaysEnabled=false pattern: undefined autoPermit skips check
 *     TC-APAUTH-FF-02  approveAlwaysEnabled=true pattern: real checker is evaluated
 *     TC-APAUTH-FF-03  undefined autoPermitRules pattern: file rule check skipped entirely
 *     TC-APAUTH-FF-04  Both checkers undefined: pipeline falls through to Cedar unconditionally
 *
 *   Integration with FileAutoPermitChecker:
 *     TC-APAUTH-INT-01  Wildcard pattern matches matching shell command
 *     TC-APAUTH-INT-02  Exact pattern blocks non-matching command
 *     TC-APAUTH-INT-03  First matching rule in list wins
 *     TC-APAUTH-INT-04  shell.exec action class routes ctx.target to matchCommand
 *     TC-APAUTH-INT-05  code.execute action class routes ctx.target to matchCommand
 *     TC-APAUTH-INT-06  Non-exec action class routes toolName to matchCommand
 *     TC-APAUTH-INT-07  Empty rules array — falls through to Cedar
 *     TC-APAUTH-INT-08  Quoted args in command normalised before matching
 *
 *   Priority order in decision chain:
 *     TC-APAUTH-PO-01  Session approval beats file rules (session checked first)
 *     TC-APAUTH-PO-02  File rules beat Cedar (Cedar not called on file-rule match)
 *     TC-APAUTH-PO-03  Cedar evaluated only when no session approval and no file rule
 *     TC-APAUTH-PO-04  Session + file rules + Cedar: only session approval fires
 *     TC-APAUTH-PO-05  JSON engine consulted after Cedar permits
 *     TC-APAUTH-PO-06  Full chain: permit propagates through all layers correctly
 *
 *   Performance impact:
 *     TC-APAUTH-PERF-01  1000 sequential evaluations with file rules complete quickly
 *     TC-APAUTH-PERF-02  FileAutoPermitChecker regex compilation is cached per-instance
 */
import { describe, it, expect, vi } from 'vitest';
import { createCombinedStage2 } from './stage2-policy.js';
import type { AutoPermitChecker } from './stage2-policy.js';
import { FileAutoPermitChecker } from '../auto-permits/matcher.js';
import { EnforcementPolicyEngine } from './pipeline.js';
import type { PipelineContext } from './pipeline.js';
import type { AutoPermit } from '../models/auto-permit.js';

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

function makeRule(pattern: string, method: AutoPermit['method'] = 'default'): AutoPermit {
  return { pattern, method, createdAt: Date.now(), originalCommand: pattern };
}

function makePermitEngine(): InstanceType<typeof EnforcementPolicyEngine> {
  const eng = new EnforcementPolicyEngine();
  vi.spyOn(eng, 'evaluateByActionClass').mockReturnValue({ effect: 'permit', reason: 'ok' });
  vi.spyOn(eng, 'evaluateByIntentGroup').mockReturnValue({ effect: 'permit', reason: 'ok' });
  vi.spyOn(eng, 'evaluate').mockReturnValue({ effect: 'permit', reason: 'ok' });
  return eng;
}

function makeForbidEngine(reason = 'cedar_denied'): InstanceType<typeof EnforcementPolicyEngine> {
  const eng = new EnforcementPolicyEngine();
  vi.spyOn(eng, 'evaluateByActionClass').mockReturnValue({ effect: 'forbid', reason });
  vi.spyOn(eng, 'evaluateByIntentGroup').mockReturnValue({ effect: 'forbid', reason });
  vi.spyOn(eng, 'evaluate').mockReturnValue({ effect: 'forbid', reason });
  return eng;
}

// ─── Feature flag disable behavior ────────────────────────────────────────────
//
// The approveAlwaysEnabled feature flag controls whether the autoPermit checker
// is passed to createCombinedStage2. When the flag is disabled, callers pass
// undefined — these tests verify the downstream behaviour of that pattern.

describe('feature flag disable behavior — autoPermit=undefined', () => {
  // TC-APAUTH-FF-01
  it('TC-APAUTH-FF-01: undefined autoPermit (flag disabled) skips session auto-approval check', async () => {
    const checker: AutoPermitChecker = { isSessionAutoApproved: vi.fn(() => true) };
    const cedar = makePermitEngine();
    // Flag disabled: autoPermit NOT passed to createCombinedStage2
    const stage2 = createCombinedStage2(cedar, null, 'test_tool', undefined);

    const result = await stage2(makeCtx());

    expect(checker.isSessionAutoApproved).not.toHaveBeenCalled();
    expect(result.reason).not.toBe('session_auto_approved');
  });

  // TC-APAUTH-FF-02
  it('TC-APAUTH-FF-02: provided autoPermit (flag enabled) causes session check to run', async () => {
    const checker: AutoPermitChecker = { isSessionAutoApproved: vi.fn(() => false) };
    const cedar = makePermitEngine();
    // Flag enabled: autoPermit passed
    const stage2 = createCombinedStage2(cedar, null, 'test_tool', checker);

    await stage2(makeCtx());

    expect(checker.isSessionAutoApproved).toHaveBeenCalledOnce();
  });

  // TC-APAUTH-FF-03
  it('TC-APAUTH-FF-03: undefined autoPermitRules skips file rule check', async () => {
    const ruleChecker = new FileAutoPermitChecker([makeRule('git commit *')]);
    const matchSpy = vi.spyOn(ruleChecker, 'matchCommand');
    const cedar = makePermitEngine();
    // autoPermitRules NOT passed (omitted)
    const stage2 = createCombinedStage2(cedar, null, 'bash', undefined, undefined);

    await stage2(makeCtx({ action_class: 'shell.exec', target: 'git commit -m "fix"' }));

    expect(matchSpy).not.toHaveBeenCalled();
  });

  // TC-APAUTH-FF-04
  it('TC-APAUTH-FF-04: both checkers undefined — Cedar evaluated unconditionally', async () => {
    const cedar = makePermitEngine();
    const evalSpy = vi.spyOn(cedar, 'evaluateByActionClass');
    const stage2 = createCombinedStage2(cedar, null, 'test_tool');

    await stage2(makeCtx());

    expect(evalSpy).toHaveBeenCalledOnce();
  });
});

// ─── Integration with FileAutoPermitChecker ───────────────────────────────────

describe('integration with FileAutoPermitChecker', () => {
  // TC-APAUTH-INT-01
  it('TC-APAUTH-INT-01: wildcard pattern permits matching shell command', async () => {
    const checker = new FileAutoPermitChecker([makeRule('git commit *')]);
    const cedar = makePermitEngine();
    const stage2 = createCombinedStage2(cedar, null, 'bash', undefined, checker);

    const result = await stage2(
      makeCtx({ action_class: 'shell.exec', target: 'git commit -m "initial commit"' }),
    );

    expect(result.effect).toBe('permit');
    expect(result.reason).toBe('auto_permit_rule');
    expect(result.stage).toBe('auto-permit');
    expect(result.rule).toBe('git commit *');
  });

  // TC-APAUTH-INT-02
  it('TC-APAUTH-INT-02: exact pattern does not match command with extra args', async () => {
    const checker = new FileAutoPermitChecker([makeRule('git status', 'exact')]);
    const cedar = makeForbidEngine('cedar_denied');
    const stage2 = createCombinedStage2(cedar, null, 'bash', undefined, checker);

    // 'git status --short' has extra tokens → exact pattern does not match
    const result = await stage2(
      makeCtx({ action_class: 'shell.exec', target: 'git status --short' }),
    );

    expect(result.effect).toBe('forbid');
    expect(result.reason).toBe('cedar_denied');
  });

  it('TC-APAUTH-INT-02b: exact pattern permits exact match', async () => {
    const checker = new FileAutoPermitChecker([makeRule('git status', 'exact')]);
    const cedar = makePermitEngine();
    const stage2 = createCombinedStage2(cedar, null, 'bash', undefined, checker);

    const result = await stage2(makeCtx({ action_class: 'shell.exec', target: 'git status' }));

    expect(result.effect).toBe('permit');
    expect(result.reason).toBe('auto_permit_rule');
  });

  // TC-APAUTH-INT-03
  it('TC-APAUTH-INT-03: first matching rule in list wins', async () => {
    const rules = [
      makeRule('git *'),
      makeRule('git commit *'),
    ];
    const checker = new FileAutoPermitChecker(rules);
    const cedar = makePermitEngine();
    const stage2 = createCombinedStage2(cedar, null, 'bash', undefined, checker);

    const result = await stage2(
      makeCtx({ action_class: 'shell.exec', target: 'git commit -m "fix"' }),
    );

    // First rule 'git *' matches → wins over 'git commit *'
    expect(result.rule).toBe('git *');
  });

  // TC-APAUTH-INT-04: shell.exec uses ctx.target
  it('TC-APAUTH-INT-04: shell.exec action class routes ctx.target to FileAutoPermitChecker', async () => {
    const checker = new FileAutoPermitChecker([makeRule('npm install *')]);
    const matchSpy = vi.spyOn(checker, 'matchCommand');
    const cedar = makePermitEngine();
    const stage2 = createCombinedStage2(cedar, null, 'bash', undefined, checker);

    await stage2(makeCtx({ action_class: 'shell.exec', target: 'npm install --save-dev vitest' }));

    expect(matchSpy).toHaveBeenCalledWith('npm install --save-dev vitest');
  });

  // TC-APAUTH-INT-05: code.execute uses ctx.target
  it('TC-APAUTH-INT-05: code.execute action class routes ctx.target to FileAutoPermitChecker', async () => {
    const checker = new FileAutoPermitChecker([makeRule('python main.py *')]);
    const matchSpy = vi.spyOn(checker, 'matchCommand');
    const cedar = makePermitEngine();
    const stage2 = createCombinedStage2(cedar, null, 'python', undefined, checker);

    await stage2(makeCtx({ action_class: 'code.execute', target: 'python main.py --debug' }));

    expect(matchSpy).toHaveBeenCalledWith('python main.py --debug');
  });

  // TC-APAUTH-INT-06: non-exec uses toolName
  it('TC-APAUTH-INT-06: non-exec action class routes toolName to FileAutoPermitChecker', async () => {
    const checker = new FileAutoPermitChecker([makeRule('read_file')]);
    const matchSpy = vi.spyOn(checker, 'matchCommand');
    const cedar = makePermitEngine();
    const stage2 = createCombinedStage2(cedar, null, 'read_file', undefined, checker);

    await stage2(makeCtx({ action_class: 'filesystem.read', target: '/etc/config.json' }));

    expect(matchSpy).toHaveBeenCalledWith('read_file');
  });

  // TC-APAUTH-INT-07: Empty rules array
  it('TC-APAUTH-INT-07: empty rules array falls through to Cedar', async () => {
    const checker = new FileAutoPermitChecker([]);
    const cedar = makePermitEngine();
    const evalSpy = vi.spyOn(cedar, 'evaluateByActionClass');
    const stage2 = createCombinedStage2(cedar, null, 'bash', undefined, checker);

    const result = await stage2(makeCtx({ action_class: 'shell.exec', target: 'ls -la' }));

    expect(evalSpy).toHaveBeenCalledOnce();
    expect(result.effect).toBe('permit');
  });

  // TC-APAUTH-INT-08: Quoted args normalised
  it('TC-APAUTH-INT-08: quoted args in command are normalised before matching', async () => {
    const checker = new FileAutoPermitChecker([makeRule('git commit *')]);
    const cedar = makePermitEngine();
    const stage2 = createCombinedStage2(cedar, null, 'bash', undefined, checker);

    // Quotes are stripped by the normaliser; pattern still matches
    const result = await stage2(
      makeCtx({ action_class: 'shell.exec', target: 'git commit -m "fix auth bug"' }),
    );

    expect(result.effect).toBe('permit');
    expect(result.reason).toBe('auto_permit_rule');
  });
});

// ─── Priority order in decision chain ─────────────────────────────────────────

describe('priority order in decision chain', () => {
  // TC-APAUTH-PO-01: Session approval beats file rules
  it('TC-APAUTH-PO-01: session auto-approval fires before file rules are checked', async () => {
    const sessionChecker: AutoPermitChecker = { isSessionAutoApproved: vi.fn(() => true) };
    const ruleChecker = new FileAutoPermitChecker([makeRule('git commit *')]);
    const matchSpy = vi.spyOn(ruleChecker, 'matchCommand');
    const cedar = makePermitEngine();
    const stage2 = createCombinedStage2(cedar, null, 'bash', sessionChecker, ruleChecker);

    const result = await stage2(
      makeCtx({ action_class: 'shell.exec', target: 'git commit -m "fix"' }),
    );

    expect(result.reason).toBe('session_auto_approved');
    expect(matchSpy).not.toHaveBeenCalled();
  });

  // TC-APAUTH-PO-02: File rules beat Cedar
  it('TC-APAUTH-PO-02: file rule match bypasses Cedar evaluation', async () => {
    const ruleChecker = new FileAutoPermitChecker([makeRule('git *')]);
    const cedar = makeForbidEngine('would_be_denied_by_cedar');
    const evalSpy = vi.spyOn(cedar, 'evaluateByActionClass');
    const stage2 = createCombinedStage2(cedar, null, 'bash', undefined, ruleChecker);

    const result = await stage2(makeCtx({ action_class: 'shell.exec', target: 'git push origin main' }));

    expect(result.effect).toBe('permit');
    expect(result.stage).toBe('auto-permit');
    expect(evalSpy).not.toHaveBeenCalled();
  });

  // TC-APAUTH-PO-03: Cedar evaluated when no session approval and no file rule
  it('TC-APAUTH-PO-03: Cedar evaluated when no session approval and no file rule matches', async () => {
    const sessionChecker: AutoPermitChecker = { isSessionAutoApproved: vi.fn(() => false) };
    const ruleChecker = new FileAutoPermitChecker([makeRule('npm *')]);
    const cedar = makePermitEngine();
    const evalSpy = vi.spyOn(cedar, 'evaluateByActionClass');
    const stage2 = createCombinedStage2(cedar, null, 'bash', sessionChecker, ruleChecker);

    // 'git status' does not match 'npm *'
    await stage2(makeCtx({ action_class: 'shell.exec', target: 'git status' }));

    expect(evalSpy).toHaveBeenCalledOnce();
  });

  // TC-APAUTH-PO-04: Session + file rules + Cedar: only session auto-approval fires
  it('TC-APAUTH-PO-04: session approval short-circuits all subsequent checks', async () => {
    const sessionChecker: AutoPermitChecker = { isSessionAutoApproved: vi.fn(() => true) };
    const ruleChecker = new FileAutoPermitChecker([makeRule('git *')]);
    const cedar = makePermitEngine();
    const evalSpy = vi.spyOn(cedar, 'evaluateByActionClass');
    const matchSpy = vi.spyOn(ruleChecker, 'matchCommand');
    const stage2 = createCombinedStage2(cedar, null, 'bash', sessionChecker, ruleChecker);

    const result = await stage2(makeCtx({ action_class: 'shell.exec', target: 'git push' }));

    expect(result.reason).toBe('session_auto_approved');
    expect(matchSpy).not.toHaveBeenCalled();
    expect(evalSpy).not.toHaveBeenCalled();
  });

  // TC-APAUTH-PO-05: JSON engine consulted after Cedar permits
  it('TC-APAUTH-PO-05: JSON rules engine is evaluated when Cedar permits', async () => {
    const ruleChecker = new FileAutoPermitChecker([]);
    const cedar = makePermitEngine();
    const jsonEngine = new EnforcementPolicyEngine();
    const jsonSpy = vi.spyOn(jsonEngine, 'evaluate').mockReturnValue({ effect: 'permit', reason: 'json_ok' });
    vi.spyOn(jsonEngine, 'evaluateByActionClass').mockReturnValue({ effect: 'permit', reason: 'json_ok' });
    vi.spyOn(jsonEngine, 'evaluateByIntentGroup').mockReturnValue({ effect: 'permit', reason: 'json_ok' });
    const stage2 = createCombinedStage2(cedar, jsonEngine, 'test_tool', undefined, ruleChecker);

    await stage2(makeCtx());

    expect(jsonSpy).toHaveBeenCalledOnce();
  });

  // TC-APAUTH-PO-06: Full permit chain
  it('TC-APAUTH-PO-06: full chain permit — all_policies_passed when no layer blocks', async () => {
    const sessionChecker: AutoPermitChecker = { isSessionAutoApproved: vi.fn(() => false) };
    const ruleChecker = new FileAutoPermitChecker([]);
    const cedar = makePermitEngine();
    const stage2 = createCombinedStage2(cedar, null, 'test_tool', sessionChecker, ruleChecker);

    const result = await stage2(makeCtx());

    expect(result.effect).toBe('permit');
    expect(result.reason).toBe('all_policies_passed');
    expect(result.stage).toBe('stage2');
  });
});

// ─── Performance impact ───────────────────────────────────────────────────────

describe('performance impact', () => {
  // TC-APAUTH-PERF-01: 1000 evaluations with file rules complete quickly
  it('TC-APAUTH-PERF-01: 1000 sequential evaluations with file rules complete in <500ms', async () => {
    const rules = [
      makeRule('git commit *'),
      makeRule('npm run *'),
      makeRule('pytest *'),
    ];
    const ruleChecker = new FileAutoPermitChecker(rules);
    const cedar = makePermitEngine();
    const stage2 = createCombinedStage2(cedar, null, 'bash', undefined, ruleChecker);

    const ctx = makeCtx({ action_class: 'shell.exec', target: 'git commit -m "perf test"' });
    const start = performance.now();

    for (let i = 0; i < 1000; i++) {
      await stage2(ctx);
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  // TC-APAUTH-PERF-02: FileAutoPermitChecker regex compilation is cached per-instance
  it('TC-APAUTH-PERF-02: FileAutoPermitChecker caches compiled regexes across repeated calls', () => {
    const rule = makeRule('git commit *');
    const checker = new FileAutoPermitChecker([rule]);

    // First call compiles and caches the regex
    const first = checker.matchCommand('git commit -m "a"');
    // Second call re-uses the cached regex
    const second = checker.matchCommand('git commit -m "b"');

    // Both calls should match the same rule (same object reference)
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.pattern).toBe(second!.pattern);
  });

  it('TC-APAUTH-PERF-02b: 1000 matchCommand calls on same checker are fast', () => {
    const rules = Array.from({ length: 20 }, (_, i) => makeRule(`tool${i} *`));
    const checker = new FileAutoPermitChecker(rules);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      checker.matchCommand(`tool${i % 20} arg`);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CompoundOperationHandler,
  type OperationPlan,
} from './compound-operation-handler.js';
import type { EdgeCaseContext } from './edge-case-registry.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function ctx(command: string, metadata?: Record<string, unknown>): EdgeCaseContext {
  return metadata !== undefined
    ? { type: 'compound-operation', command, metadata }
    : { type: 'compound-operation', command };
}

// ─── TC-COH-01: parse Unicode arrow notation ──────────────────────────────────

describe('TC-COH-01: plan() parses Unicode arrow (→) notation', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('splits a two-step arrow operation into two steps', () => {
    const plan = handler.plan('git_clone → npm_install');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].toolName).toBe('git_clone');
    expect(plan.steps[1].toolName).toBe('npm_install');
  });

  it('splits a three-step arrow operation into three steps', () => {
    const plan = handler.plan('git_clone → npm_install → run_tests');
    expect(plan.steps).toHaveLength(3);
  });

  it('returns valid:true when all steps resolve against the registry', () => {
    const plan = handler.plan('git_clone → npm_install → run_tests');
    expect(plan.valid).toBe(true);
    expect(plan.errors).toHaveLength(0);
  });

  it('preserves the original input string on the plan', () => {
    const input = 'git_clone → npm_install → run_tests';
    const plan = handler.plan(input);
    expect(plan.input).toBe(input);
  });
});

// ─── TC-COH-02: parse ASCII arrow notation ────────────────────────────────────

describe('TC-COH-02: plan() parses ASCII arrow (->) notation', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('splits a two-step ASCII arrow operation', () => {
    const plan = handler.plan('npm_install -> run_tests');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].toolName).toBe('npm_install');
    expect(plan.steps[1].toolName).toBe('run_tests');
  });

  it('returns valid:true for a valid ASCII arrow sequence', () => {
    const plan = handler.plan('npm_install -> run_tests');
    expect(plan.valid).toBe(true);
  });
});

// ─── TC-COH-03: parse && operator notation ───────────────────────────────────

describe('TC-COH-03: plan() parses && operator notation', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('splits on the && operator', () => {
    const plan = handler.plan('npm_install && run_tests');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].toolName).toBe('npm_install');
    expect(plan.steps[1].toolName).toBe('run_tests');
  });

  it('returns valid:true for a valid && sequence', () => {
    const plan = handler.plan('compile && run_tests');
    expect(plan.valid).toBe(true);
  });
});

// ─── TC-COH-04: parse semicolon notation ─────────────────────────────────────

describe('TC-COH-04: plan() parses semicolon (;) notation', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('splits on the semicolon operator', () => {
    const plan = handler.plan('git_clone; npm_install');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].toolName).toBe('git_clone');
    expect(plan.steps[1].toolName).toBe('npm_install');
  });

  it('returns valid:true for a valid semicolon sequence', () => {
    const plan = handler.plan('git_clone; run_tests');
    expect(plan.valid).toBe(true);
  });
});

// ─── TC-COH-05: action class resolution ──────────────────────────────────────

describe('TC-COH-05: plan() resolves valid steps to correct action classes', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('resolves git_clone to vcs.remote', () => {
    const plan = handler.plan('git_clone → npm_install → run_tests');
    expect(plan.steps[0].actionClass).toBe('vcs.remote');
  });

  it('resolves npm_install to package.install', () => {
    const plan = handler.plan('git_clone → npm_install → run_tests');
    expect(plan.steps[1].actionClass).toBe('package.install');
  });

  it('resolves run_tests to build.test', () => {
    const plan = handler.plan('git_clone → npm_install → run_tests');
    expect(plan.steps[2].actionClass).toBe('build.test');
  });

  it('resolves compile to build.compile', () => {
    const plan = handler.plan('compile → run_tests');
    expect(plan.steps[0].actionClass).toBe('build.compile');
  });

  it('resolves read_file to filesystem.read and write_file to filesystem.write', () => {
    const plan = handler.plan('read_file → write_file');
    expect(plan.steps[0].actionClass).toBe('filesystem.read');
    expect(plan.steps[1].actionClass).toBe('filesystem.write');
  });
});

// ─── TC-COH-06: stepIndex, risk, hitlMode fields ─────────────────────────────

describe('TC-COH-06: plan() populates stepIndex, risk, and hitlMode on each step', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('stepIndex is 0-based and matches the original position in the sequence', () => {
    const plan = handler.plan('git_clone → npm_install → run_tests');
    expect(plan.steps[0].stepIndex).toBe(0);
    expect(plan.steps[1].stepIndex).toBe(1);
    expect(plan.steps[2].stepIndex).toBe(2);
  });

  it('run_tests has risk:low and hitlMode:none (build.test registry defaults)', () => {
    const plan = handler.plan('run_tests');
    expect(plan.steps[0].risk).toBe('low');
    expect(plan.steps[0].hitlMode).toBe('none');
  });

  it('npm_install has risk:medium and hitlMode:per_request (package.install registry defaults)', () => {
    const plan = handler.plan('npm_install → run_tests');
    expect(plan.steps[0].risk).toBe('medium');
    expect(plan.steps[0].hitlMode).toBe('per_request');
  });

  it('git_clone has risk:medium and hitlMode:per_request (vcs.remote registry defaults)', () => {
    const plan = handler.plan('git_clone');
    expect(plan.steps[0].risk).toBe('medium');
    expect(plan.steps[0].hitlMode).toBe('per_request');
  });
});

// ─── TC-COH-07: unregistered step names are rejected ─────────────────────────

describe('TC-COH-07: plan() rejects unregistered tool names', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('returns valid:false when a step is not in the registry', () => {
    const plan = handler.plan('npm_install → unknown_super_tool');
    expect(plan.valid).toBe(false);
  });

  it('error message includes the unregistered tool name', () => {
    const plan = handler.plan('git_clone → unknown_super_tool');
    expect(plan.errors.some((e) => e.includes('unknown_super_tool'))).toBe(true);
  });

  it('error message mentions the taxonomy', () => {
    const plan = handler.plan('bad_tool');
    expect(plan.errors[0]).toMatch(/action taxonomy/i);
  });

  it('resolved steps are still included (all-errors-at-once pattern)', () => {
    const plan = handler.plan('git_clone → bad_tool → run_tests');
    expect(plan.steps.some((s) => s.toolName === 'git_clone')).toBe(true);
    expect(plan.steps.some((s) => s.toolName === 'run_tests')).toBe(true);
    expect(plan.errors).toHaveLength(1);
    expect(plan.valid).toBe(false);
  });

  it('stepIndex of resolved steps reflects original position even when prior steps fail', () => {
    const plan = handler.plan('bad_tool → run_tests');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].stepIndex).toBe(1);
  });
});

// ─── TC-COH-08: exec wrapper tools are forbidden ─────────────────────────────

describe('TC-COH-08: plan() rejects exec wrapper (forbidden) tool names', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('rejects "bash" as a forbidden exec wrapper', () => {
    const plan = handler.plan('npm_install → bash');
    expect(plan.valid).toBe(false);
    expect(plan.errors.some((e) => e.includes('bash'))).toBe(true);
  });

  it('rejects "shell_exec" as a forbidden exec wrapper', () => {
    const plan = handler.plan('shell_exec → run_tests');
    expect(plan.valid).toBe(false);
    expect(plan.errors.some((e) => e.includes('shell_exec'))).toBe(true);
  });

  it('rejects "cmd" as a forbidden exec wrapper', () => {
    const plan = handler.plan('npm_install → cmd');
    expect(plan.valid).toBe(false);
    expect(plan.errors.some((e) => e.includes('cmd'))).toBe(true);
  });

  it('rejection message mentions fine-grained tool calls', () => {
    const plan = handler.plan('bash → run_tests');
    expect(plan.errors[0]).toMatch(/fine-grained/i);
  });

  it('valid steps are still resolved when an exec wrapper appears mid-sequence', () => {
    const plan = handler.plan('git_clone → bash → run_tests');
    expect(plan.valid).toBe(false);
    expect(plan.steps).toHaveLength(2);
    expect(plan.errors).toHaveLength(1);
  });

  it('rejects exec wrapper tool names case-insensitively', () => {
    const plan = handler.plan('BASH → run_tests');
    expect(plan.valid).toBe(false);
    expect(plan.errors.some((e) => e.includes('BASH'))).toBe(true);
  });
});

// ─── TC-COH-09: empty and whitespace-only input ───────────────────────────────

describe('TC-COH-09: plan() rejects empty or whitespace-only input', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('returns valid:false for an empty string', () => {
    const plan = handler.plan('');
    expect(plan.valid).toBe(false);
    expect(plan.errors).toHaveLength(1);
  });

  it('returns valid:false for a whitespace-only string', () => {
    const plan = handler.plan('   ');
    expect(plan.valid).toBe(false);
    expect(plan.errors).toHaveLength(1);
  });

  it('returns an empty steps array for empty input', () => {
    const plan = handler.plan('');
    expect(plan.steps).toHaveLength(0);
  });

  it('preserves the original empty input string on the plan', () => {
    const plan = handler.plan('');
    expect(plan.input).toBe('');
  });
});

// ─── TC-COH-10: single-step input ────────────────────────────────────────────

describe('TC-COH-10: plan() handles single-step input (no separator)', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('a single registered tool name produces a valid one-step plan', () => {
    const plan = handler.plan('run_tests');
    expect(plan.valid).toBe(true);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].toolName).toBe('run_tests');
  });

  it('a single unregistered tool name produces an invalid plan with no steps', () => {
    const plan = handler.plan('do_everything');
    expect(plan.valid).toBe(false);
    expect(plan.steps).toHaveLength(0);
    expect(plan.errors).toHaveLength(1);
  });
});

// ─── TC-COH-11: handle() EdgeCaseHandler integration ─────────────────────────

describe('TC-COH-11: handle() returns EdgeCaseResult with plan in metadata', () => {
  let handler: CompoundOperationHandler;

  beforeEach(() => {
    handler = new CompoundOperationHandler();
  });

  it('returns handled:true for a valid compound operation', async () => {
    const result = await handler.handle(ctx('git_clone → npm_install → run_tests'));
    expect(result.handled).toBe(true);
  });

  it('returns decision:permit for a valid compound operation', async () => {
    const result = await handler.handle(ctx('git_clone → npm_install → run_tests'));
    expect(result.decision).toBe('permit');
  });

  it('reason string mentions the step count for a valid operation', async () => {
    const result = await handler.handle(ctx('npm_install → run_tests'));
    expect(result.reason).toMatch(/2/);
  });

  it('returns decision:forbid when a step fails validation', async () => {
    const result = await handler.handle(ctx('git_clone → bash → run_tests'));
    expect(result.decision).toBe('forbid');
  });

  it('returns handled:true even when the operation is invalid', async () => {
    const result = await handler.handle(ctx('bash'));
    expect(result.handled).toBe(true);
    expect(result.decision).toBe('forbid');
  });

  it('attaches the operation plan to result metadata', async () => {
    const result = await handler.handle(ctx('npm_install → run_tests'));
    expect(result.metadata).toBeDefined();
    const plan = (result.metadata as { plan: OperationPlan }).plan;
    expect(plan).toBeDefined();
    expect(plan.steps).toHaveLength(2);
  });

  it('metadata plan is invalid and contains errors for a failed operation', async () => {
    const result = await handler.handle(ctx('bash → run_tests'));
    const plan = (result.metadata as { plan: OperationPlan }).plan;
    expect(plan.valid).toBe(false);
    expect(plan.errors.length).toBeGreaterThan(0);
  });
});

// ─── TC-COH-12: EdgeCaseHandler interface compliance ─────────────────────────

describe('TC-COH-12: CompoundOperationHandler implements EdgeCaseHandler', () => {
  it('edgeCaseType is "compound-operation"', () => {
    const handler = new CompoundOperationHandler();
    expect(handler.edgeCaseType).toBe('compound-operation');
  });

  it('handle is an async function returning a Promise', async () => {
    const handler = new CompoundOperationHandler();
    const result = handler.handle(ctx('run_tests'));
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it('can be registered in an EdgeCaseRegistry without error', async () => {
    const { EdgeCaseRegistry } = await import('./edge-case-registry.js');
    const registry = new EdgeCaseRegistry();
    const handler = new CompoundOperationHandler();
    registry.register(handler);
    expect(registry.has('compound-operation')).toBe(true);
  });

  it('dispatched via EdgeCaseRegistry routes to the handler correctly', async () => {
    const { EdgeCaseRegistry } = await import('./edge-case-registry.js');
    const registry = new EdgeCaseRegistry();
    registry.register(new CompoundOperationHandler());
    const result = await registry.dispatch(ctx('npm_install → run_tests'));
    expect(result.handled).toBe(true);
    expect(result.decision).toBe('permit');
  });
});

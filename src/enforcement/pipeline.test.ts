/**
 * Pipeline orchestrator — test suite
 *
 * Covers all execution paths of runPipeline:
 *   1. Stage 1 deny → Stage 2 never called
 *   2. Stage 2 deny → deny result returned
 *   3. HITL trigger → pending_hitl_approval
 *   4. Full allow path → permit decision
 *   5. Thrown error → pipeline_error deny
 *   6. latency_ms populated on every path
 *   7. executionEvent emitted on every path
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline, isInstallPhase } from './pipeline.js';
import type { PipelineContext, CeeDecision, Stage1Fn, Stage2Fn } from './pipeline.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    action_class: 'filesystem.read',
    target: '/tmp/test.txt',
    payload_hash: 'abc123',
    hitl_mode: 'none',
    rule_context: { agentId: 'agent-1', channel: 'test' },
    ...overrides,
  };
}

const permitDecision: CeeDecision = { effect: 'permit', reason: 'allowed', stage: 'stage2' };
const forbidDecision: CeeDecision = { effect: 'forbid', reason: 'denied', stage: 'stage1' };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runPipeline', () => {
  let emitter: EventEmitter;
  let stage1: Stage1Fn;
  let stage2: Stage2Fn;

  beforeEach(() => {
    emitter = new EventEmitter();
    stage1 = vi.fn<Stage1Fn>().mockResolvedValue(permitDecision);
    stage2 = vi.fn<Stage2Fn>().mockResolvedValue(permitDecision);
  });

  // ── 1. Stage 1 deny prevents Stage 2 execution ──────────────────────────

  it('stage1 deny prevents stage2 from being called', async () => {
    stage1 = vi.fn<Stage1Fn>().mockResolvedValue(forbidDecision);
    await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(stage2).not.toHaveBeenCalled();
  });

  it('stage1 deny returns the forbid decision from stage1', async () => {
    const s1Decision: CeeDecision = { effect: 'forbid', reason: 'capability expired', stage: 'stage1' };
    stage1 = vi.fn<Stage1Fn>().mockResolvedValue(s1Decision);
    const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('capability expired');
  });

  // ── 2. Stage 2 deny returns deny result ─────────────────────────────────

  it('stage2 deny returns forbid decision', async () => {
    const s2Decision: CeeDecision = { effect: 'forbid', reason: 'policy violation', stage: 'stage2' };
    stage2 = vi.fn<Stage2Fn>().mockResolvedValue(s2Decision);
    const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('policy violation');
  });

  it('stage2 deny calls both stage1 and stage2', async () => {
    stage2 = vi.fn<Stage2Fn>().mockResolvedValue(forbidDecision);
    await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(stage1).toHaveBeenCalledOnce();
    expect(stage2).toHaveBeenCalledOnce();
  });

  // ── 3. HITL trigger returns pending_hitl_approval ────────────────────────

  it('per_request hitl_mode without approval_id returns pending_hitl_approval', async () => {
    const result = await runPipeline(makeCtx({ hitl_mode: 'per_request' }), stage1, stage2, emitter);
    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pending_hitl_approval');
  });

  it('session_approval hitl_mode without approval_id returns pending_hitl_approval', async () => {
    const result = await runPipeline(
      makeCtx({ hitl_mode: 'session_approval' }),
      stage1,
      stage2,
      emitter,
    );
    expect(result.decision.reason).toBe('pending_hitl_approval');
  });

  it('HITL trigger does not call stage1 or stage2', async () => {
    await runPipeline(makeCtx({ hitl_mode: 'per_request' }), stage1, stage2, emitter);
    expect(stage1).not.toHaveBeenCalled();
    expect(stage2).not.toHaveBeenCalled();
  });

  it('hitl_mode none with no approval_id skips HITL pre-check and calls stage1', async () => {
    await runPipeline(makeCtx({ hitl_mode: 'none' }), stage1, stage2, emitter);
    expect(stage1).toHaveBeenCalledOnce();
  });

  it('hitl_mode per_request with approval_id present skips HITL pre-check', async () => {
    const ctx = makeCtx({ hitl_mode: 'per_request', approval_id: 'cap-abc' });
    await runPipeline(ctx, stage1, stage2, emitter);
    expect(stage1).toHaveBeenCalledOnce();
  });

  // ── 4. Full allow path returns allow decision ────────────────────────────

  it('full allow path returns permit decision', async () => {
    const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(result.decision.effect).toBe('permit');
  });

  it('full allow path calls both stage1 and stage2', async () => {
    await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(stage1).toHaveBeenCalledOnce();
    expect(stage2).toHaveBeenCalledOnce();
  });

  it('full allow path passes the context to both stages', async () => {
    const ctx = makeCtx({ action_class: 'communication.email', target: 'user@example.com' });
    await runPipeline(ctx, stage1, stage2, emitter);
    expect(stage1).toHaveBeenCalledWith(ctx);
    expect(stage2).toHaveBeenCalledWith(ctx);
  });

  // ── 5. Any thrown error returns pipeline_error deny ──────────────────────

  it('stage1 throw returns pipeline_error forbid', async () => {
    stage1 = vi.fn<Stage1Fn>().mockRejectedValue(new Error('stage1 exploded'));
    const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pipeline_error');
  });

  it('stage2 throw returns pipeline_error forbid', async () => {
    stage2 = vi.fn<Stage2Fn>().mockRejectedValue(new Error('stage2 exploded'));
    const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(result.decision.effect).toBe('forbid');
    expect(result.decision.reason).toBe('pipeline_error');
  });

  it('non-Error throw also returns pipeline_error forbid', async () => {
    stage1 = vi.fn<Stage1Fn>().mockRejectedValue('string error');
    const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(result.decision.reason).toBe('pipeline_error');
  });

  // ── 6. latency_ms populated on all paths ────────────────────────────────

  it('latency_ms is a non-negative number on the permit path', async () => {
    const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(typeof result.latency_ms).toBe('number');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('latency_ms is non-negative on the stage1 deny path', async () => {
    stage1 = vi.fn<Stage1Fn>().mockResolvedValue(forbidDecision);
    const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('latency_ms is non-negative on the HITL trigger path', async () => {
    const result = await runPipeline(makeCtx({ hitl_mode: 'per_request' }), stage1, stage2, emitter);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('latency_ms is non-negative on the pipeline_error path', async () => {
    stage1 = vi.fn<Stage1Fn>().mockRejectedValue(new Error('err'));
    const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('latency_ms reflects artificial delay via fake timers', async () => {
    vi.useFakeTimers();
    const delayMs = 100;
    stage1 = vi.fn<Stage1Fn>().mockImplementation(
      () => new Promise(r => setTimeout(() => r(permitDecision), delayMs)),
    );
    const p = runPipeline(makeCtx(), stage1, stage2, emitter);
    await vi.advanceTimersByTimeAsync(delayMs + 10);
    const result = await p;
    expect(result.latency_ms).toBeGreaterThanOrEqual(delayMs);
    vi.useRealTimers();
  });

  // ── 7. executionEvent emitted on all paths ───────────────────────────────

  it('emits executionEvent once on the full allow path', async () => {
    const events: unknown[] = [];
    emitter.on('executionEvent', e => events.push(e));
    await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(events).toHaveLength(1);
  });

  it('emits executionEvent once on the stage1 deny path', async () => {
    const events: unknown[] = [];
    emitter.on('executionEvent', e => events.push(e));
    stage1 = vi.fn<Stage1Fn>().mockResolvedValue(forbidDecision);
    await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(events).toHaveLength(1);
  });

  it('emits executionEvent once on the stage2 deny path', async () => {
    const events: unknown[] = [];
    emitter.on('executionEvent', e => events.push(e));
    stage2 = vi.fn<Stage2Fn>().mockResolvedValue(forbidDecision);
    await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(events).toHaveLength(1);
  });

  it('emits executionEvent once on the HITL trigger path', async () => {
    const events: unknown[] = [];
    emitter.on('executionEvent', e => events.push(e));
    await runPipeline(makeCtx({ hitl_mode: 'per_request' }), stage1, stage2, emitter);
    expect(events).toHaveLength(1);
  });

  it('emits executionEvent once on the pipeline_error path', async () => {
    const events: unknown[] = [];
    emitter.on('executionEvent', e => events.push(e));
    stage1 = vi.fn<Stage1Fn>().mockRejectedValue(new Error('err'));
    await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(events).toHaveLength(1);
  });

  it('emitted executionEvent carries the final decision', async () => {
    let emittedEvent: unknown;
    emitter.on('executionEvent', e => { emittedEvent = e; });
    await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(emittedEvent).toMatchObject({ decision: { effect: 'permit' } });
  });

  it('emitted executionEvent carries an ISO timestamp', async () => {
    let emittedEvent: Record<string, unknown> | undefined;
    emitter.on('executionEvent', e => { emittedEvent = e as Record<string, unknown>; });
    await runPipeline(makeCtx(), stage1, stage2, emitter);
    expect(typeof emittedEvent?.timestamp).toBe('string');
    expect(() => new Date(emittedEvent!.timestamp as string)).not.toThrow();
  });

  // ── 8. Install phase bypass ───────────────────────────────────────────────

  describe('isInstallPhase()', () => {
    afterEach(() => {
      delete process.env.npm_lifecycle_event;
      delete process.env.OPENAUTH_FORCE_ACTIVE;
    });

    it('returns false when npm_lifecycle_event is unset', () => {
      delete process.env.npm_lifecycle_event;
      expect(isInstallPhase()).toBe(false);
    });

    it('returns true for npm_lifecycle_event=install', () => {
      process.env.npm_lifecycle_event = 'install';
      expect(isInstallPhase()).toBe(true);
    });

    it('returns true for npm_lifecycle_event=preinstall', () => {
      process.env.npm_lifecycle_event = 'preinstall';
      expect(isInstallPhase()).toBe(true);
    });

    it('returns true for npm_lifecycle_event=postinstall', () => {
      process.env.npm_lifecycle_event = 'postinstall';
      expect(isInstallPhase()).toBe(true);
    });

    it('returns true for npm_lifecycle_event=prepare', () => {
      process.env.npm_lifecycle_event = 'prepare';
      expect(isInstallPhase()).toBe(true);
    });

    it('returns false for other lifecycle events (e.g. test)', () => {
      process.env.npm_lifecycle_event = 'test';
      expect(isInstallPhase()).toBe(false);
    });

    it('returns false when OPENAUTH_FORCE_ACTIVE=1 even during install lifecycle', () => {
      process.env.npm_lifecycle_event = 'install';
      process.env.OPENAUTH_FORCE_ACTIVE = '1';
      expect(isInstallPhase()).toBe(false);
    });
  });

  describe('runPipeline — install phase bypass', () => {
    afterEach(() => {
      delete process.env.npm_lifecycle_event;
      delete process.env.OPENAUTH_FORCE_ACTIVE;
    });

    it('returns permit with reason install_phase_bypass during npm install lifecycle', async () => {
      process.env.npm_lifecycle_event = 'install';
      const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
      expect(result.decision.effect).toBe('permit');
      expect(result.decision.reason).toBe('install_phase_bypass');
      expect(result.decision.stage).toBe('pipeline');
    });

    it('does not call stage1 or stage2 during install phase', async () => {
      process.env.npm_lifecycle_event = 'postinstall';
      await runPipeline(makeCtx(), stage1, stage2, emitter);
      expect(stage1).not.toHaveBeenCalled();
      expect(stage2).not.toHaveBeenCalled();
    });

    it('emits executionEvent even during install phase bypass', async () => {
      process.env.npm_lifecycle_event = 'install';
      const events: unknown[] = [];
      emitter.on('executionEvent', e => events.push(e));
      await runPipeline(makeCtx(), stage1, stage2, emitter);
      expect(events).toHaveLength(1);
    });

    it('bypasses even high-risk actions during install phase', async () => {
      process.env.npm_lifecycle_event = 'install';
      const result = await runPipeline(makeCtx({ hitl_mode: 'per_request' }), stage1, stage2, emitter);
      expect(result.decision.effect).toBe('permit');
      expect(result.decision.reason).toBe('install_phase_bypass');
    });

    it('enforces normally when OPENAUTH_FORCE_ACTIVE=1 overrides install phase', async () => {
      process.env.npm_lifecycle_event = 'install';
      process.env.OPENAUTH_FORCE_ACTIVE = '1';
      const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
      expect(result.decision.effect).toBe('permit');
      expect(result.decision.reason).not.toBe('install_phase_bypass');
      expect(stage1).toHaveBeenCalledOnce();
      expect(stage2).toHaveBeenCalledOnce();
    });

    // T21 — single bypass point: pipeline.ts is the sole location that calls
    // isInstallPhase(); verify all four lifecycle events bypass via runPipeline
    // with stage='pipeline', confirming no duplicate bypass exists elsewhere.
    it.each(['preinstall', 'prepare'] as const)(
      'runPipeline bypasses via pipeline stage for npm_lifecycle_event=%s',
      async (event) => {
        process.env.npm_lifecycle_event = event;
        const result = await runPipeline(makeCtx(), stage1, stage2, emitter);
        expect(result.decision.effect).toBe('permit');
        expect(result.decision.reason).toBe('install_phase_bypass');
        expect(result.decision.stage).toBe('pipeline');
        expect(stage1).not.toHaveBeenCalled();
        expect(stage2).not.toHaveBeenCalled();
      },
    );
  });
});

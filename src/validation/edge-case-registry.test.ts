import { describe, it, expect, beforeEach } from 'vitest';
import {
  EdgeCaseRegistry,
  defaultEdgeCaseRegistry,
  type EdgeCaseHandler,
  type EdgeCaseContext,
  type EdgeCaseResult,
  type EdgeCaseType,
} from './edge-case-registry.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeHandler(
  type: EdgeCaseType,
  result: Partial<EdgeCaseResult> = {},
): EdgeCaseHandler {
  return {
    edgeCaseType: type,
    handle: async (_ctx: EdgeCaseContext): Promise<EdgeCaseResult> => ({
      handled: true,
      decision: 'permit',
      reason: `handled by ${type} handler`,
      ...result,
    }),
  };
}

function makeContext(
  type: EdgeCaseType,
  command: string,
  metadata?: Record<string, unknown>,
): EdgeCaseContext {
  return metadata !== undefined
    ? { type, command, metadata }
    : { type, command };
}

// ─── TC-ECR-01: register ──────────────────────────────────────────────────────

describe('TC-ECR-01: register adds handler and has() reflects it', () => {
  let registry: EdgeCaseRegistry;

  beforeEach(() => {
    registry = new EdgeCaseRegistry();
  });

  it('has() returns false before registration', () => {
    expect(registry.has('compound-operation')).toBe(false);
  });

  it('has() returns true after registering compound-operation handler', () => {
    registry.register(makeHandler('compound-operation'));
    expect(registry.has('compound-operation')).toBe(true);
  });

  it('has() returns true after registering shell-pipeline handler', () => {
    registry.register(makeHandler('shell-pipeline'));
    expect(registry.has('shell-pipeline')).toBe(true);
  });

  it('has() returns true after registering one-off-operation handler', () => {
    registry.register(makeHandler('one-off-operation'));
    expect(registry.has('one-off-operation')).toBe(true);
  });

  it('registering a second handler for the same type replaces the first', () => {
    const first = makeHandler('compound-operation', { reason: 'first' });
    const second = makeHandler('compound-operation', { reason: 'second' });
    registry.register(first);
    registry.register(second);
    expect(registry.has('compound-operation')).toBe(true);
    expect(registry.registeredTypes()).toHaveLength(1);
  });
});

// ─── TC-ECR-02: dispatch with registered handler ──────────────────────────────

describe('TC-ECR-02: dispatch invokes the registered handler', () => {
  let registry: EdgeCaseRegistry;

  beforeEach(() => {
    registry = new EdgeCaseRegistry();
  });

  it('dispatches compound-operation to its handler', async () => {
    registry.register(makeHandler('compound-operation', { decision: 'forbid', reason: 'chained' }));
    const result = await registry.dispatch(
      makeContext('compound-operation', 'npm install && npm run build'),
    );
    expect(result.handled).toBe(true);
    expect(result.decision).toBe('forbid');
    expect(result.reason).toBe('chained');
  });

  it('dispatches shell-pipeline to its handler', async () => {
    registry.register(makeHandler('shell-pipeline', { decision: 'permit', reason: 'ok' }));
    const result = await registry.dispatch(
      makeContext('shell-pipeline', 'cat file.txt | grep foo'),
    );
    expect(result.handled).toBe(true);
    expect(result.decision).toBe('permit');
  });

  it('dispatches one-off-operation to its handler', async () => {
    registry.register(makeHandler('one-off-operation', { decision: 'defer', reason: 'deferred' }));
    const result = await registry.dispatch(
      makeContext('one-off-operation', 'rm -rf /tmp/scratch'),
    );
    expect(result.handled).toBe(true);
    expect(result.decision).toBe('defer');
  });

  it('handler receives the full context', async () => {
    let capturedContext: EdgeCaseContext | undefined;
    const handler: EdgeCaseHandler = {
      edgeCaseType: 'compound-operation',
      handle: async (ctx) => {
        capturedContext = ctx;
        return { handled: true, decision: 'permit', reason: 'ok' };
      },
    };
    registry.register(handler);
    const ctx = makeContext('compound-operation', 'a && b', { foo: 'bar' });
    await registry.dispatch(ctx);
    expect(capturedContext).toStrictEqual(ctx);
  });
});

// ─── TC-ECR-03: dispatch without a registered handler ────────────────────────

describe('TC-ECR-03: dispatch returns defer result when no handler is registered', () => {
  let registry: EdgeCaseRegistry;

  beforeEach(() => {
    registry = new EdgeCaseRegistry();
  });

  it('returns handled:false for compound-operation with no handler', async () => {
    const result = await registry.dispatch(
      makeContext('compound-operation', 'a && b'),
    );
    expect(result.handled).toBe(false);
    expect(result.decision).toBe('defer');
    expect(result.reason).toContain('compound-operation');
  });

  it('returns handled:false for shell-pipeline with no handler', async () => {
    const result = await registry.dispatch(
      makeContext('shell-pipeline', 'ls | wc -l'),
    );
    expect(result.handled).toBe(false);
    expect(result.decision).toBe('defer');
  });

  it('returns handled:false for one-off-operation with no handler', async () => {
    const result = await registry.dispatch(
      makeContext('one-off-operation', 'echo hello'),
    );
    expect(result.handled).toBe(false);
    expect(result.decision).toBe('defer');
  });

  it('does not throw when dispatching to an empty registry', async () => {
    await expect(
      registry.dispatch(makeContext('shell-pipeline', 'ls')),
    ).resolves.toBeDefined();
  });
});

// ─── TC-ECR-04: unregister ────────────────────────────────────────────────────

describe('TC-ECR-04: unregister removes a handler', () => {
  let registry: EdgeCaseRegistry;

  beforeEach(() => {
    registry = new EdgeCaseRegistry();
  });

  it('returns true when a handler is removed', () => {
    registry.register(makeHandler('shell-pipeline'));
    expect(registry.unregister('shell-pipeline')).toBe(true);
    expect(registry.has('shell-pipeline')).toBe(false);
  });

  it('returns false when no handler was registered', () => {
    expect(registry.unregister('compound-operation')).toBe(false);
  });

  it('dispatch returns defer after unregistering the handler', async () => {
    registry.register(makeHandler('one-off-operation'));
    registry.unregister('one-off-operation');
    const result = await registry.dispatch(
      makeContext('one-off-operation', 'touch /tmp/x'),
    );
    expect(result.handled).toBe(false);
    expect(result.decision).toBe('defer');
  });
});

// ─── TC-ECR-05: registeredTypes ───────────────────────────────────────────────

describe('TC-ECR-05: registeredTypes reflects current handlers', () => {
  let registry: EdgeCaseRegistry;

  beforeEach(() => {
    registry = new EdgeCaseRegistry();
  });

  it('returns empty array when no handlers are registered', () => {
    expect(registry.registeredTypes()).toEqual([]);
  });

  it('returns the type of a single registered handler', () => {
    registry.register(makeHandler('shell-pipeline'));
    expect(registry.registeredTypes()).toEqual(['shell-pipeline']);
  });

  it('returns all three types when all handlers are registered', () => {
    registry.register(makeHandler('compound-operation'));
    registry.register(makeHandler('shell-pipeline'));
    registry.register(makeHandler('one-off-operation'));
    expect(registry.registeredTypes()).toHaveLength(3);
    expect(registry.registeredTypes()).toContain('compound-operation');
    expect(registry.registeredTypes()).toContain('shell-pipeline');
    expect(registry.registeredTypes()).toContain('one-off-operation');
  });

  it('removes the type from the list after unregistering', () => {
    registry.register(makeHandler('compound-operation'));
    registry.register(makeHandler('shell-pipeline'));
    registry.unregister('compound-operation');
    expect(registry.registeredTypes()).toEqual(['shell-pipeline']);
  });
});

// ─── TC-ECR-06: multiple handlers coexist ────────────────────────────────────

describe('TC-ECR-06: multiple handlers coexist without interference', () => {
  let registry: EdgeCaseRegistry;

  beforeEach(() => {
    registry = new EdgeCaseRegistry();
    registry.register(makeHandler('compound-operation', { decision: 'forbid', reason: 'compound blocked' }));
    registry.register(makeHandler('shell-pipeline', { decision: 'permit', reason: 'pipeline ok' }));
    registry.register(makeHandler('one-off-operation', { decision: 'defer', reason: 'one-off deferred' }));
  });

  it('each type routes to its own handler', async () => {
    const [compound, pipeline, oneoff] = await Promise.all([
      registry.dispatch(makeContext('compound-operation', 'a && b')),
      registry.dispatch(makeContext('shell-pipeline', 'a | b')),
      registry.dispatch(makeContext('one-off-operation', 'a')),
    ]);
    expect(compound.decision).toBe('forbid');
    expect(pipeline.decision).toBe('permit');
    expect(oneoff.decision).toBe('defer');
  });

  it('replacing one handler does not affect the others', async () => {
    registry.register(makeHandler('compound-operation', { decision: 'permit', reason: 'now ok' }));
    const pipeline = await registry.dispatch(makeContext('shell-pipeline', 'a | b'));
    expect(pipeline.decision).toBe('permit');
    expect(pipeline.reason).toBe('pipeline ok');
  });
});

// ─── TC-ECR-07: async dispatch ────────────────────────────────────────────────

describe('TC-ECR-07: dispatch is async and supports async handlers', () => {
  let registry: EdgeCaseRegistry;

  beforeEach(() => {
    registry = new EdgeCaseRegistry();
  });

  it('resolves after an async handler completes', async () => {
    const handler: EdgeCaseHandler = {
      edgeCaseType: 'shell-pipeline',
      handle: async (_ctx) => {
        await Promise.resolve(); // simulate microtask
        return { handled: true, decision: 'forbid', reason: 'async result' };
      },
    };
    registry.register(handler);
    const result = await registry.dispatch(makeContext('shell-pipeline', 'ls | wc'));
    expect(result.decision).toBe('forbid');
    expect(result.reason).toBe('async result');
  });

  it('propagates handler rejection as a rejected promise', async () => {
    const handler: EdgeCaseHandler = {
      edgeCaseType: 'one-off-operation',
      handle: async (_ctx) => {
        throw new Error('handler error');
      },
    };
    registry.register(handler);
    await expect(
      registry.dispatch(makeContext('one-off-operation', 'bad')),
    ).rejects.toThrow('handler error');
  });
});

// ─── TC-ECR-08: injectable and testable ──────────────────────────────────────

describe('TC-ECR-08: registry is injectable and each instance is isolated', () => {
  it('two registry instances do not share state', async () => {
    const registryA = new EdgeCaseRegistry();
    const registryB = new EdgeCaseRegistry();
    registryA.register(makeHandler('compound-operation', { decision: 'forbid', reason: 'A' }));

    expect(registryA.has('compound-operation')).toBe(true);
    expect(registryB.has('compound-operation')).toBe(false);

    const resultB = await registryB.dispatch(makeContext('compound-operation', 'a && b'));
    expect(resultB.handled).toBe(false);
  });

  it('defaultEdgeCaseRegistry is a shared EdgeCaseRegistry instance', () => {
    expect(defaultEdgeCaseRegistry).toBeInstanceOf(EdgeCaseRegistry);
  });

  it('injectable pattern: consumer receives registry as parameter', async () => {
    async function evaluate(
      registry: EdgeCaseRegistry,
      ctx: EdgeCaseContext,
    ): Promise<EdgeCaseResult> {
      return registry.dispatch(ctx);
    }

    const registry = new EdgeCaseRegistry();
    registry.register(makeHandler('shell-pipeline', { decision: 'permit', reason: 'injected' }));
    const result = await evaluate(registry, makeContext('shell-pipeline', 'cat f | grep x'));
    expect(result.handled).toBe(true);
    expect(result.decision).toBe('permit');
  });
});

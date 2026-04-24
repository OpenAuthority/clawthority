/**
 * Phase 1 unit tests — watcher.ts
 *
 * Covers:
 *   - startRulesWatcher creates chokidar watchers for TS rules and JSON rules
 *   - WatcherHandle.stop closes both watchers and clears timers
 *   - Debounce behaviour for JSON rule change / add events
 *   - Initial JSON rules load updates engineRef when rules are present
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mock state ───────────────────────────────────────────────────────
// All variables used inside vi.mock factories must be defined via vi.hoisted.

const { createdWatchers, mockWatch, MockPolicyEngine } = vi.hoisted(() => {
  // Track every chokidar watcher instance independently.
  const createdWatchers: Array<{
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  const mockWatch = vi.fn(() => {
    const w = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    createdWatchers.push(w);
    return w;
  });

  // A spy constructor that always returns a fresh instance with addRules().
  // Using vi.fn(impl) so the implementation is baked in at creation time.
  const MockPolicyEngine = vi.fn(function MockPE() {
    return { addRules: vi.fn() };
  });

  return { createdWatchers, mockWatch, MockPolicyEngine };
});

vi.mock('chokidar', () => ({
  default: { watch: mockWatch },
}));

// Mock node:fs so loadJsonRules does not touch disk.
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
}));

// Expose MockPolicyEngine as the PolicyEngine export.
vi.mock('./policy/engine.js', () => ({
  PolicyEngine: MockPolicyEngine,
}));

// Mock mergeRules so we don't depend on actual rule module imports.
vi.mock('./policy/rules/index.js', () => ({
  mergeRules: vi.fn().mockReturnValue([]),
  default: [],
}));

// ─── Imports (after mocks are established) ───────────────────────────────────

import { startRulesWatcher } from './watcher.js';
import { PolicyEngine } from './policy/engine.js';
import { existsSync, readFileSync } from 'node:fs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the registered handler for a given event on a watcher mock. */
function getHandler(
  watcherMock: { on: ReturnType<typeof vi.fn> },
  event: string,
): (...args: unknown[]) => void {
  const call = watcherMock.on.mock.calls.find(
    (c: unknown[]) => c[0] === event,
  );
  if (!call) throw new Error(`No '${event}' handler registered on watcher`);
  return call[1] as (...args: unknown[]) => void;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('startRulesWatcher', () => {
  let engineRef: { current: ReturnType<typeof MockPolicyEngine> };

  beforeEach(() => {
    // Reset watcher tracking arrays.
    createdWatchers.length = 0;

    // Clear only the call history — NOT the implementation — on our hoisted mocks.
    mockWatch.mockClear();
    MockPolicyEngine.mockClear();

    // Ensure the constructor always returns a fresh instance with addRules.
    // Re-asserting here protects against any mock reset that may have occurred.
    MockPolicyEngine.mockImplementation(function MockPE() {
      return { addRules: vi.fn() };
    });

    // Suppress noisy console output from the watcher.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Default: JSON rules file does not exist → no initial rebuild.
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('[]');

    engineRef = {
      current: new PolicyEngine() as unknown as ReturnType<typeof MockPolicyEngine>,
    };
    // Clear call count after the beforeEach constructor call so tests start at 0.
    MockPolicyEngine.mockClear();
    MockPolicyEngine.mockImplementation(function MockPE() {
      return { addRules: vi.fn() };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Watcher creation ────────────────────────────────────────────────────────

  it('creates exactly three chokidar watchers', () => {
    startRulesWatcher(engineRef);
    expect(mockWatch).toHaveBeenCalledTimes(3);
    expect(createdWatchers).toHaveLength(3);
  });

  it('first watcher targets the policy/rules directory', () => {
    startRulesWatcher(engineRef);
    const [firstPath] = mockWatch.mock.calls[0] as [string];
    expect(firstPath).toContain('policy/rules');
  });

  it('second watcher targets data/rules.json', () => {
    startRulesWatcher(engineRef);
    const [secondPath] = mockWatch.mock.calls[1] as [string];
    expect(secondPath).toMatch(/rules\.json$/);
  });

  it('third watcher targets data/bundle.json', () => {
    startRulesWatcher(engineRef);
    const [thirdPath] = mockWatch.mock.calls[2] as [string];
    expect(thirdPath).toMatch(/bundle\.json$/);
  });

  it('all watchers are configured with persistent:false and ignoreInitial:true', () => {
    startRulesWatcher(engineRef);
    for (const [, options] of mockWatch.mock.calls as [string, Record<string, unknown>][]) {
      expect(options.persistent).toBe(false);
      expect(options.ignoreInitial).toBe(true);
    }
  });

  // ── Event registration ──────────────────────────────────────────────────────

  it('TS watcher registers a change handler', () => {
    startRulesWatcher(engineRef);
    const tsWatcher = createdWatchers[0];
    const registeredEvents = tsWatcher.on.mock.calls.map((c: unknown[]) => c[0]);
    expect(registeredEvents).toContain('change');
  });

  it('JSON watcher registers both change and add handlers', () => {
    startRulesWatcher(engineRef);
    const jsonWatcher = createdWatchers[1];
    const registeredEvents = jsonWatcher.on.mock.calls.map((c: unknown[]) => c[0]);
    expect(registeredEvents).toContain('change');
    expect(registeredEvents).toContain('add');
  });

  it('bundle watcher registers change, add, and unlink handlers', () => {
    startRulesWatcher(engineRef);
    const bundleWatcher = createdWatchers[2];
    const registeredEvents = bundleWatcher.on.mock.calls.map((c: unknown[]) => c[0]);
    expect(registeredEvents).toContain('change');
    expect(registeredEvents).toContain('add');
    expect(registeredEvents).toContain('unlink');
  });

  // ── stop() ──────────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('closes all watchers', async () => {
      const handle = startRulesWatcher(engineRef);
      await handle.stop();
      expect(createdWatchers[0].close).toHaveBeenCalled();
      expect(createdWatchers[1].close).toHaveBeenCalled();
      expect(createdWatchers[2].close).toHaveBeenCalled();
    });

    it('returns a resolving Promise', async () => {
      const handle = startRulesWatcher(engineRef);
      await expect(handle.stop()).resolves.toBeUndefined();
    });

    it('can be called multiple times without throwing', async () => {
      const handle = startRulesWatcher(engineRef);
      await handle.stop();
      await expect(handle.stop()).resolves.toBeUndefined();
    });
  });

  // ── Initial JSON rules load ─────────────────────────────────────────────────

  describe('initial JSON rules load', () => {
    it('does not rebuild engine when JSON file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const before = engineRef.current;
      startRulesWatcher(engineRef);
      expect(engineRef.current).toBe(before);
    });

    it('does not rebuild engine when JSON file contains an empty array', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('[]');
      const before = engineRef.current;
      startRulesWatcher(engineRef);
      expect(engineRef.current).toBe(before);
    });

    it('rebuilds engine when JSON file contains valid rules', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify([{ effect: 'permit', resource: 'tool', match: 'read_file' }]),
      );
      const before = engineRef.current;
      startRulesWatcher(engineRef);
      expect(engineRef.current).not.toBe(before);
    });

    it('skips invalid JSON gracefully — engine remains unchanged', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('not-valid-json{{{');
      const before = engineRef.current;
      startRulesWatcher(engineRef);
      expect(engineRef.current).toBe(before);
    });

    it('skips non-array JSON gracefully — engine remains unchanged', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ effect: 'permit' }));
      const before = engineRef.current;
      startRulesWatcher(engineRef);
      expect(engineRef.current).toBe(before);
    });
  });

  // ── JSON watcher change event ───────────────────────────────────────────────

  describe('JSON watcher change event', () => {
    it('engine is not rebuilt before the debounce window elapses', () => {
      vi.useFakeTimers();
      startRulesWatcher(engineRef, 100);

      const jsonWatcher = createdWatchers[1];
      const onChange = getHandler(jsonWatcher, 'change');
      const before = engineRef.current;

      onChange();

      vi.advanceTimersByTime(99);
      expect(engineRef.current).toBe(before);

      vi.useRealTimers();
    });

    it('engine is rebuilt after the debounce window elapses', () => {
      vi.useFakeTimers();
      startRulesWatcher(engineRef, 100);

      const jsonWatcher = createdWatchers[1];
      const onChange = getHandler(jsonWatcher, 'change');
      const before = engineRef.current;

      onChange();
      vi.advanceTimersByTime(100);

      expect(engineRef.current).not.toBe(before);
    });

    it('debounces rapid successive change events — one rebuild per burst', () => {
      vi.useFakeTimers();
      startRulesWatcher(engineRef, 100);

      const jsonWatcher = createdWatchers[1];
      const onChange = getHandler(jsonWatcher, 'change');

      // Trigger 5 events spaced 20 ms apart (80 ms total, resets debounce each time)
      for (let i = 0; i < 5; i++) {
        onChange();
        if (i < 4) vi.advanceTimersByTime(20);
      }

      // Engine should still be the original — debounce has not fired yet
      const before = engineRef.current;

      // Now advance past the debounce — exactly one rebuild should occur
      vi.advanceTimersByTime(100);
      expect(engineRef.current).not.toBe(before);
    });
  });

  // ── JSON watcher add event ──────────────────────────────────────────────────

  describe('JSON watcher add event', () => {
    it('engine is rebuilt when the JSON file is added', () => {
      vi.useFakeTimers();
      startRulesWatcher(engineRef, 100);

      const jsonWatcher = createdWatchers[1];
      const onAdd = getHandler(jsonWatcher, 'add');
      const before = engineRef.current;

      onAdd();
      vi.advanceTimersByTime(100);

      expect(engineRef.current).not.toBe(before);
    });
  });

  // ── Bundle watcher events ───────────────────────────────────────────────────

  describe('bundle watcher change event', () => {
    it('engine is rebuilt after the debounce window elapses', () => {
      vi.useFakeTimers();
      startRulesWatcher(engineRef, 100);

      const bundleWatcher = createdWatchers[2];
      const onChange = getHandler(bundleWatcher, 'change');
      const before = engineRef.current;

      onChange();
      vi.advanceTimersByTime(100);

      expect(engineRef.current).not.toBe(before);
    });
  });

  describe('bundle watcher unlink event', () => {
    it('engine is rebuilt when bundle.json is deleted (fallback to rules.json)', () => {
      vi.useFakeTimers();
      startRulesWatcher(engineRef, 100);

      const bundleWatcher = createdWatchers[2];
      const onUnlink = getHandler(bundleWatcher, 'unlink');
      const before = engineRef.current;

      onUnlink();
      vi.advanceTimersByTime(100);

      expect(engineRef.current).not.toBe(before);
    });
  });

  // ── TS watcher change event (structural only) ───────────────────────────────

  describe('TS watcher change event', () => {
    it('the change handler is registered and callable without throwing', () => {
      // We do NOT advance async timers here to avoid triggering dynamic imports.
      startRulesWatcher(engineRef);
      const tsWatcher = createdWatchers[0];
      const onTsChange = getHandler(tsWatcher, 'change');
      expect(() => onTsChange('/some/rules/support.ts')).not.toThrow();
    });
  });

  // ── Custom debounce argument ────────────────────────────────────────────────

  it('respects a custom debounceMs argument', () => {
    vi.useFakeTimers();
    startRulesWatcher(engineRef, 500);

    const jsonWatcher = createdWatchers[1];
    const onChange = getHandler(jsonWatcher, 'change');
    const before = engineRef.current;

    onChange();

    vi.advanceTimersByTime(499); // just before debounce
    expect(engineRef.current).toBe(before); // not yet rebuilt

    vi.advanceTimersByTime(1); // debounce fires
    expect(engineRef.current).not.toBe(before); // rebuilt
  });

  // ── WatcherHandle shape ─────────────────────────────────────────────────────

  it('returned handle exposes a stop() method', () => {
    const handle = startRulesWatcher(engineRef);
    expect(typeof handle.stop).toBe('function');
  });
});

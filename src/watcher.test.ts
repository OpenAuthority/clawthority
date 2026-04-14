/**
 * Unit tests — watcher.ts
 *
 * Covers:
 *   - startRulesWatcher creates a chokidar watcher for data/rules.json
 *   - WatcherHandle.stop closes the watcher and clears timers
 *   - Debounce behaviour for JSON rule change / add events
 *   - Initial JSON rules load rebuilds engine when rules are present
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const { createdWatchers, mockWatch, MockCedarEngine } = vi.hoisted(() => {
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

  // Mock CedarEngine constructor — returns a fresh object with init().
  const MockCedarEngine = vi.fn(function MockCE() {
    return { init: vi.fn().mockResolvedValue(undefined) };
  });

  return { createdWatchers, mockWatch, MockCedarEngine };
});

vi.mock('chokidar', () => ({
  default: { watch: mockWatch },
}));

// Mock node:fs so hasValidJsonRules does not touch disk.
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
}));

// Expose MockCedarEngine as the CedarEngine export.
vi.mock('./policy/cedar-engine.js', () => ({
  CedarEngine: MockCedarEngine,
}));

// ─── Imports (after mocks are established) ───────────────────────────────────

import { startRulesWatcher } from './watcher.js';
import { CedarEngine } from './policy/cedar-engine.js';
import { existsSync, readFileSync } from 'node:fs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  let engineRef: { current: ReturnType<typeof MockCedarEngine> };

  beforeEach(() => {
    createdWatchers.length = 0;
    mockWatch.mockClear();
    MockCedarEngine.mockClear();

    MockCedarEngine.mockImplementation(function MockCE() {
      return { init: vi.fn().mockResolvedValue(undefined) };
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Default: JSON rules file does not exist → no initial rebuild.
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('[]');

    engineRef = {
      current: new CedarEngine() as unknown as ReturnType<typeof MockCedarEngine>,
    };
    MockCedarEngine.mockClear();
    MockCedarEngine.mockImplementation(function MockCE() {
      return { init: vi.fn().mockResolvedValue(undefined) };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Watcher creation ────────────────────────────────────────────────────────

  it('creates exactly one chokidar watcher', () => {
    startRulesWatcher(engineRef);
    expect(mockWatch).toHaveBeenCalledTimes(1);
    expect(createdWatchers).toHaveLength(1);
  });

  it('watcher targets data/rules.json', () => {
    startRulesWatcher(engineRef);
    const [watchedPath] = mockWatch.mock.calls[0] as [string];
    expect(watchedPath).toMatch(/rules\.json$/);
  });

  it('watcher is configured with persistent:false and ignoreInitial:true', () => {
    startRulesWatcher(engineRef);
    const [, options] = mockWatch.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.persistent).toBe(false);
    expect(options.ignoreInitial).toBe(true);
  });

  // ── Event registration ──────────────────────────────────────────────────────

  it('watcher registers both change and add handlers', () => {
    startRulesWatcher(engineRef);
    const watcher = createdWatchers[0];
    const registeredEvents = watcher.on.mock.calls.map((c: unknown[]) => c[0]);
    expect(registeredEvents).toContain('change');
    expect(registeredEvents).toContain('add');
  });

  // ── stop() ──────────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('closes the watcher', async () => {
      const handle = startRulesWatcher(engineRef);
      await handle.stop();
      expect(createdWatchers[0].close).toHaveBeenCalled();
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

      const watcher = createdWatchers[0];
      const onChange = getHandler(watcher, 'change');
      const before = engineRef.current;

      onChange();

      vi.advanceTimersByTime(99);
      expect(engineRef.current).toBe(before);

      vi.useRealTimers();
    });

    it('engine is rebuilt after the debounce window elapses', () => {
      vi.useFakeTimers();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify([{ effect: 'permit', resource: 'tool', match: '*' }]),
      );
      startRulesWatcher(engineRef, 100);

      const watcher = createdWatchers[0];
      const onChange = getHandler(watcher, 'change');
      const before = engineRef.current;

      onChange();
      vi.advanceTimersByTime(100);

      expect(engineRef.current).not.toBe(before);
    });

    it('debounces rapid successive change events — one rebuild per burst', () => {
      vi.useFakeTimers();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify([{ effect: 'permit', resource: 'tool', match: '*' }]),
      );
      startRulesWatcher(engineRef, 100);

      const watcher = createdWatchers[0];
      const onChange = getHandler(watcher, 'change');

      for (let i = 0; i < 5; i++) {
        onChange();
        if (i < 4) vi.advanceTimersByTime(20);
      }

      const before = engineRef.current;

      vi.advanceTimersByTime(100);
      expect(engineRef.current).not.toBe(before);
    });
  });

  // ── JSON watcher add event ──────────────────────────────────────────────────

  describe('JSON watcher add event', () => {
    it('engine is rebuilt when the JSON file is added', () => {
      vi.useFakeTimers();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify([{ effect: 'permit', resource: 'tool', match: '*' }]),
      );
      startRulesWatcher(engineRef, 100);

      const watcher = createdWatchers[0];
      const onAdd = getHandler(watcher, 'add');
      const before = engineRef.current;

      onAdd();
      vi.advanceTimersByTime(100);

      expect(engineRef.current).not.toBe(before);
    });
  });

  // ── Custom debounce argument ────────────────────────────────────────────────

  it('respects a custom debounceMs argument', () => {
    vi.useFakeTimers();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify([{ effect: 'permit', resource: 'tool', match: '*' }]),
    );
    startRulesWatcher(engineRef, 500);

    const watcher = createdWatchers[0];
    const onChange = getHandler(watcher, 'change');
    const before = engineRef.current;

    onChange();

    vi.advanceTimersByTime(499);
    expect(engineRef.current).toBe(before);

    vi.advanceTimersByTime(1);
    expect(engineRef.current).not.toBe(before);
  });

  // ── WatcherHandle shape ─────────────────────────────────────────────────────

  it('returned handle exposes a stop() method', () => {
    const handle = startRulesWatcher(engineRef);
    expect(typeof handle.stop).toBe('function');
  });
});

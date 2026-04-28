// ─── Auto-permit store — unit tests (T28 / T48) ──────────────────────────────
//
// TC-APS-01  loadAutoPermitRulesFromFile: ENOENT → found: false, empty rules
// TC-APS-02  loadAutoPermitRulesFromFile: valid file returns all valid rules
// TC-APS-03  loadAutoPermitRulesFromFile: mixed records — invalid ones are skipped
// TC-APS-04  loadAutoPermitRulesFromFile: non-array JSON → found: true, empty rules
// TC-APS-05  loadAutoPermitRulesFromFile: empty JSON array → found: true, empty rules
// TC-APS-06  loadAutoPermitRulesFromFile: other file read errors are re-thrown
// TC-APS-07  saveAutoPermitRules: writes JSON to .tmp then renames atomically
// TC-APS-08  saveAutoPermitRules: persists an empty array as valid JSON with checksum
// TC-APS-09  saveAutoPermitRules: written content round-trips through JSON.parse
// TC-APS-10  watchAutoPermitStore: returns handle with stop() method
// TC-APS-11  watchAutoPermitStore: callback fires on 'add' event (after debounce)
// TC-APS-12  watchAutoPermitStore: callback fires on 'change' event (after debounce)
// TC-APS-13  watchAutoPermitStore: rapid events collapse into a single callback
// TC-APS-14  watchAutoPermitStore: stop() closes watcher and cancels debounce
// TC-APS-15  watchAutoPermitStore: custom debounceMs overrides the 300 ms default
// TC-APS-16  saveAutoPermitRules: checksum equals SHA-256(JSON.stringify(rules))
// TC-APS-17  loadAutoPermitRulesFromFile: extracts checksum from versioned envelope
// TC-APS-18  loadAutoPermitRulesFromFile: checksum is undefined for legacy flat-array
// TC-APS-19  loadAutoPermitRulesFromFile: invalid JSON → validationErrors contains parse error, parseError set
// TC-APS-20  loadAutoPermitRulesFromFile: invalid envelope schema → validationErrors contains envelope errors
// TC-APS-21  loadAutoPermitRulesFromFile: invalid individual entry → validationErrors contains entry error
// TC-APS-22  loadAutoPermitRulesFromFile: valid versioned file → validationErrors is empty
// TC-APS-23  loadAutoPermitRulesFromFile: ENOENT → validationErrors is empty
// TC-APS-24  loadAutoPermitRulesFromFile: legacy flat-array with valid rules → validationErrors is empty
// TC-APS-25  loadAutoPermitRulesFromFile: checksum mismatch → validationErrors contains mismatch message

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── chokidar mock ─────────────────────────────────────────────────────────────
// Module-level vi.mock is hoisted by vitest so the fake watcher is in place
// before the store module is imported.

type EventHandler = () => void;

interface FakeWatcher {
  handlers: Record<string, EventHandler[]>;
  on(event: string, handler: EventHandler): FakeWatcher;
  close(): Promise<void>;
  emit(event: string): void;
}

function makeFakeWatcher(): FakeWatcher {
  const w: FakeWatcher = {
    handlers: {},
    on(event, handler) {
      if (!w.handlers[event]) w.handlers[event] = [];
      w.handlers[event]!.push(handler);
      return w;
    },
    close: vi.fn().mockResolvedValue(undefined),
    emit(event) {
      for (const h of w.handlers[event] ?? []) h();
    },
  };
  return w;
}

let currentFakeWatcher: FakeWatcher;

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn((_path: string, _opts: unknown) => {
      currentFakeWatcher = makeFakeWatcher();
      return currentFakeWatcher;
    }),
  },
}));

// ── fs/promises mock ──────────────────────────────────────────────────────────

const mockReadFile = vi.fn<[string, string], Promise<string>>();
const mockWriteFile = vi.fn<[string, string, unknown], Promise<void>>();
const mockRename = vi.fn<[string, string], Promise<void>>();
const mockChmod = vi.fn<[string, number], Promise<void>>();
const mockMkdir = vi.fn<[string, unknown], Promise<void>>();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: Parameters<typeof mockReadFile>) => mockReadFile(...args),
  writeFile: (...args: Parameters<typeof mockWriteFile>) => mockWriteFile(...args),
  rename: (...args: Parameters<typeof mockRename>) => mockRename(...args),
  chmod: (...args: Parameters<typeof mockChmod>) => mockChmod(...args),
  mkdir: (...args: Parameters<typeof mockMkdir>) => mockMkdir(...args),
}));

// ── Import SUT after mocks ────────────────────────────────────────────────────

import {
  loadAutoPermitRulesFromFile,
  saveAutoPermitRules,
  watchAutoPermitStore,
} from './store.js';
import type { AutoPermit } from '../models/auto-permit.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<AutoPermit> & { pattern: string }): AutoPermit {
  return {
    method: 'default',
    createdAt: 1_700_000_000_000,
    originalCommand: 'git commit -m "msg"',
    ...overrides,
  };
}

const STORE_PATH = '/data/auto-permits.json';

// ── loadAutoPermitRulesFromFile ───────────────────────────────────────────────

describe('loadAutoPermitRulesFromFile', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockRename.mockReset();
    mockChmod.mockReset();
  });

  // TC-APS-01
  it('returns found:false and empty rules when the file does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.found).toBe(false);
    expect(result.rules).toEqual([]);
    expect(result.skipped).toBe(0);
    expect(result.path).toBe(STORE_PATH);
  });

  // TC-APS-02
  it('returns all valid rules when the file contains a valid JSON array', async () => {
    const rule = makeRule({ pattern: 'git commit *' });
    mockReadFile.mockResolvedValue(JSON.stringify([rule]));
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.found).toBe(true);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.pattern).toBe('git commit *');
    expect(result.skipped).toBe(0);
  });

  // TC-APS-03
  it('skips invalid records and increments skipped count', async () => {
    const valid = makeRule({ pattern: 'git commit *' });
    const invalid = { pattern: 123, method: 'bad' }; // fails isAutoPermit
    mockReadFile.mockResolvedValue(JSON.stringify([valid, invalid]));
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.found).toBe(true);
    expect(result.rules).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  // TC-APS-04
  it('returns found:true and empty rules when the JSON is not an array', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ rules: [] }));
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.found).toBe(true);
    expect(result.rules).toEqual([]);
    expect(result.skipped).toBe(0);
  });

  // TC-APS-05
  it('returns found:true and empty rules for an empty JSON array', async () => {
    mockReadFile.mockResolvedValue('[]');
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.found).toBe(true);
    expect(result.rules).toEqual([]);
    expect(result.skipped).toBe(0);
    expect(result.version).toBe(0);
  });

  // TC-APS-05b
  it('parses versioned { version, rules } format and returns the correct version', async () => {
    const rule = makeRule({ pattern: 'git push *' });
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 5, rules: [rule] }));
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.found).toBe(true);
    expect(result.version).toBe(5);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.pattern).toBe('git push *');
    expect(result.skipped).toBe(0);
  });

  // TC-APS-17
  it('extracts checksum from versioned { version, rules, checksum } envelope', async () => {
    const rule = makeRule({ pattern: 'git push *' });
    const digest = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 2, rules: [rule], checksum: digest }));
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.checksum).toBe(digest);
  });

  // TC-APS-18
  it('returns undefined checksum for legacy flat-array format', async () => {
    const rule = makeRule({ pattern: 'git push *' });
    mockReadFile.mockResolvedValue(JSON.stringify([rule]));
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.checksum).toBeUndefined();
  });

  // TC-APS-06
  it('re-throws non-ENOENT file read errors', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockReadFile.mockRejectedValue(err);
    await expect(loadAutoPermitRulesFromFile(STORE_PATH)).rejects.toThrow('EACCES');
  });

  // TC-APS-19
  it('returns validationErrors with parse error message and parseError field when JSON is invalid', async () => {
    mockReadFile.mockResolvedValue('{ not valid json }');
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.found).toBe(true);
    expect(result.rules).toEqual([]);
    expect(result.validationErrors).toHaveLength(1);
    expect(result.validationErrors[0]).toContain('invalid JSON');
    expect(result.parseError).toBeDefined();
    expect(result.parseError).toContain('invalid JSON');
  });

  // TC-APS-20
  it('returns validationErrors with envelope errors when the file has an invalid envelope schema', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ notAnEnvelope: true }));
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.found).toBe(true);
    expect(result.rules).toEqual([]);
    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(result.validationErrors.some((e) => e.includes('envelope'))).toBe(true);
    expect(result.parseError).toBeUndefined();
  });

  // TC-APS-21
  it('returns validationErrors with entry-level error when a rule entry is invalid', async () => {
    const invalid = { pattern: 999, method: 'bad' };
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 1, rules: [invalid] }));
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.rules).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(result.validationErrors.some((e) => e.includes('rules[0]'))).toBe(true);
  });

  // TC-APS-22
  it('returns validationErrors:[] for a valid versioned file', async () => {
    const rule = makeRule({ pattern: 'git commit *' });
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 1, rules: [rule] }));
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.validationErrors).toEqual([]);
    expect(result.parseError).toBeUndefined();
  });

  // TC-APS-23
  it('returns validationErrors:[] when the file does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.found).toBe(false);
    expect(result.validationErrors).toEqual([]);
  });

  // TC-APS-24
  it('returns validationErrors:[] for a legacy flat-array with valid rules', async () => {
    const rule = makeRule({ pattern: 'npm run build' });
    mockReadFile.mockResolvedValue(JSON.stringify([rule]));
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    expect(result.validationErrors).toEqual([]);
    expect(result.version).toBe(0);
  });

  // TC-APS-25
  it('returns validationErrors with checksum mismatch message when checksum does not match', async () => {
    const rule = makeRule({ pattern: 'git push *' });
    mockReadFile.mockResolvedValue(
      JSON.stringify({ version: 1, rules: [rule], checksum: 'wrongchecksum' }),
    );
    const result = await loadAutoPermitRulesFromFile(STORE_PATH);
    // Rules are still loaded despite the mismatch.
    expect(result.rules).toHaveLength(1);
    expect(result.validationErrors.some((e) => e.includes('checksum mismatch'))).toBe(true);
  });
});

// ── saveAutoPermitRules ───────────────────────────────────────────────────────

describe('saveAutoPermitRules', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockReset();
    mockRename.mockResolvedValue(undefined);
    mockChmod.mockReset();
    mockChmod.mockResolvedValue(undefined);
    mockMkdir.mockReset();
    mockMkdir.mockResolvedValue(undefined);
  });

  // TC-APS-07
  it('writes to a .tmp file then renames over the target path', async () => {
    const rules = [makeRule({ pattern: 'git commit *' })];
    await saveAutoPermitRules(STORE_PATH, rules, 1);
    expect(mockWriteFile).toHaveBeenCalledWith(
      `${STORE_PATH}.tmp`,
      expect.any(String),
      expect.objectContaining({ mode: 0o644 }),
    );
    expect(mockRename).toHaveBeenCalledWith(`${STORE_PATH}.tmp`, STORE_PATH);
    expect(mockChmod).toHaveBeenCalledWith(STORE_PATH, 0o644);
  });

  // TC-APS-08
  it('writes versioned envelope { version, rules, checksum } as valid JSON when rules is empty', async () => {
    await saveAutoPermitRules(STORE_PATH, [], 1);
    const written = mockWriteFile.mock.calls[0]![1] as string;
    const parsed = JSON.parse(written) as { version: number; rules: unknown[]; checksum: string };
    expect(parsed.version).toBe(1);
    expect(parsed.rules).toEqual([]);
    expect(parsed.checksum).toBe('4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
  });

  // TC-APS-09
  it('written content round-trips through JSON.parse and preserves all fields', async () => {
    const rule = makeRule({ pattern: 'npm install *', method: 'exact', createdAt: 42 });
    await saveAutoPermitRules(STORE_PATH, [rule], 3);
    const written = mockWriteFile.mock.calls[0]![1] as string;
    const parsed = JSON.parse(written) as { version: number; rules: AutoPermit[] };
    expect(parsed.version).toBe(3);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0]).toMatchObject({ pattern: 'npm install *', method: 'exact', createdAt: 42 });
  });

  // TC-APS-09b
  it('uses version 1 by default when nextVersion is omitted', async () => {
    await saveAutoPermitRules(STORE_PATH, []);
    const written = mockWriteFile.mock.calls[0]![1] as string;
    const parsed = JSON.parse(written) as { version: number; rules: AutoPermit[] };
    expect(parsed.version).toBe(1);
  });

  // TC-APS-16
  it('writes checksum equal to SHA-256(JSON.stringify(rules))', async () => {
    const { createHash } = await import('node:crypto');
    const rule = makeRule({ pattern: 'git commit *' });
    await saveAutoPermitRules(STORE_PATH, [rule], 1);
    const written = mockWriteFile.mock.calls[0]![1] as string;
    const parsed = JSON.parse(written) as { version: number; rules: AutoPermit[]; checksum: string };
    const expected = createHash('sha256').update(JSON.stringify(parsed.rules)).digest('hex');
    expect(parsed.checksum).toBe(expected);
  });
});

// ── watchAutoPermitStore ──────────────────────────────────────────────────────

describe('watchAutoPermitStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // TC-APS-10
  it('returns a handle with a stop() method', () => {
    const handle = watchAutoPermitStore(STORE_PATH, vi.fn());
    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
    handle.stop();
  });

  // TC-APS-11
  it('invokes callback after debounce when an add event fires', async () => {
    const cb = vi.fn();
    watchAutoPermitStore(STORE_PATH, cb, { debounceMs: 100 });
    currentFakeWatcher.emit('add');
    expect(cb).not.toHaveBeenCalled(); // not yet — waiting for debounce
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  // TC-APS-12
  it('invokes callback after debounce when a change event fires', async () => {
    const cb = vi.fn();
    watchAutoPermitStore(STORE_PATH, cb, { debounceMs: 50 });
    currentFakeWatcher.emit('change');
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  // TC-APS-13
  it('collapses rapid add+change events into a single callback invocation', () => {
    const cb = vi.fn();
    watchAutoPermitStore(STORE_PATH, cb, { debounceMs: 200 });
    currentFakeWatcher.emit('add');
    vi.advanceTimersByTime(100); // within debounce window
    currentFakeWatcher.emit('change');
    vi.advanceTimersByTime(200); // debounce window resets; now expires
    expect(cb).toHaveBeenCalledTimes(1);
  });

  // TC-APS-14
  it('stop() closes the watcher and prevents the debounced callback from firing', () => {
    const cb = vi.fn();
    const handle = watchAutoPermitStore(STORE_PATH, cb, { debounceMs: 100 });
    currentFakeWatcher.emit('add');
    handle.stop(); // cancel before debounce expires
    vi.advanceTimersByTime(200);
    expect(cb).not.toHaveBeenCalled();
  });

  // TC-APS-15
  it('uses 300 ms debounce by default when debounceMs is not provided', () => {
    const cb = vi.fn();
    watchAutoPermitStore(STORE_PATH, cb);
    currentFakeWatcher.emit('change');
    vi.advanceTimersByTime(299);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

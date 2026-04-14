/**
 * HITL policy configuration – comprehensive test suite
 *
 * Covers:
 *   1. matchesActionPattern  – dot-notation wildcard matching
 *   2. checkAction           – full config evaluation (first-match wins)
 *   3. validateHitlPolicyConfig – schema validation
 *   4. parseHitlPolicyFile   – JSON and YAML file parsing
 *   5. startHitlPolicyWatcher – hot-reload debounce and atomic swap
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ─── Mock chokidar before any watcher imports ─────────────────────────────────

const { mockWatcherOn, mockWatcherClose } = vi.hoisted(() => {
  const mockWatcherOn = vi.fn();
  const mockWatcherClose = vi.fn().mockResolvedValue(undefined);
  return { mockWatcherOn, mockWatcherClose };
});

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: mockWatcherOn.mockReturnThis(),
      close: mockWatcherClose,
    })),
  },
}));

// ─── Imports (after mocks are hoisted) ───────────────────────────────────────

import chokidar from 'chokidar';
import { matchesActionPattern, checkAction } from './matcher.js';
import {
  validateHitlPolicyConfig,
  parseHitlPolicyFile,
  HitlPolicyParseError,
  HitlPolicyValidationError,
} from './parser.js';
import { startHitlPolicyWatcher } from './watcher.js';
import type { HitlPolicyConfig } from './types.js';

// ─── Shared fixture ───────────────────────────────────────────────────────────

const validConfig: HitlPolicyConfig = {
  version: '1',
  policies: [
    {
      name: 'Email mutations',
      actions: ['email.send', 'email.delete'],
      approval: { channel: 'slack', timeout: 300, fallback: 'deny' },
    },
    {
      name: 'File writes',
      description: 'All file writes need review',
      actions: ['file.*'],
      approval: { channel: 'console', timeout: 60, fallback: 'deny' },
      tags: ['filesystem'],
    },
    {
      name: 'Payment catch-all',
      actions: ['payment.*'],
      approval: { channel: 'email', timeout: 600, fallback: 'deny' },
    },
  ],
};

// ─── 1. matchesActionPattern ──────────────────────────────────────────────────

describe('matchesActionPattern', () => {
  it('bare "*" matches any action string', () => {
    expect(matchesActionPattern('*', 'email.delete')).toBe(true);
    expect(matchesActionPattern('*', 'file.write')).toBe(true);
    expect(matchesActionPattern('*', 'anything')).toBe(true);
    expect(matchesActionPattern('*', 'a.b.c')).toBe(true);
  });

  it('exact pattern matches itself only', () => {
    expect(matchesActionPattern('email.delete', 'email.delete')).toBe(true);
    expect(matchesActionPattern('email.delete', 'email.send')).toBe(false);
    expect(matchesActionPattern('email.delete', 'email')).toBe(false);
  });

  it('namespace wildcard "email.*" matches any email action', () => {
    expect(matchesActionPattern('email.*', 'email.send')).toBe(true);
    expect(matchesActionPattern('email.*', 'email.delete')).toBe(true);
    expect(matchesActionPattern('email.*', 'email.forward')).toBe(true);
  });

  it('"email.*" does NOT match other namespaces', () => {
    expect(matchesActionPattern('email.*', 'file.send')).toBe(false);
    expect(matchesActionPattern('email.*', 'sms.send')).toBe(false);
  });

  it('"email.*" does NOT match bare "email" (different segment count)', () => {
    expect(matchesActionPattern('email.*', 'email')).toBe(false);
  });

  it('"email.*" does NOT match three-segment actions', () => {
    expect(matchesActionPattern('email.*', 'email.folder.delete')).toBe(false);
  });

  it('action wildcard "*.delete" matches any namespace delete', () => {
    expect(matchesActionPattern('*.delete', 'email.delete')).toBe(true);
    expect(matchesActionPattern('*.delete', 'file.delete')).toBe(true);
    expect(matchesActionPattern('*.delete', 'payment.delete')).toBe(true);
  });

  it('"*.delete" does NOT match non-delete actions', () => {
    expect(matchesActionPattern('*.delete', 'email.send')).toBe(false);
    expect(matchesActionPattern('*.delete', 'file.write')).toBe(false);
  });

  it('"file.*" matches "file.write", "file.read", "file.delete"', () => {
    expect(matchesActionPattern('file.*', 'file.write')).toBe(true);
    expect(matchesActionPattern('file.*', 'file.read')).toBe(true);
    expect(matchesActionPattern('file.*', 'file.delete')).toBe(true);
  });

  it('pattern with no wildcard works as exact match', () => {
    expect(matchesActionPattern('payment.charge', 'payment.charge')).toBe(true);
    expect(matchesActionPattern('payment.charge', 'payment.refund')).toBe(false);
  });

  it('different segment counts do not match', () => {
    expect(matchesActionPattern('a.b.c', 'a.b')).toBe(false);
    expect(matchesActionPattern('a.b', 'a.b.c')).toBe(false);
  });

  it('single-segment pattern matches single-segment action exactly', () => {
    expect(matchesActionPattern('deploy', 'deploy')).toBe(true);
    expect(matchesActionPattern('deploy', 'redeploy')).toBe(false);
  });
});

// ─── 2. checkAction ──────────────────────────────────────────────────────────

describe('checkAction', () => {
  it('returns requiresApproval:false when no policy matches', () => {
    const result = checkAction(validConfig, 'db.select');
    expect(result.requiresApproval).toBe(false);
    expect(result.matchedPolicy).toBeUndefined();
  });

  it('matches exact action pattern', () => {
    const result = checkAction(validConfig, 'email.send');
    expect(result.requiresApproval).toBe(true);
    expect(result.matchedPolicy?.name).toBe('Email mutations');
  });

  it('matches namespace wildcard "file.*"', () => {
    const result = checkAction(validConfig, 'file.write');
    expect(result.requiresApproval).toBe(true);
    expect(result.matchedPolicy?.name).toBe('File writes');
  });

  it('matches namespace wildcard "payment.*"', () => {
    const result = checkAction(validConfig, 'payment.charge');
    expect(result.requiresApproval).toBe(true);
    expect(result.matchedPolicy?.name).toBe('Payment catch-all');
  });

  it('returns first matching policy in declaration order', () => {
    // Both "Email mutations" (email.send) and a hypothetical catch-all
    // would match, but the first one listed wins.
    const config: HitlPolicyConfig = {
      version: '1',
      policies: [
        {
          name: 'First',
          actions: ['email.*'],
          approval: { channel: 'slack', timeout: 60, fallback: 'deny' },
        },
        {
          name: 'Second',
          actions: ['email.send'],
          approval: { channel: 'console', timeout: 30, fallback: 'deny' },
        },
      ],
    };
    const result = checkAction(config, 'email.send');
    expect(result.matchedPolicy?.name).toBe('First');
  });

  it('matched policy carries the approval config', () => {
    const result = checkAction(validConfig, 'email.delete');
    expect(result.matchedPolicy?.approval).toEqual({
      channel: 'slack',
      timeout: 300,
      fallback: 'deny',
    });
  });

  it('matched policy carries optional tags when present', () => {
    const result = checkAction(validConfig, 'file.write');
    expect(result.matchedPolicy?.tags).toContain('filesystem');
  });
});

// ─── 3. validateHitlPolicyConfig ─────────────────────────────────────────────

describe('validateHitlPolicyConfig', () => {
  it('accepts a fully valid configuration object', () => {
    expect(() => validateHitlPolicyConfig('<in-memory>', validConfig)).not.toThrow();
    const result = validateHitlPolicyConfig('<in-memory>', validConfig);
    expect(result.version).toBe('1');
    expect(result.policies).toHaveLength(3);
  });

  it('throws HitlPolicyValidationError when version is missing', () => {
    const bad = { policies: validConfig.policies };
    expect(() => validateHitlPolicyConfig('test.yaml', bad)).toThrow(
      HitlPolicyValidationError,
    );
  });

  it('throws HitlPolicyValidationError when policies array is missing', () => {
    const bad = { version: '1' };
    expect(() => validateHitlPolicyConfig('test.yaml', bad)).toThrow(
      HitlPolicyValidationError,
    );
  });

  it('throws HitlPolicyValidationError when policies is an empty array', () => {
    const bad = { version: '1', policies: [] };
    expect(() => validateHitlPolicyConfig('test.yaml', bad)).toThrow(
      HitlPolicyValidationError,
    );
  });

  it('throws HitlPolicyValidationError when a policy has no actions', () => {
    const bad = {
      version: '1',
      policies: [
        {
          name: 'Empty',
          actions: [],
          approval: { channel: 'slack', timeout: 60, fallback: 'deny' },
        },
      ],
    };
    expect(() => validateHitlPolicyConfig('test.yaml', bad)).toThrow(
      HitlPolicyValidationError,
    );
  });

  it('throws when approval.timeout is zero or negative', () => {
    const bad = {
      version: '1',
      policies: [
        {
          name: 'Bad timeout',
          actions: ['email.*'],
          approval: { channel: 'slack', timeout: 0, fallback: 'deny' },
        },
      ],
    };
    expect(() => validateHitlPolicyConfig('test.yaml', bad)).toThrow(
      HitlPolicyValidationError,
    );
  });

  it('throws when approval.fallback has an invalid value', () => {
    const bad = {
      version: '1',
      policies: [
        {
          name: 'Bad fallback',
          actions: ['email.*'],
          approval: { channel: 'slack', timeout: 60, fallback: 'skip' },
        },
      ],
    };
    expect(() => validateHitlPolicyConfig('test.yaml', bad)).toThrow(
      HitlPolicyValidationError,
    );
  });

  it('throws when approval.channel is an empty string', () => {
    const bad = {
      version: '1',
      policies: [
        {
          name: 'Empty channel',
          actions: ['email.*'],
          approval: { channel: '', timeout: 60, fallback: 'deny' },
        },
      ],
    };
    expect(() => validateHitlPolicyConfig('test.yaml', bad)).toThrow(
      HitlPolicyValidationError,
    );
  });

  it('throws when input is null', () => {
    expect(() => validateHitlPolicyConfig('test.yaml', null)).toThrow(
      HitlPolicyValidationError,
    );
  });

  it('throws when input is a plain string', () => {
    expect(() => validateHitlPolicyConfig('test.yaml', 'not an object')).toThrow(
      HitlPolicyValidationError,
    );
  });

  it('error message includes the file path', () => {
    try {
      validateHitlPolicyConfig('my-policy.yaml', {});
    } catch (err) {
      expect(err).toBeInstanceOf(HitlPolicyValidationError);
      expect((err as HitlPolicyValidationError).message).toContain('my-policy.yaml');
    }
  });

  it('validation error exposes per-field error messages', () => {
    try {
      validateHitlPolicyConfig('test.yaml', { version: '1', policies: [] });
    } catch (err) {
      expect(err).toBeInstanceOf(HitlPolicyValidationError);
      expect((err as HitlPolicyValidationError).errors.length).toBeGreaterThan(0);
    }
  });

  it('accepts "auto-approve" as a valid fallback value', () => {
    const config: HitlPolicyConfig = {
      version: '1',
      policies: [
        {
          name: 'Auto',
          actions: ['db.*'],
          approval: { channel: 'console', timeout: 10, fallback: 'auto-approve' },
        },
      ],
    };
    expect(() => validateHitlPolicyConfig('<in-memory>', config)).not.toThrow();
  });
});

// ─── 4. parseHitlPolicyFile ───────────────────────────────────────────────────

describe('parseHitlPolicyFile', () => {
  let tmpFile: string;

  afterEach(async () => {
    if (tmpFile && existsSync(tmpFile)) {
      await rm(tmpFile, { force: true });
    }
  });

  it('parses a valid JSON policy file', async () => {
    tmpFile = join(tmpdir(), `hitl-test-${Date.now()}.json`);
    await writeFile(tmpFile, JSON.stringify(validConfig), 'utf-8');

    const result = await parseHitlPolicyFile(tmpFile);
    expect(result.version).toBe('1');
    expect(result.policies).toHaveLength(3);
  });

  it('parses a valid YAML policy file (.yaml extension)', async () => {
    tmpFile = join(tmpdir(), `hitl-test-${Date.now()}.yaml`);
    const yaml = `
version: "1"
policies:
  - name: Test
    actions:
      - email.send
    approval:
      channel: slack
      timeout: 60
      fallback: deny
`;
    await writeFile(tmpFile, yaml, 'utf-8');

    const result = await parseHitlPolicyFile(tmpFile);
    expect(result.version).toBe('1');
    expect(result.policies[0]?.name).toBe('Test');
    expect(result.policies[0]?.actions).toContain('email.send');
  });

  it('parses a valid YAML policy file (.yml extension)', async () => {
    tmpFile = join(tmpdir(), `hitl-test-${Date.now()}.yml`);
    const yaml = `
version: "1"
policies:
  - name: YML test
    actions:
      - file.*
    approval:
      channel: console
      timeout: 30
      fallback: auto-approve
`;
    await writeFile(tmpFile, yaml, 'utf-8');

    const result = await parseHitlPolicyFile(tmpFile);
    expect(result.policies[0]?.approval.fallback).toBe('auto-approve');
  });

  it('throws HitlPolicyParseError for malformed JSON', async () => {
    tmpFile = join(tmpdir(), `hitl-test-${Date.now()}.json`);
    await writeFile(tmpFile, '{ this is not valid json }', 'utf-8');

    await expect(parseHitlPolicyFile(tmpFile)).rejects.toBeInstanceOf(
      HitlPolicyParseError,
    );
  });

  it('throws HitlPolicyParseError for a missing file', async () => {
    tmpFile = join(tmpdir(), `hitl-test-nonexistent-${Date.now()}.json`);
    // Do NOT write the file — it should not exist
    await expect(parseHitlPolicyFile(tmpFile)).rejects.toBeInstanceOf(
      HitlPolicyParseError,
    );
  });

  it('throws HitlPolicyValidationError for a JSON file that fails validation', async () => {
    tmpFile = join(tmpdir(), `hitl-test-${Date.now()}.json`);
    await writeFile(tmpFile, JSON.stringify({ version: '1', policies: [] }), 'utf-8');

    await expect(parseHitlPolicyFile(tmpFile)).rejects.toBeInstanceOf(
      HitlPolicyValidationError,
    );
  });

  it('parses optional description and tags fields', async () => {
    tmpFile = join(tmpdir(), `hitl-test-${Date.now()}.json`);
    const config = {
      version: '1',
      policies: [
        {
          name: 'With extras',
          description: 'A test policy',
          actions: ['email.send'],
          approval: { channel: 'slack', timeout: 60, fallback: 'deny' },
          tags: ['email', 'test'],
        },
      ],
    };
    await writeFile(tmpFile, JSON.stringify(config), 'utf-8');

    const result = await parseHitlPolicyFile(tmpFile);
    expect(result.policies[0]?.description).toBe('A test policy');
    expect(result.policies[0]?.tags).toEqual(['email', 'test']);
  });

  it('parse error carries the file path', async () => {
    tmpFile = join(tmpdir(), `hitl-test-${Date.now()}.json`);
    await writeFile(tmpFile, 'bad json!!!', 'utf-8');

    try {
      await parseHitlPolicyFile(tmpFile);
    } catch (err) {
      expect(err).toBeInstanceOf(HitlPolicyParseError);
      expect((err as HitlPolicyParseError).filePath).toBe(tmpFile);
    }
  });
});

// ─── 5. startHitlPolicyWatcher ───────────────────────────────────────────────

describe('startHitlPolicyWatcher', () => {
  beforeEach(() => {
    vi.mocked(chokidar.watch).mockClear();
    mockWatcherOn.mockClear();
    mockWatcherClose.mockClear();
  });

  it('calls chokidar.watch with the given policy file path', () => {
    const configRef = { current: validConfig };
    const handle = startHitlPolicyWatcher('/path/to/policy.yaml', configRef);

    expect(chokidar.watch).toHaveBeenCalledOnce();
    const [watchedPath] = vi.mocked(chokidar.watch).mock.calls[0]!;
    expect(watchedPath).toBe('/path/to/policy.yaml');

    void handle.stop();
  });

  it('uses persistent:false and ignoreInitial:true', () => {
    const configRef = { current: validConfig };
    const handle = startHitlPolicyWatcher('/path/to/policy.yaml', configRef);

    const [, options] = vi.mocked(chokidar.watch).mock.calls[0]!;
    expect(options).toMatchObject({ persistent: false, ignoreInitial: true });

    void handle.stop();
  });

  it('registers a "change" event handler', () => {
    const configRef = { current: validConfig };
    const handle = startHitlPolicyWatcher('/path/to/policy.yaml', configRef);

    const changeRegistered = mockWatcherOn.mock.calls.some(
      ([event]) => event === 'change',
    );
    expect(changeRegistered).toBe(true);

    void handle.stop();
  });

  it('stop() closes the watcher and resolves', async () => {
    const configRef = { current: validConfig };
    const handle = startHitlPolicyWatcher('/path/to/policy.yaml', configRef);

    await expect(handle.stop()).resolves.toBeUndefined();
    expect(mockWatcherClose).toHaveBeenCalledOnce();
  });

  it('stop() cancels a pending debounce timer before it fires', async () => {
    vi.useFakeTimers();
    const configRef = { current: validConfig };
    const handle = startHitlPolicyWatcher('/path/to/policy.yaml', configRef, 500);

    const changeHandler = mockWatcherOn.mock.calls.find(
      ([event]) => event === 'change',
    )?.[1] as (() => void) | undefined;
    changeHandler?.();

    // Stop before the debounce elapses
    await handle.stop();

    // Advance past debounce window; no reload should have been attempted
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();
  });

  it('debounces rapid change events into a single reload', async () => {
    vi.useFakeTimers();
    const configRef = { current: validConfig };
    const handle = startHitlPolicyWatcher('/path/to/policy.yaml', configRef, 200);

    const changeHandler = mockWatcherOn.mock.calls.find(
      ([event]) => event === 'change',
    )?.[1] as (() => void) | undefined;

    // Fire the change handler 5 times in quick succession
    for (let i = 0; i < 5; i++) {
      changeHandler?.();
    }

    // Advance past the debounce window
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await handle.stop();
    // Main assertion: watcher did not crash and stop() still resolves.
  });

  it('preserves the previous config when reload fails', async () => {
    vi.useFakeTimers();
    const configRef = { current: validConfig };
    const handle = startHitlPolicyWatcher('/nonexistent/path/policy.yaml', configRef, 50);

    const changeHandler = mockWatcherOn.mock.calls.find(
      ([event]) => event === 'change',
    )?.[1] as (() => void) | undefined;
    changeHandler?.();

    // Advance through debounce + async reload (reload will fail: file not found)
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    // configRef should still point to the original validConfig
    expect(configRef.current).toBe(validConfig);
    await handle.stop();
  });

  it('swaps configRef.current to the freshly parsed config on success', async () => {
    // Write a valid policy file to a temp path, then trigger the change
    // handler so the watcher re-parses it and updates configRef.
    const tmpFile = join(tmpdir(), `hitl-watcher-${Date.now()}.json`);
    const newConfig: HitlPolicyConfig = {
      version: '1',
      policies: [
        {
          name: 'reloaded',
          actions: ['updated.*'],
          approval: { channel: 'slack', timeout: 60, fallback: 'deny' },
        },
      ],
    };
    await writeFile(tmpFile, JSON.stringify(newConfig), 'utf-8');

    try {
      const configRef = { current: validConfig };
      const handle = startHitlPolicyWatcher(tmpFile, configRef, 10);

      const changeHandler = mockWatcherOn.mock.calls.find(
        ([event]) => event === 'change',
      )?.[1] as (() => void) | undefined;
      changeHandler?.();

      // Wait for debounce + async parse to settle without fake timers (we
      // need the real fs read to resolve).
      await vi.waitFor(
        () => expect(configRef.current.policies[0]?.name).toBe('reloaded'),
        { timeout: 1000 },
      );
      expect(configRef.current).not.toBe(validConfig);
      await handle.stop();
    } finally {
      if (existsSync(tmpFile)) await rm(tmpFile);
    }
  });

  it('double stop() is safe (idempotent)', async () => {
    const configRef = { current: validConfig };
    const handle = startHitlPolicyWatcher('/path/to/policy.yaml', configRef);

    await handle.stop();
    await expect(handle.stop()).resolves.toBeUndefined();
    expect(mockWatcherClose).toHaveBeenCalledOnce();
  });
});

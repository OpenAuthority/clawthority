import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { FileAuthorityAdapter } from './file-adapter.js';
import type { FileAuthorityAdapterConfig } from './file-adapter.js';

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

// Minimal chokidar watcher stub
function makeWatcherStub() {
  const emitter = new EventEmitter();
  const watcher = {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
      return watcher;
    },
    close: vi.fn().mockResolvedValue(undefined),
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
  };
  return watcher;
}

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const BUNDLE_PATH = '/tmp/test-bundle.json';

const makeConfig = (overrides?: Partial<FileAuthorityAdapterConfig>): FileAuthorityAdapterConfig => ({
  bundlePath: BUNDLE_PATH,
  ...overrides,
});

const validBundle = { version: 1, policies: [] };
const validBundleJson = JSON.stringify(validBundle);

describe('FileAuthorityAdapter.issueCapability', () => {
  let adapter: FileAuthorityAdapter;

  beforeEach(() => {
    adapter = new FileAuthorityAdapter(makeConfig());
  });

  it('returns a capability with a UUID v7 approval_id', async () => {
    const cap = await adapter.issueCapability({
      action_class: 'email.send',
      target: 'user@example.com',
      payload_hash: 'abc123',
    });
    expect(cap.approval_id).toMatch(UUID_V7_RE);
  });

  it('computes a SHA-256 binding over action_class|target|payload_hash', async () => {
    const cap = await adapter.issueCapability({
      action_class: 'email.send',
      target: 'user@example.com',
      payload_hash: 'abc123',
    });
    expect(cap.binding).toMatch(SHA256_RE);
    expect(cap.binding).toHaveLength(64);
  });

  it('binding is deterministic for identical inputs', async () => {
    const opts = { action_class: 'email.send', target: 'user@example.com', payload_hash: 'abc123' };
    const cap1 = await adapter.issueCapability(opts);
    const cap2 = await adapter.issueCapability(opts);
    expect(cap1.binding).toBe(cap2.binding);
  });

  it('stores the capability in memory (different approval_ids for each call)', async () => {
    const opts = { action_class: 'email.send', target: 'user@example.com', payload_hash: 'abc123' };
    const cap1 = await adapter.issueCapability(opts);
    const cap2 = await adapter.issueCapability(opts);
    expect(cap1.approval_id).not.toBe(cap2.approval_id);
  });

  it('uses the default TTL of 3600s when none is configured', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const cap = await adapter.issueCapability({
      action_class: 'a',
      target: 'b',
      payload_hash: 'c',
    });
    expect(cap.issued_at).toBeGreaterThanOrEqual(now);
    expect(cap.expires_at - cap.issued_at).toBe(3600 * 1000);
    vi.useRealTimers();
  });

  it('respects capabilityTtlSeconds from config', async () => {
    const localAdapter = new FileAuthorityAdapter(makeConfig({ capabilityTtlSeconds: 600 }));
    const cap = await localAdapter.issueCapability({
      action_class: 'a',
      target: 'b',
      payload_hash: 'c',
    });
    expect(cap.expires_at - cap.issued_at).toBe(600 * 1000);
  });

  it('respects ttl_seconds override in opts', async () => {
    const cap = await adapter.issueCapability({
      action_class: 'a',
      target: 'b',
      payload_hash: 'c',
      ttl_seconds: 120,
    });
    expect(cap.expires_at - cap.issued_at).toBe(120 * 1000);
  });

  it('attaches session_id when provided', async () => {
    const cap = await adapter.issueCapability({
      action_class: 'a',
      target: 'b',
      payload_hash: 'c',
      session_id: 'sess-xyz',
    });
    expect(cap.session_id).toBe('sess-xyz');
  });

  it('omits session_id when not provided', async () => {
    const cap = await adapter.issueCapability({
      action_class: 'a',
      target: 'b',
      payload_hash: 'c',
    });
    expect('session_id' in cap).toBe(false);
  });

  it('sets action_class and target on the capability', async () => {
    const cap = await adapter.issueCapability({
      action_class: 'file.delete',
      target: '/etc/passwd',
      payload_hash: 'deadbeef',
    });
    expect(cap.action_class).toBe('file.delete');
    expect(cap.target).toBe('/etc/passwd');
  });
});

describe('FileAuthorityAdapter.watchPolicyBundle', () => {
  let adapter: FileAuthorityAdapter;
  let watcherStub: ReturnType<typeof makeWatcherStub>;
  let readFileMock: ReturnType<typeof vi.fn>;
  let chokidarMock: { watch: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    watcherStub = makeWatcherStub();
    const chokidar = await import('chokidar');
    chokidarMock = chokidar.default as unknown as { watch: ReturnType<typeof vi.fn> };
    chokidarMock.watch.mockReturnValue(watcherStub);

    const fsPromises = await import('node:fs/promises');
    readFileMock = fsPromises.readFile as ReturnType<typeof vi.fn>;
    readFileMock.mockResolvedValue(validBundleJson);

    adapter = new FileAuthorityAdapter(makeConfig());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls onUpdate with the initial bundle on startup', async () => {
    const onUpdate = vi.fn();
    const handle = await adapter.watchPolicyBundle(onUpdate);
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }));
    await handle.stop();
  });

  it('watches the configured bundlePath with chokidar', async () => {
    const onUpdate = vi.fn();
    const handle = await adapter.watchPolicyBundle(onUpdate);
    expect(chokidarMock.watch).toHaveBeenCalledWith(
      BUNDLE_PATH,
      expect.objectContaining({ ignoreInitial: true }),
    );
    await handle.stop();
  });

  it('does not call onUpdate for a version equal to current', async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const handle = await adapter.watchPolicyBundle(onUpdate);
    expect(onUpdate).toHaveBeenCalledTimes(1); // initial

    // Same version as initial (1)
    readFileMock.mockResolvedValue(JSON.stringify({ version: 1 }));
    watcherStub.emit('change');
    await vi.runAllTimersAsync();

    expect(onUpdate).toHaveBeenCalledTimes(1); // no additional call
    vi.useRealTimers();
    await handle.stop();
  });

  it('does not call onUpdate for a lower version (monotonicity)', async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const handle = await adapter.watchPolicyBundle(onUpdate);
    expect(onUpdate).toHaveBeenCalledTimes(1); // initial (v1)

    readFileMock.mockResolvedValue(JSON.stringify({ version: 0 }));
    watcherStub.emit('change');
    await vi.runAllTimersAsync();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    await handle.stop();
  });

  it('calls onUpdate for a strictly greater version', async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const handle = await adapter.watchPolicyBundle(onUpdate);
    expect(onUpdate).toHaveBeenCalledTimes(1); // initial (v1)

    readFileMock.mockResolvedValue(JSON.stringify({ version: 2, policies: ['new'] }));
    watcherStub.emit('change');
    await vi.runAllTimersAsync();

    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ version: 2 }));
    vi.useRealTimers();
    await handle.stop();
  });

  it('fails gracefully on invalid JSON (no onUpdate call, previous bundle remains)', async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const handle = await adapter.watchPolicyBundle(onUpdate);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    readFileMock.mockResolvedValue('not-valid-json{{{');
    watcherStub.emit('change');
    await vi.runAllTimersAsync();

    expect(onUpdate).toHaveBeenCalledTimes(1); // no additional call
    vi.useRealTimers();
    await handle.stop();
  });

  it('fails gracefully when bundle is missing the version field', async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const handle = await adapter.watchPolicyBundle(onUpdate);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    readFileMock.mockResolvedValue(JSON.stringify({ policies: [] })); // no version
    watcherStub.emit('change');
    await vi.runAllTimersAsync();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    await handle.stop();
  });

  it('stop() closes the chokidar watcher', async () => {
    const handle = await adapter.watchPolicyBundle(vi.fn());
    await handle.stop();
    expect(watcherStub.close).toHaveBeenCalledOnce();
  });

  it('stop() is idempotent (safe to call multiple times)', async () => {
    const handle = await adapter.watchPolicyBundle(vi.fn());
    await handle.stop();
    await handle.stop();
    expect(watcherStub.close).toHaveBeenCalledOnce();
  });
});

describe('FileAuthorityAdapter.watchRevocations', () => {
  it('returns an async iterable that yields no items', async () => {
    const adapter = new FileAuthorityAdapter(makeConfig());
    const items: string[] = [];
    for await (const id of adapter.watchRevocations()) {
      items.push(id);
    }
    expect(items).toHaveLength(0);
  });
});

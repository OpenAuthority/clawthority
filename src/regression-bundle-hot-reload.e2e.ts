/**
 * Regression test suite: bundle hot-reload via chokidar file watching
 *
 * Verifies that writing a new policy bundle to disk causes the active rules to
 * update within the chokidar debounce window (300 ms) plus a processing
 * tolerance. Tests use real filesystem I/O and a live chokidar watcher — no
 * mocks — so they exercise the full hot-reload path end-to-end.
 *
 * Timing model:
 *   file write → chokidar 'change' event → 300 ms debounce → readBundle()
 *   → onUpdate(bundle) callback
 *
 * Upper bound used in assertions: 600 ms (300 ms debounce + 300 ms tolerance).
 *
 *  TC-RBH-01  chokidar detects file write and fires onUpdate within 600 ms
 *  TC-RBH-02  active rules reflect new bundle content within 600 ms of file write
 *  TC-RBH-03  rapid sequential writes within debounce window are coalesced; only
 *             the last-written bundle rules become active
 *  TC-RBH-04  second sequential change propagates after first reload settles
 *  TC-RBH-05  rule content is fully parsed — action_class, effect, and reason
 *             are all present in the active bundle after reload
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileAuthorityAdapter } from './adapter/file-adapter.js';
import type { PolicyBundle, WatchHandle } from './adapter/types.js';
import type { BundleRule } from './policy/bundle.js';

// ─── Timing constants ────────────────────────────────────────────────────────

/**
 * Maximum time (ms) from file write to onUpdate callback.
 * = RELOAD_DEBOUNCE_MS (300) + processing tolerance (300).
 */
const RELOAD_DEADLINE_MS = 600;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function checksumOf(rules: BundleRule[]): string {
  return createHash('sha256').update(JSON.stringify(rules)).digest('hex');
}

function makeBundle(
  version: number,
  rules: BundleRule[],
): { version: number; rules: BundleRule[]; checksum: string } {
  return { version, rules, checksum: checksumOf(rules) };
}

/**
 * Polls `poll()` on a short interval until it returns a non-null/non-undefined
 * value. Throws if the deadline elapses first.
 */
async function waitFor<T>(
  poll: () => T | null | undefined,
  { timeoutMs = RELOAD_DEADLINE_MS, intervalMs = 20 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const val = poll();
    if (val != null) return val;
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: condition not met within ${timeoutMs} ms`);
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
}

// ─── Rule fixtures ────────────────────────────────────────────────────────────

const PERMIT_READ: BundleRule = {
  effect: 'permit',
  action_class: 'filesystem.read',
  reason: 'regression-read-allowed',
};

const FORBID_READ: BundleRule = {
  effect: 'forbid',
  action_class: 'filesystem.read',
  reason: 'regression-read-forbidden',
};

const PERMIT_WRITE: BundleRule = {
  effect: 'permit',
  action_class: 'filesystem.write',
  reason: 'regression-write-allowed',
};

// ─── Predicate helpers ────────────────────────────────────────────────────────

type MinimalRule = { effect: 'permit' | 'forbid'; action_class?: string; reason?: string };

function findRule(
  bundle: PolicyBundle | null,
  action_class: string,
  effect: 'permit' | 'forbid',
): MinimalRule | undefined {
  if (!bundle?.rules) return undefined;
  return (bundle.rules as MinimalRule[]).find(
    (r) => r.action_class === action_class && r.effect === effect,
  );
}

function hasEffect(
  bundle: PolicyBundle | null,
  action_class: string,
  effect: 'permit' | 'forbid',
): boolean {
  return findRule(bundle, action_class, effect) !== undefined;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('regression: bundle hot-reload via chokidar', () => {
  let testDir: string;
  let bundlePath: string;
  let adapter: FileAuthorityAdapter;
  let handle: WatchHandle | null;

  beforeEach(async () => {
    testDir = join(tmpdir(), `oa-rbh-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    bundlePath = join(testDir, 'bundle.json');
    adapter = new FileAuthorityAdapter({ bundlePath });
    handle = null;
  });

  afterEach(async () => {
    await handle?.stop();
    await rm(testDir, { recursive: true, force: true });
  });

  // ── TC-RBH-01 ──────────────────────────────────────────────────────────────

  it(
    'TC-RBH-01: chokidar detects file change and fires onUpdate within 600 ms',
    async () => {
      // Write the initial bundle so the adapter has something to load on start.
      const v1 = makeBundle(1, [PERMIT_READ]);
      await writeFile(bundlePath, JSON.stringify(v1));

      let callCount = 0;
      handle = await adapter.watchPolicyBundle(() => {
        callCount++;
      });

      // Baseline: initial load fires onUpdate synchronously (count = 1).
      expect(callCount).toBe(1);

      // Write v2 and measure how long until the second onUpdate fires.
      const v2 = makeBundle(2, [FORBID_READ]);
      const writeTime = Date.now();
      await writeFile(bundlePath, JSON.stringify(v2));

      await waitFor(() => (callCount >= 2 ? true : null), {
        timeoutMs: RELOAD_DEADLINE_MS,
      });

      const elapsed = Date.now() - writeTime;
      expect(callCount).toBe(2);
      expect(elapsed).toBeLessThan(RELOAD_DEADLINE_MS);
    },
    10_000,
  );

  // ── TC-RBH-02 ──────────────────────────────────────────────────────────────

  it(
    'TC-RBH-02: active rules reflect new bundle content within 600 ms of file write',
    async () => {
      const v1 = makeBundle(1, [PERMIT_READ]);
      await writeFile(bundlePath, JSON.stringify(v1));

      let activeBundle: PolicyBundle | null = null;
      handle = await adapter.watchPolicyBundle((b) => {
        activeBundle = b;
      });

      // Baseline rules: filesystem.read permitted.
      expect(hasEffect(activeBundle, 'filesystem.read', 'permit')).toBe(true);
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(false);

      const preSwap = activeBundle;

      // Swap to a forbid bundle — chokidar should detect the file change and
      // apply the new rules within the debounce + tolerance window.
      const v2 = makeBundle(2, [FORBID_READ]);
      await writeFile(bundlePath, JSON.stringify(v2));

      await waitFor(() => (activeBundle !== preSwap ? activeBundle : null), {
        timeoutMs: RELOAD_DEADLINE_MS,
      });

      // Active bundle must now forbid filesystem.read, not permit it.
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(true);
      expect(hasEffect(activeBundle, 'filesystem.read', 'permit')).toBe(false);
    },
    10_000,
  );

  // ── TC-RBH-03 ──────────────────────────────────────────────────────────────

  it(
    'TC-RBH-03: rapid sequential writes within debounce window are coalesced; only last bundle rules are active',
    async () => {
      const v1 = makeBundle(1, [PERMIT_READ]);
      await writeFile(bundlePath, JSON.stringify(v1));

      let updateCount = 0;
      let activeBundle: PolicyBundle | null = null;
      handle = await adapter.watchPolicyBundle((b) => {
        activeBundle = b;
        updateCount++;
      });

      // Baseline: initial load.
      expect(updateCount).toBe(1);

      const preSwap = activeBundle;

      // Write three successive bundles in rapid succession (< 50 ms apart),
      // well within the 300 ms debounce window. The adapter should coalesce
      // these into a single reload that applies only the last version (v4).
      const v2 = makeBundle(2, [FORBID_READ]);
      const v3 = makeBundle(3, [PERMIT_WRITE]);
      const v4 = makeBundle(4, [FORBID_READ, PERMIT_WRITE]);

      await writeFile(bundlePath, JSON.stringify(v2));
      await new Promise<void>((r) => setTimeout(r, 30));
      await writeFile(bundlePath, JSON.stringify(v3));
      await new Promise<void>((r) => setTimeout(r, 30));
      await writeFile(bundlePath, JSON.stringify(v4));

      // Wait for the coalesced reload to fire.
      await waitFor(() => (activeBundle !== preSwap ? activeBundle : null), {
        // Extra headroom: 300 ms debounce restarts on each write, so the
        // actual reload fires ~300 ms after the last write.
        timeoutMs: RELOAD_DEADLINE_MS + 200,
      });

      // Exactly one additional onUpdate call (coalesced from three writes).
      expect(updateCount).toBe(2);

      // Active rules must match v4 — both rules present.
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(true);
      expect(hasEffect(activeBundle, 'filesystem.write', 'permit')).toBe(true);
    },
    10_000,
  );

  // ── TC-RBH-04 ──────────────────────────────────────────────────────────────

  it(
    'TC-RBH-04: second sequential change propagates after first reload settles',
    async () => {
      const v1 = makeBundle(1, [PERMIT_READ]);
      await writeFile(bundlePath, JSON.stringify(v1));

      let activeBundle: PolicyBundle | null = null;
      handle = await adapter.watchPolicyBundle((b) => {
        activeBundle = b;
      });

      // ── First change: permit → forbid ──────────────────────────────────────

      const afterV1 = activeBundle;
      expect(hasEffect(activeBundle, 'filesystem.read', 'permit')).toBe(true);

      const v2 = makeBundle(2, [FORBID_READ]);
      await writeFile(bundlePath, JSON.stringify(v2));

      await waitFor(() => (activeBundle !== afterV1 ? activeBundle : null), {
        timeoutMs: RELOAD_DEADLINE_MS,
      });

      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(true);

      // ── Second change: forbid → permit + write ─────────────────────────────

      const afterV2 = activeBundle;

      const v3 = makeBundle(3, [PERMIT_READ, PERMIT_WRITE]);
      await writeFile(bundlePath, JSON.stringify(v3));

      await waitFor(() => (activeBundle !== afterV2 ? activeBundle : null), {
        timeoutMs: RELOAD_DEADLINE_MS,
      });

      expect(hasEffect(activeBundle, 'filesystem.read', 'permit')).toBe(true);
      expect(hasEffect(activeBundle, 'filesystem.write', 'permit')).toBe(true);
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(false);
    },
    10_000,
  );

  // ── TC-RBH-05 ──────────────────────────────────────────────────────────────

  it(
    'TC-RBH-05: rule content is fully parsed — action_class, effect, and reason all present after reload',
    async () => {
      const v1 = makeBundle(1, [PERMIT_READ]);
      await writeFile(bundlePath, JSON.stringify(v1));

      let activeBundle: PolicyBundle | null = null;
      handle = await adapter.watchPolicyBundle((b) => {
        activeBundle = b;
      });

      const preSwap = activeBundle;

      // v2 carries a forbid rule with a specific reason field that must
      // survive the full serialise → write → chokidar → parse round-trip.
      const v2 = makeBundle(2, [FORBID_READ]);
      await writeFile(bundlePath, JSON.stringify(v2));

      await waitFor(() => (activeBundle !== preSwap ? activeBundle : null), {
        timeoutMs: RELOAD_DEADLINE_MS,
      });

      // The full rule object — not just effect — must be present.
      const matched = findRule(activeBundle, 'filesystem.read', 'forbid');
      expect(matched).toBeDefined();
      expect(matched?.effect).toBe('forbid');
      expect(matched?.action_class).toBe('filesystem.read');
      expect(matched?.reason).toBe('regression-read-forbidden');
    },
    10_000,
  );
});

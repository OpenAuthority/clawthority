/**
 * Bundle hot-reload e2e tests
 *
 * Exercises policy bundle swapping, validation, and version control at runtime.
 * Tests use FileAuthorityAdapter's watchPolicyBundle() for live file-watching
 * scenarios (TC-BR-01–03, TC-17, TC-18) and validateBundle() for explicit
 * validation semantics (TC-BR-04, TC-19).
 *
 *  TC-BR-01  permissive.json permits filesystem.read on initial load
 *  TC-BR-02  swapBundle(v2-read-forbidden) denies filesystem.read within 1 s
 *  TC-BR-03  non-monotonic version is rejected; old bundle stays active
 *  TC-BR-04  bundle with broken checksum is rejected; old bundle stays active
 *  TC-17     valid version increment takes effect within 500 ms; filesystem.read changes
 *  TC-18     non-monotonic version rejected from high baseline; old bundle stays active
 *  TC-19     mismatched checksum produces descriptive error available for logging
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileAuthorityAdapter } from './adapter/file-adapter.js';
import type { PolicyBundle, WatchHandle } from './adapter/types.js';
import { validateBundle } from './policy/bundle.js';
import type { BundleRule } from './policy/bundle.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Computes SHA-256(JSON.stringify(rules)) — the checksum format expected by
 * validateBundle() in src/policy/bundle.ts.
 */
function checksumOf(rules: BundleRule[]): string {
  return createHash('sha256').update(JSON.stringify(rules)).digest('hex');
}

/**
 * Builds a bundle object whose checksum is always consistent with its rules,
 * so fixtures never silently violate the checksum invariant.
 */
function makeBundle(
  version: number,
  rules: BundleRule[],
): { version: number; rules: BundleRule[]; checksum: string } {
  return { version, rules, checksum: checksumOf(rules) };
}

/**
 * Polls `poll()` on a short interval until it returns a non-null / non-undefined
 * value, then returns that value.  Throws if the deadline is exceeded.
 *
 * Use this instead of sleep() for all timing-sensitive assertions.
 */
async function waitFor<T>(
  poll: () => T | null | undefined,
  { timeoutMs = 1_000, intervalMs = 30 } = {},
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
  reason: 'read-allowed',
};

const FORBID_READ: BundleRule = {
  effect: 'forbid',
  action_class: 'filesystem.read',
  reason: 'read-forbidden',
};

// ─── Rule-matching predicates ─────────────────────────────────────────────────

type MinimalRule = { effect: 'permit' | 'forbid'; action_class?: string };

function hasEffect(
  bundle: PolicyBundle | null,
  action_class: string,
  effect: 'permit' | 'forbid',
): boolean {
  if (!bundle?.rules) return false;
  return (bundle.rules as MinimalRule[]).some(
    (r) => r.action_class === action_class && r.effect === effect,
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('bundle hot-reload', () => {
  let testDir: string;
  let bundlePath: string;
  let adapter: FileAuthorityAdapter;
  let handle: WatchHandle | null;

  beforeEach(async () => {
    testDir = join(tmpdir(), `oa-br-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    bundlePath = join(testDir, 'bundle.json');
    adapter = new FileAuthorityAdapter({ bundlePath });
    handle = null;
  });

  afterEach(async () => {
    await handle?.stop();
    await rm(testDir, { recursive: true, force: true });
  });

  // ── TC-BR-01 ─────────────────────────────────────────────────────────────────

  it(
    'TC-BR-01: permissive bundle permits filesystem.read on initial load',
    async () => {
      const permBundle = makeBundle(1, [PERMIT_READ]);
      await writeFile(bundlePath, JSON.stringify(permBundle));

      let activeBundle: PolicyBundle | null = null;
      handle = await adapter.watchPolicyBundle((b) => {
        activeBundle = b;
      });

      // watchPolicyBundle calls onUpdate synchronously with the initial bundle.
      expect(activeBundle).not.toBeNull();
      expect(hasEffect(activeBundle, 'filesystem.read', 'permit')).toBe(true);
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(false);
    },
  );

  // ── TC-BR-02 ─────────────────────────────────────────────────────────────────

  it(
    'TC-BR-02: swapping to forbidden bundle denies filesystem.read within 1 s',
    async () => {
      const permBundle = makeBundle(1, [PERMIT_READ]);
      await writeFile(bundlePath, JSON.stringify(permBundle));

      let activeBundle: PolicyBundle | null = null;
      handle = await adapter.watchPolicyBundle((b) => {
        activeBundle = b;
      });

      // Baseline: filesystem.read is permitted.
      expect(hasEffect(activeBundle, 'filesystem.read', 'permit')).toBe(true);

      const preSwapBundle = activeBundle;

      // Swap the bundle file — triggers the chokidar watcher (debounce: 300 ms).
      const forbidBundle = makeBundle(2, [FORBID_READ]);
      await writeFile(bundlePath, JSON.stringify(forbidBundle));

      // waitFor the adapter to detect the change and apply the new bundle.
      // Deadline: 1 000 ms (acceptance criterion).
      await waitFor(
        () => (activeBundle !== preSwapBundle ? activeBundle : null),
        { timeoutMs: 1_000 },
      );

      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(true);
      expect(hasEffect(activeBundle, 'filesystem.read', 'permit')).toBe(false);
    },
    10_000,
  );

  // ── TC-BR-03 ─────────────────────────────────────────────────────────────────

  it(
    'TC-BR-03: non-monotonic version is rejected and old bundle stays active',
    async () => {
      // Start with v2 so a v1 reload is a clear regression.
      const v2Bundle = makeBundle(2, [FORBID_READ]);
      await writeFile(bundlePath, JSON.stringify(v2Bundle));

      let updateCount = 0;
      let activeBundle: PolicyBundle | null = null;
      handle = await adapter.watchPolicyBundle((b) => {
        activeBundle = b;
        updateCount++;
      });

      // Initial load counted.
      expect(updateCount).toBe(1);
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(true);

      // Write a v1 bundle — version regression / rollback attempt.
      const v1Bundle = makeBundle(1, [PERMIT_READ]);
      await writeFile(bundlePath, JSON.stringify(v1Bundle));

      // Wait past the debounce window (300 ms) plus a processing buffer.
      // Use waitFor with a timed-elapsed condition rather than sleep().
      const writeTime = Date.now();
      await waitFor(() => (Date.now() - writeTime >= 500 ? true : null), {
        timeoutMs: 700,
      });

      // The adapter should have seen the file change but rejected v1 because
      // version 1 ≤ currentVersion (2).
      expect(updateCount).toBe(1);
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(true);
    },
    10_000,
  );

  // ── TC-BR-04 ─────────────────────────────────────────────────────────────────

  it(
    'TC-BR-04: bundle with broken checksum is rejected; old bundle stays active',
    async () => {
      // Establish a valid active bundle (v1, permissive).
      const permBundle = makeBundle(1, [PERMIT_READ]);
      expect(permBundle.checksum).toHaveLength(64); // sanity-check SHA-256 hex

      // Construct a v2 bundle with a deliberately wrong checksum.
      const tamperedBundle = {
        version: 2,
        rules: [FORBID_READ],
        checksum: '0'.repeat(64), // all-zero — never a valid SHA-256 of these rules
      };

      // validateBundle() must accept the good bundle at version 0 (cold start).
      const goodResult = validateBundle(permBundle, 0);
      expect(goodResult.valid).toBe(true);

      // validateBundle() must reject the tampered bundle with a checksum error.
      const badResult = validateBundle(tamperedBundle, permBundle.version);
      expect(badResult.valid).toBe(false);
      expect(badResult.error).toMatch(/[Cc]hecksum/);

      // Simulate the "keep old bundle active" invariant: a loader that gates
      // bundle application on validateBundle() will not apply the tampered bundle.
      let currentBundle: typeof permBundle | typeof tamperedBundle = permBundle;
      const applyResult = validateBundle(tamperedBundle, currentBundle.version);
      if (applyResult.valid) {
        currentBundle = tamperedBundle;
      }
      // Old bundle still active because checksum failed.
      expect(currentBundle).toBe(permBundle);
      expect(hasEffect(currentBundle as PolicyBundle, 'filesystem.read', 'permit')).toBe(true);
    },
  );

  // ── TC-17 ────────────────────────────────────────────────────────────────────

  it(
    'TC-17: valid version increment with new rules takes effect within 500 ms',
    async () => {
      const permBundle = makeBundle(1, [PERMIT_READ]);
      await writeFile(bundlePath, JSON.stringify(permBundle));

      let activeBundle: PolicyBundle | null = null;
      handle = await adapter.watchPolicyBundle((b) => {
        activeBundle = b;
      });

      // Baseline: filesystem.read is permitted.
      expect(hasEffect(activeBundle, 'filesystem.read', 'permit')).toBe(true);
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(false);

      const preSwapBundle = activeBundle;

      // Write v2 with a forbidden rule — the adapter must detect and apply
      // within the 500 ms acceptance-criterion window.
      const forbidBundle = makeBundle(2, [FORBID_READ]);
      await writeFile(bundlePath, JSON.stringify(forbidBundle));

      // Deadline: 500 ms (stricter than the general 1 s criterion in TC-BR-02).
      await waitFor(
        () => (activeBundle !== preSwapBundle ? activeBundle : null),
        { timeoutMs: 500 },
      );

      // filesystem.read behaviour must have changed to forbidden.
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(true);
      expect(hasEffect(activeBundle, 'filesystem.read', 'permit')).toBe(false);
    },
    10_000,
  );

  // ── TC-18 ────────────────────────────────────────────────────────────────────

  it(
    'TC-18: non-monotonic version from high baseline is rejected; previous bundle remains active',
    async () => {
      // Start at a high version (5) so any lower version is unambiguously
      // non-monotonic.  This complements TC-BR-03 (v2 → v1) by verifying the
      // guard holds regardless of the specific version gap.
      const v5Bundle = makeBundle(5, [FORBID_READ]);
      await writeFile(bundlePath, JSON.stringify(v5Bundle));

      let updateCount = 0;
      let activeBundle: PolicyBundle | null = null;
      handle = await adapter.watchPolicyBundle((b) => {
        activeBundle = b;
        updateCount++;
      });

      // Initial load counted.
      expect(updateCount).toBe(1);
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(true);

      // Write a v3 bundle — rollback attempt (3 ≤ 5).
      const v3Bundle = makeBundle(3, [PERMIT_READ]);
      await writeFile(bundlePath, JSON.stringify(v3Bundle));

      // Allow the debounce window (300 ms) plus a processing buffer to elapse.
      const writeTime = Date.now();
      await waitFor(() => (Date.now() - writeTime >= 500 ? true : null), {
        timeoutMs: 700,
      });

      // The adapter should have rejected v3; updateCount and bundle unchanged.
      expect(updateCount).toBe(1);
      expect(hasEffect(activeBundle, 'filesystem.read', 'forbid')).toBe(true);
      expect(hasEffect(activeBundle, 'filesystem.read', 'permit')).toBe(false);
    },
    10_000,
  );

  // ── TC-19 ────────────────────────────────────────────────────────────────────

  it(
    'TC-19: mismatched checksum is rejected; validation error is descriptive for logging',
    async () => {
      const permBundle = makeBundle(1, [PERMIT_READ]);

      // Construct a v2 bundle where the checksum belongs to a *different* rule
      // set — a realistic tamper scenario (rules were swapped after signing).
      const tamperedBundle = {
        version: 2,
        rules: [FORBID_READ],
        checksum: checksumOf([PERMIT_READ]), // checksum is for PERMIT_READ, not FORBID_READ
      };

      // validateBundle() must reject the tampered bundle.
      const result = validateBundle(tamperedBundle, permBundle.version);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/[Cc]hecksum/);

      // The error message must contain both the expected and the actual digest
      // so that it surfaces meaningful information when forwarded to a logger.
      const expectedDigest = checksumOf([FORBID_READ]);
      const actualDigest = checksumOf([PERMIT_READ]);
      expect(result.error).toContain(expectedDigest);
      expect(result.error).toContain(actualDigest);

      // Simulate the "previous bundle stays active" invariant: a loader that
      // gates application on validateBundle() must not apply the tampered bundle.
      let currentBundle: typeof permBundle | typeof tamperedBundle = permBundle;
      if (result.valid) {
        currentBundle = tamperedBundle;
      }
      expect(currentBundle).toBe(permBundle);
      expect(hasEffect(currentBundle as PolicyBundle, 'filesystem.read', 'permit')).toBe(true);
    },
  );
});

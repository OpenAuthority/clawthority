/**
 * e2e/harness.test.ts — OpenClawHarness smoke test
 *
 * Verifies that the harness can:
 *   HC-01  spawn the runner process and receive a "ready" signal within 5 s
 *   HC-02  invoke filesystem.read and receive a permit decision
 *   HC-03  tail the audit log and parse an ExecutionEvent
 *   HC-04  cleanly shut down the child process via SIGTERM
 *   HC-05  leave no orphaned processes after shutdown (verified via ps)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec as execCb } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { OpenClawHarness } from './harness.js';

const exec = promisify(execCb);

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('OpenClawHarness smoke test', () => {
  let harness: OpenClawHarness;
  let auditLogPath: string;

  beforeEach(() => {
    auditLogPath = join(tmpdir(), `oa-smoke-${Date.now()}.jsonl`);
    harness = new OpenClawHarness({ auditLogPath, timeout: 5_000 });
  });

  afterEach(async () => {
    await harness.shutdown().catch(() => {/* best-effort */});
    await rm(auditLogPath, { force: true });
  });

  // ── HC-01 ─────────────────────────────────────────────────────────────────

  it(
    'HC-01: harness spawns runner and plugin loads within 5 s',
    async () => {
      await harness.spawn();
      expect(harness.pid).toBeTypeOf('number');
      expect(harness.pid!).toBeGreaterThan(0);
    },
    5_000,
  );

  // ── HC-02 ─────────────────────────────────────────────────────────────────

  it(
    'HC-02: invokeToolCall filesystem.read returns a permit decision',
    async () => {
      await harness.spawn();
      const result = await harness.invokeToolCall('read_file', { path: '/tmp/smoke-test.txt' });
      expect(result.effect).toBe('permit');
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    },
    5_000,
  );

  // ── HC-03 ─────────────────────────────────────────────────────────────────

  it(
    'HC-03: tailAuditLog returns a parseable ExecutionEvent after a tool call',
    async () => {
      await harness.spawn();
      await harness.invokeToolCall('read_file', { path: '/tmp/smoke-audit.txt' });

      const events = await harness.tailAuditLog();

      expect(events.length).toBeGreaterThanOrEqual(1);

      const last = events[events.length - 1]!;

      // decision shape
      expect(last).toHaveProperty('decision');
      expect(last.decision.effect).toBe('permit');
      expect(typeof last.decision.reason).toBe('string');

      // timestamp is a valid ISO 8601 string
      expect(last).toHaveProperty('timestamp');
      expect(typeof last.timestamp).toBe('string');
      expect(() => new Date(last.timestamp)).not.toThrow();
      expect(new Date(last.timestamp).toISOString()).toBe(last.timestamp);
    },
    5_000,
  );

  // ── HC-04 ─────────────────────────────────────────────────────────────────

  it(
    'HC-04: shutdown() cleanly terminates the child process',
    async () => {
      await harness.spawn();
      const pid = harness.pid!;
      expect(pid).toBeGreaterThan(0);

      await harness.shutdown();

      // pid getter must be undefined after shutdown
      expect(harness.pid).toBeUndefined();

      // Process should no longer appear in the process table
      const { stdout } = await exec(`ps -p ${pid} -o pid= 2>/dev/null || true`);
      expect(stdout.trim()).toBe('');
    },
    8_000,
  );

  // ── HC-05 ─────────────────────────────────────────────────────────────────

  it(
    'HC-05: no orphaned processes remain after shutdown (verified via ps)',
    async () => {
      await harness.spawn();
      const pid = harness.pid!;

      await harness.shutdown();

      // Allow the OS a brief moment to reap the process
      await new Promise<void>((r) => setTimeout(r, 200));

      const { stdout } = await exec(`ps -p ${pid} -o pid= 2>/dev/null || true`);
      expect(stdout.trim()).toBe('');
    },
    8_000,
  );
});

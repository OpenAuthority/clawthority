/**
 * Plugin lifecycle e2e tests — Open Authority v0.1
 *
 * Exercises the OpenClaw plugin's lifecycle properties: resource hygiene,
 * audit integrity, and crash-recovery behaviour.
 *
 * ─── JSON-RPC frame protocol ─────────────────────────────────────────────────
 * stdin  ← { "type": "tool_call", "id", "tool", "params" }
 * stdout → { "type": "ready" }  (once, on startup)
 * stdout → { "type": "decision", "id", "effect", "reason" }  (per call)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  TC-LC-01  Plugin processes 100 tool calls without FD leaks (lsof check)
 *  TC-LC-02  Every call produces exactly one ExecutionEvent in audit.jsonl
 *  TC-LC-03  SIGKILL during an in-flight call does not corrupt audit.jsonl
 *  TC-LC-04  Post-crash audit lines contain required fields (not truncated)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec as execCb } from 'node:child_process';
import { rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { OpenClawHarness } from '../e2e/harness.js';

const exec = promisify(execCb);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the total number of open file table entries for the given PID
 * using lsof (header row excluded).  Returns 0 when lsof is unavailable
 * or the process cannot be found.
 */
async function countOpenFds(pid: number): Promise<number> {
  try {
    const { stdout } = await exec(`lsof -p ${pid} 2>/dev/null | wc -l`);
    const total = parseInt(stdout.trim(), 10);
    return Math.max(0, total - 1); // subtract the lsof header row
  } catch {
    return 0;
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('plugin lifecycle', () => {
  let harness: OpenClawHarness;
  let auditLogPath: string;

  beforeEach(() => {
    // Each test gets an isolated audit log so residual entries cannot leak
    // between tests.
    auditLogPath = join(tmpdir(), `oa-lc-${Date.now()}.jsonl`);
    harness = new OpenClawHarness({ auditLogPath, timeout: 10_000 });
  });

  afterEach(async () => {
    // Race shutdown against a 3 s deadline: when a test has already SIGKILL'd
    // the process externally, the harness's shutdown() registers an 'exit'
    // listener that never fires (the event already occurred), causing it to
    // hang until the 2 s force-kill timeout — which can exceed the hook limit.
    // The race lets us proceed without waiting for a process we already killed.
    await Promise.race([
      harness.shutdown().catch(() => { /* best-effort */ }),
      new Promise<void>((r) => setTimeout(r, 3_000)),
    ]);
    await rm(auditLogPath, { force: true });
  }, 5_000);

  // ── TC-LC-01 ─────────────────────────────────────────────────────────────────

  it(
    'TC-LC-01: plugin processes 100 tool calls without FD leaks (lsof)',
    async () => {
      await harness.spawn();
      const pid = harness.pid!;
      expect(pid).toBeGreaterThan(0);

      // Baseline FD count immediately after the process is ready.
      const fdBefore = await countOpenFds(pid);

      for (let i = 0; i < 100; i++) {
        await harness.invokeToolCall('read_file', { path: `/tmp/lc-file-${i}.txt` });
      }

      // Post-run FD count — must not have grown by more than 5 to account
      // for benign OS / Node.js bookkeeping overhead.
      const fdAfter = await countOpenFds(pid);
      expect(fdAfter - fdBefore).toBeLessThanOrEqual(5);
    },
    60_000,
  );

  // ── TC-LC-02 ─────────────────────────────────────────────────────────────────

  it(
    'TC-LC-02: every tool call produces exactly one ExecutionEvent in audit.jsonl',
    async () => {
      await harness.spawn();

      const CALL_COUNT = 20;
      for (let i = 0; i < CALL_COUNT; i++) {
        await harness.invokeToolCall('read_file', { path: `/tmp/lc-audit-${i}.txt` });
      }

      const events = await harness.tailAudit();

      // One entry per call — no duplicates, no dropped entries.
      expect(events).toHaveLength(CALL_COUNT);

      // Structural sanity check on every emitted event.
      for (const event of events) {
        expect(event).toHaveProperty('decision');
        expect(event).toHaveProperty('timestamp');
        expect(typeof event.decision.effect).toBe('string');
        expect(typeof event.decision.reason).toBe('string');
        expect(typeof event.timestamp).toBe('string');
        expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
      }
    },
    30_000,
  );

  // ── TC-LC-03 ─────────────────────────────────────────────────────────────────

  it(
    'TC-LC-03: SIGKILL during an in-flight call does not corrupt audit.jsonl',
    async () => {
      await harness.spawn();
      const pid = harness.pid!;

      // Establish at least two committed entries before the crash so the log
      // is guaranteed non-empty regardless of in-flight write timing.
      await harness.invokeToolCall('read_file', { path: '/tmp/lc-pre-1.txt' });
      await harness.invokeToolCall('read_file', { path: '/tmp/lc-pre-2.txt' });

      // Send a third call then immediately SIGKILL — the process may die
      // before, during, or after the audit write for this final call.
      const inflight = harness.invokeToolCall('read_file', { path: '/tmp/lc-crash.txt' });
      process.kill(pid, 'SIGKILL');

      // Allow the in-flight call to reject (write error or pipe close).
      // Use a race so we never block longer than 2 s regardless of timing.
      await Promise.race([
        inflight.catch(() => { /* expected rejection after SIGKILL */ }),
        new Promise<void>((r) => setTimeout(r, 2_000)),
      ]);

      // Read the raw JSONL file — every non-empty line must parse as valid JSON.
      // A truncated entry (partial write at the moment of kill) would throw here.
      const raw = await readFile(auditLogPath, 'utf-8').catch(() => '');
      const lines = raw.split('\n').filter(Boolean);

      for (const line of lines) {
        expect(
          () => JSON.parse(line),
          `audit line must be valid JSON, got: "${line}"`,
        ).not.toThrow();
      }
    },
    15_000,
  );

  // ── TC-LC-04 ─────────────────────────────────────────────────────────────────

  it(
    'TC-LC-04: post-crash audit lines contain required fields and valid timestamps',
    async () => {
      await harness.spawn();
      const pid = harness.pid!;

      // Ensure at least one committed entry exists before the crash.
      await harness.invokeToolCall('read_file', { path: '/tmp/lc-tc04-pre.txt' });

      // SIGKILL during a second in-flight call.
      const inflight = harness.invokeToolCall('read_file', { path: '/tmp/lc-tc04-crash.txt' });
      process.kill(pid, 'SIGKILL');

      await Promise.race([
        inflight.catch(() => { /* expected */ }),
        new Promise<void>((r) => setTimeout(r, 2_000)),
      ]);

      // The audit log must either be absent (no entries written) or contain
      // only structurally complete entries — no half-written lines.
      const raw = await readFile(auditLogPath, 'utf-8').catch(() => '');
      const lines = raw.split('\n').filter(Boolean);

      for (const line of lines) {
        let parsed: unknown;

        // Step 1: must be valid JSON (not truncated mid-write).
        expect(
          () => { parsed = JSON.parse(line); },
          `not truncated: "${line}"`,
        ).not.toThrow();

        // Step 2: required top-level fields must be present.
        expect(parsed).toMatchObject({
          decision: {
            effect: expect.stringMatching(/^(permit|forbid)$/),
            reason: expect.any(String),
          },
          timestamp: expect.any(String),
        });

        // Step 3: timestamp must be a valid ISO 8601 string.
        const ts = (parsed as { timestamp: string }).timestamp;
        expect(new Date(ts).toISOString(), `invalid ISO 8601 timestamp: "${ts}"`).toBe(ts);
      }
    },
    15_000,
  );
});

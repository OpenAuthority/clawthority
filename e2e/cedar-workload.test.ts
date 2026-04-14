/**
 * e2e/cedar-workload.test.ts — Cedar engine representative workload test
 *
 * Validates that the Cedar WASM engine produces correct authorization decisions
 * for a representative set of tool calls drawn from the active policy bundle.
 *
 * Test IDs
 * ─────────
 *   CW-01  Cedar runner boots with --engine cedar; activation banner engine === 'cedar'
 *   CW-02  filesystem.read (read_file) → permit
 *   CW-03  browser.navigate (navigate) → permit
 *   CW-04  payment.transfer (transfer_funds) → forbid
 *   CW-05  credential.access (get_secret) → forbid
 *   CW-06  system.execute (execute_command) → forbid
 *   CW-07  account.permission.change (change_permissions) → forbid
 *   CW-08  unknown tool (unknown_tool_xyz) → forbid (unknown_sensitive_action)
 *   CW-09  At least one full session logged in the audit log
 *   CW-10  No runtime errors: all decisions carry engine === 'cedar' metadata
 *
 * Decision comparison table
 * ─────────────────────────
 * | Tool                | Action class               | Expected |
 * |---------------------|----------------------------|----------|
 * | read_file           | filesystem.read            | permit   |
 * | navigate            | browser.navigate           | permit   |
 * | transfer_funds      | payment.transfer           | forbid   |
 * | get_secret          | credential.access          | forbid   |
 * | execute_command     | system.execute             | forbid   |
 * | change_permissions  | account.permission.change  | forbid   |
 * | unknown_tool_xyz    | unknown_sensitive_action   | forbid   |
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenClawHarness } from './harness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CEDAR_RUNNER = resolve(__dirname, 'cedar-runner.mjs');

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Cedar engine — representative workload', () => {
  let harness: OpenClawHarness;
  let auditLogPath: string;

  // Generous timeout: Cedar WASM loading can take 3–8 s on first import.
  const BOOT_TIMEOUT_MS = 30_000;
  const CALL_TIMEOUT_MS = 10_000;

  beforeAll(async () => {
    auditLogPath = join(tmpdir(), `oa-cedar-workload-${Date.now()}.jsonl`);
    harness = new OpenClawHarness({
      runnerPath: CEDAR_RUNNER,
      runnerArgs: ['--engine', 'cedar'],
      auditLogPath,
      timeout: BOOT_TIMEOUT_MS,
    });
    await harness.spawn();
  }, BOOT_TIMEOUT_MS + 5_000);

  afterAll(async () => {
    await harness.shutdown().catch(() => { /* best-effort */ });
    await rm(auditLogPath, { force: true });
  });

  // ── CW-01 — Activation banner ─────────────────────────────────────────────

  it(
    'CW-01: runner starts and activation banner reports engine: cedar',
    () => {
      expect(harness.pid).toBeTypeOf('number');
      expect(harness.pid!).toBeGreaterThan(0);

      const info = harness.startupInfo;
      expect(info).toBeDefined();
      expect(info!['engine']).toBe('cedar');
      expect(typeof info!['policiesLoaded']).toBe('number');
      expect((info!['policiesLoaded'] as number)).toBeGreaterThan(0);
    },
  );

  // ── CW-02 — filesystem.read → permit ─────────────────────────────────────

  it(
    'CW-02: read_file (filesystem.read) → permit',
    async () => {
      const result = await harness.invokeToolCall('read_file', { path: '/tmp/test.txt' });
      expect(result.effect).toBe('permit');
    },
    CALL_TIMEOUT_MS,
  );

  // ── CW-03 — browser.navigate → permit ────────────────────────────────────

  it(
    'CW-03: navigate (browser.navigate) → permit',
    async () => {
      const result = await harness.invokeToolCall('navigate', { url: 'https://example.com' });
      expect(result.effect).toBe('permit');
    },
    CALL_TIMEOUT_MS,
  );

  // ── CW-04 — payment.transfer → forbid ────────────────────────────────────

  it(
    'CW-04: transfer_funds (payment.transfer) → forbid',
    async () => {
      const result = await harness.invokeToolCall('transfer_funds', { amount: 100 });
      expect(result.effect).toBe('forbid');
    },
    CALL_TIMEOUT_MS,
  );

  // ── CW-05 — credential.access → forbid ───────────────────────────────────

  it(
    'CW-05: get_secret (credential.access) → forbid',
    async () => {
      const result = await harness.invokeToolCall('get_secret', { name: 'API_KEY' });
      expect(result.effect).toBe('forbid');
    },
    CALL_TIMEOUT_MS,
  );

  // ── CW-06 — system.execute → forbid ──────────────────────────────────────

  it(
    'CW-06: execute_command (system.execute) → forbid',
    async () => {
      const result = await harness.invokeToolCall('execute_command', { cmd: 'ls' });
      expect(result.effect).toBe('forbid');
    },
    CALL_TIMEOUT_MS,
  );

  // ── CW-07 — account.permission.change → forbid ───────────────────────────

  it(
    'CW-07: change_permissions (account.permission.change) → forbid',
    async () => {
      const result = await harness.invokeToolCall('change_permissions', { role: 'admin' });
      expect(result.effect).toBe('forbid');
    },
    CALL_TIMEOUT_MS,
  );

  // ── CW-08 — unknown tool → forbid ────────────────────────────────────────

  it(
    'CW-08: unknown_tool_xyz (unknown_sensitive_action) → forbid',
    async () => {
      const result = await harness.invokeToolCall('unknown_tool_xyz', {});
      expect(result.effect).toBe('forbid');
    },
    CALL_TIMEOUT_MS,
  );

  // ── CW-09 — At least one session logged ──────────────────────────────────

  it(
    'CW-09: audit log contains at least one full session entry',
    async () => {
      const events = await harness.tailAudit();

      expect(events.length).toBeGreaterThanOrEqual(1);

      // Every logged entry has the expected shape.
      for (const ev of events) {
        expect(ev).toHaveProperty('decision');
        expect(['permit', 'forbid']).toContain(ev.decision.effect);
        expect(ev).toHaveProperty('timestamp');
        expect(new Date(ev.timestamp).toISOString()).toBe(ev.timestamp);
      }

      // Verify at least one permit and one forbid were logged (session coverage).
      const permits = events.filter(e => e.decision.effect === 'permit');
      const forbids = events.filter(e => e.decision.effect === 'forbid');
      expect(permits.length).toBeGreaterThanOrEqual(1);
      expect(forbids.length).toBeGreaterThanOrEqual(1);
    },
    CALL_TIMEOUT_MS,
  );

  // ── CW-10 — No runtime errors ─────────────────────────────────────────────

  it(
    'CW-10: all audit entries carry engine: cedar (no fallback or error paths)',
    async () => {
      const events = await harness.tailAudit();

      // Cedar runtime errors produce reason 'cedar_runtime_error'; none expected.
      const runtimeErrors = events.filter(
        e => e.decision.reason === 'cedar_runtime_error',
      );
      expect(runtimeErrors).toHaveLength(0);

      // Every entry should identify the cedar engine.
      for (const ev of events) {
        expect((ev.decision as Record<string, unknown>)['engine']).toBe('cedar');
      }
    },
    CALL_TIMEOUT_MS,
  );

  // ── Decision comparison table (inline summary) ────────────────────────────

  it(
    'CW-SUMMARY: decision comparison — Cedar matches expected policy outcomes',
    async () => {
      // Run the full workload in a single batch and compare.
      const workload: Array<{ tool: string; params?: Record<string, unknown>; expected: 'permit' | 'forbid'; actionClass: string }> = [
        { tool: 'read_file',          params: { path: '/tmp/x' },   expected: 'permit',  actionClass: 'filesystem.read' },
        { tool: 'navigate',           params: { url: 'https://x' }, expected: 'permit',  actionClass: 'browser.navigate' },
        { tool: 'transfer_funds',     params: { amount: 1 },        expected: 'forbid',  actionClass: 'payment.transfer' },
        { tool: 'initiate_payment',   params: { amount: 1 },        expected: 'forbid',  actionClass: 'payment.initiate' },
        { tool: 'get_secret',         params: { name: 'k' },        expected: 'forbid',  actionClass: 'credential.access' },
        { tool: 'set_secret',         params: { name: 'k' },        expected: 'forbid',  actionClass: 'credential.write' },
        { tool: 'execute_command',    params: { cmd: 'ls' },        expected: 'forbid',  actionClass: 'system.execute' },
        { tool: 'change_permissions', params: { role: 'admin' },    expected: 'forbid',  actionClass: 'account.permission.change' },
        { tool: 'unknown_tool_xyz',   params: {},                   expected: 'forbid',  actionClass: 'unknown_sensitive_action' },
      ];

      const divergences: string[] = [];

      for (const { tool, params, expected, actionClass } of workload) {
        const result = await harness.invokeToolCall(tool, params);
        if (result.effect !== expected) {
          divergences.push(
            `${tool} (${actionClass}): expected ${expected}, got ${result.effect} (reason: ${result.reason})`,
          );
        }
      }

      if (divergences.length > 0) {
        // Document divergences rather than silently failing — aids investigation.
        console.warn('\nCedar decision divergences:\n' + divergences.map(d => `  - ${d}`).join('\n'));
      }

      expect(divergences).toHaveLength(0);
    },
    CALL_TIMEOUT_MS * 15, // generous: 9 sequential tool calls
  );
});

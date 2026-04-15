/**
 * Install lifecycle e2e tests — Open Authority
 *
 * Validates install lifecycle behaviour: policy enforcement is deferred during
 * npm install lifecycle phases, activated when the marker file is present, and
 * OPENAUTH_FORCE_ACTIVE=1 overrides both gates.
 *
 * ─── Custom lifecycle-aware runner ────────────────────────────────────────────
 * Each test spawns a specialised runner written to a temp .mjs file that mirrors
 * the isInstalled() gate from src/index.ts.  Its behaviour is driven by:
 *
 *   IL_MARKER_PATH        Path substituted for data/.installed in the runner
 *   npm_lifecycle_event   Active npm lifecycle phase (install / preinstall / …)
 *   OPENAUTH_FORCE_ACTIVE "1" forces enforcement regardless of install state
 *
 * Deferred state (no marker, install lifecycle):  all tool calls → permit
 * Active state (marker present or FORCE_ACTIVE):  execute_command → forbid
 *                                                  read_file      → permit
 *
 * ─── Test matrix ──────────────────────────────────────────────────────────────
 *  TC-IL-01  npm install lifecycle defers enforcement — all tool calls permit
 *  TC-IL-02  shell.exec (execute_command) not blocked during install lifecycle
 *  TC-IL-03  Runtime enforcement active when marker file is present
 *  TC-IL-04  OPENAUTH_FORCE_ACTIVE=1 forces active enforcement during install lifecycle
 *  TC-IL-05  post-install.mjs writes marker file with valid ISO 8601 timestamp
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { exec as execCb } from 'node:child_process';
import { rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { OpenClawHarness } from '../e2e/harness.js';

const exec = promisify(execCb);
const __fileDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__fileDir, '..');

// ─── Lifecycle-aware runner source ────────────────────────────────────────────
// Mirrors the isInstalled() logic from src/index.ts so the subprocess under
// test behaves identically to the real plugin during each lifecycle phase.

const LIFECYCLE_RUNNER_SOURCE = `import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

const auditLogPath = process.env['AUDIT_LOG'] ?? '/tmp/oa-il.jsonl';
const markerPath = process.env['IL_MARKER_PATH'] ?? '';

function isInstalled() {
  if (process.env['OPENAUTH_FORCE_ACTIVE'] === '1') return true;
  const lifecycleEvent = process.env['npm_lifecycle_event'] ?? '';
  if (['install', 'preinstall', 'postinstall', 'prepare'].includes(lifecycleEvent)) return false;
  if (!markerPath) return false;
  return existsSync(markerPath);
}

function resolveDecision(tool) {
  if (!isInstalled()) {
    return { effect: 'permit', reason: 'install_deferred', stage: 'stage1' };
  }
  if (tool === 'execute_command' || tool === 'shell_exec') {
    return { effect: 'forbid', reason: 'policy_block', stage: 'stage2' };
  }
  return { effect: 'permit', reason: 'default_permit', stage: 'stage2' };
}

async function writeAuditEntry(decision) {
  const entry = JSON.stringify({ decision, timestamp: new Date().toISOString() }) + '\\n';
  try {
    await mkdir(dirname(auditLogPath), { recursive: true });
    await appendFile(auditLogPath, entry, 'utf-8');
  } catch (err) {
    process.stderr.write('[il-runner] audit write failed: ' + err.message + '\\n');
  }
}

process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n');

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); } catch { return; }
  if (req.type === 'tool_call') {
    const decision = resolveDecision(req.tool);
    await writeAuditEntry(decision);
    process.stdout.write(JSON.stringify({ type: 'decision', id: req.id, effect: decision.effect, reason: decision.reason }) + '\\n');
  }
});

rl.on('close', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a marker file at path with an ISO 8601 timestamp (simulates post-install). */
async function writeMarkerFile(filePath: string): Promise<void> {
  await writeFile(filePath, new Date().toISOString() + '\n', 'utf-8');
}

/** Returns true when the file at filePath exists and is accessible. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Snapshots the listed env vars, applies overrides for the duration of fn(),
 * then restores original values.  Pass undefined to delete a key for the call.
 */
async function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('install lifecycle', () => {
  let runnerPath!: string;
  let harness!: OpenClawHarness;
  let auditLogPath!: string;
  let markerPath!: string;

  // Write the lifecycle-aware runner once for the whole suite.
  beforeAll(async () => {
    runnerPath = join(tmpdir(), `oa-il-runner-${Date.now()}.mjs`);
    await writeFile(runnerPath, LIFECYCLE_RUNNER_SOURCE, 'utf-8');
  });

  afterAll(async () => {
    await rm(runnerPath, { force: true });
  });

  beforeEach(() => {
    const ts = Date.now();
    auditLogPath = join(tmpdir(), `oa-il-audit-${ts}.jsonl`);
    markerPath = join(tmpdir(), `oa-il-marker-${ts}`);
    harness = new OpenClawHarness({ auditLogPath, runnerPath, timeout: 10_000 });
  });

  afterEach(async () => {
    await Promise.race([
      harness.shutdown().catch(() => { /* best-effort */ }),
      new Promise<void>((r) => setTimeout(r, 3_000)),
    ]);
    await rm(auditLogPath, { force: true });
    await rm(markerPath, { force: true });
  }, 5_000);

  // ── TC-IL-01 ─────────────────────────────────────────────────────────────────

  it(
    'TC-IL-01: npm install lifecycle defers enforcement — all tool calls permit',
    async () => {
      // npm_lifecycle_event=install → isInstalled() returns false → enforcement deferred.
      // The marker path is set but the file does not exist, so without the lifecycle
      // gate the runner would enforce; confirming the gate fires proves the logic.
      await withEnv(
        {
          npm_lifecycle_event: 'install',
          OPENAUTH_FORCE_ACTIVE: undefined,
          IL_MARKER_PATH: markerPath,
        },
        async () => {
          await harness.spawn();

          const execResult = await harness.invokeToolCall('execute_command', { cmd: 'npm install' });
          const readResult = await harness.invokeToolCall('read_file', { path: '/tmp/test.txt' });

          expect(execResult.effect).toBe('permit');
          expect(execResult.reason).toBe('install_deferred');
          expect(readResult.effect).toBe('permit');
          expect(readResult.reason).toBe('install_deferred');
        },
      );
    },
    15_000,
  );

  // ── TC-IL-02 ─────────────────────────────────────────────────────────────────

  it(
    'TC-IL-02: shell.exec (execute_command) calls not blocked during install lifecycle',
    async () => {
      // postinstall is the phase most likely to run build tools; validate that
      // shell execution is unconditionally permitted during install phases.
      await withEnv(
        {
          npm_lifecycle_event: 'postinstall',
          OPENAUTH_FORCE_ACTIVE: undefined,
          IL_MARKER_PATH: markerPath,
        },
        async () => {
          await harness.spawn();

          const result = await harness.invokeToolCall('execute_command', { cmd: 'npm run build' });
          expect(result.effect).toBe('permit');
          expect(result.reason).toBe('install_deferred');
        },
      );
    },
    15_000,
  );

  // ── TC-IL-03 ─────────────────────────────────────────────────────────────────

  it(
    'TC-IL-03: runtime enforcement is active when marker file is present',
    async () => {
      // Simulate a completed install: write the marker file before spawning.
      await writeMarkerFile(markerPath);
      expect(await fileExists(markerPath)).toBe(true);

      await withEnv(
        {
          npm_lifecycle_event: undefined, // no active install phase
          OPENAUTH_FORCE_ACTIVE: undefined,
          IL_MARKER_PATH: markerPath,
        },
        async () => {
          await harness.spawn();

          // execute_command must be blocked now that install has completed.
          const execResult = await harness.invokeToolCall('execute_command', { cmd: 'rm -rf /' });
          expect(execResult.effect).toBe('forbid');
          expect(execResult.reason).toBe('policy_block');

          // Innocuous reads remain permitted.
          const readResult = await harness.invokeToolCall('read_file', { path: '/tmp/safe.txt' });
          expect(readResult.effect).toBe('permit');
          expect(readResult.reason).toBe('default_permit');
        },
      );
    },
    15_000,
  );

  // ── TC-IL-04 ─────────────────────────────────────────────────────────────────

  it(
    'TC-IL-04: OPENAUTH_FORCE_ACTIVE=1 forces active enforcement during install lifecycle',
    async () => {
      // npm_lifecycle_event=install would normally defer enforcement; OPENAUTH_FORCE_ACTIVE=1
      // must override it and activate enforcement even without a marker file.
      await withEnv(
        {
          npm_lifecycle_event: 'install',
          OPENAUTH_FORCE_ACTIVE: '1',
          IL_MARKER_PATH: markerPath, // marker absent — FORCE_ACTIVE bypasses marker check
        },
        async () => {
          await harness.spawn();

          // Enforcement active: execute_command is blocked despite install lifecycle.
          const execResult = await harness.invokeToolCall('execute_command', { cmd: 'ls' });
          expect(execResult.effect).toBe('forbid');
          expect(execResult.reason).toBe('policy_block');

          // Safe reads remain permitted.
          const readResult = await harness.invokeToolCall('read_file', { path: '/tmp/test.txt' });
          expect(readResult.effect).toBe('permit');
          expect(readResult.reason).toBe('default_permit');
        },
      );
    },
    15_000,
  );

  // ── TC-IL-05 ─────────────────────────────────────────────────────────────────

  it(
    'TC-IL-05: post-install.mjs writes marker file with valid ISO 8601 timestamp',
    async () => {
      const realMarkerPath = join(repoRoot, 'data', '.installed');

      // Snapshot the existing marker so we can restore it after the test.
      const markerExisted = await fileExists(realMarkerPath);
      const originalContent = markerExisted
        ? await readFile(realMarkerPath, 'utf-8')
        : null;

      try {
        const { stdout } = await exec('node scripts/post-install.mjs', { cwd: repoRoot });
        expect(stdout).toContain('install complete');

        expect(await fileExists(realMarkerPath)).toBe(true);

        const content = await readFile(realMarkerPath, 'utf-8');
        const timestamp = content.trim();

        // Content must be a single valid ISO 8601 timestamp.
        expect(timestamp).toBeTruthy();
        expect(new Date(timestamp).toISOString()).toBe(timestamp);
      } finally {
        // Restore the pre-test marker state regardless of test outcome.
        if (originalContent !== null) {
          await writeFile(realMarkerPath, originalContent, 'utf-8');
        } else {
          await rm(realMarkerPath, { force: true });
        }
      }
    },
    15_000,
  );
});

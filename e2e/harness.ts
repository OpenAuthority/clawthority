/**
 * e2e/harness.ts — OpenClawHarness
 *
 * Manages the lifecycle of a spawned OpenClaw host process for E2E testing.
 *
 * ─── JSON-RPC frame format ────────────────────────────────────────────────────
 *
 * All messages are newline-delimited JSON written over stdio.
 *
 * Outbound frames (harness → process, written to stdin):
 *
 *   Tool-call request
 *   { "type": "tool_call", "id": "<string>", "tool": "<tool-name>", "params": { … } }
 *
 * Inbound frames (process → harness, read from stdout):
 *
 *   Ready signal — emitted once at startup when the plugin is initialised
 *   { "type": "ready" }
 *
 *   Decision response — one per tool-call request, matched by "id"
 *   { "type": "decision", "id": "<string>", "effect": "permit" | "forbid", "reason": "<string>" }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Usage (simple):
 *   const harness = new OpenClawHarness({ auditLogPath: '/tmp/audit.jsonl' });
 *   await harness.spawn();
 *   const result = await harness.invokeToolCall('read_file', { path: '/tmp/x' });
 *   const events = await harness.tailAudit();
 *   await harness.shutdown();
 *
 * Usage (full config):
 *   const harness = new OpenClawHarness({
 *     pluginDir: '/path/to/plugin',
 *     workDir: '/tmp/test-work',
 *     bundleFixture: '/path/to/bundle.json',
 *     configOverrides: { logLevel: 'debug' },
 *     auditLogPath: '/tmp/audit.jsonl',
 *   });
 *   await harness.spawn();           // copies plugin, seeds bundle.json
 *   await harness.invokeToolCall(…);
 *   await harness.approveNext(token); // approves HITL request
 *   await harness.swapBundle('/path/to/new-bundle.json');
 *   const events = await harness.tailAudit(0);
 *   await harness.shutdown();
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, copyFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Configuration for the E2E test harness.
 *
 * Extends {@link HarnessOptions} with fields required to deploy the plugin
 * into a working directory and invoke the real OpenClaw binary.
 */
export interface HarnessConfig {
  /**
   * Path to the OpenClaw binary.
   * When absent the harness falls back to spawning `runner.mjs` via `node`.
   */
  openclawBin?: string;
  /**
   * Directory whose contents are copied into {@link workDir} during
   * {@link Harness.spawn}. Optional — no copy is performed when absent.
   */
  pluginDir?: string;
  /**
   * Writable working directory used as the plugin root during the test.
   * Created automatically if it does not exist.
   * Required when {@link pluginDir} or {@link bundleFixture} are specified.
   */
  workDir?: string;
  /**
   * Path to a `bundle.json` fixture that is copied into {@link workDir}
   * as `bundle.json` during {@link Harness.spawn}.
   */
  bundleFixture?: string;
  /**
   * Key/value pairs merged into the plugin configuration before spawn.
   * Written as JSON alongside the plugin files in {@link workDir}.
   */
  configOverrides?: Record<string, unknown>;
  /** Path to the JSONL audit log file written by the runner process. */
  auditLogPath?: string;
  /**
   * Milliseconds to wait for the runner to signal "ready".
   * Defaults to 5 000 ms.
   */
  timeout?: number;
  /**
   * Absolute path to the fallback runner script.
   * Defaults to `runner.mjs` in the same directory as this module.
   */
  runnerPath?: string;
  /**
   * Base URL of the HITL approval server (e.g. `http://localhost:3000`).
   * Required for {@link Harness.approveNext}.
   */
  hitlServerUrl?: string;
  /**
   * Extra command-line arguments appended after the runner script path when
   * spawning via `node`.  Ignored when {@link openclawBin} is set.
   *
   * @example `['--engine', 'cedar']`
   */
  runnerArgs?: string[];
}

/**
 * Legacy option bag accepted by {@link OpenClawHarness}.
 * @deprecated Prefer {@link HarnessConfig}.
 */
export interface HarnessOptions {
  auditLogPath?: string;
  timeout?: number;
  runnerPath?: string;
}

/** Authorization decision returned by the runner for a tool call. */
export interface ToolCallResult {
  effect: 'permit' | 'forbid';
  reason: string;
}

/** Audit entry written by the runner for each tool call decision. */
export interface ExecutionEvent {
  decision: { effect: string; reason: string; stage?: string };
  timestamp: string;
}

/**
 * Public contract for the E2E test harness.
 *
 * Implementations manage the full lifecycle of an OpenClaw host process:
 * spawning, invoking tool calls, managing HITL approval, hot-swapping
 * bundle fixtures, tailing the audit log, and clean shutdown.
 */
export interface Harness {
  /**
   * Spawns the OpenClaw (or runner) process.
   *
   * When {@link HarnessConfig.pluginDir} is set the plugin sources are
   * copied into {@link HarnessConfig.workDir} before the process starts.
   * When {@link HarnessConfig.bundleFixture} is set it is seeded into
   * `workDir/bundle.json`.
   *
   * Resolves once the process emits `{ "type": "ready" }` on stdout.
   */
  spawn(): Promise<void>;

  /**
   * Sends a tool-call request to the process over stdin and waits for the
   * matching decision frame on stdout.
   *
   * Frame sent (stdin):
   * `{ "type": "tool_call", "id": "<auto>", "tool": "<tool>", "params": {…} }`
   */
  invokeToolCall(tool: string, params?: Record<string, unknown>): Promise<ToolCallResult>;

  /**
   * Approves the next pending HITL request by POSTing to the approval
   * server configured via {@link HarnessConfig.hitlServerUrl}.
   *
   * @param token  The approval token from the HITL request.
   */
  approveNext(token: string): Promise<void>;

  /**
   * Copies `newBundlePath` over `workDir/bundle.json`, triggering the
   * plugin's hot-reload watcher.
   *
   * @param newBundlePath  Absolute path to the replacement bundle fixture.
   */
  swapBundle(newBundlePath: string): Promise<void>;

  /**
   * Reads the audit log and returns {@link ExecutionEvent} objects.
   *
   * @param since  Number of events already consumed; only events after
   *               this offset are returned.  Defaults to 0 (all events).
   */
  tailAudit(since?: number): Promise<ExecutionEvent[]>;

  /**
   * Sends SIGTERM to the child process and waits for it to exit.
   * Falls back to SIGKILL after 2 s.  Safe to call multiple times.
   */
  shutdown(): Promise<void>;
}

// ─── OpenClawHarness ─────────────────────────────────────────────────────────

let _reqCounter = 0;

export class OpenClawHarness implements Harness {
  private proc: ChildProcess | null = null;
  private pendingRequests = new Map<string, (result: ToolCallResult) => void>();

  readonly auditLogPath: string;
  private readonly timeoutMs: number;
  private readonly runnerPath: string;
  private readonly config: HarnessConfig;

  /**
   * The full payload of the `{ type: 'ready' }` frame emitted by the runner
   * on startup.  Includes any activation metadata the runner chooses to
   * include (e.g. `engine`, `engineVersion`, `policiesLoaded`).
   *
   * `undefined` until {@link spawn} resolves.
   */
  startupInfo: Record<string, unknown> | undefined = undefined;

  constructor(opts: HarnessOptions | HarnessConfig = {}) {
    this.config = opts as HarnessConfig;
    this.auditLogPath = opts.auditLogPath ?? '/tmp/oa-smoke.jsonl';
    this.timeoutMs = opts.timeout ?? 5_000;
    this.runnerPath = opts.runnerPath ?? resolve(__dirname, 'runner.mjs');
  }

  /** PID of the spawned runner process, or undefined if not started. */
  get pid(): number | undefined {
    return this.proc?.pid;
  }

  /**
   * Spawns the runner process and waits for it to signal "ready".
   *
   * When {@link HarnessConfig.pluginDir} and {@link HarnessConfig.workDir}
   * are provided, the plugin directory contents are copied into workDir
   * before the process starts.  When {@link HarnessConfig.bundleFixture}
   * is provided it is seeded as `workDir/bundle.json`.
   * When {@link HarnessConfig.configOverrides} are provided they are written
   * as `workDir/config.overrides.json`.
   *
   * @throws {Error} If the runner does not become ready within the configured
   *                 timeout, or if the process fails to start.
   */
  async spawn(): Promise<void> {
    // ── 1. Prepare workDir ───────────────────────────────────────────────────
    const { pluginDir, workDir, bundleFixture, configOverrides, openclawBin } = this.config;

    if (workDir) {
      await mkdir(workDir, { recursive: true });

      if (pluginDir) {
        // Copy all plugin source files into workDir.
        await cp(pluginDir, workDir, { recursive: true });
      }

      if (bundleFixture) {
        // Seed bundle.json fixture into workDir.
        await copyFile(bundleFixture, join(workDir, 'bundle.json'));
      }

      if (configOverrides && Object.keys(configOverrides).length > 0) {
        await writeFile(
          join(workDir, 'config.overrides.json'),
          JSON.stringify(configOverrides, null, 2),
          'utf-8',
        );
      }
    }

    // ── 2. Determine command ─────────────────────────────────────────────────
    // If openclawBin is provided, invoke it directly.
    // Otherwise fall back to spawning runner.mjs via node (test mode).
    const { runnerArgs = [] } = this.config;
    const [cmd, args] =
      openclawBin != null
        ? [openclawBin, workDir ? ['--plugin-dir', workDir] : []]
        : ['node', [this.runnerPath, ...runnerArgs]];

    // ── 3. Spawn process ─────────────────────────────────────────────────────
    this.proc = spawn(cmd, args, {
      cwd: workDir,
      env: { ...process.env, AUDIT_LOG: this.auditLogPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const proc = this.proc;

    // Attach readline to stdout for response parsing.
    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg['type'] === 'decision' && typeof msg['id'] === 'string') {
        const resolver = this.pendingRequests.get(msg['id']);
        if (resolver) {
          this.pendingRequests.delete(msg['id']);
          resolver({
            effect: msg['effect'] as 'permit' | 'forbid',
            reason: msg['reason'] as string,
          });
        }
      }
    });

    // Wait for ready or timeout.
    await new Promise<void>((res, rej) => {
      const timer = setTimeout(
        () => rej(new Error(`Runner did not become ready within ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );

      const onReady = (line: string) => {
        const trimmed = line.trim();
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return;
        }
        if (msg['type'] === 'ready') {
          clearTimeout(timer);
          rl.off('line', onReady);
          this.startupInfo = msg;
          res();
        }
      };

      rl.on('line', onReady);

      proc.on('error', (err) => {
        clearTimeout(timer);
        rej(err);
      });

      proc.on('exit', (code) => {
        clearTimeout(timer);
        rej(new Error(`Runner exited prematurely with code ${String(code)}`));
      });
    });
  }

  /**
   * Sends a tool call request to the runner and waits for the decision.
   *
   * Frame sent to stdin:
   * `{ "type": "tool_call", "id": "<auto-increment>", "tool": "<tool>", "params": {…} }`
   *
   * @param tool   Tool name (e.g. `'read_file'`).
   * @param params Tool call parameters forwarded to the runner.
   */
  async invokeToolCall(
    tool: string,
    params: Record<string, unknown> = {},
  ): Promise<ToolCallResult> {
    if (!this.proc) throw new Error('Harness not started — call spawn() first');

    const id = String(++_reqCounter);

    // JSON-RPC-style tool call frame written to the process stdin.
    const line = JSON.stringify({ type: 'tool_call', id, tool, params }) + '\n';

    return new Promise<ToolCallResult>((res, rej) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          rej(new Error(`Tool call ${id} (${tool}) timed out`));
        }
      }, this.timeoutMs);

      // Register resolver before writing to avoid a race.
      this.pendingRequests.set(id, (result) => {
        clearTimeout(timer);
        res(result);
      });

      this.proc!.stdin!.write(line, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          rej(err);
        }
      });
    });
  }

  /**
   * Approves the next pending HITL request.
   *
   * POSTs to `{hitlServerUrl}/approve/{token}` using the HITL server URL
   * configured in {@link HarnessConfig.hitlServerUrl}.
   *
   * @param token  Approval token included in the HITL request.
   * @throws {Error} If `hitlServerUrl` is not configured.
   */
  async approveNext(token: string): Promise<void> {
    const { hitlServerUrl } = this.config;
    if (!hitlServerUrl) {
      throw new Error('approveNext requires hitlServerUrl in HarnessConfig');
    }
    await this._httpPost(new URL(`/approve/${encodeURIComponent(token)}`, hitlServerUrl));
  }

  /**
   * Replaces `workDir/bundle.json` with the file at `newBundlePath`.
   *
   * This triggers the plugin's hot-reload watcher so tests can verify
   * bundle update behaviour without restarting the process.
   *
   * @param newBundlePath  Absolute path to the replacement bundle fixture.
   * @throws {Error} If `workDir` is not configured.
   */
  async swapBundle(newBundlePath: string): Promise<void> {
    const { workDir } = this.config;
    if (!workDir) {
      throw new Error('swapBundle requires workDir in HarnessConfig');
    }
    await copyFile(newBundlePath, join(workDir, 'bundle.json'));
  }

  /**
   * Reads the audit log file and returns all parsed {@link ExecutionEvent}s,
   * optionally skipping events already consumed by the caller.
   *
   * @param since  Number of events already seen; events at indices `>= since`
   *               are returned.  Pass `0` (default) to receive all events.
   */
  async tailAudit(since = 0): Promise<ExecutionEvent[]> {
    const raw = await readFile(this.auditLogPath, 'utf-8');
    const all = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ExecutionEvent);
    return since > 0 ? all.slice(since) : all;
  }

  /**
   * Reads the audit log file and returns all parsed execution events.
   *
   * Each line in the JSONL file is one {@link ExecutionEvent}.
   *
   * @deprecated Use {@link tailAudit} instead.
   */
  async tailAuditLog(): Promise<ExecutionEvent[]> {
    return this.tailAudit(0);
  }

  /**
   * Sends SIGTERM to the child process and waits for it to exit.
   *
   * Falls back to SIGKILL after 2 s if the process does not exit cleanly.
   * Safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    if (!this.proc) return;

    const proc = this.proc;
    this.proc = null;
    this.pendingRequests.clear();

    await new Promise<void>((res) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          res();
        }
      };

      proc.once('exit', finish);

      // Process may have already exited.
      if (proc.exitCode !== null) {
        finish();
        return;
      }

      try {
        proc.kill('SIGTERM');
      } catch {
        finish();
        return;
      }

      // Force-kill after 2 s.
      const forceTimer = setTimeout(() => {
        if (!done) {
          try {
            proc.kill('SIGKILL');
          } catch { /* already gone */ }
        }
      }, 2_000);

      proc.once('exit', () => clearTimeout(forceTimer));
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Issues a fire-and-forget POST to the given URL using node:http/https. */
  private _httpPost(url: URL): Promise<void> {
    return new Promise<void>((res, rej) => {
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: { 'content-length': '0' },
        },
        (resp) => {
          resp.resume(); // drain body
          if (resp.statusCode != null && resp.statusCode >= 400) {
            rej(new Error(`approveNext: server returned HTTP ${resp.statusCode}`));
          } else {
            res();
          }
        },
      );
      req.on('error', rej);
      req.end();
    });
  }
}

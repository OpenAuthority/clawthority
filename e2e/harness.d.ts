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
    decision: {
        effect: string;
        reason: string;
        stage?: string;
    };
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
export declare class OpenClawHarness implements Harness {
    private proc;
    private pendingRequests;
    readonly auditLogPath: string;
    private readonly timeoutMs;
    private readonly runnerPath;
    private readonly config;
    constructor(opts?: HarnessOptions | HarnessConfig);
    /** PID of the spawned runner process, or undefined if not started. */
    get pid(): number | undefined;
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
    spawn(): Promise<void>;
    /**
     * Sends a tool call request to the runner and waits for the decision.
     *
     * Frame sent to stdin:
     * `{ "type": "tool_call", "id": "<auto-increment>", "tool": "<tool>", "params": {…} }`
     *
     * @param tool   Tool name (e.g. `'read_file'`).
     * @param params Tool call parameters forwarded to the runner.
     */
    invokeToolCall(tool: string, params?: Record<string, unknown>): Promise<ToolCallResult>;
    /**
     * Approves the next pending HITL request.
     *
     * POSTs to `{hitlServerUrl}/approve/{token}` using the HITL server URL
     * configured in {@link HarnessConfig.hitlServerUrl}.
     *
     * @param token  Approval token included in the HITL request.
     * @throws {Error} If `hitlServerUrl` is not configured.
     */
    approveNext(token: string): Promise<void>;
    /**
     * Replaces `workDir/bundle.json` with the file at `newBundlePath`.
     *
     * This triggers the plugin's hot-reload watcher so tests can verify
     * bundle update behaviour without restarting the process.
     *
     * @param newBundlePath  Absolute path to the replacement bundle fixture.
     * @throws {Error} If `workDir` is not configured.
     */
    swapBundle(newBundlePath: string): Promise<void>;
    /**
     * Reads the audit log file and returns all parsed {@link ExecutionEvent}s,
     * optionally skipping events already consumed by the caller.
     *
     * @param since  Number of events already seen; events at indices `>= since`
     *               are returned.  Pass `0` (default) to receive all events.
     */
    tailAudit(since?: number): Promise<ExecutionEvent[]>;
    /**
     * Reads the audit log file and returns all parsed execution events.
     *
     * Each line in the JSONL file is one {@link ExecutionEvent}.
     *
     * @deprecated Use {@link tailAudit} instead.
     */
    tailAuditLog(): Promise<ExecutionEvent[]>;
    /**
     * Sends SIGTERM to the child process and waits for it to exit.
     *
     * Falls back to SIGKILL after 2 s if the process does not exit cleanly.
     * Safe to call multiple times.
     */
    shutdown(): Promise<void>;
    /** Issues a fire-and-forget POST to the given URL using node:http/https. */
    private _httpPost;
}
//# sourceMappingURL=harness.d.ts.map
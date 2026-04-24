/**
 * unsafe_admin_exec tool implementation.
 *
 * Executes arbitrary shell commands when explicitly permitted.
 * This tool is inert by default — execution requires:
 *   1. The CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC environment variable set to '1'.
 *   2. A justification string of at least JUSTIFICATION_MIN_LENGTH characters.
 *   3. A HITL capability token (approval_id) for every invocation.
 *   4. The capability token must not have been previously consumed (no replay).
 *
 * All invocations are audit-logged regardless of outcome. Commands are
 * sanitized before logging to prevent credential leakage in audit trails.
 * The justification is recorded verbatim in every audit log entry.
 *
 * Action class: shell.exec
 */

import { spawn } from 'node:child_process';
import { sanitizeCommandPrefix } from '../../enforcement/normalize.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum number of characters required in the justification field. */
export const JUSTIFICATION_MIN_LENGTH = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the unsafe_admin_exec tool. */
export interface UnsafeAdminExecParams {
  /** Shell command to execute. */
  command: string;
  /**
   * Human-readable reason for this invocation.
   * Must be at least JUSTIFICATION_MIN_LENGTH characters.
   * Recorded verbatim in the audit trail.
   */
  justification: string;
  /** Working directory for command execution. Defaults to process.cwd(). */
  working_dir?: string;
}

/** Successful result from the unsafe_admin_exec tool. */
export interface UnsafeAdminExecResult {
  /** Standard output captured from the command. */
  stdout: string;
  /** Standard error captured from the command. */
  stderr: string;
  /** Process exit code. -1 when the process was signalled or did not exit cleanly. */
  exit_code: number;
}

/** Minimal audit logger interface accepted by unsafeAdminExec. */
export interface UnsafeAdminExecLogger {
  log(entry: Record<string, unknown>): Promise<void>;
}

/**
 * Minimal interface for HITL capability token validation.
 *
 * In production this is satisfied by ApprovalManager from
 * `src/hitl/approval-manager.ts`. Tests may supply a lightweight stub.
 */
export interface UnsafeAdminExecApprovalManager {
  /** Returns true if the token has already been resolved or expired. */
  isConsumed(token: string): boolean;
  /**
   * Marks the token as consumed.
   * Returns true when the token was found and resolved, false otherwise.
   */
  resolveApproval(token: string, decision: 'approved' | 'denied'): boolean;
}

/** Contextual options for the unsafeAdminExec function. */
export interface UnsafeAdminExecOptions {
  /** Optional audit logger for recording all execution events. */
  logger?: UnsafeAdminExecLogger;
  /** Agent ID included in every audit log entry. */
  agentId?: string;
  /** Channel included in every audit log entry. */
  channel?: string;
  /**
   * HITL capability token issued after human approval.
   * Required for every invocation. Absent → throws 'hitl-required'.
   */
  approval_id?: string;
  /**
   * Approval manager used to validate and consume the capability token.
   * When provided, the token is checked for prior consumption (no replay)
   * and is consumed before command execution.
   */
  approvalManager?: UnsafeAdminExecApprovalManager;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `unsafeAdminExec`.
 *
 * The `code` discriminant lets callers branch on error type without
 * string-matching the message.
 *
 * - `disabled`               — CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC is not set to '1'.
 * - `invalid-justification`  — justification is shorter than JUSTIFICATION_MIN_LENGTH.
 * - `hitl-required`          — approval_id was not provided.
 * - `token-replayed`         — capability token has already been consumed.
 * - `exec-error`             — command spawning failed unexpectedly (e.g. invalid cwd).
 */
export class UnsafeAdminExecError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'disabled'
      | 'invalid-justification'
      | 'hitl-required'
      | 'token-replayed'
      | 'exec-error',
  ) {
    super(message);
    this.name = 'UnsafeAdminExecError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Spawns a shell command asynchronously and resolves with stdout, stderr,
 * and the exit code once the process closes.
 */
function execCommand(
  command: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, { shell: true, cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += String(chunk);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += String(chunk);
    });
    proc.on('error', reject);
    proc.on('close', (code: number | null) => {
      resolve({ stdout, stderr, exit_code: code ?? -1 });
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Executes a shell command when all pre-execution gates pass.
 *
 * Pre-execution gate order:
 *   1. Environment gate  — CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC must be '1'.
 *   2. Justification     — params.justification must be ≥ JUSTIFICATION_MIN_LENGTH chars.
 *   3. HITL token        — options.approval_id must be present.
 *   4. Replay protection — token must not have been consumed already.
 *
 * The capability token is consumed (via approvalManager.resolveApproval) before
 * the command runs so it cannot be replayed even if the process is interrupted.
 *
 * Every gate check and execution event is written to the audit log, including
 * the sanitized command prefix and the full justification string.
 *
 * @param params   Shell command, mandatory justification, and optional cwd.
 * @param options  Logger, agent context, HITL token, and approval manager.
 * @returns        stdout, stderr, and exit_code from the command.
 *
 * @throws {UnsafeAdminExecError}  code 'disabled'              — env var absent.
 * @throws {UnsafeAdminExecError}  code 'invalid-justification' — too short.
 * @throws {UnsafeAdminExecError}  code 'hitl-required'         — no approval_id.
 * @throws {UnsafeAdminExecError}  code 'token-replayed'        — token consumed.
 * @throws {UnsafeAdminExecError}  code 'exec-error'            — spawn failure.
 */
export async function unsafeAdminExec(
  params: UnsafeAdminExecParams,
  options: UnsafeAdminExecOptions = {},
): Promise<UnsafeAdminExecResult> {
  const { logger, agentId = 'unknown', channel = 'unknown', approval_id, approvalManager } =
    options;
  const ts = new Date().toISOString();
  const commandPrefix = sanitizeCommandPrefix(params.command);

  // Gate 1: environment check.
  const enabled = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] === '1';
  if (!enabled) {
    await logger?.log({
      ts,
      type: 'unsafe-admin-exec',
      event: 'disabled',
      toolName: 'unsafe_admin_exec',
      commandPrefix,
      agentId,
      channel,
      reason: 'CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC is not set to 1',
    });
    throw new UnsafeAdminExecError(
      'unsafe_admin_exec is disabled. Set CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC=1 to enable.',
      'disabled',
    );
  }

  // Gate 2: justification length.
  if (params.justification.length < JUSTIFICATION_MIN_LENGTH) {
    await logger?.log({
      ts,
      type: 'unsafe-admin-exec',
      event: 'invalid-justification',
      toolName: 'unsafe_admin_exec',
      commandPrefix,
      agentId,
      channel,
      reason: `justification must be at least ${JUSTIFICATION_MIN_LENGTH} characters`,
    });
    throw new UnsafeAdminExecError(
      `justification must be at least ${JUSTIFICATION_MIN_LENGTH} characters.`,
      'invalid-justification',
    );
  }

  // Gate 3: HITL capability token presence.
  if (!approval_id) {
    await logger?.log({
      ts,
      type: 'unsafe-admin-exec',
      event: 'hitl-required',
      toolName: 'unsafe_admin_exec',
      commandPrefix,
      agentId,
      channel,
      justification: params.justification,
      reason: 'HITL approval token is required for every invocation',
    });
    throw new UnsafeAdminExecError(
      'unsafe_admin_exec requires a HITL approval token (approval_id) for every invocation.',
      'hitl-required',
    );
  }

  // Gate 4: replay protection — token must not be consumed.
  if (approvalManager?.isConsumed(approval_id)) {
    await logger?.log({
      ts,
      type: 'unsafe-admin-exec',
      event: 'token-replayed',
      toolName: 'unsafe_admin_exec',
      commandPrefix,
      agentId,
      channel,
      justification: params.justification,
      approvalId: approval_id,
      reason: 'capability token has already been consumed',
    });
    throw new UnsafeAdminExecError(
      'Capability token has already been consumed and cannot be replayed.',
      'token-replayed',
    );
  }

  // Log the execution attempt before running so the attempt is always recorded,
  // even if the process is killed mid-execution.
  await logger?.log({
    ts,
    type: 'unsafe-admin-exec',
    event: 'exec-attempt',
    toolName: 'unsafe_admin_exec',
    commandPrefix,
    workingDir: params.working_dir ?? null,
    agentId,
    channel,
    justification: params.justification,
    approvalId: approval_id,
  });

  // Consume the token before execution so it cannot be replayed.
  approvalManager?.resolveApproval(approval_id, 'approved');

  let result: { stdout: string; stderr: string; exit_code: number };
  try {
    result = await execCommand(params.command, params.working_dir);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await logger?.log({
      ts: new Date().toISOString(),
      type: 'unsafe-admin-exec',
      event: 'exec-error',
      toolName: 'unsafe_admin_exec',
      commandPrefix,
      agentId,
      channel,
      justification: params.justification,
      approvalId: approval_id,
      error: message,
    });
    throw new UnsafeAdminExecError(`Command spawn failed: ${message}`, 'exec-error');
  }

  await logger?.log({
    ts: new Date().toISOString(),
    type: 'unsafe-admin-exec',
    event: 'exec-complete',
    toolName: 'unsafe_admin_exec',
    commandPrefix,
    agentId,
    channel,
    justification: params.justification,
    approvalId: approval_id,
    exitCode: result.exit_code,
    stdoutLength: result.stdout.length,
    stderrLength: result.stderr.length,
  });

  return result;
}

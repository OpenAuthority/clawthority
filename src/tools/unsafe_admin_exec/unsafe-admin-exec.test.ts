/**
 * Unit tests for the unsafe_admin_exec tool.
 *
 * Each test group restores the CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC
 * environment variable to its original value after the group runs.
 *
 * Test IDs:
 *   TC-UAX-01: Execution when enabled (CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC=1)
 *   TC-UAX-02: Inert behavior when disabled (env var absent or not '1')
 *   TC-UAX-03: Audit logging — all invocation events are recorded
 *   TC-UAX-04: Result shape
 *   TC-UAX-05: Security — command is sanitized in audit log entries
 *   TC-UAX-06: Justification validation — min length enforced
 *   TC-UAX-07: HITL approval required — approval_id must be present
 *   TC-UAX-08: Token replay protection — consumed tokens are rejected
 *   TC-UAX-09: Justification in audit trail — recorded in every log entry
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  unsafeAdminExec,
  UnsafeAdminExecError,
  JUSTIFICATION_MIN_LENGTH,
} from './unsafe-admin-exec.js';
import type {
  UnsafeAdminExecLogger,
  UnsafeAdminExecApprovalManager,
} from './unsafe-admin-exec.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a stub logger that records all entries. */
function makeLogger(): { logger: UnsafeAdminExecLogger; entries: Array<Record<string, unknown>> } {
  const entries: Array<Record<string, unknown>> = [];
  const logger: UnsafeAdminExecLogger = {
    log: async (entry) => {
      entries.push(entry);
    },
  };
  return { logger, entries };
}

/**
 * Creates a lightweight approval manager stub.
 * Tracks consumed tokens in memory; resolveApproval marks a token consumed.
 */
function makeApprovalManager(): UnsafeAdminExecApprovalManager {
  const consumed = new Set<string>();
  return {
    isConsumed: (token) => consumed.has(token),
    resolveApproval: (token, _decision) => {
      consumed.add(token);
      return true;
    },
  };
}

/** A justification string that meets the minimum length requirement. */
const VALID_JUSTIFICATION = 'Admin exec approved for scheduled maintenance task';

// ─── TC-UAX-01: Execution when enabled ───────────────────────────────────────

describe('TC-UAX-01: execution when enabled', () => {
  const ORIGINAL = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

  beforeEach(() => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    } else {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = ORIGINAL;
    }
  });

  it('returns stdout from the executed command', async () => {
    const result = await unsafeAdminExec(
      { command: 'echo hello', justification: VALID_JUSTIFICATION },
      { approval_id: 'tok-01a', approvalManager: makeApprovalManager() },
    );
    expect(result.stdout.trim()).toBe('hello');
  });

  it('returns exit_code 0 for a successful command', async () => {
    const result = await unsafeAdminExec(
      { command: 'true', justification: VALID_JUSTIFICATION },
      { approval_id: 'tok-01b', approvalManager: makeApprovalManager() },
    );
    expect(result.exit_code).toBe(0);
  });

  it('returns non-zero exit_code for a failing command', async () => {
    const result = await unsafeAdminExec(
      { command: 'false', justification: VALID_JUSTIFICATION },
      { approval_id: 'tok-01c', approvalManager: makeApprovalManager() },
    );
    expect(result.exit_code).not.toBe(0);
  });

  it('returns stderr from the executed command', async () => {
    const result = await unsafeAdminExec(
      { command: 'echo err >&2', justification: VALID_JUSTIFICATION },
      { approval_id: 'tok-01d', approvalManager: makeApprovalManager() },
    );
    expect(result.stderr.trim()).toBe('err');
  });

  it('executes with the provided working_dir', async () => {
    const result = await unsafeAdminExec(
      { command: 'pwd', working_dir: '/tmp', justification: VALID_JUSTIFICATION },
      { approval_id: 'tok-01e', approvalManager: makeApprovalManager() },
    );
    // /tmp may resolve to /private/tmp on macOS; check that the output ends with /tmp
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });

  it('stdout is empty string when command produces no output', async () => {
    const result = await unsafeAdminExec(
      { command: 'true', justification: VALID_JUSTIFICATION },
      { approval_id: 'tok-01f', approvalManager: makeApprovalManager() },
    );
    expect(result.stdout).toBe('');
  });
});

// ─── TC-UAX-02: Inert behavior when disabled ─────────────────────────────────

describe('TC-UAX-02: inert behavior when disabled', () => {
  const ORIGINAL = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    } else {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = ORIGINAL;
    }
  });

  it('throws UnsafeAdminExecError when env var is absent', async () => {
    delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec({ command: 'echo hello', justification: 'x' });
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }

    expect(err).toBeInstanceOf(UnsafeAdminExecError);
    expect(err!.code).toBe('disabled');
  });

  it('throws UnsafeAdminExecError when env var is "0"', async () => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '0';

    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec({ command: 'echo hello', justification: 'x' });
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }

    expect(err).toBeInstanceOf(UnsafeAdminExecError);
    expect(err!.code).toBe('disabled');
  });

  it('throws UnsafeAdminExecError when env var is "true" (not "1")', async () => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = 'true';

    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec({ command: 'echo hello', justification: 'x' });
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }

    expect(err).toBeInstanceOf(UnsafeAdminExecError);
    expect(err!.code).toBe('disabled');
  });

  it('thrown error has name "UnsafeAdminExecError"', async () => {
    delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec({ command: 'echo hello', justification: 'x' });
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }

    expect(err!.name).toBe('UnsafeAdminExecError');
  });

  it('error message references the env var', async () => {
    delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec({ command: 'echo hello', justification: 'x' });
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }

    expect(err!.message).toContain('CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC');
  });
});

// ─── TC-UAX-03: Audit logging ────────────────────────────────────────────────

describe('TC-UAX-03: audit logging', () => {
  const ORIGINAL = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    } else {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = ORIGINAL;
    }
  });

  it('logs a disabled event when env var is absent', async () => {
    delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    const { logger, entries } = makeLogger();

    try {
      await unsafeAdminExec({ command: 'echo hello', justification: 'x' }, { logger });
    } catch {
      // expected
    }

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'unsafe-admin-exec',
      event: 'disabled',
      toolName: 'unsafe_admin_exec',
    });
  });

  it('logs exec-attempt and exec-complete events on successful execution', async () => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
    const { logger, entries } = makeLogger();

    await unsafeAdminExec(
      { command: 'echo hello', justification: VALID_JUSTIFICATION },
      { logger, approval_id: 'tok-03a', approvalManager: makeApprovalManager() },
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'unsafe-admin-exec', event: 'exec-attempt' });
    expect(entries[1]).toMatchObject({ type: 'unsafe-admin-exec', event: 'exec-complete' });
  });

  it('exec-complete entry includes exit code', async () => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
    const { logger, entries } = makeLogger();

    await unsafeAdminExec(
      { command: 'true', justification: VALID_JUSTIFICATION },
      { logger, approval_id: 'tok-03b', approvalManager: makeApprovalManager() },
    );

    const complete = entries.find((e) => e['event'] === 'exec-complete');
    expect(complete).toBeDefined();
    expect(complete!['exitCode']).toBe(0);
  });

  it('all entries include toolName unsafe_admin_exec', async () => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
    const { logger, entries } = makeLogger();

    await unsafeAdminExec(
      { command: 'echo hello', justification: VALID_JUSTIFICATION },
      { logger, approval_id: 'tok-03c', approvalManager: makeApprovalManager() },
    );

    for (const entry of entries) {
      expect(entry['toolName']).toBe('unsafe_admin_exec');
    }
  });

  it('all entries include a ts timestamp string', async () => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
    const { logger, entries } = makeLogger();

    await unsafeAdminExec(
      { command: 'echo hello', justification: VALID_JUSTIFICATION },
      { logger, approval_id: 'tok-03d', approvalManager: makeApprovalManager() },
    );

    for (const entry of entries) {
      expect(typeof entry['ts']).toBe('string');
      expect((entry['ts'] as string).length).toBeGreaterThan(0);
    }
  });

  it('propagates agentId and channel into log entries', async () => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
    const { logger, entries } = makeLogger();

    await unsafeAdminExec(
      { command: 'echo hello', justification: VALID_JUSTIFICATION },
      {
        logger,
        agentId: 'agent-42',
        channel: 'ops-channel',
        approval_id: 'tok-03e',
        approvalManager: makeApprovalManager(),
      },
    );

    for (const entry of entries) {
      expect(entry['agentId']).toBe('agent-42');
      expect(entry['channel']).toBe('ops-channel');
    }
  });

  it('exec-attempt entry includes workingDir when provided', async () => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
    const { logger, entries } = makeLogger();

    await unsafeAdminExec(
      { command: 'pwd', working_dir: '/tmp', justification: VALID_JUSTIFICATION },
      { logger, approval_id: 'tok-03f', approvalManager: makeApprovalManager() },
    );

    const attempt = entries.find((e) => e['event'] === 'exec-attempt');
    expect(attempt!['workingDir']).toBe('/tmp');
  });

  it('exec-complete entry includes stdoutLength and stderrLength', async () => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
    const { logger, entries } = makeLogger();

    await unsafeAdminExec(
      { command: 'echo hello', justification: VALID_JUSTIFICATION },
      { logger, approval_id: 'tok-03g', approvalManager: makeApprovalManager() },
    );

    const complete = entries.find((e) => e['event'] === 'exec-complete');
    expect(typeof complete!['stdoutLength']).toBe('number');
    expect(typeof complete!['stderrLength']).toBe('number');
  });
});

// ─── TC-UAX-04: Result shape ─────────────────────────────────────────────────

describe('TC-UAX-04: result shape', () => {
  const ORIGINAL = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

  beforeEach(() => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    } else {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = ORIGINAL;
    }
  });

  it('result has stdout, stderr, and exit_code fields', async () => {
    const result = await unsafeAdminExec(
      { command: 'echo hello', justification: VALID_JUSTIFICATION },
      { approval_id: 'tok-04a', approvalManager: makeApprovalManager() },
    );
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('exit_code');
  });

  it('stdout and stderr are strings', async () => {
    const result = await unsafeAdminExec(
      { command: 'echo hello', justification: VALID_JUSTIFICATION },
      { approval_id: 'tok-04b', approvalManager: makeApprovalManager() },
    );
    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });

  it('exit_code is a number', async () => {
    const result = await unsafeAdminExec(
      { command: 'echo hello', justification: VALID_JUSTIFICATION },
      { approval_id: 'tok-04c', approvalManager: makeApprovalManager() },
    );
    expect(typeof result.exit_code).toBe('number');
  });
});

// ─── TC-UAX-05: Security — command sanitization ───────────────────────────────

describe('TC-UAX-05: security — command sanitization in audit log', () => {
  const ORIGINAL = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

  beforeEach(() => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    } else {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = ORIGINAL;
    }
  });

  it('commandPrefix in log entries does not exceed 40 characters', async () => {
    const { logger, entries } = makeLogger();
    const longCommand = 'echo ' + 'a'.repeat(100);

    await unsafeAdminExec(
      { command: longCommand, justification: VALID_JUSTIFICATION },
      { logger, approval_id: 'tok-05a', approvalManager: makeApprovalManager() },
    );

    for (const entry of entries) {
      if (typeof entry['commandPrefix'] === 'string') {
        expect(entry['commandPrefix'].length).toBeLessThanOrEqual(40);
      }
    }
  });

  it('commandPrefix redacts Bearer tokens', async () => {
    const { logger, entries } = makeLogger();

    await unsafeAdminExec(
      {
        command: 'curl -H "Authorization: Bearer secret-token-abc123" https://example.com',
        justification: VALID_JUSTIFICATION,
      },
      { logger, approval_id: 'tok-05b', approvalManager: makeApprovalManager() },
    );

    for (const entry of entries) {
      if (typeof entry['commandPrefix'] === 'string') {
        expect(entry['commandPrefix']).not.toContain('secret-token-abc123');
      }
    }
  });

  it('commandPrefix redacts token= assignments', async () => {
    const { logger, entries } = makeLogger();

    await unsafeAdminExec(
      {
        command: 'curl "https://api.example.com?token=supersecret"',
        justification: VALID_JUSTIFICATION,
      },
      { logger, approval_id: 'tok-05c', approvalManager: makeApprovalManager() },
    );

    for (const entry of entries) {
      if (typeof entry['commandPrefix'] === 'string') {
        expect(entry['commandPrefix']).not.toContain('supersecret');
      }
    }
  });
});

// ─── TC-UAX-06: Justification validation ─────────────────────────────────────

describe('TC-UAX-06: justification validation — min length enforced', () => {
  const ORIGINAL = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

  beforeEach(() => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    } else {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = ORIGINAL;
    }
  });

  it('throws invalid-justification when justification is empty', async () => {
    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec(
        { command: 'echo hello', justification: '' },
        { approval_id: 'tok-06a' },
      );
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }
    expect(err).toBeInstanceOf(UnsafeAdminExecError);
    expect(err!.code).toBe('invalid-justification');
  });

  it('throws invalid-justification when justification is one char short of minimum', async () => {
    const shortJustification = 'x'.repeat(JUSTIFICATION_MIN_LENGTH - 1);
    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec(
        { command: 'echo hello', justification: shortJustification },
        { approval_id: 'tok-06b' },
      );
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }
    expect(err).toBeInstanceOf(UnsafeAdminExecError);
    expect(err!.code).toBe('invalid-justification');
  });

  it('does not throw when justification is exactly JUSTIFICATION_MIN_LENGTH characters', async () => {
    const exactJustification = 'x'.repeat(JUSTIFICATION_MIN_LENGTH);
    const result = await unsafeAdminExec(
      { command: 'true', justification: exactJustification },
      { approval_id: 'tok-06c', approvalManager: makeApprovalManager() },
    );
    expect(result.exit_code).toBe(0);
  });

  it('error message references the minimum length', async () => {
    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec(
        { command: 'echo hello', justification: 'too short' },
        { approval_id: 'tok-06d' },
      );
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }
    expect(err!.message).toContain(String(JUSTIFICATION_MIN_LENGTH));
  });

  it('justification check occurs after disabled check (disabled wins)', async () => {
    delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec(
        { command: 'echo hello', justification: '' },
        { approval_id: 'tok-06e' },
      );
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }
    // 'disabled' takes priority over 'invalid-justification'
    expect(err!.code).toBe('disabled');
  });
});

// ─── TC-UAX-07: HITL approval required ───────────────────────────────────────

describe('TC-UAX-07: HITL approval required — approval_id must be present', () => {
  const ORIGINAL = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

  beforeEach(() => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    } else {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = ORIGINAL;
    }
  });

  it('throws hitl-required when no approval_id is provided', async () => {
    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec({ command: 'echo hello', justification: VALID_JUSTIFICATION });
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }
    expect(err).toBeInstanceOf(UnsafeAdminExecError);
    expect(err!.code).toBe('hitl-required');
  });

  it('thrown hitl-required error has name "UnsafeAdminExecError"', async () => {
    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec({ command: 'echo hello', justification: VALID_JUSTIFICATION });
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }
    expect(err!.name).toBe('UnsafeAdminExecError');
  });

  it('error message references approval_id', async () => {
    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec({ command: 'echo hello', justification: VALID_JUSTIFICATION });
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }
    expect(err!.message).toContain('approval_id');
  });

  it('logs a hitl-required event when no approval_id is provided', async () => {
    const { logger, entries } = makeLogger();
    try {
      await unsafeAdminExec(
        { command: 'echo hello', justification: VALID_JUSTIFICATION },
        { logger },
      );
    } catch {
      // expected
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'unsafe-admin-exec',
      event: 'hitl-required',
      toolName: 'unsafe_admin_exec',
    });
  });

  it('succeeds when a valid approval_id is provided', async () => {
    const result = await unsafeAdminExec(
      { command: 'true', justification: VALID_JUSTIFICATION },
      { approval_id: 'tok-07e', approvalManager: makeApprovalManager() },
    );
    expect(result.exit_code).toBe(0);
  });
});

// ─── TC-UAX-08: Token replay protection ──────────────────────────────────────

describe('TC-UAX-08: token replay protection — consumed tokens are rejected', () => {
  const ORIGINAL = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

  beforeEach(() => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    } else {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = ORIGINAL;
    }
  });

  it('throws token-replayed when approval_id was already consumed before the call', async () => {
    const manager = makeApprovalManager();
    // Pre-consume the token to simulate a replay attempt.
    manager.resolveApproval('pre-consumed-token', 'approved');

    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec(
        { command: 'echo hello', justification: VALID_JUSTIFICATION },
        { approval_id: 'pre-consumed-token', approvalManager: manager },
      );
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }

    expect(err).toBeInstanceOf(UnsafeAdminExecError);
    expect(err!.code).toBe('token-replayed');
  });

  it('token is consumed after a successful execution, preventing replay', async () => {
    const manager = makeApprovalManager();
    const token = 'one-time-token';

    // First call succeeds.
    await unsafeAdminExec(
      { command: 'true', justification: VALID_JUSTIFICATION },
      { approval_id: token, approvalManager: manager },
    );

    // Second call with the same token must fail.
    let err: UnsafeAdminExecError | undefined;
    try {
      await unsafeAdminExec(
        { command: 'true', justification: VALID_JUSTIFICATION },
        { approval_id: token, approvalManager: manager },
      );
    } catch (e) {
      err = e as UnsafeAdminExecError;
    }

    expect(err).toBeInstanceOf(UnsafeAdminExecError);
    expect(err!.code).toBe('token-replayed');
  });

  it('logs a token-replayed event containing the approvalId', async () => {
    const manager = makeApprovalManager();
    const { logger, entries } = makeLogger();
    manager.resolveApproval('replay-token', 'approved');

    try {
      await unsafeAdminExec(
        { command: 'echo hello', justification: VALID_JUSTIFICATION },
        { logger, approval_id: 'replay-token', approvalManager: manager },
      );
    } catch {
      // expected
    }

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'unsafe-admin-exec',
      event: 'token-replayed',
      approvalId: 'replay-token',
    });
  });

  it('different tokens are independent — second token is not blocked by first', async () => {
    const manager = makeApprovalManager();

    await unsafeAdminExec(
      { command: 'true', justification: VALID_JUSTIFICATION },
      { approval_id: 'token-A', approvalManager: manager },
    );

    // A different token should still work.
    const result = await unsafeAdminExec(
      { command: 'true', justification: VALID_JUSTIFICATION },
      { approval_id: 'token-B', approvalManager: manager },
    );

    expect(result.exit_code).toBe(0);
  });
});

// ─── TC-UAX-09: Justification in audit trail ─────────────────────────────────

describe('TC-UAX-09: justification in audit trail — recorded in every log entry', () => {
  const ORIGINAL = process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];

  beforeEach(() => {
    process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = '1';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'];
    } else {
      process.env['CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC'] = ORIGINAL;
    }
  });

  it('exec-attempt entry records the justification verbatim', async () => {
    const { logger, entries } = makeLogger();
    const justification = 'Deploying hotfix for critical production incident';

    await unsafeAdminExec(
      { command: 'true', justification },
      { logger, approval_id: 'tok-09a', approvalManager: makeApprovalManager() },
    );

    const attempt = entries.find((e) => e['event'] === 'exec-attempt');
    expect(attempt!['justification']).toBe(justification);
  });

  it('exec-complete entry records the justification verbatim', async () => {
    const { logger, entries } = makeLogger();
    const justification = 'Deploying hotfix for critical production incident';

    await unsafeAdminExec(
      { command: 'true', justification },
      { logger, approval_id: 'tok-09b', approvalManager: makeApprovalManager() },
    );

    const complete = entries.find((e) => e['event'] === 'exec-complete');
    expect(complete!['justification']).toBe(justification);
  });

  it('hitl-required event records the justification when approval_id is absent', async () => {
    const { logger, entries } = makeLogger();
    const justification = VALID_JUSTIFICATION;

    try {
      await unsafeAdminExec({ command: 'true', justification }, { logger });
    } catch {
      // expected
    }

    expect(entries[0]).toMatchObject({
      event: 'hitl-required',
      justification,
    });
  });

  it('token-replayed event records the justification', async () => {
    const { logger, entries } = makeLogger();
    const manager = makeApprovalManager();
    const justification = VALID_JUSTIFICATION;
    manager.resolveApproval('tok-09d', 'approved');

    try {
      await unsafeAdminExec({ command: 'true', justification }, { logger, approval_id: 'tok-09d', approvalManager: manager });
    } catch {
      // expected
    }

    expect(entries[0]).toMatchObject({
      event: 'token-replayed',
      justification,
    });
  });

  it('approvalId is recorded in exec-attempt and exec-complete entries', async () => {
    const { logger, entries } = makeLogger();

    await unsafeAdminExec(
      { command: 'true', justification: VALID_JUSTIFICATION },
      { logger, approval_id: 'my-approval-id', approvalManager: makeApprovalManager() },
    );

    const attempt = entries.find((e) => e['event'] === 'exec-attempt');
    const complete = entries.find((e) => e['event'] === 'exec-complete');
    expect(attempt!['approvalId']).toBe('my-approval-id');
    expect(complete!['approvalId']).toBe('my-approval-id');
  });
});

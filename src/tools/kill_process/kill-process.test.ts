/**
 * Unit tests for the kill_process tool.
 *
 * Test IDs:
 *   TC-KIL-01: validatePid    — pid validation
 *   TC-KIL-02: validateSignal — signal validation
 *   TC-KIL-03: killProcess    — pre-flight rejects bad pids
 *   TC-KIL-04: killProcess    — pre-flight rejects bad signals
 *   TC-KIL-05: killProcess    — successful execution against a child process
 *   TC-KIL-06: killProcess    — default signal is TERM
 *   TC-KIL-07: manifest       — F-05 manifest is well-formed
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import {
  validatePid,
  validateSignal,
  killProcess,
  KillProcessError,
  KILL_SIGNALS,
} from './kill-process.js';
import { killProcessManifest } from './manifest.js';

// ─── TC-KIL-01: validatePid ──────────────────────────────────────────────────

describe('TC-KIL-01: validatePid — pid validation', () => {
  it('accepts pid 0 (process-group sentinel)', () => {
    expect(validatePid(0)).toBe(true);
  });

  it('accepts pid 1 (init — structurally valid)', () => {
    expect(validatePid(1)).toBe(true);
  });

  it('accepts a typical pid', () => {
    expect(validatePid(12345)).toBe(true);
  });

  it('rejects negative pids', () => {
    expect(validatePid(-1)).toBe(false);
  });

  it('rejects fractional pids', () => {
    expect(validatePid(12.5)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(validatePid(Number.NaN)).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(validatePid(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('rejects unsafe integer', () => {
    expect(validatePid(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it('rejects a numeric string', () => {
    expect(validatePid('1234')).toBe(false);
  });
});

// ─── TC-KIL-02: validateSignal ───────────────────────────────────────────────

describe('TC-KIL-02: validateSignal — signal validation', () => {
  it.each(KILL_SIGNALS)('accepts signal "%s"', (sig) => {
    expect(validateSignal(sig)).toBe(true);
  });

  it('rejects an unknown signal', () => {
    expect(validateSignal('SEGV')).toBe(false);
  });

  it('rejects lowercase signal name', () => {
    expect(validateSignal('term')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validateSignal('')).toBe(false);
  });

  it('rejects shell injection in signal', () => {
    expect(validateSignal('TERM; rm -rf /')).toBe(false);
  });
});

// ─── TC-KIL-03: pre-flight rejects bad pids ──────────────────────────────────

describe('TC-KIL-03: killProcess — pre-flight rejects bad pids', () => {
  it('throws invalid-pid for a fractional pid', () => {
    let err: KillProcessError | undefined;
    try {
      killProcess({ pid: 12.5 });
    } catch (e) {
      err = e as KillProcessError;
    }
    expect(err).toBeInstanceOf(KillProcessError);
    expect(err!.code).toBe('invalid-pid');
  });

  it('throws invalid-pid for a negative pid', () => {
    let err: KillProcessError | undefined;
    try {
      killProcess({ pid: -1 });
    } catch (e) {
      err = e as KillProcessError;
    }
    expect(err!.code).toBe('invalid-pid');
  });
});

// ─── TC-KIL-04: pre-flight rejects bad signals ───────────────────────────────

describe('TC-KIL-04: killProcess — pre-flight rejects bad signals', () => {
  it('throws invalid-signal for an unknown signal', () => {
    let err: KillProcessError | undefined;
    try {
      killProcess({ pid: 1, signal: 'SEGV' as never });
    } catch (e) {
      err = e as KillProcessError;
    }
    expect(err).toBeInstanceOf(KillProcessError);
    expect(err!.code).toBe('invalid-signal');
  });

  it('pid validation runs before signal validation', () => {
    let err: KillProcessError | undefined;
    try {
      killProcess({ pid: -1, signal: 'BOGUS' as never });
    } catch (e) {
      err = e as KillProcessError;
    }
    expect(err!.code).toBe('invalid-pid');
  });
});

// ─── TC-KIL-05: successful execution ─────────────────────────────────────────

describe('TC-KIL-05: killProcess — successful execution against a child process', () => {
  it('kills a long-running child process with TERM and returns exit_code 0', async () => {
    // Spawn a sleep — long enough that it cannot finish before we signal it.
    const child = spawn('sleep', ['10']);
    expect(child.pid).toBeDefined();
    const pid = child.pid!;

    // Wait one tick so the child is actually running.
    await new Promise((r) => setTimeout(r, 50));

    const result = killProcess({ pid, signal: 'TERM' });
    expect(result.exit_code).toBe(0);

    // Wait for child to die so we don't leak the process.
    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve());
    });
  });
});

// ─── TC-KIL-06: default signal is TERM ───────────────────────────────────────

describe('TC-KIL-06: killProcess — default signal is TERM', () => {
  it('does not throw when signal is omitted (defaults to TERM)', async () => {
    const child = spawn('sleep', ['10']);
    const pid = child.pid!;

    await new Promise((r) => setTimeout(r, 50));

    const result = killProcess({ pid });
    expect(result.exit_code).toBe(0);

    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve());
    });
  });
});

// ─── TC-KIL-07: manifest sanity ──────────────────────────────────────────────

describe('TC-KIL-07: manifest is a well-formed F-05 manifest', () => {
  it('declares the process.signal action class', () => {
    expect(killProcessManifest.action_class).toBe('process.signal');
  });

  it('declares risk_tier high', () => {
    expect(killProcessManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(killProcessManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares pid as the target_field', () => {
    expect(killProcessManifest.target_field).toBe('pid');
  });

  it('marks pid as required (signal is optional)', () => {
    expect(killProcessManifest.params['required']).toEqual(['pid']);
  });

  it('forbids additional properties on the params schema', () => {
    expect(killProcessManifest.params['additionalProperties']).toBe(false);
  });
});

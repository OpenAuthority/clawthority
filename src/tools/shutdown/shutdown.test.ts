/**
 * Unit tests for the shutdown tool.
 *
 * Test IDs:
 *   TC-SHD-01: validateMode             — mode validation
 *   TC-SHD-02: validateTime             — schedule expression validation
 *   TC-SHD-03: shutdown                 — pre-flight rejects invalid mode
 *   TC-SHD-04: shutdown                 — pre-flight rejects malformed time
 *   TC-SHD-05: shutdown                 — cancel mode forbids time
 *   TC-SHD-06: shutdown                 — error metadata is well-formed
 *   TC-SHD-07: manifest                 — F-05 manifest is well-formed
 *
 * No execution test: actually invoking shutdown would take down the host
 * running the suite. Spawn behaviour is covered by the shared
 * `spawnSync(... shell: false)` invariant in sibling tools.
 */

import { describe, it, expect } from 'vitest';
import {
  validateMode,
  validateTime,
  shutdown,
  ShutdownError,
  SHUTDOWN_MODES,
} from './shutdown.js';
import { shutdownManifest } from './manifest.js';

// ─── TC-SHD-01: validateMode ─────────────────────────────────────────────────

describe('TC-SHD-01: validateMode — mode validation', () => {
  it.each(SHUTDOWN_MODES)('accepts the mode "%s"', (mode) => {
    expect(validateMode(mode)).toBe(true);
  });

  it('rejects an unknown mode', () => {
    expect(validateMode('halt')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validateMode('')).toBe(false);
  });

  it('rejects a wrong-case mode', () => {
    expect(validateMode('POWEROFF')).toBe(false);
  });
});

// ─── TC-SHD-02: validateTime ─────────────────────────────────────────────────

describe('TC-SHD-02: validateTime — schedule expression validation', () => {
  it('accepts "now"', () => {
    expect(validateTime('now')).toBe(true);
  });

  it('accepts a relative offset "+5"', () => {
    expect(validateTime('+5')).toBe(true);
  });

  it('accepts a relative offset "+0"', () => {
    expect(validateTime('+0')).toBe(true);
  });

  it('accepts a relative offset "+1440" (24 hours)', () => {
    expect(validateTime('+1440')).toBe(true);
  });

  it('accepts an absolute time "23:59"', () => {
    expect(validateTime('23:59')).toBe(true);
  });

  it('accepts an absolute time "00:00"', () => {
    expect(validateTime('00:00')).toBe(true);
  });

  it('accepts an absolute time "9:30"', () => {
    expect(validateTime('9:30')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateTime('')).toBe(false);
  });

  it('rejects "tomorrow"', () => {
    expect(validateTime('tomorrow')).toBe(false);
  });

  it('rejects an invalid hour "25:00"', () => {
    expect(validateTime('25:00')).toBe(false);
  });

  it('rejects an invalid minute "23:60"', () => {
    expect(validateTime('23:60')).toBe(false);
  });

  it('rejects shell injection in time', () => {
    expect(validateTime('now; rm -rf /')).toBe(false);
  });

  it('rejects shutdown(8) message form (not supported by typed wrapper)', () => {
    expect(validateTime('+5 The system is going down for maintenance')).toBe(
      false,
    );
  });

  it('rejects negative offset', () => {
    expect(validateTime('-5')).toBe(false);
  });
});

// ─── TC-SHD-03: pre-flight rejects invalid mode ──────────────────────────────

describe('TC-SHD-03: shutdown — pre-flight rejects invalid mode', () => {
  it('throws invalid-mode for "halt"', () => {
    let err: ShutdownError | undefined;
    try {
      shutdown({ mode: 'halt' as never });
    } catch (e) {
      err = e as ShutdownError;
    }
    expect(err).toBeInstanceOf(ShutdownError);
    expect(err!.code).toBe('invalid-mode');
  });

  it('throws invalid-mode for an empty mode string', () => {
    let err: ShutdownError | undefined;
    try {
      shutdown({ mode: '' as never });
    } catch (e) {
      err = e as ShutdownError;
    }
    expect(err!.code).toBe('invalid-mode');
  });
});

// ─── TC-SHD-04: pre-flight rejects malformed time ────────────────────────────

describe('TC-SHD-04: shutdown — pre-flight rejects malformed time', () => {
  it('throws invalid-time for a non-matching time string', () => {
    let err: ShutdownError | undefined;
    try {
      shutdown({ mode: 'reboot', time: 'tomorrow' });
    } catch (e) {
      err = e as ShutdownError;
    }
    expect(err).toBeInstanceOf(ShutdownError);
    expect(err!.code).toBe('invalid-time');
  });

  it('throws invalid-time for shell injection in time', () => {
    let err: ShutdownError | undefined;
    try {
      shutdown({ mode: 'poweroff', time: 'now; rm -rf /' });
    } catch (e) {
      err = e as ShutdownError;
    }
    expect(err!.code).toBe('invalid-time');
  });
});

// ─── TC-SHD-05: cancel mode forbids time ─────────────────────────────────────

describe('TC-SHD-05: shutdown — cancel mode forbids time', () => {
  it('throws time-not-allowed when cancel is paired with a time', () => {
    let err: ShutdownError | undefined;
    try {
      shutdown({ mode: 'cancel', time: 'now' });
    } catch (e) {
      err = e as ShutdownError;
    }
    expect(err).toBeInstanceOf(ShutdownError);
    expect(err!.code).toBe('time-not-allowed');
  });
});

// ─── TC-SHD-06: error metadata ───────────────────────────────────────────────

describe('TC-SHD-06: shutdown — error metadata is well-formed', () => {
  it('error name is "ShutdownError"', () => {
    let err: ShutdownError | undefined;
    try {
      shutdown({ mode: 'halt' as never });
    } catch (e) {
      err = e as ShutdownError;
    }
    expect(err!.name).toBe('ShutdownError');
  });

  it('invalid-mode message includes the offending mode', () => {
    let err: ShutdownError | undefined;
    try {
      shutdown({ mode: 'kaboom' as never });
    } catch (e) {
      err = e as ShutdownError;
    }
    expect(err!.message).toContain('kaboom');
  });

  it('invalid-time message includes the offending time', () => {
    let err: ShutdownError | undefined;
    try {
      shutdown({ mode: 'reboot', time: 'banana' });
    } catch (e) {
      err = e as ShutdownError;
    }
    expect(err!.message).toContain('banana');
  });
});

// ─── TC-SHD-07: manifest sanity ──────────────────────────────────────────────

describe('TC-SHD-07: manifest is a well-formed F-05 manifest', () => {
  it('declares the system.service action class', () => {
    expect(shutdownManifest.action_class).toBe('system.service');
  });

  it('declares risk_tier critical', () => {
    expect(shutdownManifest.risk_tier).toBe('critical');
  });

  it('declares per_request HITL', () => {
    expect(shutdownManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares mode as the target_field', () => {
    expect(shutdownManifest.target_field).toBe('mode');
  });

  it('marks mode as required (time is optional)', () => {
    expect(shutdownManifest.params['required']).toEqual(['mode']);
  });

  it('forbids additional properties on the params schema', () => {
    expect(shutdownManifest.params['additionalProperties']).toBe(false);
  });
});

/**
 * Unit tests for the reboot tool.
 *
 * Test IDs:
 *   TC-RBT-01: reboot — pre-flight rejects missing confirm
 *   TC-RBT-02: reboot — pre-flight rejects non-true confirm values
 *   TC-RBT-03: reboot — error metadata is well-formed
 *   TC-RBT-04: manifest — F-05 manifest is well-formed
 *
 * No execution test: the only way `reboot()` reaches `spawnSync` is when
 * `confirm: true` is passed, and we are not going to actually reboot the
 * host running the test suite. Spawn behaviour is exercised by the
 * shared `spawnSync(... shell: false)` invariant covered by sibling
 * tools (docker_run, systemctl_unit_action, etc.).
 */

import { describe, it, expect } from 'vitest';
import { reboot, RebootError } from './reboot.js';
import { rebootManifest } from './manifest.js';

// ─── TC-RBT-01: pre-flight rejects missing confirm ───────────────────────────

describe('TC-RBT-01: reboot — pre-flight rejects missing confirm', () => {
  it('throws RebootError when params is empty', () => {
    let err: RebootError | undefined;
    try {
      reboot({} as never);
    } catch (e) {
      err = e as RebootError;
    }
    expect(err).toBeInstanceOf(RebootError);
    expect(err!.code).toBe('confirm-required');
  });

  it('throws RebootError when params is null', () => {
    let err: RebootError | undefined;
    try {
      reboot(null as never);
    } catch (e) {
      err = e as RebootError;
    }
    expect(err).toBeInstanceOf(RebootError);
    expect(err!.code).toBe('confirm-required');
  });
});

// ─── TC-RBT-02: pre-flight rejects non-true confirm values ───────────────────

describe('TC-RBT-02: reboot — pre-flight rejects non-true confirm values', () => {
  it('rejects confirm: false', () => {
    let err: RebootError | undefined;
    try {
      reboot({ confirm: false as unknown as true });
    } catch (e) {
      err = e as RebootError;
    }
    expect(err!.code).toBe('confirm-required');
  });

  it('rejects confirm: 1 (truthy but not exactly true)', () => {
    let err: RebootError | undefined;
    try {
      reboot({ confirm: 1 as unknown as true });
    } catch (e) {
      err = e as RebootError;
    }
    expect(err!.code).toBe('confirm-required');
  });

  it('rejects confirm: "true" (string truthy)', () => {
    let err: RebootError | undefined;
    try {
      reboot({ confirm: 'true' as unknown as true });
    } catch (e) {
      err = e as RebootError;
    }
    expect(err!.code).toBe('confirm-required');
  });
});

// ─── TC-RBT-03: error metadata ───────────────────────────────────────────────

describe('TC-RBT-03: reboot — error metadata is well-formed', () => {
  it('error name is "RebootError"', () => {
    let err: RebootError | undefined;
    try {
      reboot({} as never);
    } catch (e) {
      err = e as RebootError;
    }
    expect(err!.name).toBe('RebootError');
  });

  it('error message mentions the required confirm flag', () => {
    let err: RebootError | undefined;
    try {
      reboot({} as never);
    } catch (e) {
      err = e as RebootError;
    }
    expect(err!.message).toContain('confirm');
  });
});

// ─── TC-RBT-04: manifest sanity ──────────────────────────────────────────────

describe('TC-RBT-04: manifest is a well-formed F-05 manifest', () => {
  it('declares the system.service action class', () => {
    expect(rebootManifest.action_class).toBe('system.service');
  });

  it('declares risk_tier critical', () => {
    expect(rebootManifest.risk_tier).toBe('critical');
  });

  it('declares per_request HITL', () => {
    expect(rebootManifest.default_hitl_mode).toBe('per_request');
  });

  it('marks confirm as required', () => {
    expect(rebootManifest.params['required']).toEqual(['confirm']);
  });

  it('forbids additional properties on the params schema', () => {
    expect(rebootManifest.params['additionalProperties']).toBe(false);
  });

  it('pins confirm to const: true', () => {
    const props = rebootManifest.params['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(props['confirm']?.['const']).toBe(true);
  });
});

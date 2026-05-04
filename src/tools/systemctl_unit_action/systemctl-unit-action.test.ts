/**
 * Unit tests for the systemctl_unit_action tool.
 *
 * The execution group (TC-SCT-06) is gated behind a module-level systemctl
 * availability probe so it skips gracefully on hosts without systemd
 * (e.g. CI runners on macOS).
 *
 * Test IDs:
 *   TC-SCT-01: validateUnitName       — unit-name validation
 *   TC-SCT-02: validateAction         — action-verb validation
 *   TC-SCT-03: systemctlUnitAction    — pre-flight rejects shell injection
 *   TC-SCT-04: systemctlUnitAction    — pre-flight rejects unknown action
 *   TC-SCT-05: systemctlUnitAction    — pre-flight error metadata
 *   TC-SCT-06: systemctlUnitAction    — successful invocation (requires systemctl)
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  validateUnitName,
  validateAction,
  systemctlUnitAction,
  SystemctlUnitActionError,
  SYSTEMCTL_ACTIONS,
} from './systemctl-unit-action.js';
import { systemctlUnitActionManifest } from './manifest.js';

// ─── Binary probe ─────────────────────────────────────────────────────────────

const systemctlAvailable =
  spawnSync('systemctl', ['--version'], { encoding: 'utf-8' }).status === 0;

// ─── TC-SCT-01: validateUnitName ─────────────────────────────────────────────

describe('TC-SCT-01: validateUnitName — unit-name validation', () => {
  it('accepts a simple service unit', () => {
    expect(validateUnitName('nginx.service')).toBe(true);
  });

  it('accepts a target unit', () => {
    expect(validateUnitName('multi-user.target')).toBe(true);
  });

  it('accepts a template instance with @', () => {
    expect(validateUnitName('user@1000.service')).toBe(true);
  });

  it('accepts a unit with digits', () => {
    expect(validateUnitName('docker-1.service')).toBe(true);
  });

  it('accepts a unit with underscore', () => {
    expect(validateUnitName('my_unit.service')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateUnitName('')).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(validateUnitName('   ')).toBe(false);
  });

  it('rejects a unit with a semicolon (shell injection)', () => {
    expect(validateUnitName('nginx; rm -rf /')).toBe(false);
  });

  it('rejects a unit with a backtick', () => {
    expect(validateUnitName('nginx`cmd`')).toBe(false);
  });

  it('rejects a unit with a dollar sign', () => {
    expect(validateUnitName('$UNIT_FROM_ENV')).toBe(false);
  });

  it('rejects a unit with a space', () => {
    expect(validateUnitName('two words.service')).toBe(false);
  });

  it('rejects a unit with a slash (path traversal)', () => {
    expect(validateUnitName('../../etc/passwd')).toBe(false);
  });

  it('rejects a unit longer than 256 characters', () => {
    expect(validateUnitName('a'.repeat(257))).toBe(false);
  });

  it('accepts a unit exactly 256 characters', () => {
    expect(validateUnitName('a'.repeat(256))).toBe(true);
  });

  it('rejects non-string input (null cast)', () => {
    expect(validateUnitName(null as unknown as string)).toBe(false);
  });
});

// ─── TC-SCT-02: validateAction ────────────────────────────────────────────────

describe('TC-SCT-02: validateAction — action-verb validation', () => {
  it.each(SYSTEMCTL_ACTIONS)('accepts the lifecycle verb "%s"', (verb) => {
    expect(validateAction(verb)).toBe(true);
  });

  it('rejects an unknown verb', () => {
    expect(validateAction('reboot')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validateAction('')).toBe(false);
  });

  it('rejects a verb with shell injection', () => {
    expect(validateAction('start; rm -rf /')).toBe(false);
  });

  it('rejects a wrong-case verb (verbs are case-sensitive)', () => {
    expect(validateAction('START')).toBe(false);
  });
});

// ─── TC-SCT-03: pre-flight rejects shell injection ───────────────────────────

describe('TC-SCT-03: systemctlUnitAction — pre-flight rejects shell injection', () => {
  it('throws invalid-unit for a unit name with a semicolon', () => {
    let err: SystemctlUnitActionError | undefined;
    try {
      systemctlUnitAction({ unit: 'nginx; rm -rf /', action: 'restart' });
    } catch (e) {
      err = e as SystemctlUnitActionError;
    }
    expect(err).toBeInstanceOf(SystemctlUnitActionError);
    expect(err!.code).toBe('invalid-unit');
  });

  it('throws invalid-unit for a unit name with backticks', () => {
    let err: SystemctlUnitActionError | undefined;
    try {
      systemctlUnitAction({ unit: 'nginx`whoami`', action: 'restart' });
    } catch (e) {
      err = e as SystemctlUnitActionError;
    }
    expect(err).toBeInstanceOf(SystemctlUnitActionError);
    expect(err!.code).toBe('invalid-unit');
  });

  it('throws invalid-unit for a $-substituted unit (env-injection scenario)', () => {
    let err: SystemctlUnitActionError | undefined;
    try {
      systemctlUnitAction({ unit: '$UNIT_FROM_ENV', action: 'restart' });
    } catch (e) {
      err = e as SystemctlUnitActionError;
    }
    expect(err).toBeInstanceOf(SystemctlUnitActionError);
    expect(err!.code).toBe('invalid-unit');
  });
});

// ─── TC-SCT-04: pre-flight rejects unknown action ────────────────────────────

describe('TC-SCT-04: systemctlUnitAction — pre-flight rejects unknown action', () => {
  it('throws invalid-action for "reboot" (not in the lifecycle enum)', () => {
    let err: SystemctlUnitActionError | undefined;
    try {
      systemctlUnitAction({
        unit: 'nginx.service',
        action: 'reboot' as never,
      });
    } catch (e) {
      err = e as SystemctlUnitActionError;
    }
    expect(err).toBeInstanceOf(SystemctlUnitActionError);
    expect(err!.code).toBe('invalid-action');
  });

  it('throws invalid-action for an empty action string', () => {
    let err: SystemctlUnitActionError | undefined;
    try {
      systemctlUnitAction({ unit: 'nginx.service', action: '' as never });
    } catch (e) {
      err = e as SystemctlUnitActionError;
    }
    expect(err).toBeInstanceOf(SystemctlUnitActionError);
    expect(err!.code).toBe('invalid-action');
  });

  it('action validation runs before unit validation (action error wins)', () => {
    let err: SystemctlUnitActionError | undefined;
    try {
      systemctlUnitAction({ unit: 'bad; unit', action: 'kaboom' as never });
    } catch (e) {
      err = e as SystemctlUnitActionError;
    }
    expect(err!.code).toBe('invalid-action');
  });
});

// ─── TC-SCT-05: pre-flight error metadata ────────────────────────────────────

describe('TC-SCT-05: systemctlUnitAction — pre-flight error metadata', () => {
  it('error name is "SystemctlUnitActionError"', () => {
    let err: SystemctlUnitActionError | undefined;
    try {
      systemctlUnitAction({ unit: '', action: 'start' });
    } catch (e) {
      err = e as SystemctlUnitActionError;
    }
    expect(err!.name).toBe('SystemctlUnitActionError');
  });

  it('error message includes the offending unit name', () => {
    let err: SystemctlUnitActionError | undefined;
    try {
      systemctlUnitAction({ unit: 'bad unit!', action: 'start' });
    } catch (e) {
      err = e as SystemctlUnitActionError;
    }
    expect(err!.message).toContain('bad unit!');
  });

  it('error message includes the offending action', () => {
    let err: SystemctlUnitActionError | undefined;
    try {
      systemctlUnitAction({
        unit: 'nginx.service',
        action: 'kaboom' as never,
      });
    } catch (e) {
      err = e as SystemctlUnitActionError;
    }
    expect(err!.message).toContain('kaboom');
  });
});

// ─── TC-SCT-06: successful invocation (requires systemctl) ───────────────────

describe.skipIf(!systemctlAvailable)(
  'TC-SCT-06: systemctlUnitAction — successful invocation (requires systemctl)',
  () => {
    it('runs `systemctl is-active` on a likely-present unit and returns a typed result', () => {
      // `dbus.service` is present on essentially every systemd host. The exit
      // code may be 0 (active) or non-zero (inactive); we only assert the
      // shape of the result, not its content.
      const result = systemctlUnitAction({
        unit: 'dbus.service',
        action: 'is-active',
      });

      expect(typeof result.stdout).toBe('string');
      expect(typeof result.stderr).toBe('string');
      expect(typeof result.exit_code).toBe('number');
    });
  },
);

// ─── TC-SCT-07: manifest sanity ──────────────────────────────────────────────

describe('TC-SCT-07: manifest is a well-formed F-05 manifest', () => {
  it('declares the system.service action class', () => {
    expect(systemctlUnitActionManifest.action_class).toBe('system.service');
  });

  it('declares risk_tier critical to align with the registry default', () => {
    expect(systemctlUnitActionManifest.risk_tier).toBe('critical');
  });

  it('declares per_request HITL', () => {
    expect(systemctlUnitActionManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares unit as the target_field', () => {
    expect(systemctlUnitActionManifest.target_field).toBe('unit');
  });

  it('marks unit and action as required', () => {
    expect(systemctlUnitActionManifest.params['required']).toEqual([
      'unit',
      'action',
    ]);
  });

  it('forbids additional properties on the params schema', () => {
    expect(systemctlUnitActionManifest.params['additionalProperties']).toBe(
      false,
    );
  });
});

/**
 * Unit tests for the crontab_install_from_file tool.
 *
 * Test IDs:
 *   TC-CTI-01: pre-flight rejects missing replace_confirm
 *   TC-CTI-02: pre-flight rejects bad file_path
 *   TC-CTI-03: pre-flight rejects bad user
 *   TC-CTI-04: replace_confirm validation runs first
 *   TC-CTI-05: manifest sanity
 */

import { describe, it, expect } from 'vitest';
import {
  crontabInstallFromFile,
  CrontabInstallFromFileError,
} from './crontab-install-from-file.js';
import { crontabInstallFromFileManifest } from './manifest.js';

// ─── TC-CTI-01: rejects missing replace_confirm ──────────────────────────────

describe('TC-CTI-01: crontabInstallFromFile — pre-flight rejects missing replace_confirm', () => {
  it('throws when replace_confirm is omitted', () => {
    let err: CrontabInstallFromFileError | undefined;
    try {
      crontabInstallFromFile({ file_path: '/tmp/cronfile' } as never);
    } catch (e) {
      err = e as CrontabInstallFromFileError;
    }
    expect(err!.code).toBe('replace-confirm-required');
  });

  it('throws when replace_confirm is false', () => {
    let err: CrontabInstallFromFileError | undefined;
    try {
      crontabInstallFromFile({
        file_path: '/tmp/cronfile',
        replace_confirm: false as unknown as true,
      });
    } catch (e) {
      err = e as CrontabInstallFromFileError;
    }
    expect(err!.code).toBe('replace-confirm-required');
  });

  it('throws when replace_confirm is "true" (string truthy)', () => {
    let err: CrontabInstallFromFileError | undefined;
    try {
      crontabInstallFromFile({
        file_path: '/tmp/cronfile',
        replace_confirm: 'true' as unknown as true,
      });
    } catch (e) {
      err = e as CrontabInstallFromFileError;
    }
    expect(err!.code).toBe('replace-confirm-required');
  });
});

// ─── TC-CTI-02: rejects bad file_path ────────────────────────────────────────

describe('TC-CTI-02: crontabInstallFromFile — pre-flight rejects bad file_path', () => {
  it('throws invalid-file-path for shell injection', () => {
    let err: CrontabInstallFromFileError | undefined;
    try {
      crontabInstallFromFile({
        file_path: '/tmp/x; rm -rf /',
        replace_confirm: true,
      });
    } catch (e) {
      err = e as CrontabInstallFromFileError;
    }
    expect(err!.code).toBe('invalid-file-path');
  });

  it('throws invalid-file-path for empty path', () => {
    let err: CrontabInstallFromFileError | undefined;
    try {
      crontabInstallFromFile({ file_path: '', replace_confirm: true });
    } catch (e) {
      err = e as CrontabInstallFromFileError;
    }
    expect(err!.code).toBe('invalid-file-path');
  });
});

// ─── TC-CTI-03: rejects bad user ─────────────────────────────────────────────

describe('TC-CTI-03: crontabInstallFromFile — pre-flight rejects bad user', () => {
  it('throws invalid-user for shell injection in user', () => {
    let err: CrontabInstallFromFileError | undefined;
    try {
      crontabInstallFromFile({
        file_path: '/tmp/cronfile',
        replace_confirm: true,
        user: 'alice; rm',
      });
    } catch (e) {
      err = e as CrontabInstallFromFileError;
    }
    expect(err!.code).toBe('invalid-user');
  });
});

// ─── TC-CTI-04: replace_confirm validation runs first ────────────────────────

describe('TC-CTI-04: crontabInstallFromFile — replace_confirm validation runs first', () => {
  it('replace-confirm-required wins over invalid-file-path', () => {
    let err: CrontabInstallFromFileError | undefined;
    try {
      crontabInstallFromFile({ file_path: ';bad', replace_confirm: false } as never);
    } catch (e) {
      err = e as CrontabInstallFromFileError;
    }
    expect(err!.code).toBe('replace-confirm-required');
  });
});

// ─── TC-CTI-05: manifest sanity ──────────────────────────────────────────────

describe('TC-CTI-05: manifest is a well-formed F-05 manifest', () => {
  it('declares the scheduling.persist action class', () => {
    expect(crontabInstallFromFileManifest.action_class).toBe(
      'scheduling.persist',
    );
  });

  it('declares risk_tier high', () => {
    expect(crontabInstallFromFileManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(crontabInstallFromFileManifest.default_hitl_mode).toBe(
      'per_request',
    );
  });

  it('declares file_path as the target_field', () => {
    expect(crontabInstallFromFileManifest.target_field).toBe('file_path');
  });

  it('marks file_path and replace_confirm as required', () => {
    expect(crontabInstallFromFileManifest.params['required']).toEqual([
      'file_path',
      'replace_confirm',
    ]);
  });

  it('pins replace_confirm to const: true', () => {
    const props = crontabInstallFromFileManifest.params['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(props['replace_confirm']?.['const']).toBe(true);
  });

  it('forbids additional properties on the params schema', () => {
    expect(crontabInstallFromFileManifest.params['additionalProperties']).toBe(
      false,
    );
  });
});

/**
 * Unit tests for the chmod_path tool.
 *
 * Test IDs:
 *   TC-CHM-01: validateMode  — mode validation (numeric + symbolic)
 *   TC-CHM-02: validatePath  — path validation
 *   TC-CHM-03: chmodPath     — pre-flight rejects bad paths
 *   TC-CHM-04: chmodPath     — pre-flight rejects bad modes
 *   TC-CHM-05: chmodPath     — successful execution against a temp file
 *   TC-CHM-06: manifest      — F-05 manifest is well-formed
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateMode,
  validatePath,
  chmodPath,
  ChmodPathError,
} from './chmod-path.js';
import { chmodPathManifest } from './manifest.js';

const chmodAvailable =
  spawnSync('chmod', ['--version'], { encoding: 'utf-8' }).status === 0 ||
  // BSD chmod (macOS) doesn't support --version; probe with a no-op help flag.
  spawnSync('chmod', ['-h'], { encoding: 'utf-8' }).status !== null;

// ─── TC-CHM-01: validateMode ─────────────────────────────────────────────────

describe('TC-CHM-01: validateMode — mode validation', () => {
  it('accepts a 3-digit numeric mode', () => {
    expect(validateMode('755')).toBe(true);
  });

  it('accepts a 4-digit numeric mode (with leading zero)', () => {
    expect(validateMode('0644')).toBe(true);
  });

  it('accepts a setuid 4-digit mode', () => {
    expect(validateMode('4755')).toBe(true);
  });

  it('accepts a simple symbolic mode "u+x"', () => {
    expect(validateMode('u+x')).toBe(true);
  });

  it('accepts an everyone-readable mode "a=r"', () => {
    expect(validateMode('a=r')).toBe(true);
  });

  it('accepts a multi-clause symbolic mode "u+x,g-w"', () => {
    expect(validateMode('u+x,g-w')).toBe(true);
  });

  it('accepts an implicit-class clause "+x"', () => {
    expect(validateMode('+x')).toBe(true);
  });

  it('accepts the X (capital) permission for directories-only', () => {
    expect(validateMode('a+X')).toBe(true);
  });

  it('rejects a digit out of octal range', () => {
    expect(validateMode('789')).toBe(false);
  });

  it('rejects a 5-digit numeric mode', () => {
    expect(validateMode('12345')).toBe(false);
  });

  it('rejects an empty mode', () => {
    expect(validateMode('')).toBe(false);
  });

  it('rejects shell injection in mode', () => {
    expect(validateMode('755; rm -rf /')).toBe(false);
  });

  it('rejects free-text "rwxr-xr-x" (ls -l output, not a mode)', () => {
    expect(validateMode('rwxr-xr-x')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(validateMode(null as unknown as string)).toBe(false);
  });
});

// ─── TC-CHM-02: validatePath ─────────────────────────────────────────────────

describe('TC-CHM-02: validatePath — path validation', () => {
  it('accepts an absolute path', () => {
    expect(validatePath('/etc/nginx/nginx.conf')).toBe(true);
  });

  it('accepts a relative path', () => {
    expect(validatePath('./build/output')).toBe(true);
  });

  it('accepts a path with spaces', () => {
    // chmod accepts paths with spaces because we pass them as a single
    // argv element to spawnSync — no shell word-splitting occurs.
    expect(validatePath('/tmp/path with spaces')).toBe(true);
  });

  it('rejects an empty path', () => {
    expect(validatePath('')).toBe(false);
  });

  it('rejects a path with a semicolon (shell injection)', () => {
    expect(validatePath('/tmp/foo; rm -rf /')).toBe(false);
  });

  it('rejects a path with a backtick', () => {
    expect(validatePath('/tmp/`whoami`')).toBe(false);
  });

  it('rejects a path with a dollar sign', () => {
    expect(validatePath('$HOME/.ssh')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(validatePath(undefined as unknown as string)).toBe(false);
  });
});

// ─── TC-CHM-03: pre-flight rejects bad paths ─────────────────────────────────

describe('TC-CHM-03: chmodPath — pre-flight rejects bad paths', () => {
  it('throws invalid-path for a path with shell injection', () => {
    let err: ChmodPathError | undefined;
    try {
      chmodPath({ path: '/tmp/x; rm -rf /', mode: '644' });
    } catch (e) {
      err = e as ChmodPathError;
    }
    expect(err).toBeInstanceOf(ChmodPathError);
    expect(err!.code).toBe('invalid-path');
  });

  it('throws invalid-path for an empty path', () => {
    let err: ChmodPathError | undefined;
    try {
      chmodPath({ path: '', mode: '644' });
    } catch (e) {
      err = e as ChmodPathError;
    }
    expect(err!.code).toBe('invalid-path');
  });
});

// ─── TC-CHM-04: pre-flight rejects bad modes ─────────────────────────────────

describe('TC-CHM-04: chmodPath — pre-flight rejects bad modes', () => {
  it('throws invalid-mode for a non-octal numeric form', () => {
    let err: ChmodPathError | undefined;
    try {
      chmodPath({ path: '/tmp/x', mode: '888' });
    } catch (e) {
      err = e as ChmodPathError;
    }
    expect(err).toBeInstanceOf(ChmodPathError);
    expect(err!.code).toBe('invalid-mode');
  });

  it('throws invalid-mode for free-text "rwxr-xr-x"', () => {
    let err: ChmodPathError | undefined;
    try {
      chmodPath({ path: '/tmp/x', mode: 'rwxr-xr-x' });
    } catch (e) {
      err = e as ChmodPathError;
    }
    expect(err!.code).toBe('invalid-mode');
  });

  it('path validation runs before mode validation (path error wins)', () => {
    let err: ChmodPathError | undefined;
    try {
      chmodPath({ path: ';bad', mode: 'bad-mode' });
    } catch (e) {
      err = e as ChmodPathError;
    }
    expect(err!.code).toBe('invalid-path');
  });
});

// ─── TC-CHM-05: successful execution ─────────────────────────────────────────

describe.skipIf(!chmodAvailable)(
  'TC-CHM-05: chmodPath — successful execution against a temp file',
  () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'chmod-path-test-'));
    const tmpFile = join(tmpDir, 'fixture.txt');
    writeFileSync(tmpFile, 'hello');

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('chmods a regular file with a numeric mode', () => {
      const result = chmodPath({ path: tmpFile, mode: '600' });
      expect(result.exit_code).toBe(0);
      const mode = statSync(tmpFile).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('chmods a regular file with a symbolic mode', () => {
      const result = chmodPath({ path: tmpFile, mode: 'u+x' });
      expect(result.exit_code).toBe(0);
      const mode = statSync(tmpFile).mode & 0o777;
      expect((mode & 0o100) !== 0).toBe(true);
    });
  },
);

// ─── TC-CHM-06: manifest sanity ──────────────────────────────────────────────

describe('TC-CHM-06: manifest is a well-formed F-05 manifest', () => {
  it('declares the permissions.modify action class', () => {
    expect(chmodPathManifest.action_class).toBe('permissions.modify');
  });

  it('declares risk_tier high to align with the registry default', () => {
    expect(chmodPathManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(chmodPathManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares path as the target_field', () => {
    expect(chmodPathManifest.target_field).toBe('path');
  });

  it('marks path and mode as required (recursive is optional)', () => {
    expect(chmodPathManifest.params['required']).toEqual(['path', 'mode']);
  });

  it('forbids additional properties on the params schema', () => {
    expect(chmodPathManifest.params['additionalProperties']).toBe(false);
  });
});

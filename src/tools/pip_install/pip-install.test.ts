/**
 * Unit tests for the pip_install tool.
 *
 * Test groups that exercise the actual `pip` binary are gated behind a
 * module-level availability probe so they are skipped gracefully on hosts
 * without pip.
 *
 * Test IDs:
 *   TC-PIP-01: validatePackageSpec — package spec validation
 *   TC-PIP-02: pipInstall — pre-flight validation logic
 *   TC-PIP-03: pipInstall — successful execution (requires pip)
 *   TC-PIP-04: pipInstall — error handling (non-zero exit codes)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validatePackageSpec, pipInstall, PipInstallError } from './pip-install.js';

// ─── Binary probe ─────────────────────────────────────────────────────────────

const pipAvailable =
  spawnSync('pip', ['--version'], { encoding: 'utf-8' }).status === 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pip-install-'));
}

// ─── TC-PIP-01: validatePackageSpec ──────────────────────────────────────────

describe('TC-PIP-01: validatePackageSpec — package spec validation', () => {
  // Valid specs
  it('accepts a bare package name', () => {
    expect(validatePackageSpec('requests')).toBe(true);
  });

  it('accepts a name with digits', () => {
    expect(validatePackageSpec('h2')).toBe(true);
  });

  it('accepts a name with hyphens', () => {
    expect(validatePackageSpec('my-package')).toBe(true);
  });

  it('accepts a name with underscores', () => {
    expect(validatePackageSpec('my_package')).toBe(true);
  });

  it('accepts a name with dots', () => {
    expect(validatePackageSpec('zope.interface')).toBe(true);
  });

  it('accepts an equality pin', () => {
    expect(validatePackageSpec('django==4.2.0')).toBe(true);
  });

  it('accepts a minimum version constraint', () => {
    expect(validatePackageSpec('flask>=2.0')).toBe(true);
  });

  it('accepts a maximum version constraint', () => {
    expect(validatePackageSpec('numpy<2.0')).toBe(true);
  });

  it('accepts a compatible release specifier', () => {
    expect(validatePackageSpec('sqlalchemy~=2.0')).toBe(true);
  });

  it('accepts a not-equal specifier', () => {
    expect(validatePackageSpec('boto3!=1.28.0')).toBe(true);
  });

  it('accepts multiple version clauses', () => {
    expect(validatePackageSpec('flask>=2.0,<3.0')).toBe(true);
  });

  it('accepts extras without version', () => {
    expect(validatePackageSpec('requests[security]')).toBe(true);
  });

  it('accepts extras with multiple items', () => {
    expect(validatePackageSpec('requests[security,socks]')).toBe(true);
  });

  it('accepts extras with version constraint', () => {
    expect(validatePackageSpec('requests[security]>=2.28.0')).toBe(true);
  });

  it('accepts a wildcard version', () => {
    expect(validatePackageSpec('flask==2.*')).toBe(true);
  });

  // Invalid specs
  it('rejects an empty string', () => {
    expect(validatePackageSpec('')).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(validatePackageSpec('   ')).toBe(false);
  });

  it('rejects a name starting with a hyphen', () => {
    expect(validatePackageSpec('-requests')).toBe(false);
  });

  it('rejects a name with shell metacharacters (semicolon)', () => {
    expect(validatePackageSpec('requests;version')).toBe(false);
  });

  it('rejects a name with spaces', () => {
    expect(validatePackageSpec('my package')).toBe(false);
  });

  it('rejects a name with a dollar sign', () => {
    expect(validatePackageSpec('$package')).toBe(false);
  });

  it('rejects a name with backticks', () => {
    expect(validatePackageSpec('`pkg`')).toBe(false);
  });

  it('returns false for non-string input (null cast)', () => {
    expect(validatePackageSpec(null as unknown as string)).toBe(false);
  });
});

// ─── TC-PIP-02: pipInstall — pre-flight validation ───────────────────────────

describe('TC-PIP-02: pipInstall — pre-flight validation logic', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws PipInstallError with code no-packages-specified when nothing is provided', () => {
    let err: PipInstallError | undefined;
    try {
      pipInstall({}, { cwd: dir });
    } catch (e) {
      err = e as PipInstallError;
    }
    expect(err).toBeInstanceOf(PipInstallError);
    expect(err!.code).toBe('no-packages-specified');
  });

  it('throws PipInstallError with code no-packages-specified for empty packages array', () => {
    let err: PipInstallError | undefined;
    try {
      pipInstall({ packages: [] }, { cwd: dir });
    } catch (e) {
      err = e as PipInstallError;
    }
    expect(err).toBeInstanceOf(PipInstallError);
    expect(err!.code).toBe('no-packages-specified');
  });

  it('throws PipInstallError with code invalid-package-spec for shell injection attempt', () => {
    let err: PipInstallError | undefined;
    try {
      pipInstall({ packages: ['requests; rm -rf /'] }, { cwd: dir });
    } catch (e) {
      err = e as PipInstallError;
    }
    expect(err).toBeInstanceOf(PipInstallError);
    expect(err!.code).toBe('invalid-package-spec');
  });

  it('throws PipInstallError with code invalid-package-spec for a name with spaces', () => {
    let err: PipInstallError | undefined;
    try {
      pipInstall({ packages: ['my package'] }, { cwd: dir });
    } catch (e) {
      err = e as PipInstallError;
    }
    expect(err).toBeInstanceOf(PipInstallError);
    expect(err!.code).toBe('invalid-package-spec');
  });

  it('error message includes the invalid spec', () => {
    let err: PipInstallError | undefined;
    try {
      pipInstall({ packages: ['bad spec!'] }, { cwd: dir });
    } catch (e) {
      err = e as PipInstallError;
    }
    expect(err!.message).toContain('bad spec!');
  });

  it('thrown error name is "PipInstallError"', () => {
    let err: PipInstallError | undefined;
    try {
      pipInstall({}, { cwd: dir });
    } catch (e) {
      err = e as PipInstallError;
    }
    expect(err!.name).toBe('PipInstallError');
  });

  it('throws PipInstallError with code requirements-file-not-found when file is absent', () => {
    let err: PipInstallError | undefined;
    try {
      pipInstall({ requirements: 'nonexistent-requirements.txt' }, { cwd: dir });
    } catch (e) {
      err = e as PipInstallError;
    }
    expect(err).toBeInstanceOf(PipInstallError);
    expect(err!.code).toBe('requirements-file-not-found');
  });

  it('error message includes the missing file path', () => {
    let err: PipInstallError | undefined;
    try {
      pipInstall({ requirements: 'missing.txt' }, { cwd: dir });
    } catch (e) {
      err = e as PipInstallError;
    }
    expect(err!.message).toContain('missing.txt');
  });

  it('PipInstallError code is one of the typed discriminants', () => {
    let err: PipInstallError | undefined;
    try {
      pipInstall({}, { cwd: dir });
    } catch (e) {
      err = e as PipInstallError;
    }
    const validCodes: Array<'invalid-package-spec' | 'requirements-file-not-found' | 'no-packages-specified'> =
      ['invalid-package-spec', 'requirements-file-not-found', 'no-packages-specified'];
    expect(validCodes).toContain(err!.code);
  });

  it('does not throw when a valid requirements file exists', () => {
    writeFileSync(join(dir, 'requirements.txt'), 'requests\n');
    // Throws only if pip is unavailable (status === null / non-zero), but
    // no PipInstallError should be raised for pre-flight.
    let preFlightErr: PipInstallError | undefined;
    try {
      pipInstall({ requirements: 'requirements.txt' }, { cwd: dir });
    } catch (e) {
      if (e instanceof PipInstallError) preFlightErr = e;
    }
    expect(preFlightErr).toBeUndefined();
  });

  it('does not throw PipInstallError for valid package specs', () => {
    let preFlightErr: PipInstallError | undefined;
    try {
      pipInstall({ packages: ['requests', 'flask>=2.0', 'django==4.2.0'] }, { cwd: dir });
    } catch (e) {
      if (e instanceof PipInstallError) preFlightErr = e;
    }
    expect(preFlightErr).toBeUndefined();
  });
});

// ─── TC-PIP-03: pipInstall — successful execution ────────────────────────────

describe.skipIf(!pipAvailable)('TC-PIP-03: pipInstall — successful execution', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns exit_code 0 when installing an already-installed package', () => {
    // pip itself is always available in this test group; installing pip is a
    // no-op that should return exit code 0.
    const result = pipInstall({ packages: ['pip'] }, { cwd: dir });
    expect(result.exit_code).toBe(0);
  });

  it('result has stdout, stderr, and exit_code fields', () => {
    const result = pipInstall({ packages: ['pip'] }, { cwd: dir });
    expect(Object.keys(result).sort()).toEqual(['exit_code', 'stderr', 'stdout'].sort());
  });

  it('stdout and stderr are strings', () => {
    const result = pipInstall({ packages: ['pip'] }, { cwd: dir });
    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });

  it('exit_code is a number', () => {
    const result = pipInstall({ packages: ['pip'] }, { cwd: dir });
    expect(typeof result.exit_code).toBe('number');
  });

  it('installs from requirements.txt without throwing', () => {
    writeFileSync(join(dir, 'requirements.txt'), 'pip\n');
    const result = pipInstall({ requirements: 'requirements.txt' }, { cwd: dir });
    expect(result.exit_code).toBe(0);
  });

  it('passes --upgrade flag without error', () => {
    const result = pipInstall({ packages: ['pip'], upgrade: true }, { cwd: dir });
    expect(typeof result.exit_code).toBe('number');
  });
});

// ─── TC-PIP-04: pipInstall — error handling ──────────────────────────────────

describe.skipIf(!pipAvailable)('TC-PIP-04: pipInstall — error handling', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns non-zero exit_code for a nonexistent package without throwing', () => {
    // A package name that does not exist on PyPI will cause pip to exit non-zero.
    // We use a deliberately invalid package name that passes our name validation
    // (valid PyPI name format) but does not exist on the index.
    const result = pipInstall(
      {
        packages: ['thisisapackagethatdoesnotexistatall99999999'],
        // Point to a local non-existent index so the test is fast and
        // deterministic without needing internet access.
        index_url: 'http://localhost:19999/simple',
      },
      { cwd: dir },
    );
    expect(result.exit_code).not.toBe(0);
  });

  it('does not throw for a non-zero pip exit code — returns exit_code instead', () => {
    let threw = false;
    try {
      pipInstall(
        {
          packages: ['thisisapackagethatdoesnotexistatall99999999'],
          index_url: 'http://localhost:19999/simple',
        },
        { cwd: dir },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

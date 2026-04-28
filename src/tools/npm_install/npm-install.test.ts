/**
 * Unit tests for the npm_install tool.
 *
 * Test groups that exercise the actual `npm` binary are gated behind a
 * module-level availability probe so they are skipped gracefully on hosts
 * without npm.
 *
 * Test IDs:
 *   TC-NI-01: validateNpmPackageSpec — package spec validation
 *   TC-NI-02: npmInstall — pre-flight validation logic
 *   TC-NI-03: npmInstall — successful execution (requires npm)
 *   TC-NI-04: npmInstall — error handling (requires npm)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateNpmPackageSpec, npmInstall, NpmInstallError } from './npm-install.js';

// ─── Binary probe ─────────────────────────────────────────────────────────────

const npmAvailable =
  spawnSync('npm', ['--version'], { encoding: 'utf-8' }).status === 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'npm-install-'));
}

function writePackageJson(dir: string, content: object = {}): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(content, null, 2));
}

// ─── TC-NI-01: validateNpmPackageSpec ─────────────────────────────────────────

describe('TC-NI-01: validateNpmPackageSpec — package spec validation', () => {
  // Valid specs — bare names
  it('accepts a bare package name', () => {
    expect(validateNpmPackageSpec('lodash')).toBe(true);
  });

  it('accepts a single-character package name', () => {
    expect(validateNpmPackageSpec('n')).toBe(true);
  });

  it('accepts a name with hyphens', () => {
    expect(validateNpmPackageSpec('my-package')).toBe(true);
  });

  it('accepts a name with underscores', () => {
    expect(validateNpmPackageSpec('my_package')).toBe(true);
  });

  it('accepts a name with digits', () => {
    expect(validateNpmPackageSpec('react18')).toBe(true);
  });

  it('accepts a name with dots', () => {
    expect(validateNpmPackageSpec('socket.io')).toBe(true);
  });

  // Valid specs — scoped packages
  it('accepts a scoped package', () => {
    expect(validateNpmPackageSpec('@types/node')).toBe(true);
  });

  it('accepts a scoped package with hyphens', () => {
    expect(validateNpmPackageSpec('@babel/core')).toBe(true);
  });

  it('accepts a scoped package with underscores', () => {
    expect(validateNpmPackageSpec('@my_org/my_package')).toBe(true);
  });

  // Valid specs — with version specifiers
  it('accepts a bare name with exact version', () => {
    expect(validateNpmPackageSpec('lodash@4.17.21')).toBe(true);
  });

  it('accepts a bare name with caret range', () => {
    expect(validateNpmPackageSpec('express@^4.0.0')).toBe(true);
  });

  it('accepts a bare name with tilde range', () => {
    expect(validateNpmPackageSpec('express@~4.18.0')).toBe(true);
  });

  it('accepts a bare name with greater-than comparator', () => {
    expect(validateNpmPackageSpec('lodash@>=4.0.0')).toBe(true);
  });

  it('accepts a bare name with latest tag', () => {
    expect(validateNpmPackageSpec('typescript@latest')).toBe(true);
  });

  it('accepts a bare name with beta tag', () => {
    expect(validateNpmPackageSpec('react@beta')).toBe(true);
  });

  it('accepts a bare name with wildcard version', () => {
    expect(validateNpmPackageSpec('lodash@*')).toBe(true);
  });

  it('accepts a major-only version shorthand', () => {
    expect(validateNpmPackageSpec('typescript@5')).toBe(true);
  });

  it('accepts a scoped package with exact version', () => {
    expect(validateNpmPackageSpec('@types/node@18.0.0')).toBe(true);
  });

  it('accepts a scoped package with caret range', () => {
    expect(validateNpmPackageSpec('@babel/core@^7.0.0')).toBe(true);
  });

  it('accepts a scoped package with latest tag', () => {
    expect(validateNpmPackageSpec('@types/node@latest')).toBe(true);
  });

  // Invalid specs
  it('rejects an empty string', () => {
    expect(validateNpmPackageSpec('')).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(validateNpmPackageSpec('   ')).toBe(false);
  });

  it('rejects a name with spaces', () => {
    expect(validateNpmPackageSpec('my package')).toBe(false);
  });

  it('rejects a name with a semicolon (shell injection)', () => {
    expect(validateNpmPackageSpec('lodash; rm -rf /')).toBe(false);
  });

  it('rejects a name with a backtick (shell injection)', () => {
    expect(validateNpmPackageSpec('pkg`cmd`')).toBe(false);
  });

  it('rejects a name with a dollar sign (shell injection)', () => {
    expect(validateNpmPackageSpec('$pkg')).toBe(false);
  });

  it('rejects a version with shell metacharacters', () => {
    expect(validateNpmPackageSpec('lodash@4.0.0; rm -rf /')).toBe(false);
  });

  it('rejects a version with backtick (shell injection)', () => {
    expect(validateNpmPackageSpec('lodash@`cmd`')).toBe(false);
  });

  it('rejects a malformed scoped package with no slash', () => {
    expect(validateNpmPackageSpec('@scope')).toBe(false);
  });

  it('rejects non-string input (null cast)', () => {
    expect(validateNpmPackageSpec(null as unknown as string)).toBe(false);
  });
});

// ─── TC-NI-02: npmInstall — pre-flight validation ─────────────────────────────

describe('TC-NI-02: npmInstall — pre-flight validation logic', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws NpmInstallError with code package-json-not-found when no packages and no package.json', () => {
    let err: NpmInstallError | undefined;
    try {
      npmInstall({}, { cwd: dir });
    } catch (e) {
      err = e as NpmInstallError;
    }
    expect(err).toBeInstanceOf(NpmInstallError);
    expect(err!.code).toBe('package-json-not-found');
  });

  it('throws NpmInstallError with code package-json-not-found for empty packages array and no package.json', () => {
    let err: NpmInstallError | undefined;
    try {
      npmInstall({ packages: [] }, { cwd: dir });
    } catch (e) {
      err = e as NpmInstallError;
    }
    expect(err).toBeInstanceOf(NpmInstallError);
    expect(err!.code).toBe('package-json-not-found');
  });

  it('error message includes the missing package.json path', () => {
    let err: NpmInstallError | undefined;
    try {
      npmInstall({}, { cwd: dir });
    } catch (e) {
      err = e as NpmInstallError;
    }
    expect(err!.message).toContain('package.json');
  });

  it('throws NpmInstallError with code invalid-package-spec for a name with spaces', () => {
    let err: NpmInstallError | undefined;
    try {
      npmInstall({ packages: ['my package'] }, { cwd: dir });
    } catch (e) {
      err = e as NpmInstallError;
    }
    expect(err).toBeInstanceOf(NpmInstallError);
    expect(err!.code).toBe('invalid-package-spec');
  });

  it('throws NpmInstallError with code invalid-package-spec for shell injection attempt', () => {
    let err: NpmInstallError | undefined;
    try {
      npmInstall({ packages: ['lodash; rm -rf /'] }, { cwd: dir });
    } catch (e) {
      err = e as NpmInstallError;
    }
    expect(err).toBeInstanceOf(NpmInstallError);
    expect(err!.code).toBe('invalid-package-spec');
  });

  it('error message includes the invalid spec', () => {
    let err: NpmInstallError | undefined;
    try {
      npmInstall({ packages: ['bad spec!'] }, { cwd: dir });
    } catch (e) {
      err = e as NpmInstallError;
    }
    expect(err!.message).toContain('bad spec!');
  });

  it('thrown error name is "NpmInstallError"', () => {
    let err: NpmInstallError | undefined;
    try {
      npmInstall({}, { cwd: dir });
    } catch (e) {
      err = e as NpmInstallError;
    }
    expect(err!.name).toBe('NpmInstallError');
  });

  it('NpmInstallError code is one of the typed discriminants', () => {
    let err: NpmInstallError | undefined;
    try {
      npmInstall({}, { cwd: dir });
    } catch (e) {
      err = e as NpmInstallError;
    }
    const validCodes: Array<'invalid-package-spec' | 'package-json-not-found'> = [
      'invalid-package-spec',
      'package-json-not-found',
    ];
    expect(validCodes).toContain(err!.code);
  });

  it('does not throw when package.json exists and no packages specified', () => {
    writePackageJson(dir, { name: 'test', version: '1.0.0' });
    // Pre-flight passes; actual npm may fail but no NpmInstallError is raised.
    let preFlightErr: NpmInstallError | undefined;
    try {
      npmInstall({}, { cwd: dir });
    } catch (e) {
      if (e instanceof NpmInstallError) preFlightErr = e;
    }
    expect(preFlightErr).toBeUndefined();
  });

  it('does not throw NpmInstallError for valid package specs', () => {
    let preFlightErr: NpmInstallError | undefined;
    try {
      npmInstall({ packages: ['lodash', 'typescript@5', '@types/node@latest'] }, { cwd: dir });
    } catch (e) {
      if (e instanceof NpmInstallError) preFlightErr = e;
    }
    expect(preFlightErr).toBeUndefined();
  });

  it('resolves working_dir relative to options.cwd', () => {
    // subdir does not have package.json — only dir does
    const subdir = 'subdir';
    writePackageJson(dir, { name: 'test', version: '1.0.0' });
    let preFlightErr: NpmInstallError | undefined;
    try {
      npmInstall({ working_dir: subdir }, { cwd: dir });
    } catch (e) {
      if (e instanceof NpmInstallError) preFlightErr = e;
    }
    // subdir/package.json does not exist → package-json-not-found
    expect(preFlightErr).toBeInstanceOf(NpmInstallError);
    expect(preFlightErr!.code).toBe('package-json-not-found');
  });
});

// ─── TC-NI-03: npmInstall — successful execution ──────────────────────────────

describe.skipIf(!npmAvailable)('TC-NI-03: npmInstall — successful execution', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns exit_code 0 when installing from a minimal package.json', () => {
    writePackageJson(dir, { name: 'test', version: '1.0.0', dependencies: {} });
    const result = npmInstall({}, { cwd: dir });
    expect(result.exit_code).toBe(0);
  });

  it('result has stdout, stderr, and exit_code fields', () => {
    writePackageJson(dir, { name: 'test', version: '1.0.0', dependencies: {} });
    const result = npmInstall({}, { cwd: dir });
    expect(Object.keys(result).sort()).toEqual(['exit_code', 'stderr', 'stdout'].sort());
  });

  it('stdout and stderr are strings', () => {
    writePackageJson(dir, { name: 'test', version: '1.0.0', dependencies: {} });
    const result = npmInstall({}, { cwd: dir });
    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });

  it('exit_code is a number', () => {
    writePackageJson(dir, { name: 'test', version: '1.0.0', dependencies: {} });
    const result = npmInstall({}, { cwd: dir });
    expect(typeof result.exit_code).toBe('number');
  });

  it('passes --package-lock-only flag without error', () => {
    writePackageJson(dir, { name: 'test', version: '1.0.0', dependencies: {} });
    const result = npmInstall({ flags: ['--package-lock-only'] }, { cwd: dir });
    expect(typeof result.exit_code).toBe('number');
  });
});

// ─── TC-NI-04: npmInstall — error handling ────────────────────────────────────

describe.skipIf(!npmAvailable)('TC-NI-04: npmInstall — error handling', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns non-zero exit_code for a nonexistent package without throwing', () => {
    // A package name that passes our validation but does not exist on the registry.
    // We point to a non-existent local registry so the test is fast and deterministic.
    const result = npmInstall(
      {
        packages: ['this-package-absolutely-does-not-exist-99999999'],
        flags: ['--registry', 'http://localhost:19999'],
      },
      { cwd: dir },
    );
    expect(result.exit_code).not.toBe(0);
  });

  it('does not throw for a non-zero npm exit code — returns exit_code instead', () => {
    let threw = false;
    try {
      npmInstall(
        {
          packages: ['this-package-absolutely-does-not-exist-99999999'],
          flags: ['--registry', 'http://localhost:19999'],
        },
        { cwd: dir },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

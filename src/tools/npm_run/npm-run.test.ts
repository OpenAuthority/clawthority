/**
 * Unit tests for the npm_run tool.
 *
 * Each test group uses temporary directories for isolation. Tests that
 * exercise the actual `npm` binary require it to be installed on the host.
 *
 * Test IDs:
 *   TC-NPM-01: parsePackageJsonScripts — script extraction
 *   TC-NPM-02: npmRun — script validation logic
 *   TC-NPM-03: npmRun — successful execution
 *   TC-NPM-04: npmRun — error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parsePackageJsonScripts, npmRun, NpmRunError } from './npm-run.js';

// ─── Binary availability gate ─────────────────────────────────────────────────

const npmAvailable = spawnSync('npm', ['--version'], { encoding: 'utf-8' }).status === 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'npm-run-'));
}

/** Write a package.json with the given scripts to the directory. */
function writePackageJson(dir: string, scripts: Record<string, string>): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'test-pkg', version: '1.0.0', scripts }),
  );
}

// ─── TC-NPM-01: parsePackageJsonScripts ──────────────────────────────────────

describe('TC-NPM-01: parsePackageJsonScripts — script extraction', () => {
  it('extracts a single script', () => {
    const content = JSON.stringify({ scripts: { build: 'tsc' } });
    const scripts = parsePackageJsonScripts(content);
    expect(scripts.has('build')).toBe(true);
  });

  it('extracts multiple scripts', () => {
    const content = JSON.stringify({ scripts: { build: 'tsc', test: 'vitest', lint: 'eslint .' } });
    const scripts = parsePackageJsonScripts(content);
    expect(scripts.has('build')).toBe(true);
    expect(scripts.has('test')).toBe(true);
    expect(scripts.has('lint')).toBe(true);
  });

  it('extracts scripts with hyphenated names', () => {
    const content = JSON.stringify({ scripts: { 'build:watch': 'tsc -w', 'test:coverage': 'vitest --coverage' } });
    const scripts = parsePackageJsonScripts(content);
    expect(scripts.has('build:watch')).toBe(true);
    expect(scripts.has('test:coverage')).toBe(true);
  });

  it('returns empty Set when scripts property is absent', () => {
    const content = JSON.stringify({ name: 'test-pkg', version: '1.0.0' });
    const scripts = parsePackageJsonScripts(content);
    expect(scripts.size).toBe(0);
  });

  it('returns empty Set for empty JSON object', () => {
    const scripts = parsePackageJsonScripts('{}');
    expect(scripts.size).toBe(0);
  });

  it('returns empty Set for invalid JSON', () => {
    const scripts = parsePackageJsonScripts('not valid json {{{');
    expect(scripts.size).toBe(0);
  });

  it('returns empty Set for empty string', () => {
    const scripts = parsePackageJsonScripts('');
    expect(scripts.size).toBe(0);
  });

  it('returns empty Set when scripts is null', () => {
    const content = JSON.stringify({ scripts: null });
    const scripts = parsePackageJsonScripts(content);
    expect(scripts.size).toBe(0);
  });

  it('returns a Set instance', () => {
    const content = JSON.stringify({ scripts: { build: 'tsc' } });
    const result = parsePackageJsonScripts(content);
    expect(result).toBeInstanceOf(Set);
  });

  it('handles package.json with no scripts key at root level', () => {
    const content = JSON.stringify({ name: 'pkg', dependencies: { lodash: '^4.0.0' } });
    const scripts = parsePackageJsonScripts(content);
    expect(scripts.size).toBe(0);
  });
});

// ─── TC-NPM-02: npmRun — script validation logic ─────────────────────────────

describe('TC-NPM-02: npmRun — script validation logic', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws NpmRunError with code package-json-not-found when package.json is absent', () => {
    let err: NpmRunError | undefined;
    try {
      npmRun({ script: 'build' }, { cwd: dir });
    } catch (e) {
      err = e as NpmRunError;
    }
    expect(err).toBeInstanceOf(NpmRunError);
    expect(err!.code).toBe('package-json-not-found');
  });

  it('thrown error name is "NpmRunError"', () => {
    let err: NpmRunError | undefined;
    try {
      npmRun({ script: 'build' }, { cwd: dir });
    } catch (e) {
      err = e as NpmRunError;
    }
    expect(err!.name).toBe('NpmRunError');
  });

  it('error message includes the path for missing package.json', () => {
    let err: NpmRunError | undefined;
    try {
      npmRun({ script: 'build' }, { cwd: dir });
    } catch (e) {
      err = e as NpmRunError;
    }
    expect(err!.message).toContain('package.json');
  });

  it('throws NpmRunError with code script-not-found when script is absent from package.json', () => {
    writePackageJson(dir, { build: 'tsc' });

    let err: NpmRunError | undefined;
    try {
      npmRun({ script: 'nonexistent' }, { cwd: dir });
    } catch (e) {
      err = e as NpmRunError;
    }
    expect(err).toBeInstanceOf(NpmRunError);
    expect(err!.code).toBe('script-not-found');
  });

  it('error message includes the missing script name', () => {
    writePackageJson(dir, { build: 'tsc' });

    let err: NpmRunError | undefined;
    try {
      npmRun({ script: 'missing-script' }, { cwd: dir });
    } catch (e) {
      err = e as NpmRunError;
    }
    expect(err!.message).toContain('missing-script');
  });

  it('error message includes known scripts when script is not found', () => {
    writePackageJson(dir, { build: 'tsc', test: 'vitest' });

    let err: NpmRunError | undefined;
    try {
      npmRun({ script: 'nonexistent' }, { cwd: dir });
    } catch (e) {
      err = e as NpmRunError;
    }
    expect(err!.message).toContain('build');
    expect(err!.message).toContain('test');
  });

  it('NpmRunError code is one of the typed discriminants', () => {
    let err: NpmRunError | undefined;
    try {
      npmRun({ script: 'build' }, { cwd: dir });
    } catch (e) {
      err = e as NpmRunError;
    }
    const validCodes: Array<'package-json-not-found' | 'script-not-found'> = [
      'package-json-not-found',
      'script-not-found',
    ];
    expect(validCodes).toContain(err!.code);
  });

  it('resolves working_dir relative to options.cwd', () => {
    // No package.json in dir/sub — should throw package-json-not-found
    let err: NpmRunError | undefined;
    try {
      npmRun({ script: 'build', working_dir: 'sub' }, { cwd: dir });
    } catch (e) {
      err = e as NpmRunError;
    }
    expect(err).toBeInstanceOf(NpmRunError);
    expect(err!.code).toBe('package-json-not-found');
  });
});

// ─── TC-NPM-03: npmRun — successful execution ────────────────────────────────

describe.skipIf(!npmAvailable)('TC-NPM-03: npmRun — successful execution', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns exit_code 0 on a successful script', () => {
    writePackageJson(dir, { greet: 'echo hello from npm' });

    const result = npmRun({ script: 'greet' }, { cwd: dir });

    expect(result.exit_code).toBe(0);
  });

  it('result has stdout, stderr, and exit_code fields', () => {
    writePackageJson(dir, { ok: 'node -e "process.exit(0)"' });

    const result = npmRun({ script: 'ok' }, { cwd: dir });

    expect(Object.keys(result).sort()).toEqual(['exit_code', 'stderr', 'stdout'].sort());
  });

  it('stdout and stderr are strings', () => {
    writePackageJson(dir, { ok: 'node -e "process.exit(0)"' });

    const result = npmRun({ script: 'ok' }, { cwd: dir });

    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });

  it('captures stdout from the script', () => {
    writePackageJson(dir, { greet: 'node -e "process.stdout.write(\'hello npm\')"' });

    const result = npmRun({ script: 'greet', silent: true }, { cwd: dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('hello npm');
  });

  it('passes --silent flag to suppress npm lifecycle output', () => {
    writePackageJson(dir, { quiet: 'node -e "process.exit(0)"' });

    const result = npmRun({ script: 'quiet', silent: true }, { cwd: dir });

    expect(result.exit_code).toBe(0);
  });

  it('passes args after -- to the script', () => {
    // With `node -e 'code'`, argv[1] is the first extra arg (no script-path slot),
    // so use slice(1) to capture all pass-through arguments.
    writePackageJson(dir, { echo: 'node -e "console.log(process.argv.slice(1).join(\' \'))"' });

    const result = npmRun({ script: 'echo', args: ['foo', 'bar'], silent: true }, { cwd: dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('foo');
    expect(result.stdout).toContain('bar');
  });

  it('supports working_dir parameter as absolute path', () => {
    const subDir = join(dir, 'sub');
    mkdirSync(subDir, { recursive: true });
    writePackageJson(subDir, { hello: 'node -e "process.exit(0)"' });

    const result = npmRun({ script: 'hello', working_dir: subDir }, { cwd: dir });

    expect(result.exit_code).toBe(0);
  });

  it('captures non-zero exit code for a failing script without throwing', () => {
    writePackageJson(dir, { fail: 'node -e "process.exit(42)"' });

    const result = npmRun({ script: 'fail' }, { cwd: dir });

    expect(result.exit_code).not.toBe(0);
  });
});

// ─── TC-NPM-04: npmRun — error handling ──────────────────────────────────────

describe.skipIf(!npmAvailable)('TC-NPM-04: npmRun — error handling', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not throw when npm exits non-zero — returns exit_code instead', () => {
    writePackageJson(dir, { fail: 'node -e "process.exit(1)"' });

    const result = npmRun({ script: 'fail' }, { cwd: dir });

    expect(result.exit_code).not.toBe(0);
  });

  it('NpmRunError for missing package.json includes the path in message', () => {
    let err: NpmRunError | undefined;
    try {
      npmRun({ script: 'build' }, { cwd: dir });
    } catch (e) {
      err = e as NpmRunError;
    }
    expect(err!.message).toContain(dir);
  });
});

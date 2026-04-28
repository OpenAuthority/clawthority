/**
 * Unit tests for the pytest tool.
 *
 * Test groups that exercise the actual `pytest` binary are gated behind a
 * module-level availability probe so they are skipped gracefully on hosts
 * without pytest.
 *
 * Test IDs:
 *   TC-PYT-01: runPytest — pre-flight validation logic
 *   TC-PYT-02: runPytest — successful execution (requires pytest)
 *   TC-PYT-03: runPytest — test discovery (requires pytest)
 *   TC-PYT-04: runPytest — error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPytest, PytestError } from './pytest.js';

// ─── Binary probe ─────────────────────────────────────────────────────────────

const pytestAvailable =
  spawnSync('pytest', ['--version'], { encoding: 'utf-8' }).status === 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pytest-tool-'));
}

/** Write a minimal Python test file to the directory. */
function writeTestFile(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content);
}

// ─── TC-PYT-01: runPytest — pre-flight validation logic ──────────────────────

describe('TC-PYT-01: runPytest — pre-flight validation logic', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws PytestError with code test-path-not-found for a nonexistent absolute path', () => {
    const missingPath = join(dir, 'nonexistent_test.py');

    let err: PytestError | undefined;
    try {
      runPytest({ test_paths: [missingPath] }, { cwd: dir });
    } catch (e) {
      err = e as PytestError;
    }

    expect(err).toBeInstanceOf(PytestError);
    expect(err!.code).toBe('test-path-not-found');
  });

  it('throws PytestError with code test-path-not-found for a nonexistent relative path', () => {
    let err: PytestError | undefined;
    try {
      runPytest({ test_paths: ['nonexistent_test.py'] }, { cwd: dir });
    } catch (e) {
      err = e as PytestError;
    }

    expect(err).toBeInstanceOf(PytestError);
    expect(err!.code).toBe('test-path-not-found');
  });

  it('error message includes the missing path', () => {
    let err: PytestError | undefined;
    try {
      runPytest({ test_paths: ['missing.py'] }, { cwd: dir });
    } catch (e) {
      err = e as PytestError;
    }

    expect(err!.message).toContain('missing.py');
  });

  it('thrown error name is "PytestError"', () => {
    let err: PytestError | undefined;
    try {
      runPytest({ test_paths: ['nonexistent.py'] }, { cwd: dir });
    } catch (e) {
      err = e as PytestError;
    }

    expect(err!.name).toBe('PytestError');
  });

  it('PytestError code is the typed discriminant', () => {
    let err: PytestError | undefined;
    try {
      runPytest({ test_paths: ['nonexistent.py'] }, { cwd: dir });
    } catch (e) {
      err = e as PytestError;
    }

    expect(err!.code).toBe('test-path-not-found');
  });

  it('does not throw PytestError when test_paths is omitted', () => {
    // No paths specified → no pre-flight check; pytest will run with no args.
    // May fail if pytest is not installed, but no PytestError should be raised.
    let preFlightErr: PytestError | undefined;
    try {
      runPytest({}, { cwd: dir });
    } catch (e) {
      if (e instanceof PytestError) preFlightErr = e;
    }

    expect(preFlightErr).toBeUndefined();
  });

  it('does not throw PytestError when test_paths is empty', () => {
    let preFlightErr: PytestError | undefined;
    try {
      runPytest({ test_paths: [] }, { cwd: dir });
    } catch (e) {
      if (e instanceof PytestError) preFlightErr = e;
    }

    expect(preFlightErr).toBeUndefined();
  });

  it('does not throw when test_paths references an existing file', () => {
    writeTestFile(dir, 'test_ok.py', 'def test_pass(): assert True\n');

    let preFlightErr: PytestError | undefined;
    try {
      runPytest({ test_paths: ['test_ok.py'] }, { cwd: dir });
    } catch (e) {
      if (e instanceof PytestError) preFlightErr = e;
    }

    expect(preFlightErr).toBeUndefined();
  });

  it('does not throw when test_paths references an existing directory', () => {
    const subDir = join(dir, 'tests');
    mkdirSync(subDir, { recursive: true });

    let preFlightErr: PytestError | undefined;
    try {
      runPytest({ test_paths: [subDir] }, { cwd: dir });
    } catch (e) {
      if (e instanceof PytestError) preFlightErr = e;
    }

    expect(preFlightErr).toBeUndefined();
  });

  it('throws on the first invalid path when multiple paths are given', () => {
    writeTestFile(dir, 'test_ok.py', 'def test_pass(): assert True\n');

    let err: PytestError | undefined;
    try {
      runPytest({ test_paths: ['test_ok.py', 'nonexistent.py'] }, { cwd: dir });
    } catch (e) {
      err = e as PytestError;
    }

    expect(err).toBeInstanceOf(PytestError);
    expect(err!.code).toBe('test-path-not-found');
  });

  it('resolves relative working_dir against options.cwd', () => {
    const subDir = join(dir, 'sub');
    mkdirSync(subDir, { recursive: true });

    // test_paths relative to sub/ — file does not exist there
    let err: PytestError | undefined;
    try {
      runPytest({ test_paths: ['nonexistent.py'], working_dir: 'sub' }, { cwd: dir });
    } catch (e) {
      err = e as PytestError;
    }

    expect(err).toBeInstanceOf(PytestError);
    expect(err!.code).toBe('test-path-not-found');
  });
});

// ─── TC-PYT-02: runPytest — successful execution ─────────────────────────────

describe.skipIf(!pytestAvailable)('TC-PYT-02: runPytest — successful execution', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns exit_code 0 when all tests pass', () => {
    writeTestFile(dir, 'test_pass.py', 'def test_always_pass():\n    assert 1 + 1 == 2\n');

    const result = runPytest({ test_paths: ['test_pass.py'] }, { cwd: dir });

    expect(result.exit_code).toBe(0);
  });

  it('result has stdout, stderr, and exit_code fields', () => {
    writeTestFile(dir, 'test_pass.py', 'def test_always_pass():\n    assert True\n');

    const result = runPytest({ test_paths: ['test_pass.py'] }, { cwd: dir });

    expect(Object.keys(result).sort()).toEqual(['exit_code', 'stderr', 'stdout'].sort());
  });

  it('stdout and stderr are strings', () => {
    writeTestFile(dir, 'test_pass.py', 'def test_always_pass():\n    assert True\n');

    const result = runPytest({ test_paths: ['test_pass.py'] }, { cwd: dir });

    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });

  it('exit_code is a number', () => {
    writeTestFile(dir, 'test_pass.py', 'def test_always_pass():\n    assert True\n');

    const result = runPytest({ test_paths: ['test_pass.py'] }, { cwd: dir });

    expect(typeof result.exit_code).toBe('number');
  });

  it('returns exit_code 1 when a test fails', () => {
    writeTestFile(dir, 'test_fail.py', 'def test_always_fail():\n    assert False\n');

    const result = runPytest({ test_paths: ['test_fail.py'] }, { cwd: dir });

    expect(result.exit_code).toBe(1);
  });

  it('does not throw when a test fails — returns exit_code instead', () => {
    writeTestFile(dir, 'test_fail.py', 'def test_always_fail():\n    assert False\n');

    let threw = false;
    try {
      runPytest({ test_paths: ['test_fail.py'] }, { cwd: dir });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
  });

  it('passes -v flag in verbose mode', () => {
    writeTestFile(dir, 'test_pass.py', 'def test_always_pass():\n    assert True\n');

    const result = runPytest({ test_paths: ['test_pass.py'], verbose: true }, { cwd: dir });

    expect(result.exit_code).toBe(0);
    // Verbose output includes PASSED marker
    expect(result.stdout).toMatch(/PASSED|passed/);
  });

  it('returns exit_code 5 when collect_only finds no tests in an empty directory', () => {
    // pytest exit code 5: no tests collected
    const result = runPytest({ collect_only: true }, { cwd: dir });

    expect(result.exit_code).toBe(5);
  });

  it('supports keyword expression to filter tests', () => {
    writeTestFile(
      dir,
      'test_mixed.py',
      'def test_alpha():\n    assert True\ndef test_beta():\n    assert True\n',
    );

    const result = runPytest(
      { test_paths: ['test_mixed.py'], keyword: 'alpha' },
      { cwd: dir },
    );

    expect(result.exit_code).toBe(0);
  });

  it('supports working_dir parameter as absolute path', () => {
    const subDir = join(dir, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeTestFile(subDir, 'test_sub.py', 'def test_sub():\n    assert True\n');

    const result = runPytest(
      { test_paths: ['test_sub.py'], working_dir: subDir },
      { cwd: dir },
    );

    expect(result.exit_code).toBe(0);
  });
});

// ─── TC-PYT-03: runPytest — test discovery ────────────────────────────────────

describe.skipIf(!pytestAvailable)('TC-PYT-03: runPytest — test discovery', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('collect_only returns exit_code 0 when tests are present', () => {
    writeTestFile(dir, 'test_found.py', 'def test_one():\n    assert True\n');

    const result = runPytest({ collect_only: true }, { cwd: dir });

    // Exit code 0 means tests were collected successfully
    expect(result.exit_code).toBe(0);
  });

  it('collect_only stdout includes test names', () => {
    writeTestFile(dir, 'test_found.py', 'def test_one():\n    assert True\n');

    const result = runPytest({ collect_only: true }, { cwd: dir });

    expect(result.stdout).toContain('test_one');
  });

  it('passes extra args to pytest', () => {
    writeTestFile(dir, 'test_pass.py', 'def test_always_pass():\n    assert True\n');

    const result = runPytest(
      { test_paths: ['test_pass.py'], args: ['--tb=short'] },
      { cwd: dir },
    );

    expect(result.exit_code).toBe(0);
  });
});

// ─── TC-PYT-04: runPytest — error handling ────────────────────────────────────

describe('TC-PYT-04: runPytest — error handling', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('result exit_code is a number even when pytest is not found', () => {
    // When pytest binary is absent, spawnSync returns status: null.
    // The implementation falls back to exit_code 1.
    const result = runPytest({}, { cwd: dir });

    expect(typeof result.exit_code).toBe('number');
  });

  it('result stdout and stderr are strings even when pytest is not found', () => {
    const result = runPytest({}, { cwd: dir });

    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });
});

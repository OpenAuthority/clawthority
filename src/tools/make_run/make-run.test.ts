/**
 * Unit tests for the make_run tool.
 *
 * Each test group uses temporary directories for isolation. Tests that
 * exercise the actual `make` binary require it to be installed on the host.
 *
 * Test IDs:
 *   TC-MKR-01: parseMakefileTargets — target extraction
 *   TC-MKR-02: makeRun — target validation logic
 *   TC-MKR-03: makeRun — successful execution
 *   TC-MKR-04: makeRun — error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseMakefileTargets, makeRun, MakeRunError } from './make-run.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'make-run-'));
}

/** Write a Makefile with the given content to the directory. */
function writeMakefile(dir: string, content: string): void {
  writeFileSync(join(dir, 'Makefile'), content);
}

// ─── TC-MKR-01: parseMakefileTargets ─────────────────────────────────────────

describe('TC-MKR-01: parseMakefileTargets — target extraction', () => {
  it('extracts a single target', () => {
    const content = 'build:\n\techo building\n';
    const targets = parseMakefileTargets(content);
    expect(targets.has('build')).toBe(true);
  });

  it('extracts multiple targets', () => {
    const content = 'build:\n\techo building\ntest:\n\techo testing\nclean:\n\trm -f *.o\n';
    const targets = parseMakefileTargets(content);
    expect(targets.has('build')).toBe(true);
    expect(targets.has('test')).toBe(true);
    expect(targets.has('clean')).toBe(true);
  });

  it('extracts targets with hyphen in name', () => {
    const content = 'run-tests:\n\tvitest\n';
    const targets = parseMakefileTargets(content);
    expect(targets.has('run-tests')).toBe(true);
  });

  it('extracts targets with underscore in name', () => {
    const content = 'run_all:\n\techo all\n';
    const targets = parseMakefileTargets(content);
    expect(targets.has('run_all')).toBe(true);
  });

  it('extracts targets with dependencies', () => {
    const content = 'build: deps\n\techo building\ndeps:\n\techo deps\n';
    const targets = parseMakefileTargets(content);
    expect(targets.has('build')).toBe(true);
    expect(targets.has('deps')).toBe(true);
  });

  it('does not extract .PHONY as a target', () => {
    const content = '.PHONY: build test\nbuild:\n\techo building\n';
    const targets = parseMakefileTargets(content);
    expect(targets.has('.PHONY')).toBe(false);
    expect(targets.has('build')).toBe(true);
  });

  it('does not extract pattern rules (%)', () => {
    const content = '%.o: %.c\n\t$(CC) -c $<\nbuild:\n\techo build\n';
    const targets = parseMakefileTargets(content);
    expect([...targets].some(t => t.includes('%'))).toBe(false);
    expect(targets.has('build')).toBe(true);
  });

  it('returns empty set for empty file', () => {
    const targets = parseMakefileTargets('');
    expect(targets.size).toBe(0);
  });

  it('ignores comment lines', () => {
    const content = '# This is a comment\nbuild:\n\techo build\n';
    const targets = parseMakefileTargets(content);
    expect(targets.has('build')).toBe(true);
  });

  it('returns a Set instance', () => {
    const content = 'build:\n\techo build\n';
    const result = parseMakefileTargets(content);
    expect(result).toBeInstanceOf(Set);
  });
});

// ─── TC-MKR-02: makeRun — target validation logic ─────────────────────────────

describe('TC-MKR-02: makeRun — target validation logic', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws MakeRunError with code makefile-not-found when Makefile is absent', () => {
    let err: MakeRunError | undefined;
    try {
      makeRun({ target: 'build', validate_target: true }, { cwd: dir });
    } catch (e) {
      err = e as MakeRunError;
    }
    expect(err).toBeInstanceOf(MakeRunError);
    expect(err!.code).toBe('makefile-not-found');
  });

  it('thrown error name is "MakeRunError"', () => {
    let err: MakeRunError | undefined;
    try {
      makeRun({ target: 'build', validate_target: true }, { cwd: dir });
    } catch (e) {
      err = e as MakeRunError;
    }
    expect(err!.name).toBe('MakeRunError');
  });

  it('throws MakeRunError with code target-not-found when target is absent from Makefile', () => {
    writeMakefile(dir, 'build:\n\techo building\n');

    let err: MakeRunError | undefined;
    try {
      makeRun({ target: 'nonexistent', validate_target: true }, { cwd: dir });
    } catch (e) {
      err = e as MakeRunError;
    }
    expect(err).toBeInstanceOf(MakeRunError);
    expect(err!.code).toBe('target-not-found');
  });

  it('error message includes the missing target name', () => {
    writeMakefile(dir, 'build:\n\techo building\n');

    let err: MakeRunError | undefined;
    try {
      makeRun({ target: 'missing-target', validate_target: true }, { cwd: dir });
    } catch (e) {
      err = e as MakeRunError;
    }
    expect(err!.message).toContain('missing-target');
  });

  it('error message includes known targets when target is not found', () => {
    writeMakefile(dir, 'build:\n\techo building\n');

    let err: MakeRunError | undefined;
    try {
      makeRun({ target: 'nonexistent', validate_target: true }, { cwd: dir });
    } catch (e) {
      err = e as MakeRunError;
    }
    expect(err!.message).toContain('build');
  });

  it('skips target validation when validate_target is false', () => {
    // No Makefile written — validation is skipped so it reaches make, which
    // exits non-zero. We get a result back (not a thrown MakeRunError).
    const result = makeRun(
      { target: 'anything', validate_target: false },
      { cwd: dir },
    );
    expect(result).toHaveProperty('exit_code');
    expect(typeof result.exit_code).toBe('number');
  });

  it('skips validation when target is undefined', () => {
    const result = makeRun({ validate_target: false }, { cwd: dir });
    expect(result).toHaveProperty('exit_code');
  });

  it('skips validation when target is empty string', () => {
    writeMakefile(dir, 'build:\n\techo building\n');
    // An empty target string should skip target validation even with validate_target: true.
    const result = makeRun({ target: '', validate_target: true }, { cwd: dir });
    expect(result).toHaveProperty('exit_code');
  });

  it('MakeRunError code is one of the typed discriminants', () => {
    let err: MakeRunError | undefined;
    try {
      makeRun({ target: 'build', validate_target: true }, { cwd: dir });
    } catch (e) {
      err = e as MakeRunError;
    }
    const validCodes: Array<'makefile-not-found' | 'target-not-found' | 'make-error'> = [
      'makefile-not-found',
      'target-not-found',
      'make-error',
    ];
    expect(validCodes).toContain(err!.code);
  });
});

// ─── TC-MKR-03: makeRun — successful execution ───────────────────────────────

describe('TC-MKR-03: makeRun — successful execution', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns stdout from a simple echo target', () => {
    writeMakefile(dir, 'greet:\n\t@echo hello from make\n');

    const result = makeRun({ target: 'greet' }, { cwd: dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('hello from make');
  });

  it('returns exit_code 0 on success', () => {
    writeMakefile(dir, 'ok:\n\t@true\n');

    const result = makeRun({ target: 'ok' }, { cwd: dir });

    expect(result.exit_code).toBe(0);
  });

  it('result has stdout, stderr, and exit_code fields', () => {
    writeMakefile(dir, 'ok:\n\t@true\n');

    const result = makeRun({ target: 'ok' }, { cwd: dir });

    expect(Object.keys(result).sort()).toEqual(['exit_code', 'stderr', 'stdout'].sort());
  });

  it('runs default target when target is omitted', () => {
    writeMakefile(dir, 'default:\n\t@echo default target\n');

    const result = makeRun({}, { cwd: dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('default target');
  });

  it('supports working_dir parameter as absolute path', () => {
    const subDir = join(dir, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'Makefile'), 'hello:\n\t@echo sub hello\n');

    const result = makeRun({ target: 'hello', working_dir: subDir }, { cwd: dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('sub hello');
  });

  it('stdout and stderr are strings', () => {
    writeMakefile(dir, 'ok:\n\t@true\n');

    const result = makeRun({ target: 'ok' }, { cwd: dir });

    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });

  it('passes -j flag for parallel jobs', () => {
    writeMakefile(dir, 'parallel:\n\t@echo parallel\n');

    const result = makeRun({ target: 'parallel', jobs: 4 }, { cwd: dir });

    expect(result.exit_code).toBe(0);
  });

  it('captures non-zero exit code for a failing target without throwing', () => {
    writeMakefile(dir, 'fail:\n\t@false\n');

    const result = makeRun({ target: 'fail' }, { cwd: dir });

    expect(result.exit_code).not.toBe(0);
  });

  it('uses custom Makefile path via makefile parameter', () => {
    const customPath = join(dir, 'Build.mk');
    writeFileSync(customPath, 'custom:\n\t@echo custom file\n');

    const result = makeRun(
      { target: 'custom', makefile: 'Build.mk', validate_target: false },
      { cwd: dir },
    );

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('custom file');
  });
});

// ─── TC-MKR-04: makeRun — error handling ──────────────────────────────────────

describe('TC-MKR-04: makeRun — error handling', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not throw when make exits non-zero — returns exit_code instead', () => {
    writeMakefile(dir, 'fail:\n\t@false\n');

    const result = makeRun({ target: 'fail' }, { cwd: dir });

    expect(result.exit_code).not.toBe(0);
  });

  it('MakeRunError for missing Makefile includes the path in message', () => {
    let err: MakeRunError | undefined;
    try {
      makeRun({ target: 'build', validate_target: true }, { cwd: dir });
    } catch (e) {
      err = e as MakeRunError;
    }
    expect(err!.message).toContain('Makefile');
  });
});

/**
 * Release readiness validator.
 *
 * Provides the `ReleaseValidator` class, which runs a structured exit checklist
 * against the project root directory to determine whether a release is ready to
 * ship. Two series of checks are performed:
 *
 *   DOD-1 through DOD-8 — Definition of Done criteria (structural gates)
 *   V-01  through V-12  — Verification criteria (config and doc spot-checks)
 *
 * Additional cross-cutting checks:
 *   - Migration guide publication (docs/migration-v2.md)
 *   - Spec alignment audit completion
 *   - Security review sign-off (docs/security-review-v2.md)
 *   - CHANGELOG format and release entry validation
 *
 * All checks are file-based and run without spawning sub-processes.
 *
 * @see docs/security-review-v2.md
 * @see CHANGELOG.md
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Result of a single release readiness check. */
export interface CheckResult {
  /** Check identifier, e.g. "DOD-1" or "V-01". */
  id: string;
  /** Short human-readable description of what was checked. */
  description: string;
  /** `true` when the check passed, `false` when it failed. */
  passed: boolean;
  /** Failure reason when `passed` is `false`. Omitted on success. */
  reason?: string;
}

/** Aggregated result from `ReleaseValidator.validate()`. */
export interface ReleaseValidationResult {
  /** `true` when all checks passed. */
  valid: boolean;
  /** Target release version that was validated against. */
  targetVersion: string;
  /** All checks in the order they were run (both passed and failed). */
  checks: CheckResult[];
  /** Subset of `checks` where `passed` is `false`. */
  failures: CheckResult[];
}

/** Input context for `ReleaseValidator.validate()`. */
export interface ReleaseValidationContext {
  /** Absolute path to the project root directory. */
  root: string;
  /** Target release version string, e.g. `"2.0.0"`. */
  targetVersion: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Reads a file relative to `root`, returning its contents or `null` if it does not exist. */
function readFile(root: string, relativePath: string): string | null {
  const fullPath = join(root, relativePath);
  if (!existsSync(fullPath)) return null;
  try {
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/** Returns `true` when a file exists relative to `root`. */
function fileExists(root: string, relativePath: string): boolean {
  return existsSync(join(root, relativePath));
}

// ─── ReleaseValidator ─────────────────────────────────────────────────────────

/**
 * Automated exit-checklist validator for release readiness.
 *
 * Runs DOD-1 through DOD-8 (Definition of Done) and V-01 through V-12
 * (Verification) checks against the project root directory. All checks are
 * purely file-based; no test commands are executed.
 *
 * @example
 * ```ts
 * const validator = new ReleaseValidator();
 * const result = validator.validate({ root: process.cwd(), targetVersion: '2.0.0' });
 * if (!result.valid) {
 *   for (const f of result.failures) {
 *     console.error(`[${f.id}] ${f.description}: ${f.reason}`);
 *   }
 * }
 * ```
 */
export class ReleaseValidator {
  /**
   * Runs all DOD and V-series checks against the given project root.
   *
   * @param context  Root directory and target version to validate against.
   * @returns        Aggregated `ReleaseValidationResult` with per-check details.
   */
  validate(context: ReleaseValidationContext): ReleaseValidationResult {
    const { root, targetVersion } = context;
    const checks: CheckResult[] = [
      ...this.runDodChecks(root, targetVersion),
      ...this.runVSeriesChecks(root, targetVersion),
    ];
    const failures = checks.filter((c) => !c.passed);
    return { valid: failures.length === 0, targetVersion, checks, failures };
  }

  // ─── DOD-1 through DOD-8 ───────────────────────────────────────────────────

  private runDodChecks(root: string, targetVersion: string): CheckResult[] {
    return [
      this.checkDod1(root),
      this.checkDod2(root),
      this.checkDod3(root),
      this.checkDod4(root, targetVersion),
      this.checkDod5(root),
      this.checkDod6(root),
      this.checkDod7(root),
      this.checkDod8(root),
    ];
  }

  /** DOD-1: Unit test configuration exists and targets src/**\/\*.test.ts */
  private checkDod1(root: string): CheckResult {
    const id = 'DOD-1';
    const description = 'Unit test configuration targets src/**/*.test.ts';
    const cfg = readFile(root, 'vitest.config.ts');
    if (cfg === null) {
      return { id, description, passed: false, reason: 'vitest.config.ts not found' };
    }
    if (!cfg.includes("'src/**/*.test.ts'") && !cfg.includes('"src/**/*.test.ts"')) {
      return {
        id,
        description,
        passed: false,
        reason: "vitest.config.ts does not include 'src/**/*.test.ts' in the test include glob",
      };
    }
    return { id, description, passed: true };
  }

  /** DOD-2: E2E test configuration exists */
  private checkDod2(root: string): CheckResult {
    const id = 'DOD-2';
    const description = 'E2E test configuration exists (vitest.e2e.config.ts)';
    if (!fileExists(root, 'vitest.e2e.config.ts')) {
      return { id, description, passed: false, reason: 'vitest.e2e.config.ts not found' };
    }
    return { id, description, passed: true };
  }

  /** DOD-3: Coverage thresholds declared in vitest.config.ts */
  private checkDod3(root: string): CheckResult {
    const id = 'DOD-3';
    const description = 'Coverage thresholds declared in vitest.config.ts';
    const cfg = readFile(root, 'vitest.config.ts');
    if (cfg === null) {
      return { id, description, passed: false, reason: 'vitest.config.ts not found' };
    }
    if (!cfg.includes('thresholds')) {
      return {
        id,
        description,
        passed: false,
        reason: 'vitest.config.ts does not declare a thresholds block',
      };
    }
    return { id, description, passed: true };
  }

  /** DOD-4: CHANGELOG contains a release entry for the target version */
  private checkDod4(root: string, targetVersion: string): CheckResult {
    const id = 'DOD-4';
    const description = `CHANGELOG contains a release entry for v${targetVersion}`;
    const changelog = readFile(root, 'CHANGELOG.md');
    if (changelog === null) {
      return { id, description, passed: false, reason: 'CHANGELOG.md not found' };
    }
    const releaseHeader = `## [${targetVersion}]`;
    if (!changelog.includes(releaseHeader)) {
      return {
        id,
        description,
        passed: false,
        reason: `CHANGELOG.md does not contain a "${releaseHeader}" release entry`,
      };
    }
    return { id, description, passed: true };
  }

  /** DOD-5: Migration guide published (docs/migration-v2.md) */
  private checkDod5(root: string): CheckResult {
    const id = 'DOD-5';
    const description = 'Migration guide published (docs/migration-v2.md)';
    if (!fileExists(root, 'docs/migration-v2.md')) {
      return {
        id,
        description,
        passed: false,
        reason: 'docs/migration-v2.md not found — migration guide must be published before release',
      };
    }
    return { id, description, passed: true };
  }

  /** DOD-6: Spec alignment audit completed */
  private checkDod6(root: string): CheckResult {
    const id = 'DOD-6';
    const description = 'Spec alignment audit completed';
    // Accept either a dedicated audit file or an inline annotation in contributing.md
    const auditFile = fileExists(root, 'docs/spec-alignment-audit.md');
    const contributing = readFile(root, 'docs/contributing.md');
    const contributingHasAudit =
      contributing !== null &&
      (contributing.includes('spec alignment audit') ||
        contributing.includes('spec-alignment-audit'));
    if (!auditFile && !contributingHasAudit) {
      return {
        id,
        description,
        passed: false,
        reason:
          'Spec alignment audit not found. Create docs/spec-alignment-audit.md or annotate docs/contributing.md.',
      };
    }
    return { id, description, passed: true };
  }

  /** DOD-7: Security review completed (docs/security-review-v2.md exists) */
  private checkDod7(root: string): CheckResult {
    const id = 'DOD-7';
    const description = 'Security review document exists (docs/security-review-v2.md)';
    if (!fileExists(root, 'docs/security-review-v2.md')) {
      return {
        id,
        description,
        passed: false,
        reason:
          'docs/security-review-v2.md not found — security review must be completed before release',
      };
    }
    return { id, description, passed: true };
  }

  /** DOD-8: No blocking items in the CHANGELOG [Unreleased] section */
  private checkDod8(root: string): CheckResult {
    const id = 'DOD-8';
    const description = 'No blocking items in CHANGELOG [Unreleased] section';
    const changelog = readFile(root, 'CHANGELOG.md');
    if (changelog === null) {
      return { id, description, passed: false, reason: 'CHANGELOG.md not found' };
    }
    // Extract the [Unreleased] section (content between "## [Unreleased]" and the next "## [")
    const unreleasedStart = changelog.indexOf('## [Unreleased]');
    if (unreleasedStart === -1) {
      return { id, description, passed: true };
    }
    const afterUnreleased = changelog.slice(unreleasedStart + '## [Unreleased]'.length);
    const nextSectionIdx = afterUnreleased.search(/\n## \[/);
    const unreleasedContent =
      nextSectionIdx === -1 ? afterUnreleased : afterUnreleased.slice(0, nextSectionIdx);
    if (unreleasedContent.includes('[BLOCKING]') || unreleasedContent.includes('[RELEASE BLOCKER]')) {
      return {
        id,
        description,
        passed: false,
        reason: 'CHANGELOG [Unreleased] section contains blocking items that must be resolved before release',
      };
    }
    return { id, description, passed: true };
  }

  // ─── V-01 through V-12 ─────────────────────────────────────────────────────

  private runVSeriesChecks(root: string, targetVersion: string): CheckResult[] {
    return [
      this.checkV01(root),
      this.checkV02(root),
      this.checkV03(root),
      this.checkV04(root),
      this.checkV05(root),
      this.checkV06(root),
      this.checkV07(root),
      this.checkV08(root),
      this.checkV09(root),
      this.checkV10(root),
      this.checkV11(root),
      this.checkV12(root, targetVersion),
    ];
  }

  /** V-01: TypeScript strict mode enabled in tsconfig.json */
  private checkV01(root: string): CheckResult {
    const id = 'V-01';
    const description = 'TypeScript strict mode enabled in tsconfig.json';
    const tsconfig = readFile(root, 'tsconfig.json');
    if (tsconfig === null) {
      return { id, description, passed: false, reason: 'tsconfig.json not found' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(tsconfig);
    } catch {
      return { id, description, passed: false, reason: 'tsconfig.json is not valid JSON' };
    }
    const compilerOptions =
      parsed !== null &&
      typeof parsed === 'object' &&
      'compilerOptions' in parsed
        ? (parsed as Record<string, unknown>)['compilerOptions']
        : undefined;
    if (
      typeof compilerOptions !== 'object' ||
      compilerOptions === null ||
      (compilerOptions as Record<string, unknown>)['strict'] !== true
    ) {
      return {
        id,
        description,
        passed: false,
        reason: 'tsconfig.json compilerOptions.strict is not true',
      };
    }
    return { id, description, passed: true };
  }

  /** V-02: No runtime child_process/execSync import in src/index.ts */
  private checkV02(root: string): CheckResult {
    const id = 'V-02';
    const description = 'No runtime child_process import in src/index.ts';
    const indexTs = readFile(root, 'src/index.ts');
    if (indexTs === null) {
      return { id, description, passed: false, reason: 'src/index.ts not found' };
    }
    if (indexTs.includes('child_process') || indexTs.includes('execSync')) {
      return {
        id,
        description,
        passed: false,
        reason:
          'src/index.ts imports child_process or execSync — runtime shell execution is forbidden (see CHANGELOG 1.1.2)',
      };
    }
    return { id, description, passed: true };
  }

  /** V-03: vitest.config.ts declares a thresholds block */
  private checkV03(root: string): CheckResult {
    const id = 'V-03';
    const description = 'vitest.config.ts declares a thresholds block';
    const cfg = readFile(root, 'vitest.config.ts');
    if (cfg === null) {
      return { id, description, passed: false, reason: 'vitest.config.ts not found' };
    }
    if (!cfg.includes('thresholds')) {
      return {
        id,
        description,
        passed: false,
        reason: "vitest.config.ts does not contain a 'thresholds' block",
      };
    }
    return { id, description, passed: true };
  }

  /** V-04: src/enforcement/** coverage threshold >= 95% lines */
  private checkV04(root: string): CheckResult {
    const id = 'V-04';
    const description = "src/enforcement/** coverage threshold >= 95% lines";
    return this.checkCoverageThreshold(root, id, description, "'src/enforcement/**'", 95);
  }

  /** V-05: src/hitl/** coverage threshold >= 88% lines */
  private checkV05(root: string): CheckResult {
    const id = 'V-05';
    const description = "src/hitl/** coverage threshold >= 88% lines";
    return this.checkCoverageThreshold(root, id, description, "'src/hitl/**'", 88);
  }

  /** V-06: src/policy/** coverage threshold >= 90% lines */
  private checkV06(root: string): CheckResult {
    const id = 'V-06';
    const description = "src/policy/** coverage threshold >= 90% lines";
    return this.checkCoverageThreshold(root, id, description, "'src/policy/**'", 90);
  }

  /** V-07: src/adapter/** coverage threshold >= 85% lines */
  private checkV07(root: string): CheckResult {
    const id = 'V-07';
    const description = "src/adapter/** coverage threshold >= 85% lines";
    return this.checkCoverageThreshold(root, id, description, "'src/adapter/**'", 85);
  }

  /** V-08: E2E config omits threshold gates (coverage is informational only) */
  private checkV08(root: string): CheckResult {
    const id = 'V-08';
    const description = 'E2E config (vitest.e2e.config.ts) omits threshold gates';
    const cfg = readFile(root, 'vitest.e2e.config.ts');
    if (cfg === null) {
      return { id, description, passed: false, reason: 'vitest.e2e.config.ts not found' };
    }
    if (cfg.includes('thresholds')) {
      return {
        id,
        description,
        passed: false,
        reason:
          'vitest.e2e.config.ts contains a thresholds block — E2E coverage must be informational only (no gates)',
      };
    }
    return { id, description, passed: true };
  }

  /** V-09: Security review document exists */
  private checkV09(root: string): CheckResult {
    const id = 'V-09';
    const description = 'Security review document exists (docs/security-review-v2.md)';
    if (!fileExists(root, 'docs/security-review-v2.md')) {
      return {
        id,
        description,
        passed: false,
        reason: 'docs/security-review-v2.md not found',
      };
    }
    return { id, description, passed: true };
  }

  /** V-10: No open critical security findings in security review */
  private checkV10(root: string): CheckResult {
    const id = 'V-10';
    const description = 'No open critical security findings in docs/security-review-v2.md';
    const review = readFile(root, 'docs/security-review-v2.md');
    if (review === null) {
      return {
        id,
        description,
        passed: false,
        reason: 'docs/security-review-v2.md not found',
      };
    }
    // Detect table rows with both "Critical" severity and "Open" status.
    // Finding rows follow the pattern: | F-NN | area | Critical | Open |
    const criticalOpenPattern = /\|\s*[A-Z]-\d+\s*\|[^|]*\|\s*Critical\s*\|\s*Open\s*\|/i;
    if (criticalOpenPattern.test(review)) {
      return {
        id,
        description,
        passed: false,
        reason:
          'docs/security-review-v2.md has at least one open critical security finding that must be resolved before release',
      };
    }
    return { id, description, passed: true };
  }

  /** V-11: CHANGELOG follows Keep a Changelog format */
  private checkV11(root: string): CheckResult {
    const id = 'V-11';
    const description = 'CHANGELOG.md follows Keep a Changelog format';
    const changelog = readFile(root, 'CHANGELOG.md');
    if (changelog === null) {
      return { id, description, passed: false, reason: 'CHANGELOG.md not found' };
    }
    const hasKeepAChangelog = changelog.includes('Keep a Changelog');
    const hasSemVer = changelog.includes('Semantic Versioning');
    if (!hasKeepAChangelog || !hasSemVer) {
      return {
        id,
        description,
        passed: false,
        reason:
          'CHANGELOG.md does not reference "Keep a Changelog" and "Semantic Versioning" — the format header is missing or non-compliant',
      };
    }
    return { id, description, passed: true };
  }

  /** V-12: package.json version matches the target release version */
  private checkV12(root: string, targetVersion: string): CheckResult {
    const id = 'V-12';
    const description = `package.json version matches target release version (${targetVersion})`;
    const pkgJson = readFile(root, 'package.json');
    if (pkgJson === null) {
      return { id, description, passed: false, reason: 'package.json not found' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(pkgJson);
    } catch {
      return { id, description, passed: false, reason: 'package.json is not valid JSON' };
    }
    const version =
      parsed !== null && typeof parsed === 'object' && 'version' in parsed
        ? (parsed as Record<string, unknown>)['version']
        : undefined;
    if (version !== targetVersion) {
      return {
        id,
        description,
        passed: false,
        reason: `package.json version is "${String(version)}" but expected "${targetVersion}"`,
      };
    }
    return { id, description, passed: true };
  }

  // ─── Shared helpers ────────────────────────────────────────────────────────

  /**
   * Checks that a vitest.config.ts coverage threshold for a given glob pattern
   * meets the required minimum lines percentage.
   */
  private checkCoverageThreshold(
    root: string,
    id: string,
    description: string,
    globPattern: string,
    minLines: number,
  ): CheckResult {
    const cfg = readFile(root, 'vitest.config.ts');
    if (cfg === null) {
      return { id, description, passed: false, reason: 'vitest.config.ts not found' };
    }
    const patternIdx = cfg.indexOf(globPattern);
    if (patternIdx === -1) {
      return {
        id,
        description,
        passed: false,
        reason: `vitest.config.ts does not declare a coverage threshold for ${globPattern}`,
      };
    }
    // Search for `lines: N` within the next 80 characters after the pattern
    const slice = cfg.slice(patternIdx, patternIdx + 80);
    const linesMatch = /lines:\s*(\d+)/.exec(slice);
    if (linesMatch === null) {
      return {
        id,
        description,
        passed: false,
        reason: `vitest.config.ts coverage block for ${globPattern} does not declare a lines threshold`,
      };
    }
    const declared = parseInt(linesMatch[1]!, 10);
    if (declared < minLines) {
      return {
        id,
        description,
        passed: false,
        reason: `vitest.config.ts declares lines: ${declared} for ${globPattern} but minimum is ${minLines}`,
      };
    }
    return { id, description, passed: true };
  }
}

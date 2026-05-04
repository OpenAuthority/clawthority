/**
 * Spec alignment validator.
 *
 * Validates the Clawthority plugin implementation against three spec sources:
 *
 *   FEP §2          — Typed Intent / ToolUseParams structure
 *                     (architecture.md §2 ExecutionEnvelope / Intent)
 *   FEP Shell       — Raw shell execution prohibition
 *                     (Universal Rule E-03: exec wrappers forbidden)
 *   Integration Spec — OpenClaw hook integration requirements
 *                     (architecture.md §10 + enforcement pipeline invariants)
 *
 * Check ID prefixes:
 *   SA-F-NN   FEP §2 typed Intent / ToolUseParams structure checks
 *   SA-S-NN   FEP raw shell prohibition checks
 *   SA-I-NN   Integration Spec checks
 *
 * All checks are purely file-based. No sub-processes are spawned.
 *
 * @see docs/architecture.md §2 ExecutionEnvelope
 * @see docs/architecture.md §10 OpenClaw Hook Integration
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Spec section that a check belongs to. */
export type SpecSection = 'FEP §2' | 'FEP Shell Prohibition' | 'Integration Spec';

/** Result of a single spec alignment check. */
export interface SpecCheckResult {
  /** Check identifier, e.g. "SA-F-01". */
  id: string;
  /** Short human-readable description of what was checked. */
  description: string;
  /** The spec section this check belongs to. */
  specSection: SpecSection;
  /** `true` when the check passed, `false` when it failed. */
  passed: boolean;
  /** Failure reason when `passed` is `false`. Omitted on success. */
  reason?: string;
}

/** Aggregated result from `SpecAlignmentValidator.validate()`. */
export interface SpecAlignmentResult {
  /** `true` when all checks passed (implementation is spec-compliant). */
  compliant: boolean;
  /** All checks in the order they were run. */
  checks: SpecCheckResult[];
  /** Subset of `checks` where `passed` is `false`. */
  failures: SpecCheckResult[];
  /** Numeric summary of the validation run. */
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

/** Input context for `SpecAlignmentValidator.validate()`. */
export interface SpecAlignmentContext {
  /** Absolute path to the project root directory. */
  root: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function readFile(root: string, relativePath: string): string | null {
  const fullPath = join(root, relativePath);
  if (!existsSync(fullPath)) return null;
  try {
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

function fileExists(root: string, relativePath: string): boolean {
  return existsSync(join(root, relativePath));
}

/**
 * Recursively collects all `.ts` source files under `srcDir`,
 * excluding `.test.ts` and `.e2e.ts` files (test/spec files).
 */
function collectSourceFiles(srcDir: string): string[] {
  const results: string[] = [];
  if (!existsSync(srcDir)) return results;

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(fullPath);
      } else if (
        entry.endsWith('.ts') &&
        !entry.endsWith('.test.ts') &&
        !entry.endsWith('.e2e.ts')
      ) {
        results.push(fullPath);
      }
    }
  }

  walk(srcDir);
  return results;
}

// ─── SpecAlignmentValidator ───────────────────────────────────────────────────

/**
 * Validates the Clawthority plugin implementation against FEP §2,
 * shell prohibition, and Integration Spec requirements.
 *
 * @example
 * ```ts
 * const validator = new SpecAlignmentValidator();
 * const result = validator.validate({ root: process.cwd() });
 * if (!result.compliant) {
 *   console.error(validator.generateReport(result));
 *   process.exit(1);
 * }
 * ```
 */
export class SpecAlignmentValidator {
  /**
   * Runs all spec alignment checks against the given project root.
   *
   * @param context  Root directory to validate.
   * @returns        Aggregated `SpecAlignmentResult` with per-check details.
   */
  validate(context: SpecAlignmentContext): SpecAlignmentResult {
    const { root } = context;
    const checks: SpecCheckResult[] = [
      ...this.runFepSection2Checks(root),
      ...this.runShellProhibitionChecks(root),
      ...this.runIntegrationSpecChecks(root),
    ];
    const failures = checks.filter((c) => !c.passed);
    return {
      compliant: failures.length === 0,
      checks,
      failures,
      summary: {
        total: checks.length,
        passed: checks.filter((c) => c.passed).length,
        failed: failures.length,
      },
    };
  }

  /**
   * Formats a `SpecAlignmentResult` as a human-readable compliance report.
   *
   * @param result  Result from `validate()`.
   * @returns       Multi-line report string suitable for CI output.
   */
  generateReport(result: SpecAlignmentResult): string {
    const lines: string[] = [];
    const border = '═'.repeat(54);
    const divider = '─'.repeat(54);

    lines.push('Spec Alignment Compliance Report');
    lines.push(border);
    lines.push('');

    const sections: SpecSection[] = ['FEP §2', 'FEP Shell Prohibition', 'Integration Spec'];
    for (const section of sections) {
      const sectionChecks = result.checks.filter((c) => c.specSection === section);
      if (sectionChecks.length === 0) continue;

      lines.push(section);
      lines.push(divider);
      for (const check of sectionChecks) {
        const status = check.passed ? '[PASS]' : '[FAIL]';
        const line = `  ${status} ${check.id.padEnd(8)} ${check.description}`;
        lines.push(line);
        if (!check.passed && check.reason !== undefined) {
          lines.push(`           ↳ ${check.reason}`);
        }
      }
      lines.push('');
    }

    lines.push(border);
    const { total, passed, failed } = result.summary;
    if (result.compliant) {
      lines.push(`Result: ${passed}/${total} checks passed — COMPLIANT`);
    } else {
      lines.push(`Result: ${failed}/${total} checks FAILED — NON-COMPLIANT`);
      lines.push('');
      lines.push('Failures:');
      for (const f of result.failures) {
        lines.push(`  [${f.id}] ${f.description}`);
        if (f.reason !== undefined) {
          lines.push(`        ${f.reason}`);
        }
      }
    }

    return lines.join('\n');
  }

  // ─── FEP §2 — Intent / ToolUseParams Structure ────────────────────────────

  private runFepSection2Checks(root: string): SpecCheckResult[] {
    return [
      this.checkSaF01(root),
      this.checkSaF02(root),
      this.checkSaF03(root),
      this.checkSaF04(root),
      this.checkSaF05(root),
      this.checkSaF06(root),
      this.checkSaF07(root),
      this.checkSaF08(root),
    ];
  }

  /** SA-F-01: src/types.ts exists */
  private checkSaF01(root: string): SpecCheckResult {
    const id = 'SA-F-01';
    const description = 'src/types.ts exists';
    const section: SpecSection = 'FEP §2';
    if (!fileExists(root, 'src/types.ts')) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'src/types.ts not found — FEP §2 requires a central types file',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-F-02: Intent interface is exported from src/types.ts */
  private checkSaF02(root: string): SpecCheckResult {
    const id = 'SA-F-02';
    const description = 'Intent interface exported from src/types.ts';
    const section: SpecSection = 'FEP §2';
    const types = readFile(root, 'src/types.ts');
    if (types === null) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'src/types.ts not found',
      };
    }
    if (!/export\s+interface\s+Intent\b/.test(types)) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          'src/types.ts does not export an Intent interface (FEP §2 requires typed Intent)',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-F-03: Intent.action_class field declared as string */
  private checkSaF03(root: string): SpecCheckResult {
    const id = 'SA-F-03';
    const description = 'Intent.action_class field declared as string';
    const section: SpecSection = 'FEP §2';
    const types = readFile(root, 'src/types.ts');
    if (types === null) {
      return { id, description, specSection: section, passed: false, reason: 'src/types.ts not found' };
    }
    if (!/action_class\s*:\s*string\b/.test(types)) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'Intent.action_class is not declared as string in src/types.ts',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-F-04: Intent.target field declared as string */
  private checkSaF04(root: string): SpecCheckResult {
    const id = 'SA-F-04';
    const description = 'Intent.target field declared as string';
    const section: SpecSection = 'FEP §2';
    const types = readFile(root, 'src/types.ts');
    if (types === null) {
      return { id, description, specSection: section, passed: false, reason: 'src/types.ts not found' };
    }
    if (!/\btarget\s*:\s*string\b/.test(types)) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'Intent.target is not declared as string in src/types.ts',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-F-05: Intent.summary field declared as string */
  private checkSaF05(root: string): SpecCheckResult {
    const id = 'SA-F-05';
    const description = 'Intent.summary field declared as string';
    const section: SpecSection = 'FEP §2';
    const types = readFile(root, 'src/types.ts');
    if (types === null) {
      return { id, description, specSection: section, passed: false, reason: 'src/types.ts not found' };
    }
    if (!/\bsummary\s*:\s*string\b/.test(types)) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'Intent.summary is not declared as string in src/types.ts',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-F-06: Intent.payload_hash field declared as string (SHA-256 binding) */
  private checkSaF06(root: string): SpecCheckResult {
    const id = 'SA-F-06';
    const description = 'Intent.payload_hash field declared as string';
    const section: SpecSection = 'FEP §2';
    const types = readFile(root, 'src/types.ts');
    if (types === null) {
      return { id, description, specSection: section, passed: false, reason: 'src/types.ts not found' };
    }
    if (!/payload_hash\s*:\s*string\b/.test(types)) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          'Intent.payload_hash is not declared as string — FEP §2 requires SHA-256 binding via typed payload_hash',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-F-07: Intent.parameters typed as Record<string, unknown> (not any) */
  private checkSaF07(root: string): SpecCheckResult {
    const id = 'SA-F-07';
    const description = 'Intent.parameters typed as Record<string, unknown>';
    const section: SpecSection = 'FEP §2';
    const types = readFile(root, 'src/types.ts');
    if (types === null) {
      return { id, description, specSection: section, passed: false, reason: 'src/types.ts not found' };
    }
    if (!/parameters\s*:\s*Record<string,\s*unknown>/.test(types)) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          'Intent.parameters is not typed as Record<string, unknown> — FEP §2 prohibits untyped (any) ToolUseParams',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-F-08: ExecutionEnvelope wraps Intent type */
  private checkSaF08(root: string): SpecCheckResult {
    const id = 'SA-F-08';
    const description = 'ExecutionEnvelope wraps Intent type';
    const section: SpecSection = 'FEP §2';
    const types = readFile(root, 'src/types.ts');
    if (types === null) {
      return { id, description, specSection: section, passed: false, reason: 'src/types.ts not found' };
    }
    if (!/export\s+interface\s+ExecutionEnvelope\b/.test(types)) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'ExecutionEnvelope interface not found in src/types.ts',
      };
    }
    if (!/\bintent\s*:\s*Intent\b/.test(types)) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          'ExecutionEnvelope does not declare an intent: Intent field — FEP §2 requires envelope to wrap Intent',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  // ─── FEP Shell Prohibition ────────────────────────────────────────────────

  private runShellProhibitionChecks(root: string): SpecCheckResult[] {
    return [
      this.checkSaS01(root),
      this.checkSaS02(root),
    ];
  }

  /**
   * Paths allowed to use node:child_process / spawnSync for SA-S-01 and
   * SA-S-02. FEP's shell-prohibition targets *unstructured* shell execution
   * (command injection surface). Entries here fall into three categories:
   *
   *   1. Safe-pattern exec — external binaries invoked with explicit argv
   *      arrays and `{ shell: false }`, no command-injection surface.
   *   2. Meta-level validators/build scripts that must reference the
   *      forbidden API names as data to detect them in other files.
   *   3. Designed escape hatches — single, audited, HITL-gated tools whose
   *      documented purpose is exactly to provide controlled shell access
   *      when all other mechanisms fail. These are opt-in via env var,
   *      payload-bound at the pipeline layer, and must be reviewed on
   *      every code change. Adding a new entry to this bucket requires an
   *      RFC per docs/rfc/README.md.
   */
  private static readonly CHILD_PROCESS_ALLOWLIST: readonly RegExp[] = [
    // Git tools: spawnSync('git', [argv], { shell: false }) — explicit argv,
    // no shell interpretation.
    /^src\/tools\/git_[a-z]+\/git-[a-z]+\.ts$/,
    // Typed package/build tool wrappers: spawnSync with an explicit argv
    // array and no shell. Same safe-pattern category as git_* — each tool
    // invokes a single fixed external binary (npm, pip, make, docker, pytest)
    // with structured arguments derived from typed parameters.
    /^src\/tools\/(?:npm_install|npm_run|pip_install|make_run|docker_run|pytest)\/[a-z-]+\.ts$/,
    // v1.3.2 typed-tool wrappers for high-risk admin commands. Same safe-
    // pattern category as the package/build wrappers above: each tool
    // invokes a single fixed external binary (systemctl, reboot, shutdown,
    // chmod, chown, kill, pkill, kubectl, docker, crontab) with explicit
    // argv arrays and { shell: false }. Pre-flight validators reject shell
    // metacharacters at the parameter level. See docs/release-plans/v1.3.2.md.
    /^src\/tools\/(?:systemctl_unit_action|reboot|shutdown|chmod_path|chown_path|kill_process|pkill_pattern|kubectl_apply|kubectl_get|kubectl_delete|kubectl_rollout|docker_push|crontab_list|crontab_install_from_file|crontab_remove)\/[a-z-]+\.ts$/,
    // Meta-level validators that must reference the forbidden API names
    // as strings/regex sources to detect them in other files.
    /^src\/validation\/spec-alignment-validator\.ts$/,
    // Designed escape hatch (CS-11): unsafe_admin_exec is the sole opt-in
    // path for controlled shell execution. Inert unless
    // CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC=1, always HITL-gated, always
    // audit-logged with justification, capability bound to the exact
    // command string via SHA-256 payload hash at pipeline Stage 1.
    /^src\/tools\/unsafe_admin_exec\/unsafe-admin-exec\.ts$/,
  ];

  private static isAllowlisted(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/');
    return SpecAlignmentValidator.CHILD_PROCESS_ALLOWLIST.some((re) => re.test(normalized));
  }

  /**
   * SA-S-01: No child_process imports in src/ non-test source files.
   *
   * Scans for actual `import` or `require` statements pulling in
   * `child_process` (or `node:child_process`). Mere string mentions in
   * comments or string literals do NOT count as violations — those arise
   * naturally in documentation and meta-level validators.
   *
   * Files matching CHILD_PROCESS_ALLOWLIST are exempt (see its docstring).
   */
  private checkSaS01(root: string): SpecCheckResult {
    const id = 'SA-S-01';
    const description = 'No child_process imports in src/ source files';
    const section: SpecSection = 'FEP Shell Prohibition';

    const srcDir = join(root, 'src');
    const sourceFiles = collectSourceFiles(srcDir);
    const violations: string[] = [];
    // Real import forms: `import ... from 'child_process'` / `'node:child_process'`
    // and `require('child_process')` / `require('node:child_process')`.
    const importPattern =
      /(?:import[^'"]*from\s*['"](?:node:)?child_process['"]|require\s*\(\s*['"](?:node:)?child_process['"]\s*\))/;

    for (const filePath of sourceFiles) {
      const rel = (filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath)
        .replace(/\\/g, '/');
      if (SpecAlignmentValidator.isAllowlisted(rel)) continue;

      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      if (importPattern.test(content)) {
        violations.push(rel);
      }
    }

    if (violations.length > 0) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: `child_process imported in: ${violations.join(', ')} — FEP prohibits raw shell execution in plugin source`,
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /**
   * SA-S-02: No execSync / spawnSync calls in src/ non-test source files.
   *
   * Detects runtime shell-execution API calls. Files matching
   * CHILD_PROCESS_ALLOWLIST are exempt (see its docstring).
   */
  private checkSaS02(root: string): SpecCheckResult {
    const id = 'SA-S-02';
    const description = 'No execSync / spawnSync / exec calls in src/ source files';
    const section: SpecSection = 'FEP Shell Prohibition';

    const srcDir = join(root, 'src');
    const sourceFiles = collectSourceFiles(srcDir);
    const violations: string[] = [];
    const forbiddenPattern = /\b(execSync|spawnSync)\s*\(/;

    for (const filePath of sourceFiles) {
      const rel = (filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath)
        .replace(/\\/g, '/');
      if (SpecAlignmentValidator.isAllowlisted(rel)) continue;

      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      if (forbiddenPattern.test(content)) {
        violations.push(rel);
      }
    }

    if (violations.length > 0) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: `execSync/spawnSync found in: ${violations.join(', ')} — FEP prohibits raw shell execution in plugin source`,
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  // ─── Integration Spec ─────────────────────────────────────────────────────

  private runIntegrationSpecChecks(root: string): SpecCheckResult[] {
    return [
      this.checkSaI01(root),
      this.checkSaI02(root),
      this.checkSaI03(root),
      this.checkSaI04(root),
      this.checkSaI05(root),
      this.checkSaI06(root),
      this.checkSaI07(root),
    ];
  }

  /** SA-I-01: normalize_action function exists in src/enforcement/normalize.ts */
  private checkSaI01(root: string): SpecCheckResult {
    const id = 'SA-I-01';
    const description = 'normalize_action function in src/enforcement/normalize.ts';
    const section: SpecSection = 'Integration Spec';

    if (!fileExists(root, 'src/enforcement/normalize.ts')) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'src/enforcement/normalize.ts not found — Integration Spec requires action normalization layer',
      };
    }
    const normalize = readFile(root, 'src/enforcement/normalize.ts');
    if (normalize === null || !/\bnormalize_action\b/.test(normalize)) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          'normalize_action function not found in src/enforcement/normalize.ts — Integration Spec requires this entry point',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-I-02: Stage 1 capability gate file exists */
  private checkSaI02(root: string): SpecCheckResult {
    const id = 'SA-I-02';
    const description = 'Stage 1 capability gate file exists (src/enforcement/stage1-capability.ts)';
    const section: SpecSection = 'Integration Spec';

    if (!fileExists(root, 'src/enforcement/stage1-capability.ts')) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          'src/enforcement/stage1-capability.ts not found — Integration Spec requires two-stage pipeline with Stage 1 capability gate',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-I-03: Stage 2 policy evaluation file exists */
  private checkSaI03(root: string): SpecCheckResult {
    const id = 'SA-I-03';
    const description = 'Stage 2 policy evaluation file exists (src/enforcement/stage2-policy.ts)';
    const section: SpecSection = 'Integration Spec';

    if (!fileExists(root, 'src/enforcement/stage2-policy.ts')) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          'src/enforcement/stage2-policy.ts not found — Integration Spec requires two-stage pipeline with Stage 2 policy evaluation',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-I-04: IAuthorityAdapter interface in src/adapter/types.ts */
  private checkSaI04(root: string): SpecCheckResult {
    const id = 'SA-I-04';
    const description = 'IAuthorityAdapter interface in src/adapter/types.ts';
    const section: SpecSection = 'Integration Spec';

    const adapterTypes = readFile(root, 'src/adapter/types.ts');
    if (adapterTypes === null) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'src/adapter/types.ts not found — Integration Spec requires IAuthorityAdapter abstraction',
      };
    }
    if (!/export\s+interface\s+IAuthorityAdapter\b/.test(adapterTypes)) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          'IAuthorityAdapter interface not exported from src/adapter/types.ts — Integration Spec requires adapter abstraction',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-I-05: HITL approval manager exists (src/hitl/approval-manager.ts) */
  private checkSaI05(root: string): SpecCheckResult {
    const id = 'SA-I-05';
    const description = 'HITL approval manager exists (src/hitl/approval-manager.ts)';
    const section: SpecSection = 'Integration Spec';

    if (!fileExists(root, 'src/hitl/approval-manager.ts')) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          'src/hitl/approval-manager.ts not found — Integration Spec requires Human-in-the-Loop approval system',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /** SA-I-06: @openclaw/action-registry declared in package.json dependencies */
  private checkSaI06(root: string): SpecCheckResult {
    const id = 'SA-I-06';
    const description = '@openclaw/action-registry in package.json dependencies';
    const section: SpecSection = 'Integration Spec';

    const pkgJson = readFile(root, 'package.json');
    if (pkgJson === null) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'package.json not found',
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(pkgJson);
    } catch {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'package.json is not valid JSON',
      };
    }
    const deps =
      parsed !== null && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)['dependencies']
        : undefined;
    const hasDep =
      deps !== null &&
      typeof deps === 'object' &&
      deps !== undefined &&
      '@openclaw/action-registry' in (deps as Record<string, unknown>);
    if (!hasDep) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          '@openclaw/action-registry not declared in package.json dependencies — Integration Spec requires the shared action taxonomy package',
      };
    }
    return { id, description, specSection: section, passed: true };
  }

  /**
   * SA-I-07: Fail-closed guarantee — unknown_sensitive_action referenced in
   *          src/enforcement/normalize.ts.
   *
   * The Integration Spec requires that unknown tool names resolve to
   * `unknown_sensitive_action` (critical risk, per_request HITL) rather than
   * silently permitting them.
   */
  private checkSaI07(root: string): SpecCheckResult {
    const id = 'SA-I-07';
    const description = 'Fail-closed: unknown_sensitive_action in src/enforcement/normalize.ts';
    const section: SpecSection = 'Integration Spec';

    const normalize = readFile(root, 'src/enforcement/normalize.ts');
    if (normalize === null) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason: 'src/enforcement/normalize.ts not found',
      };
    }
    if (!normalize.includes('unknown_sensitive_action')) {
      return {
        id,
        description,
        specSection: section,
        passed: false,
        reason:
          'unknown_sensitive_action not referenced in src/enforcement/normalize.ts — Integration Spec requires fail-closed catch-all for unknown tools',
      };
    }
    return { id, description, specSection: section, passed: true };
  }
}

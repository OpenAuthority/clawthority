/**
 * No-exec regression contract test.
 *
 * Prevents regression to generic shell.exec in the reference SKILL.md
 * manifests under examples/skills/ by asserting none declare
 * `action_class: shell.exec` without a valid `unsafe_legacy` exception with
 * an active (future) deadline.
 *
 * Test IDs:
 *   TC-NER-01: Frontmatter extraction — parses YAML between --- delimiters
 *   TC-NER-02: Exec detection — flags shell.exec without unsafe_legacy
 *   TC-NER-03: unsafe_legacy validation — requires active (future) deadline
 *   TC-NER-04: Contract — all reference skill manifests pass
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// ─── Path resolution ───────────────────────────────────────────────────────────

const _dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(_dirname, '../..');
const SKILLS_DIR = join(REPO_ROOT, 'examples', 'skills');
const MANIFEST_FILENAME = 'SKILL.md';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ExecViolation {
  /** Relative path to the manifest file containing the violation. */
  file: string;
  /** Human-readable description of the violation. */
  message: string;
}

interface ExecCheckResult {
  valid: boolean;
  violations: ExecViolation[];
}

// ─── Manifest parsing helpers ──────────────────────────────────────────────────

/**
 * Extracts parsed YAML frontmatter from a SKILL.md file.
 * Returns `null` if no frontmatter block is present or parsing fails.
 */
function extractFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return null;
  try {
    const parsed = parseYaml(match[1]);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the deadline string from an `unsafe_legacy` field value.
 *
 * Supports two forms:
 *   - String:  `unsafe_legacy: "2026-12-31"`
 *   - Object:  `unsafe_legacy: { deadline: "2026-12-31", reason: "..." }`
 *
 * Returns `null` when no deadline can be found.
 */
function extractUnsafeLegacyDeadline(unsafeLegacy: unknown): string | null {
  if (typeof unsafeLegacy === 'string') return unsafeLegacy;
  if (typeof unsafeLegacy === 'object' && unsafeLegacy !== null) {
    const obj = unsafeLegacy as Record<string, unknown>;
    if (typeof obj['deadline'] === 'string') return obj['deadline'];
  }
  return null;
}

/**
 * Returns `true` when the deadline is a valid date strictly after today.
 * Comparison is at day granularity (time-of-day is ignored).
 */
function isDeadlineActive(deadline: string): boolean {
  const deadlineDate = new Date(deadline);
  if (isNaN(deadlineDate.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDay = new Date(deadlineDate);
  deadlineDay.setHours(0, 0, 0, 0);
  return deadlineDay > today;
}

/**
 * Checks a single parsed manifest for shell.exec violations.
 * Returns an empty array when the manifest is clean.
 */
function checkManifest(
  frontmatter: Record<string, unknown>,
  relPath: string,
): ExecViolation[] {
  if (frontmatter['action_class'] !== 'shell.exec') return [];

  const unsafeLegacy = frontmatter['unsafe_legacy'];

  if (unsafeLegacy === undefined || unsafeLegacy === null || unsafeLegacy === false) {
    return [
      {
        file: relPath,
        message:
          'Declares action_class: shell.exec without an unsafe_legacy exception.',
      },
    ];
  }

  const deadline = extractUnsafeLegacyDeadline(unsafeLegacy);

  if (deadline === null) {
    return [
      {
        file: relPath,
        message:
          'Declares action_class: shell.exec with unsafe_legacy but missing a deadline field.',
      },
    ];
  }

  if (!isDeadlineActive(deadline)) {
    return [
      {
        file: relPath,
        message: `Declares action_class: shell.exec with unsafe_legacy deadline "${deadline}" which is expired or invalid.`,
      },
    ];
  }

  return [];
}

/**
 * Finds all SKILL.md manifest paths under the given skills directory.
 */
function findSkillManifests(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  const manifests: string[] = [];
  for (const entry of readdirSync(skillsDir)) {
    const skillDir = join(skillsDir, entry);
    if (!statSync(skillDir).isDirectory()) continue;
    const manifestPath = join(skillDir, MANIFEST_FILENAME);
    if (existsSync(manifestPath)) manifests.push(manifestPath);
  }
  return manifests;
}

/**
 * Scans all first-party skill manifests for shell.exec violations.
 */
function scanSkillManifests(skillsDir: string): ExecCheckResult {
  const manifestPaths = findSkillManifests(skillsDir);
  const violations: ExecViolation[] = [];

  for (const absPath of manifestPaths) {
    const content = readFileSync(absPath, 'utf-8');
    const frontmatter = extractFrontmatter(content);
    if (frontmatter === null) continue;
    const relPath = relative(REPO_ROOT, absPath);
    violations.push(...checkManifest(frontmatter, relPath));
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Formats a violations list into a human-readable CI-friendly report.
 */
function formatViolationsReport(violations: ExecViolation[]): string {
  if (violations.length === 0) return 'No violations.';
  const lines = [
    `shell.exec regression detected — ${violations.length} violation(s):`,
    '',
    ...violations.map(
      (v, i) => `  ${i + 1}. [${v.file}]\n     ${v.message}`,
    ),
    '',
    'Fix: remove action_class: shell.exec, or add unsafe_legacy with a future deadline.',
  ];
  return lines.join('\n');
}

// ─── TC-NER-01: Frontmatter extraction ────────────────────────────────────────

describe('TC-NER-01: frontmatter extraction', () => {
  it('parses standard YAML frontmatter block', () => {
    const content = '---\nname: test-skill\nversion: 1.0.0\n---\n# body';
    const fm = extractFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm!['name']).toBe('test-skill');
    expect(fm!['version']).toBe('1.0.0');
  });

  it('returns null when no frontmatter block is present', () => {
    const content = '# No frontmatter here\nJust a regular file.';
    expect(extractFrontmatter(content)).toBeNull();
  });

  it('returns null for malformed YAML', () => {
    const content = '---\n: invalid: yaml: [unclosed\n---';
    expect(extractFrontmatter(content)).toBeNull();
  });

  it('handles Windows-style CRLF line endings', () => {
    const content = '---\r\nname: crlf-skill\r\nversion: 2.0.0\r\n---\r\n# body';
    const fm = extractFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm!['name']).toBe('crlf-skill');
  });

  it('returns null when frontmatter yields a non-object value', () => {
    // A bare scalar is not a valid manifest
    const content = '---\njust a string\n---\n';
    expect(extractFrontmatter(content)).toBeNull();
  });
});

// ─── TC-NER-02: Exec detection ─────────────────────────────────────────────────

describe('TC-NER-02: shell.exec detection', () => {
  it('flags manifest with action_class: shell.exec and no unsafe_legacy', () => {
    const fm = { name: 'bad-skill', action_class: 'shell.exec' };
    const violations = checkManifest(fm, 'skills/bad-skill/SKILL.md');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe('skills/bad-skill/SKILL.md');
    expect(violations[0]!.message).toMatch(/unsafe_legacy/);
  });

  it('flags manifest with action_class: shell.exec and unsafe_legacy: false', () => {
    const fm = { name: 'bad-skill', action_class: 'shell.exec', unsafe_legacy: false };
    const violations = checkManifest(fm, 'skills/bad-skill/SKILL.md');
    expect(violations).toHaveLength(1);
  });

  it('flags manifest with action_class: shell.exec and unsafe_legacy: null', () => {
    const fm = { name: 'bad-skill', action_class: 'shell.exec', unsafe_legacy: null };
    const violations = checkManifest(fm, 'skills/bad-skill/SKILL.md');
    expect(violations).toHaveLength(1);
  });

  it('does not flag manifest without action_class field', () => {
    const fm = { name: 'clean-skill', version: '1.0.0' };
    const violations = checkManifest(fm, 'skills/clean-skill/SKILL.md');
    expect(violations).toHaveLength(0);
  });

  it('does not flag other action_class values', () => {
    const fm = { name: 'fs-skill', action_class: 'filesystem.read' };
    const violations = checkManifest(fm, 'skills/fs-skill/SKILL.md');
    expect(violations).toHaveLength(0);
  });

  it('violation message includes the file path', () => {
    const fm = { action_class: 'shell.exec' };
    const violations = checkManifest(fm, 'skills/bad/SKILL.md');
    expect(violations[0]!.message.length).toBeGreaterThan(0);
    expect(violations[0]!.file).toBe('skills/bad/SKILL.md');
  });
});

// ─── TC-NER-03: unsafe_legacy validation ──────────────────────────────────────

describe('TC-NER-03: unsafe_legacy deadline validation', () => {
  const FUTURE_DATE = '2099-01-01';
  const PAST_DATE = '2000-01-01';

  it('accepts shell.exec with string unsafe_legacy pointing to a future date', () => {
    const fm = { action_class: 'shell.exec', unsafe_legacy: FUTURE_DATE };
    const violations = checkManifest(fm, 'skills/x/SKILL.md');
    expect(violations).toHaveLength(0);
  });

  it('accepts shell.exec with object unsafe_legacy containing a future deadline', () => {
    const fm = {
      action_class: 'shell.exec',
      unsafe_legacy: { deadline: FUTURE_DATE, reason: 'legacy compat' },
    };
    const violations = checkManifest(fm, 'skills/x/SKILL.md');
    expect(violations).toHaveLength(0);
  });

  it('flags shell.exec with expired string deadline', () => {
    const fm = { action_class: 'shell.exec', unsafe_legacy: PAST_DATE };
    const violations = checkManifest(fm, 'skills/x/SKILL.md');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toMatch(/expired/);
  });

  it('flags shell.exec with expired object deadline', () => {
    const fm = {
      action_class: 'shell.exec',
      unsafe_legacy: { deadline: PAST_DATE },
    };
    const violations = checkManifest(fm, 'skills/x/SKILL.md');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toMatch(/expired/);
  });

  it('flags shell.exec with unsafe_legacy object missing a deadline field', () => {
    const fm = {
      action_class: 'shell.exec',
      unsafe_legacy: { reason: 'some reason' },
    };
    const violations = checkManifest(fm, 'skills/x/SKILL.md');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toMatch(/deadline/);
  });

  it('flags shell.exec with invalid (non-parseable) deadline string', () => {
    const fm = {
      action_class: 'shell.exec',
      unsafe_legacy: { deadline: 'not-a-date' },
    };
    const violations = checkManifest(fm, 'skills/x/SKILL.md');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toMatch(/expired or invalid/);
  });

  it('isDeadlineActive returns true for a far-future date', () => {
    expect(isDeadlineActive('2099-01-01')).toBe(true);
  });

  it('isDeadlineActive returns false for a past date', () => {
    expect(isDeadlineActive('2000-01-01')).toBe(false);
  });

  it('isDeadlineActive returns false for a non-date string', () => {
    expect(isDeadlineActive('not-a-date')).toBe(false);
  });

  it('formatViolationsReport includes violation count and file paths', () => {
    const violations: ExecViolation[] = [
      { file: 'skills/bad/SKILL.md', message: 'No unsafe_legacy.' },
    ];
    const report = formatViolationsReport(violations);
    expect(report).toContain('1 violation');
    expect(report).toContain('skills/bad/SKILL.md');
    expect(report).toContain('No unsafe_legacy.');
  });

  it('formatViolationsReport returns clean message when there are no violations', () => {
    expect(formatViolationsReport([])).toBe('No violations.');
  });
});

// ─── TC-NER-04: Contract — reference skill manifests pass ─────────────────────

describe('TC-NER-04: reference skill manifests contain no shell.exec violations', () => {
  it('examples/skills/ directory exists and contains at least one manifest', () => {
    const manifests = findSkillManifests(SKILLS_DIR);
    expect(manifests.length).toBeGreaterThan(0);
  });

  it('no reference skill declares shell.exec without a valid unsafe_legacy exception', () => {
    const result = scanSkillManifests(SKILLS_DIR);
    expect(result.valid, formatViolationsReport(result.violations)).toBe(true);
  });
});

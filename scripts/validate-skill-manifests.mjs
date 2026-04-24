#!/usr/bin/env node
/**
 * validate-skill-manifests.mjs
 *
 * CI validator for reference SKILL.md manifests under examples/skills/.
 *
 * Scans all examples/skills/ subdirectories and enforces the rule:
 *   action_class: shell.exec MUST include an unsafe_legacy field with a future deadline.
 *
 * Exits with code 1 and prints a clear report if any violation is found.
 * Exits with code 0 when all manifests are clean.
 *
 * Reference: E-01
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// ─── Path resolution ───────────────────────────────────────────────────────────

const _dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(_dirname, '..');
const SKILLS_DIR = join(REPO_ROOT, 'examples', 'skills');
const MANIFEST_FILENAME = 'SKILL.md';

// ─── Manifest parsing helpers ──────────────────────────────────────────────────

/**
 * Extracts parsed YAML frontmatter from a SKILL.md file.
 * Returns null if no frontmatter block is present or parsing fails.
 */
function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return null;
  try {
    const parsed = parseYaml(match[1]);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the deadline string from an unsafe_legacy field value.
 *
 * Supports two forms:
 *   - String:  unsafe_legacy: "2026-12-31"
 *   - Object:  unsafe_legacy: { deadline: "2026-12-31", reason: "..." }
 *
 * Returns null when no deadline can be found.
 */
function extractUnsafeLegacyDeadline(unsafeLegacy) {
  if (typeof unsafeLegacy === 'string') return unsafeLegacy;
  if (typeof unsafeLegacy === 'object' && unsafeLegacy !== null) {
    if (typeof unsafeLegacy['deadline'] === 'string') return unsafeLegacy['deadline'];
  }
  return null;
}

/**
 * Returns true when the deadline is a valid date strictly after today.
 * Comparison is at day granularity (time-of-day is ignored).
 */
function isDeadlineActive(deadline) {
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
function checkManifest(frontmatter, relPath) {
  if (frontmatter['action_class'] !== 'shell.exec') return [];

  const unsafeLegacy = frontmatter['unsafe_legacy'];

  if (unsafeLegacy === undefined || unsafeLegacy === null || unsafeLegacy === false) {
    return [
      {
        file: relPath,
        message: 'Declares action_class: shell.exec without an unsafe_legacy exception.',
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
function findSkillManifests(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  const manifests = [];
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
function scanSkillManifests(skillsDir) {
  const manifestPaths = findSkillManifests(skillsDir);
  const violations = [];

  for (const absPath of manifestPaths) {
    const content = readFileSync(absPath, 'utf-8');
    const frontmatter = extractFrontmatter(content);
    if (frontmatter === null) continue;
    const relPath = relative(REPO_ROOT, absPath);
    violations.push(...checkManifest(frontmatter, relPath));
  }

  return { valid: violations.length === 0, violations, total: manifestPaths.length };
}

/**
 * Formats a violations list into a human-readable CI-friendly report.
 */
function formatViolationsReport(violations) {
  if (violations.length === 0) return 'No violations.';
  const lines = [
    `unsafe_legacy violation(s) detected — ${violations.length} violation(s):`,
    '',
    ...violations.map((v, i) => `  ${i + 1}. [${v.file}]\n     ${v.message}`),
    '',
    'Fix: remove action_class: shell.exec, or add unsafe_legacy with a future deadline.',
  ];
  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const result = scanSkillManifests(SKILLS_DIR);

console.log(`Scanned ${result.total} skill manifest(s) in examples/skills/`);

if (result.valid) {
  console.log('All manifests passed validation.');
  process.exit(0);
} else {
  console.error('');
  console.error(formatViolationsReport(result.violations));
  process.exit(1);
}

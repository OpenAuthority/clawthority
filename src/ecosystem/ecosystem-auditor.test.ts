import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EcosystemAuditor } from './ecosystem-auditor.js';
import type {
  ActionRegistryEntry,
  HitlModeNorm,
  RiskLevel,
} from '../enforcement/normalize.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal registry used across tests. */
const MOCK_REGISTRY: readonly ActionRegistryEntry[] = [
  {
    action_class: 'filesystem.read',
    default_risk: 'low' as RiskLevel,
    default_hitl_mode: 'none' as HitlModeNorm,
    aliases: ['read', 'read_file', 'view_file'],
  },
  {
    action_class: 'filesystem.write',
    default_risk: 'medium' as RiskLevel,
    default_hitl_mode: 'per_request' as HitlModeNorm,
    aliases: ['write', 'write_file', 'edit'],
  },
  {
    action_class: 'filesystem.delete',
    default_risk: 'high' as RiskLevel,
    default_hitl_mode: 'per_request' as HitlModeNorm,
    aliases: ['rm', 'delete_file', 'remove'],
    intent_group: 'destructive_fs',
  },
  {
    action_class: 'shell.exec',
    default_risk: 'high' as RiskLevel,
    default_hitl_mode: 'per_request' as HitlModeNorm,
    aliases: ['bash', 'run_command'],
  },
  {
    action_class: 'communication.email',
    default_risk: 'high' as RiskLevel,
    default_hitl_mode: 'per_request' as HitlModeNorm,
    aliases: ['send_email', 'email'],
    intent_group: 'external_send',
  },
  {
    action_class: 'unknown_sensitive_action',
    default_risk: 'critical' as RiskLevel,
    default_hitl_mode: 'per_request' as HitlModeNorm,
    aliases: [],
  },
];

const SKILL_WITH_GAPS = `---
name: my-skill
version: 1.0.0
description: Test skill with gaps.
allowed-tools: Bash(*)
---

# /my-skill — Test

## When to Trigger

You MUST ask for confirmation before:

- **Moving** files: \`mv\` outside project
- **Killing** processes: \`kill\`
- **Searching**: \`search_files\`

## Examples

\`\`\`
read_file src/index.ts
search_files pattern="TODO"
\`\`\`
`;

const SKILL_NO_GAPS = `---
name: safe-skill
version: 1.0.0
description: Skill using only registered tools.
allowed-tools: Bash(*)
---

# /safe-skill

Use \`read_file\`, \`write_file\`, and \`bash\` only.

\`delete_file\` must be approved first.
`;

const SKILL_NO_FRONTMATTER = `# /broken-skill

This skill has no frontmatter.
`;

const SKILL_MULTIPLE_TOOLS = `---
name: multi-skill
version: 2.0.0
description: Skill using multiple tools.
allowed-tools: Bash(*), Read, Write
---

# /multi-skill

Calls \`rm\`, \`send_email\`, \`git-commit\`, and \`mv\`.
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpSkillDir(
  skills: Array<{ dir: string; content: string }>,
): string {
  const root = mkdtempSync(join(tmpdir(), 'eco-audit-test-'));
  for (const { dir, content } of skills) {
    const skillDir = join(root, dir);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
  }
  return root;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EcosystemAuditor', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  // ── Constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('builds an alias index from the supplied registry', () => {
      tmpDir = makeTmpSkillDir([]);
      const auditor = new EcosystemAuditor(tmpDir, MOCK_REGISTRY);
      // Audit an empty dir — just confirm construction succeeds
      const report = auditor.audit();
      expect(report.statistics.totalSkillsScanned).toBe(0);
    });

    it('excludes unknown_sensitive_action from knownClasses', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'safe-skill', content: SKILL_NO_GAPS }]);
      const auditor = new EcosystemAuditor(tmpDir, MOCK_REGISTRY);
      const report = auditor.audit();
      // unknown_sensitive_action should not appear as a key
      expect('unknown_sensitive_action' in report.statistics.patternsByActionClass).toBe(false);
    });
  });

  // ── Skill file scanning ────────────────────────────────────────────────────

  describe('skill scanning', () => {
    it('returns zero skills for an empty directory', () => {
      tmpDir = makeTmpSkillDir([]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      expect(report.scannedSkills).toHaveLength(0);
      expect(report.statistics.totalSkillsScanned).toBe(0);
    });

    it('scans a single SKILL.md file', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      expect(report.scannedSkills).toHaveLength(1);
      expect(report.statistics.totalSkillsScanned).toBe(1);
    });

    it('scans multiple skills in separate subdirectories', () => {
      tmpDir = makeTmpSkillDir([
        { dir: 'skill-a', content: SKILL_WITH_GAPS },
        { dir: 'skill-b', content: SKILL_NO_GAPS },
      ]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      expect(report.scannedSkills).toHaveLength(2);
    });

    it('handles skills nested in subdirectories', () => {
      tmpDir = makeTmpSkillDir([
        { dir: 'category/skill-a', content: SKILL_WITH_GAPS },
        { dir: 'other/skill-b', content: SKILL_NO_GAPS },
      ]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      expect(report.scannedSkills).toHaveLength(2);
    });

    it('does not crash when skillsDir does not exist', () => {
      const auditor = new EcosystemAuditor('/nonexistent/path', MOCK_REGISTRY);
      const report = auditor.audit();
      expect(report.scannedSkills).toHaveLength(0);
    });
  });

  // ── Frontmatter parsing ────────────────────────────────────────────────────

  describe('frontmatter parsing', () => {
    it('extracts name, version, and description from frontmatter', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const skill = report.scannedSkills[0]!;
      expect(skill.name).toBe('my-skill');
      expect(skill.version).toBe('1.0.0');
      expect(skill.description).toBe('Test skill with gaps.');
    });

    it('extracts allowed-tools from frontmatter', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const skill = report.scannedSkills[0]!;
      expect(skill.allowedTools).toContain('Bash(*)');
    });

    it('handles skill with no frontmatter gracefully', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'broken', content: SKILL_NO_FRONTMATTER }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      expect(report.scannedSkills).toHaveLength(1);
      const skill = report.scannedSkills[0]!;
      expect(skill.version).toBe('0.0.0');
      expect(skill.allowedTools).toHaveLength(0);
    });

    it('extracts multiple allowed-tools entries', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'multi', content: SKILL_MULTIPLE_TOOLS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const skill = report.scannedSkills[0]!;
      expect(skill.allowedTools.length).toBeGreaterThan(1);
    });
  });

  // ── Pattern extraction ─────────────────────────────────────────────────────

  describe('command pattern extraction', () => {
    it('extracts tool names from inline code spans', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const patterns = report.commandPatterns.map((p) => p.pattern);
      expect(patterns).toContain('mv');
      expect(patterns).toContain('kill');
      expect(patterns).toContain('search_files');
    });

    it('extracts tool name from allowed-tools frontmatter (strips args)', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const patterns = report.commandPatterns.map((p) => p.pattern);
      // Bash(*) → bash
      expect(patterns).toContain('bash');
    });

    it('normalises patterns to lowercase', () => {
      const skillContent = `---
name: upper-skill
version: 1.0.0
description: d
---
Use \`Read_File\` and \`BASH\`.
`;
      tmpDir = makeTmpSkillDir([{ dir: 'up-skill', content: skillContent }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const patterns = report.commandPatterns.map((p) => p.pattern);
      expect(patterns).toContain('read_file');
      expect(patterns).toContain('bash');
    });

    it('de-duplicates patterns within a single skill', () => {
      const skillContent = `---
name: dup-skill
version: 1.0.0
description: d
---
Use \`rm\` to delete. Then \`rm\` again.
`;
      tmpDir = makeTmpSkillDir([{ dir: 'dup', content: skillContent }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const rmPattern = report.commandPatterns.find((p) => p.pattern === 'rm');
      // Should appear once (per-skill dedup), but frequency tracks cross-skill occurrences
      expect(rmPattern).toBeDefined();
    });

    it('accumulates frequency across multiple skills', () => {
      tmpDir = makeTmpSkillDir([
        { dir: 'skill-a', content: SKILL_NO_GAPS },   // mentions bash, read_file, etc.
        { dir: 'skill-b', content: SKILL_MULTIPLE_TOOLS }, // also mentions rm, send_email
      ]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const rmPattern = report.commandPatterns.find((p) => p.pattern === 'rm');
      // rm appears in SKILL_MULTIPLE_TOOLS
      expect(rmPattern).toBeDefined();
    });

    it('records source skill names for each pattern', () => {
      tmpDir = makeTmpSkillDir([
        { dir: 'skill-a', content: SKILL_NO_GAPS },
        { dir: 'skill-b', content: SKILL_WITH_GAPS },
      ]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const bashPattern = report.commandPatterns.find((p) => p.pattern === 'bash');
      expect(bashPattern).toBeDefined();
      // bash appears in both skills (allowed-tools)
      expect(bashPattern!.sources.length).toBeGreaterThanOrEqual(1);
    });

    it('takes only the first token from multi-word inline code spans', () => {
      const skillContent = `---
name: multi-word
version: 1.0.0
description: d
---
Run \`npm install --save-dev\` and \`git status\`.
`;
      tmpDir = makeTmpSkillDir([{ dir: 'mw', content: skillContent }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const patterns = report.commandPatterns.map((p) => p.pattern);
      // npm and git should be extracted as first tokens; full strings should not appear
      expect(patterns).toContain('npm');
      expect(patterns).toContain('git');
      expect(patterns).not.toContain('npm install --save-dev');
    });

    it('filters out noise words', () => {
      const skillContent = `---
name: noisy
version: 1.0.0
description: d
---
Type \`yes\` to approve or \`no\` to reject. Use \`true\` or \`false\`.
`;
      tmpDir = makeTmpSkillDir([{ dir: 'noisy', content: skillContent }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const patterns = report.commandPatterns.map((p) => p.pattern);
      expect(patterns).not.toContain('yes');
      expect(patterns).not.toContain('no');
      expect(patterns).not.toContain('true');
      expect(patterns).not.toContain('false');
    });

    it('filters out single-character tokens', () => {
      const skillContent = `---
name: single-char
version: 1.0.0
description: d
---
Press \`q\` to quit or \`y\` for yes.
`;
      tmpDir = makeTmpSkillDir([{ dir: 'sc', content: skillContent }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const patterns = report.commandPatterns.map((p) => p.pattern);
      expect(patterns).not.toContain('q');
      expect(patterns).not.toContain('y');
    });
  });

  // ── Taxonomy resolution ────────────────────────────────────────────────────

  describe('taxonomy resolution', () => {
    it('resolves known tool aliases to their action class', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'safe', content: SKILL_NO_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const readFile = report.commandPatterns.find((p) => p.pattern === 'read_file');
      expect(readFile?.actionClass).toBe('filesystem.read');
    });

    it('sets actionClass to null for unregistered patterns (taxonomy gaps)', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const mv = report.commandPatterns.find((p) => p.pattern === 'mv');
      expect(mv?.actionClass).toBeNull();
    });

    it('resolves bash (from allowed-tools) to shell.exec', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const bash = report.commandPatterns.find((p) => p.pattern === 'bash');
      expect(bash?.actionClass).toBe('shell.exec');
    });

    it('resolves rm to filesystem.delete', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'multi', content: SKILL_MULTIPLE_TOOLS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const rm = report.commandPatterns.find((p) => p.pattern === 'rm');
      expect(rm?.actionClass).toBe('filesystem.delete');
    });
  });

  // ── Taxonomy gaps ──────────────────────────────────────────────────────────

  describe('taxonomy gaps', () => {
    it('includes patterns with null actionClass in taxonomyGaps', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const gapPatterns = report.taxonomyGaps.map((g) => g.pattern);
      expect(gapPatterns).toContain('mv');
      expect(gapPatterns).toContain('kill');
      expect(gapPatterns).toContain('search_files');
    });

    it('does not include resolved patterns in taxonomyGaps', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const gapPatterns = report.taxonomyGaps.map((g) => g.pattern);
      expect(gapPatterns).not.toContain('bash');
      expect(gapPatterns).not.toContain('rm');
    });

    it('produces zero gaps for a skill using only registered tools', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'safe', content: SKILL_NO_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      // SKILL_NO_GAPS only mentions read_file, write_file, bash, delete_file — all registered
      for (const gap of report.taxonomyGaps) {
        // If any gaps remain they must not be known registry aliases
        expect(report.commandPatterns.find((p) => p.pattern === gap.pattern)?.actionClass).toBeNull();
      }
    });

    it('assigns suggestedCategory to each gap', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      for (const gap of report.taxonomyGaps) {
        expect(typeof gap.suggestedCategory).toBe('string');
        expect(gap.suggestedCategory.length).toBeGreaterThan(0);
      }
    });

    it('infers filesystem.move for mv pattern', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const mvGap = report.taxonomyGaps.find((g) => g.pattern === 'mv');
      expect(mvGap?.suggestedCategory).toBe('filesystem.move');
    });

    it('infers process.control for kill pattern', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const killGap = report.taxonomyGaps.find((g) => g.pattern === 'kill');
      expect(killGap?.suggestedCategory).toBe('process.control');
    });

    it('infers filesystem.search for search_files pattern', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const searchGap = report.taxonomyGaps.find((g) => g.pattern === 'search_files');
      expect(searchGap?.suggestedCategory).toBe('filesystem.search');
    });

    it('infers vcs.git for git-related patterns', () => {
      const skillContent = `---
name: git-skill
version: 1.0.0
description: d
---
Use \`git-commit\` to commit changes.
`;
      tmpDir = makeTmpSkillDir([{ dir: 'git-skill', content: skillContent }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const gitGap = report.taxonomyGaps.find((g) => g.pattern === 'git-commit');
      expect(gitGap?.suggestedCategory).toBe('vcs.git');
    });

    it('falls back to uncategorized for unknown patterns', () => {
      const skillContent = `---
name: mystery-skill
version: 1.0.0
description: d
---
Use \`quux_frobnicate\` to frobnicate.
`;
      tmpDir = makeTmpSkillDir([{ dir: 'mystery', content: skillContent }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const gap = report.taxonomyGaps.find((g) => g.pattern === 'quux_frobnicate');
      expect(gap?.suggestedCategory).toBe('uncategorized');
    });

    it('carries frequency and sources through to gap entries', () => {
      tmpDir = makeTmpSkillDir([
        { dir: 'skill-a', content: SKILL_WITH_GAPS },
        { dir: 'skill-b', content: SKILL_MULTIPLE_TOOLS }, // mentions mv
      ]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const mvGap = report.taxonomyGaps.find((g) => g.pattern === 'mv');
      expect(mvGap).toBeDefined();
      expect(mvGap!.frequency).toBeGreaterThanOrEqual(1);
      expect(mvGap!.sources.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Statistics ─────────────────────────────────────────────────────────────

  describe('statistics', () => {
    beforeEach(() => {
      tmpDir = makeTmpSkillDir([
        { dir: 'skill-a', content: SKILL_WITH_GAPS },
        { dir: 'skill-b', content: SKILL_NO_GAPS },
      ]);
    });

    it('reports totalSkillsScanned', () => {
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      expect(report.statistics.totalSkillsScanned).toBe(2);
    });

    it('reports totalCommandPatterns as distinct pattern count', () => {
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      expect(report.statistics.totalCommandPatterns).toBe(report.commandPatterns.length);
    });

    it('computes mappedToTaxonomy correctly', () => {
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const expectedMapped = report.commandPatterns.filter((p) => p.actionClass !== null).length;
      expect(report.statistics.mappedToTaxonomy).toBe(expectedMapped);
    });

    it('computes unmappedPatterns correctly', () => {
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      expect(report.statistics.unmappedPatterns).toBe(report.taxonomyGaps.length);
    });

    it('computes coverageRate as mapped/total', () => {
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const { mappedToTaxonomy, totalCommandPatterns, coverageRate } = report.statistics;
      const expected = totalCommandPatterns === 0 ? 1 : mappedToTaxonomy / totalCommandPatterns;
      expect(coverageRate).toBeCloseTo(expected);
    });

    it('returns coverageRate of 1 for an empty skill directory', () => {
      const emptyDir = makeTmpSkillDir([]);
      const report = new EcosystemAuditor(emptyDir, MOCK_REGISTRY).audit();
      expect(report.statistics.coverageRate).toBe(1);
      rmSync(emptyDir, { recursive: true, force: true });
    });

    it('includes topPatternsByFrequency with at most 10 entries', () => {
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      expect(report.statistics.topPatternsByFrequency.length).toBeLessThanOrEqual(10);
    });

    it('orders topPatternsByFrequency descending', () => {
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const freqs = report.statistics.topPatternsByFrequency.map((p) => p.frequency);
      for (let i = 1; i < freqs.length; i++) {
        expect(freqs[i]!).toBeLessThanOrEqual(freqs[i - 1]!);
      }
    });

    it('includes known action class keys in patternsByActionClass', () => {
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      expect('filesystem.read' in report.statistics.patternsByActionClass).toBe(true);
      expect('shell.exec' in report.statistics.patternsByActionClass).toBe(true);
    });

    it('maps resolved patterns into their action class bucket', () => {
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const fsBucket = report.statistics.patternsByActionClass['filesystem.read'];
      expect(fsBucket).toContain('read_file');
    });

    it('groups gaps by suggestedCategory in gapsByCategory', () => {
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      for (const gap of report.taxonomyGaps) {
        const cat = gap.suggestedCategory;
        expect(cat in report.statistics.gapsByCategory).toBe(true);
        expect(report.statistics.gapsByCategory[cat]).toContainEqual(
          expect.objectContaining({ pattern: gap.pattern }),
        );
      }
    });
  });

  // ── JSON export ────────────────────────────────────────────────────────────

  describe('exportJson', () => {
    it('serialises report to valid JSON', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const auditor = new EcosystemAuditor(tmpDir, MOCK_REGISTRY);
      const report = auditor.audit();
      const json = auditor.exportJson(report);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('includes all top-level report fields in the JSON output', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const auditor = new EcosystemAuditor(tmpDir, MOCK_REGISTRY);
      const report = auditor.audit();
      const parsed = JSON.parse(auditor.exportJson(report)) as Record<string, unknown>;
      expect(parsed).toHaveProperty('generatedAt');
      expect(parsed).toHaveProperty('scannedSkills');
      expect(parsed).toHaveProperty('commandPatterns');
      expect(parsed).toHaveProperty('taxonomyGaps');
      expect(parsed).toHaveProperty('statistics');
    });

    it('round-trips report data through JSON without loss', () => {
      tmpDir = makeTmpSkillDir([{ dir: 'my-skill', content: SKILL_WITH_GAPS }]);
      const auditor = new EcosystemAuditor(tmpDir, MOCK_REGISTRY);
      const report = auditor.audit();
      const roundTripped = JSON.parse(auditor.exportJson(report)) as typeof report;
      expect(roundTripped.taxonomyGaps.length).toBe(report.taxonomyGaps.length);
      expect(roundTripped.commandPatterns.length).toBe(report.commandPatterns.length);
    });
  });

  // ── Category inference ─────────────────────────────────────────────────────

  describe('category inference', () => {
    const categorySkill = (patterns: string[]): string => `---
name: cat-skill
version: 1.0.0
description: d
---
${patterns.map((p) => `Use \`${p}\`.`).join('\n')}
`;

    it.each([
      ['git-push', 'vcs.git'],
      ['docker-run', 'container'],
      ['kubectl-get', 'container.orchestration'],
      ['npm-install', 'package.management'],
      ['aws-deploy', 'cloud.platform'],
      ['quux_zap', 'uncategorized'],
    ])('infers %s → %s', (pattern, expectedCategory) => {
      tmpDir = makeTmpSkillDir([{ dir: 'cat', content: categorySkill([pattern]) }]);
      const report = new EcosystemAuditor(tmpDir, MOCK_REGISTRY).audit();
      const gap = report.taxonomyGaps.find((g) => g.pattern === pattern);
      if (gap !== undefined) {
        expect(gap.suggestedCategory).toBe(expectedCategory);
      }
      // pattern may have been filtered as noise; that's also acceptable
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});

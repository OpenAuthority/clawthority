/**
 * Ecosystem auditor for taxonomy gap analysis (F-01).
 *
 * Scans SKILL.md files in the skill ecosystem, extracts command patterns from
 * frontmatter and inline code spans, resolves each against the action registry,
 * and produces a gap report identifying operations not covered by the current
 * taxonomy — input data for the F-02 taxonomy draft process.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionRegistryEntry } from '../enforcement/normalize.js';

// ─── Public Types ─────────────────────────────────────────────────────────────

/** Metadata parsed from a SKILL.md frontmatter block. */
export interface SkillMetadata {
  /** Skill name from frontmatter. */
  name: string;
  /** Semver version string. */
  version: string;
  /** One-line description. */
  description: string;
  /** Raw `allowed-tools` strings (e.g. `['Bash(*)']`). */
  allowedTools: string[];
  /** Absolute path to the SKILL.md file. */
  filePath: string;
}

/** A single command/tool-name pattern found across the skill ecosystem. */
export interface CommandPattern {
  /** The normalized (lowercase) pattern. */
  pattern: string;
  /** How many times this pattern was found across all skills. */
  frequency: number;
  /** Names of skills in which this pattern appears. */
  sources: string[];
  /** Resolved action class, or `null` when the pattern is a taxonomy gap. */
  actionClass: string | null;
}

/** A command pattern that has no entry in the current taxonomy. */
export interface TaxonomyGap {
  /** The unresolved pattern. */
  pattern: string;
  /** Frequency across all skills. */
  frequency: number;
  /** Names of skills that mention this pattern. */
  sources: string[];
  /**
   * Inferred operation category for F-02 drafting.
   * Examples: `'filesystem.move'`, `'process.control'`, `'vcs'`.
   */
  suggestedCategory: string;
}

/** Statistical summary produced by {@link EcosystemAuditor.audit}. */
export interface AuditStatistics {
  /** Number of SKILL.md files scanned. */
  totalSkillsScanned: number;
  /** Distinct command patterns found. */
  totalCommandPatterns: number;
  /** Patterns that resolved to a known action class. */
  mappedToTaxonomy: number;
  /** Patterns with no taxonomy entry (taxonomy gaps). */
  unmappedPatterns: number;
  /**
   * Fraction of patterns that resolved to a known action class.
   * Range `[0, 1]`; `1.0` means full taxonomy coverage.
   */
  coverageRate: number;
  /** Top-10 most frequent patterns across all skills. */
  topPatternsByFrequency: Array<{ pattern: string; frequency: number }>;
  /** For each action class, the list of patterns that map to it. */
  patternsByActionClass: Record<string, string[]>;
  /** Taxonomy gaps grouped by their inferred category. */
  gapsByCategory: Record<string, TaxonomyGap[]>;
}

/** Full report produced by {@link EcosystemAuditor.audit}. */
export interface AuditReport {
  /** ISO 8601 timestamp of report generation. */
  generatedAt: string;
  /** Metadata for every scanned skill. */
  scannedSkills: SkillMetadata[];
  /** All distinct command patterns found (resolved and unresolved). */
  commandPatterns: CommandPattern[];
  /** Patterns with no taxonomy coverage — candidates for F-02. */
  taxonomyGaps: TaxonomyGap[];
  /** Statistical analysis of command frequency and taxonomy coverage. */
  statistics: AuditStatistics;
}

// ─── Internal Constants ───────────────────────────────────────────────────────

/** Matches the YAML-like frontmatter block at the top of a SKILL.md. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Captures the content of an inline code span. */
const INLINE_CODE_RE = /`([^`\n]+)`/g;

/**
 * A valid tool-name pattern: lowercase snake_case or dot-separated segments,
 * optionally with hyphens. Must start with a letter.
 * Examples: `read_file`, `filesystem.delete`, `npm-install`.
 */
const TOOL_NAME_RE = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/;

/**
 * Tokens that are common English or Markdown words but not tool names.
 * Patterns that match these are discarded before taxonomy resolution.
 */
const NOISE_WORDS = new Set([
  // Boolean / null literals
  'true', 'false', 'null', 'undefined', 'nan',
  // Common English function words
  'yes', 'no', 'ok', 'on', 'off', 'all',
  'a', 'an', 'the', 'and', 'or', 'not', 'is', 'it', 'as', 'to',
  'in', 'of', 'at', 'by',
  // Common action verbs used in prose (not standalone tool names)
  'add', 'use', 'try', 'let', 'go',
  // File extensions that may appear in inline code
  'ts', 'js', 'md', 'json', 'yaml', 'yml', 'txt', 'log', 'csv',
  // Short meta-tokens
  'api', 'id', 'url', 'key', 'type', 'name', 'mode', 'tag',
  // Approval workflow responses
  'approve', 'reject', 'cancel', 'modify',
  // Shell built-in or utility commands that map to shell.exec via bash alias —
  // they are not distinct taxonomy action classes and don't represent gaps.
  'sudo', 'echo', 'cat', 'grep', 'sed', 'awk', 'head', 'tail',
  'env', 'export', 'source', 'cd', 'pwd', 'which',
  // Severity / log level labels
  'info', 'warn', 'error', 'debug',
]);

/**
 * Category inference rules: ordered list of `[keyword, suggestedCategory]`.
 * The first matching rule wins.
 */
const CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:move|mv|rename|copy|cp)\b/, 'filesystem.move'],
  [/\bsearch(?:_files?|_dir|_code)?\b|\bgrep\b|\bfind\b/, 'filesystem.search'],
  [/\bgit\b/, 'vcs.git'],
  [/\bsvn\b|\bhg\b/, 'vcs'],
  [/\bdocker\b|\bpodman\b/, 'container'],
  [/\bkubectl?\b|\bhelm\b/, 'container.orchestration'],
  [/\bkill\b|\bpkill\b|\bsignal\b|\bprocess\b/, 'process.control'],
  [/\bdatabase\b|\bsql\b|\bquery\b|\bdb\b/, 'database'],
  [/\bnotif(?:y|ication)\b|\bpush\b/, 'communication.push'],
  [/\bssh\b|\btelnet\b|\bftp\b/, 'network.shell'],
  [/\bpackage\b|\binstall\b|\buninstall\b/, 'package.management'],
  [/\bschedule\b|\bcron\b|\btimer\b/, 'scheduler'],
  [/\bcloud\b|\baws\b|\bgcp\b|\bazure\b/, 'cloud.platform'],
  [/\bci\b|\bpipeline\b|\bbuild\b|\bdeploy\b/, 'ci.cd'],
  [/\bconfig(?:ure)?\b|\bsetting\b/, 'configuration'],
];

// ─── EcosystemAuditor ─────────────────────────────────────────────────────────

/**
 * Audits the skill ecosystem to identify command patterns and taxonomy gaps.
 *
 * Construction accepts the canonical action registry (from
 * `src/enforcement/normalize.ts`) so the auditor can resolve tool names to
 * action classes and detect gaps without coupling itself to the live registry
 * module (which also keeps the class unit-testable with mock registries).
 *
 * @example
 * ```typescript
 * import { REGISTRY } from '../enforcement/normalize.js';
 * const auditor = new EcosystemAuditor('./skills', REGISTRY);
 * const report  = auditor.audit();
 * console.log(auditor.exportJson(report));
 * ```
 */
export class EcosystemAuditor {
  /** Alias → canonical action_class, built from the supplied registry. */
  private readonly aliasIndex: Map<string, string>;
  /** Set of all known canonical action classes (excludes unknown_sensitive_action). */
  private readonly knownClasses: Set<string>;

  constructor(
    private readonly skillsDir: string,
    registry: readonly ActionRegistryEntry[],
  ) {
    this.aliasIndex = new Map();
    this.knownClasses = new Set();
    for (const entry of registry) {
      if (entry.action_class !== 'unknown_sensitive_action') {
        this.knownClasses.add(entry.action_class);
      }
      for (const alias of entry.aliases) {
        this.aliasIndex.set(alias, entry.action_class);
      }
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Runs the full ecosystem audit.
   *
   * 1. Walks `skillsDir` recursively for `SKILL.md` files.
   * 2. Parses frontmatter and extracts inline command patterns from each file.
   * 3. Resolves each pattern against the action registry.
   * 4. Identifies taxonomy gaps (patterns with no known action class).
   * 5. Computes frequency statistics and groups gaps by inferred category.
   *
   * @returns A fully populated {@link AuditReport}.
   */
  audit(): AuditReport {
    const skillFiles = this.scanSkillFiles();

    // Accumulate per-pattern data across all skills.
    const accumulator = new Map<
      string,
      { frequency: number; sources: string[]; actionClass: string | null }
    >();

    for (const { metadata, content } of skillFiles) {
      const patterns = this.extractPatternsFromContent(content, metadata);
      for (const pattern of patterns) {
        const existing = accumulator.get(pattern);
        if (existing !== undefined) {
          existing.frequency += 1;
          if (!existing.sources.includes(metadata.name)) {
            existing.sources.push(metadata.name);
          }
        } else {
          accumulator.set(pattern, {
            frequency: 1,
            sources: [metadata.name],
            actionClass: this.resolveToActionClass(pattern),
          });
        }
      }
    }

    const commandPatterns: CommandPattern[] = [...accumulator.entries()].map(
      ([pattern, data]) => ({
        pattern,
        frequency: data.frequency,
        sources: data.sources,
        actionClass: data.actionClass,
      }),
    );

    const taxonomyGaps: TaxonomyGap[] = commandPatterns
      .filter((p) => p.actionClass === null)
      .map((p) => ({
        pattern: p.pattern,
        frequency: p.frequency,
        sources: p.sources,
        suggestedCategory: this.inferCategory(p.pattern),
      }));

    const statistics = this.computeStatistics(commandPatterns, taxonomyGaps, skillFiles.length);

    return {
      generatedAt: new Date().toISOString(),
      scannedSkills: skillFiles.map((sf) => sf.metadata),
      commandPatterns,
      taxonomyGaps,
      statistics,
    };
  }

  /**
   * Serialises an {@link AuditReport} to a formatted JSON string for export
   * to the F-02 draft process or further tooling.
   */
  exportJson(report: AuditReport): string {
    return JSON.stringify(report, null, 2);
  }

  // ─── File Scanning ───────────────────────────────────────────────────────────

  /**
   * Walks `skillsDir` recursively and returns all `SKILL.md` files along with
   * their parsed metadata and raw content.
   */
  private scanSkillFiles(): Array<{ metadata: SkillMetadata; content: string }> {
    const results: Array<{ metadata: SkillMetadata; content: string }> = [];

    const walkDir = (dir: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (entry === 'SKILL.md') {
          let content: string;
          try {
            content = readFileSync(fullPath, 'utf-8');
          } catch {
            continue;
          }
          const metadata = this.parseFrontmatter(content, fullPath);
          results.push({ metadata, content });
        }
      }
    };

    walkDir(this.skillsDir);
    return results;
  }

  /**
   * Parses YAML-like frontmatter from a SKILL.md file.
   * Falls back to safe defaults when fields are absent.
   */
  private parseFrontmatter(content: string, filePath: string): SkillMetadata {
    const match = FRONTMATTER_RE.exec(content);
    if (match === null) {
      return { name: filePath, version: '0.0.0', description: '', allowedTools: [], filePath };
    }
    const fm = match[1] ?? '';

    const nameMatch = /^name:\s*(.+)$/m.exec(fm);
    const versionMatch = /^version:\s*(.+)$/m.exec(fm);
    const descriptionMatch = /^description:\s*(.+)$/m.exec(fm);
    const allowedToolsMatch = /^allowed-tools:\s*(.+)$/m.exec(fm);

    const name = nameMatch?.[1]?.trim() ?? filePath;
    const version = versionMatch?.[1]?.trim() ?? '0.0.0';
    const description = descriptionMatch?.[1]?.trim() ?? '';
    const allowedTools = allowedToolsMatch !== null
      ? allowedToolsMatch[1]!.trim().split(/[,\s]+/).filter(Boolean)
      : [];

    return { name, version, description, allowedTools, filePath };
  }

  // ─── Pattern Extraction ──────────────────────────────────────────────────────

  /**
   * Extracts candidate tool-name patterns from a skill's content.
   *
   * Sources (in priority order):
   * 1. `allowed-tools` tool names from frontmatter (e.g. `Bash(*)` → `bash`).
   * 2. Inline code spans that match the tool-name shape.
   *
   * Returns a de-duplicated set of lowercase patterns for this skill.
   */
  private extractPatternsFromContent(content: string, metadata: SkillMetadata): string[] {
    const found = new Set<string>();

    // 1. allowed-tools from frontmatter
    for (const raw of metadata.allowedTools) {
      // Strip parenthetical argument spec: Bash(*) → bash
      const toolName = raw.replace(/\(.*\)$/, '').trim().toLowerCase();
      if (toolName.length > 0 && this.isToolNameCandidate(toolName)) {
        found.add(toolName);
      }
    }

    // 2. Inline code spans: `...`
    const bodyStart = this.findBodyStart(content);
    const body = content.slice(bodyStart);

    INLINE_CODE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INLINE_CODE_RE.exec(body)) !== null) {
      const span = match[1]!.trim();
      // Take only the first token (before any space) to handle `cmd args`
      const firstToken = span.split(/\s+/)[0] ?? '';
      const normalized = firstToken.toLowerCase();
      if (this.isToolNameCandidate(normalized)) {
        found.add(normalized);
      }
    }

    return [...found];
  }

  /**
   * Returns the character offset at which the skill body begins (after the
   * closing `---` of the frontmatter block), or 0 if there is no frontmatter.
   */
  private findBodyStart(content: string): number {
    const match = FRONTMATTER_RE.exec(content);
    if (match === null) return 0;
    return match.index + match[0].length;
  }

  /**
   * Returns `true` when a token is a plausible tool-name candidate:
   * - At least 2 characters long.
   * - Matches the `[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*` shape.
   * - Not in the noise-word block-list.
   */
  private isToolNameCandidate(token: string): boolean {
    if (token.length < 2) return false;
    if (!TOOL_NAME_RE.test(token)) return false;
    if (NOISE_WORDS.has(token)) return false;
    return true;
  }

  // ─── Taxonomy Resolution ─────────────────────────────────────────────────────

  /**
   * Resolves a normalized tool-name pattern to an action class.
   * Returns `null` when the pattern is a taxonomy gap (no registered alias).
   */
  private resolveToActionClass(pattern: string): string | null {
    const resolved = this.aliasIndex.get(pattern);
    if (resolved === undefined || resolved === 'unknown_sensitive_action') {
      return null;
    }
    return resolved;
  }

  // ─── Gap Classification ──────────────────────────────────────────────────────

  /**
   * Infers a suggested action-class category for a taxonomy gap pattern.
   * Returns `'uncategorized'` when no rule matches.
   */
  private inferCategory(pattern: string): string {
    for (const [re, category] of CATEGORY_RULES) {
      if (re.test(pattern)) return category;
    }
    return 'uncategorized';
  }

  // ─── Statistics ───────────────────────────────────────────────────────────────

  /** Builds the {@link AuditStatistics} section of the report. */
  private computeStatistics(
    patterns: CommandPattern[],
    gaps: TaxonomyGap[],
    skillsScanned: number,
  ): AuditStatistics {
    const total = patterns.length;
    const mapped = patterns.filter((p) => p.actionClass !== null).length;
    const unmapped = total - mapped;
    const coverageRate = total === 0 ? 1 : mapped / total;

    // Top-10 by frequency (descending)
    const topPatternsByFrequency = [...patterns]
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10)
      .map((p) => ({ pattern: p.pattern, frequency: p.frequency }));

    // Group resolved patterns by action class
    const patternsByActionClass: Record<string, string[]> = {};
    for (const ac of this.knownClasses) {
      patternsByActionClass[ac] = [];
    }
    for (const p of patterns) {
      if (p.actionClass !== null) {
        const list = patternsByActionClass[p.actionClass];
        if (list !== undefined) {
          list.push(p.pattern);
        } else {
          patternsByActionClass[p.actionClass] = [p.pattern];
        }
      }
    }

    // Group gaps by inferred category
    const gapsByCategory: Record<string, TaxonomyGap[]> = {};
    for (const gap of gaps) {
      const cat = gap.suggestedCategory;
      const list = gapsByCategory[cat];
      if (list !== undefined) {
        list.push(gap);
      } else {
        gapsByCategory[cat] = [gap];
      }
    }

    return {
      totalSkillsScanned: skillsScanned,
      totalCommandPatterns: total,
      mappedToTaxonomy: mapped,
      unmappedPatterns: unmapped,
      coverageRate,
      topPatternsByFrequency,
      patternsByActionClass,
      gapsByCategory,
    };
  }
}

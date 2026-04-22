/**
 * @openclaw/migrate-exec-codemod
 *
 * Advisory codemod library for detecting shell.exec patterns in OpenClaw
 * skill files and TypeScript manifests, and suggesting fine-grained
 * tool replacements.
 *
 * @example
 * ```ts
 * import { analyzeFile, formatReport, renderReport, buildDiff, renderDiff } from '@openclaw/migrate-exec-codemod';
 * import { readFileSync } from 'node:fs';
 *
 * const result = analyzeFile('skills/my-skill/SKILL.md');
 * const report = formatReport(result);
 * console.log(renderReport(report));
 *
 * const source = readFileSync('skills/my-skill/SKILL.md', 'utf8');
 * const diff = buildDiff(result, source);
 * console.log(renderDiff(diff));
 * ```
 */

export { analyzeFile, analyzeSource } from './analyzer.js';
export type { AnalysisResult, Finding, FindingKind, FileKind } from './analyzer.js';

export { formatReport, renderReport } from './suggestions.js';
export type { FormattedSuggestion, SuggestionReport } from './suggestions.js';

export { buildDiff, renderDiff } from './diff.js';
export type { DiffHunk, FileDiff } from './diff.js';

export { EXEC_TOOL_NAMES, COMMAND_RULES } from './patterns.js';
export type { Suggestion, CommandRule, RiskTier } from './patterns.js';

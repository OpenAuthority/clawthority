/**
 * Suggestion formatting helpers.
 *
 * Converts raw Finding objects into human-readable advisory messages
 * suitable for console output or report generation.
 */

import type { Finding, AnalysisResult } from './analyzer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormattedSuggestion {
  file: string;
  line: number;
  kind: string;
  severity: 'info' | 'advisory';
  message: string;
  detail: string | null;
}

export interface SuggestionReport {
  file: string;
  total: number;
  suggestions: FormattedSuggestion[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindLabel(kind: Finding['kind']): string {
  switch (kind) {
    case 'frontmatter-action-class':
      return 'FRONTMATTER';
    case 'json-tool-call':
      return 'JSON TOOL CALL';
    case 'ts-action-class-literal':
      return 'TS LITERAL';
  }
}

function formatFinding(file: string, finding: Finding): FormattedSuggestion {
  const { suggestion, context } = finding;

  if (suggestion) {
    const detail = [
      `Replace with: ${suggestion.tool} (action_class: ${suggestion.action_class}, risk: ${suggestion.risk_tier})`,
      suggestion.rationale,
      context ? `Command: ${context}` : null,
    ]
      .filter(Boolean)
      .join('\n  ');

    return {
      file,
      line: finding.line,
      kind: kindLabel(finding.kind),
      severity: 'advisory',
      message: `[${finding.kind}] '${finding.matched_text}' → suggest '${suggestion.tool}'`,
      detail,
    };
  }

  return {
    file,
    line: finding.line,
    kind: kindLabel(finding.kind),
    severity: 'info',
    message: `[${finding.kind}] '${finding.matched_text}' — exec pattern detected, no specific replacement identified`,
    detail: context ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Formats an AnalysisResult into a SuggestionReport. */
export function formatReport(result: AnalysisResult): SuggestionReport {
  return {
    file: result.file,
    total: result.findings.length,
    suggestions: result.findings.map((f) => formatFinding(result.file, f)),
  };
}

/** Renders a SuggestionReport as a human-readable string for console output. */
export function renderReport(report: SuggestionReport): string {
  if (report.total === 0) {
    return `✓ ${report.file}: no exec patterns detected\n`;
  }

  const lines: string[] = [
    `⚠ ${report.file}: ${report.total} exec pattern(s) detected`,
    '',
  ];

  for (const s of report.suggestions) {
    lines.push(`  Line ${s.line} [${s.kind}]`);
    lines.push(`  ${s.message}`);
    if (s.detail) {
      for (const dl of s.detail.split('\n')) {
        lines.push(`    ${dl}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

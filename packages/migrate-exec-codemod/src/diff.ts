/**
 * Diff output generation.
 *
 * Produces unified-diff-style advisory output for exec pattern findings.
 * The diff is advisory (not applied automatically) — it shows what a
 * migration to a fine-grained tool call would look like.
 */

import type { AnalysisResult, Finding } from './analyzer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffHunk {
  /** Starting line in the original file (1-based) */
  start_line: number;
  /** Context lines shown before/after the finding */
  context_lines: number;
  /** Unified diff hunk header */
  header: string;
  /** Diff lines: '-' for removed, '+' for added, ' ' for context */
  lines: string[];
}

export interface FileDiff {
  file: string;
  hunks: DiffHunk[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTEXT = 2; // lines of context around each finding

function buildJsonToolCallHunk(
  sourceLines: readonly string[],
  finding: Finding,
): DiffHunk | null {
  if (!finding.suggestion) return null;

  const lineIdx = finding.line - 1; // 0-based
  const contextStart = Math.max(0, lineIdx - CONTEXT);
  const contextEnd = Math.min(sourceLines.length - 1, lineIdx + CONTEXT);
  const hunkSize = contextEnd - contextStart + 1;

  const lines: string[] = [];
  let removedCount = 0;
  let addedCount = 0;

  for (let i = contextStart; i <= contextEnd; i++) {
    const srcLine = sourceLines[i] ?? '';
    if (i === lineIdx) {
      // Replace the matched tool name with the suggested one
      const oldLine = srcLine;
      const newLine = srcLine.replace(
        /"tool"\s*:\s*"[^"]+"/,
        `"tool": "${finding.suggestion.tool}"`,
      );
      if (oldLine !== newLine) {
        lines.push(`-${oldLine}`);
        lines.push(`+${newLine}`);
        removedCount++;
        addedCount++;
      } else {
        lines.push(` ${srcLine}`);
      }
    } else {
      lines.push(` ${srcLine}`);
    }
  }

  const header = `@@ -${contextStart + 1},${hunkSize} +${contextStart + 1},${hunkSize - removedCount + addedCount} @@`;

  return {
    start_line: contextStart + 1,
    context_lines: CONTEXT,
    header,
    lines,
  };
}

function buildFrontmatterHunk(
  sourceLines: readonly string[],
  finding: Finding,
): DiffHunk | null {
  // For frontmatter findings we can't suggest a single replacement (depends on skill
  // semantics) — emit an advisory comment hunk instead
  const lineIdx = finding.line - 1;
  const contextStart = Math.max(0, lineIdx - CONTEXT);
  const contextEnd = Math.min(sourceLines.length - 1, lineIdx + CONTEXT);
  const hunkSize = contextEnd - contextStart + 1;

  const lines: string[] = [];
  for (let i = contextStart; i <= contextEnd; i++) {
    const srcLine = sourceLines[i] ?? '';
    if (i === lineIdx) {
      lines.push(`-${srcLine}`);
      lines.push(`+# TODO(migrate-exec): replace shell.exec with a more specific action_class`);
      lines.push(`+${srcLine}`);
    } else {
      lines.push(` ${srcLine}`);
    }
  }

  const header = `@@ -${contextStart + 1},${hunkSize} +${contextStart + 1},${hunkSize + 1} @@`;

  return {
    start_line: contextStart + 1,
    context_lines: CONTEXT,
    header,
    lines,
  };
}

function buildTsHunk(
  sourceLines: readonly string[],
  finding: Finding,
): DiffHunk | null {
  const lineIdx = finding.line - 1;
  const contextStart = Math.max(0, lineIdx - CONTEXT);
  const contextEnd = Math.min(sourceLines.length - 1, lineIdx + CONTEXT);
  const hunkSize = contextEnd - contextStart + 1;

  const lines: string[] = [];
  for (let i = contextStart; i <= contextEnd; i++) {
    const srcLine = sourceLines[i] ?? '';
    if (i === lineIdx) {
      lines.push(`-${srcLine}`);
      lines.push(`+  // TODO(migrate-exec): replace 'shell.exec' with a more specific action_class`);
      lines.push(`+${srcLine}`);
    } else {
      lines.push(` ${srcLine}`);
    }
  }

  const header = `@@ -${contextStart + 1},${hunkSize} +${contextStart + 1},${hunkSize + 1} @@`;

  return {
    start_line: contextStart + 1,
    context_lines: CONTEXT,
    header,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a FileDiff from an AnalysisResult.
 *
 * Only findings with actionable suggestions (or frontmatter/ts hits that
 * warrant a TODO annotation) produce hunks.
 */
export function buildDiff(result: AnalysisResult, source: string): FileDiff {
  const sourceLines = source.split('\n');
  const hunks: DiffHunk[] = [];

  for (const finding of result.findings) {
    let hunk: DiffHunk | null = null;
    if (finding.kind === 'json-tool-call') {
      hunk = buildJsonToolCallHunk(sourceLines, finding);
    } else if (finding.kind === 'frontmatter-action-class') {
      hunk = buildFrontmatterHunk(sourceLines, finding);
    } else if (finding.kind === 'ts-action-class-literal') {
      hunk = buildTsHunk(sourceLines, finding);
    }
    if (hunk) hunks.push(hunk);
  }

  return { file: result.file, hunks };
}

/** Renders a FileDiff as a unified diff string. */
export function renderDiff(diff: FileDiff): string {
  if (diff.hunks.length === 0) {
    return `--- a/${diff.file}\n+++ b/${diff.file}\n(no changes suggested)\n`;
  }

  const lines: string[] = [
    `--- a/${diff.file}`,
    `+++ b/${diff.file}`,
  ];

  for (const hunk of diff.hunks) {
    lines.push(hunk.header);
    lines.push(...hunk.lines);
  }

  return lines.join('\n') + '\n';
}

/**
 * SKILL.md and TypeScript file analyzer.
 *
 * Parses skill files and manifest sources looking for shell.exec patterns.
 * Uses:
 *  - yaml.parse() for YAML frontmatter (structured AST)
 *  - JSON.parse() for JSON tool-call blocks in markdown (structured AST)
 *  - Regex for TypeScript string literal detection (best-effort)
 */

import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { EXEC_TOOL_NAMES, COMMAND_RULES, type Suggestion } from './patterns.js';

// ---------------------------------------------------------------------------
// Finding types
// ---------------------------------------------------------------------------

export type FindingKind =
  | 'frontmatter-action-class'
  | 'json-tool-call'
  | 'ts-action-class-literal';

export interface Finding {
  /** Category of the finding */
  kind: FindingKind;
  /** 1-based line number in the source file */
  line: number;
  /** Raw text of the matched region */
  matched_text: string;
  /** Advisory suggestion, if a fine-grained alternative was identified */
  suggestion: Suggestion | null;
  /** Extra context (e.g. the command string that drove the suggestion) */
  context?: string | undefined;
}

export interface AnalysisResult {
  file: string;
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the line number (1-based) of a character offset in a source string. */
function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

/** Applies COMMAND_RULES to a command string and returns the first matching suggestion. */
function matchCommand(command: string): Suggestion | null {
  for (const rule of COMMAND_RULES) {
    if (rule.pattern.test(command)) {
      return rule.suggestion;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// SKILL.md frontmatter analysis
// ---------------------------------------------------------------------------

/** Parses the YAML frontmatter block (between ---) from a SKILL.md source. */
function parseFrontmatter(source: string): { data: Record<string, unknown>; endOffset: number } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(source);
  if (!match || match.index !== 0) return null;
  const rawYaml = match[1] ?? '';
  try {
    const data = parseYaml(rawYaml) as Record<string, unknown>;
    return { data, endOffset: match.index + match[0].length };
  } catch {
    return null;
  }
}

function analyzeFrontmatter(source: string, findings: Finding[]): void {
  const parsed = parseFrontmatter(source);
  if (!parsed) return;

  const actionClass = parsed.data['action_class'];
  if (typeof actionClass !== 'string') return;

  // Detect shell.exec directly or via an exec alias
  const isExec =
    actionClass === 'shell.exec' || EXEC_TOOL_NAMES.has(actionClass.toLowerCase());
  if (!isExec) return;

  // Find the line where action_class appears in the frontmatter source
  const acMatch = /^action_class:\s*.+$/m.exec(source);
  const line = acMatch ? lineOf(source, acMatch.index) : 1;

  findings.push({
    kind: 'frontmatter-action-class',
    line,
    matched_text: acMatch ? acMatch[0].trim() : `action_class: ${actionClass}`,
    suggestion: null, // frontmatter replacement depends on skill semantics; advisory only
    context: `Frontmatter declares action_class: ${actionClass}. Consider replacing with a more specific action class (e.g. vcs.read, filesystem.read) that matches the skill's actual operation.`,
  });
}

// ---------------------------------------------------------------------------
// JSON code block analysis
// ---------------------------------------------------------------------------

/**
 * Extracts all fenced code blocks with language "json" from markdown source.
 * Returns each block with its start line in the original source.
 */
function extractJsonBlocks(source: string): Array<{ content: string; startLine: number }> {
  const blocks: Array<{ content: string; startLine: number }> = [];
  // Match ```json ... ``` blocks
  const blockRegex = /^```json\r?\n([\s\S]*?)^```/gm;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(source)) !== null) {
    const startLine = lineOf(source, match.index) + 1; // +1: first line after opening fence
    blocks.push({ content: match[1] ?? '', startLine });
  }
  return blocks;
}

function analyzeJsonBlocks(source: string, findings: Finding[]): void {
  for (const block of extractJsonBlocks(source)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.content);
    } catch {
      continue; // malformed JSON — skip
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;

    const obj = parsed as Record<string, unknown>;
    const toolName = obj['tool'];
    if (typeof toolName !== 'string') continue;
    if (!EXEC_TOOL_NAMES.has(toolName.toLowerCase())) continue;

    // Find the command param (typically params.command or params.cmd)
    const params = obj['params'];
    let command: string | null = null;
    if (typeof params === 'object' && params !== null) {
      const p = params as Record<string, unknown>;
      if (typeof p['command'] === 'string') command = p['command'];
      else if (typeof p['cmd'] === 'string') command = p['cmd'];
    }

    const suggestion = command ? matchCommand(command) : null;

    // Find line offset of "tool" key in this block to report a precise line
    const toolKeyOffset = block.content.indexOf('"tool"');
    const blockLine =
      toolKeyOffset >= 0
        ? block.startLine + block.content.slice(0, toolKeyOffset).split('\n').length - 1
        : block.startLine;

    findings.push({
      kind: 'json-tool-call',
      line: blockLine,
      matched_text: `"tool": "${toolName}"`,
      suggestion,
      context: command ?? undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// TypeScript source analysis
// ---------------------------------------------------------------------------

function analyzeTsSource(source: string, findings: Finding[]): void {
  // Match: action_class: 'shell.exec' or action_class: "shell.exec"
  // Also catches exec alias strings in action_class fields
  const tsRegex = /action_class\s*:\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = tsRegex.exec(source)) !== null) {
    const value = match[1] ?? '';
    const isExec =
      value === 'shell.exec' || EXEC_TOOL_NAMES.has(value.toLowerCase());
    if (!isExec) continue;

    findings.push({
      kind: 'ts-action-class-literal',
      line: lineOf(source, match.index),
      matched_text: match[0],
      suggestion: null,
      context: `TypeScript literal action_class: '${value}'. Consider replacing with a more specific action class.`,
    });
  }

  // Also catch aliases used as tool name strings in aliases arrays
  // e.g. aliases: ['bash', 'run_command', ...]  — advisory: these map to shell.exec
  const aliasRegex = /aliases\s*:\s*\[([^\]]+)\]/g;
  while ((match = aliasRegex.exec(source)) !== null) {
    const aliasBlock = match[1] ?? '';
    const quotedNames = [...aliasBlock.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
    const execAliases = quotedNames.filter((n) => EXEC_TOOL_NAMES.has(n.toLowerCase()));
    if (execAliases.length === 0) continue;

    findings.push({
      kind: 'ts-action-class-literal',
      line: lineOf(source, match.index),
      matched_text: match[0].slice(0, 80) + (match[0].length > 80 ? '…' : ''),
      suggestion: null,
      context: `aliases array contains exec aliases: ${execAliases.map((a) => `'${a}'`).join(', ')}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type FileKind = 'skill' | 'typescript' | 'auto';

/**
 * Analyzes a file for shell.exec patterns and returns advisory findings.
 *
 * @param filePath  Absolute or relative path to the file to analyze.
 * @param kind      'skill' for SKILL.md, 'typescript' for .ts files, 'auto' to infer from extension.
 */
export function analyzeFile(filePath: string, kind: FileKind = 'auto'): AnalysisResult {
  const source = readFileSync(filePath, 'utf8');
  return analyzeSource(source, filePath, kind);
}

/**
 * Analyzes an in-memory source string for shell.exec patterns.
 * Useful for testing without touching the filesystem.
 *
 * @param source    The raw file contents.
 * @param filePath  Logical file path (used for display and extension inference).
 * @param kind      File kind hint.
 */
export function analyzeSource(
  source: string,
  filePath: string,
  kind: FileKind = 'auto',
): AnalysisResult {
  const findings: Finding[] = [];

  const effectiveKind =
    kind === 'auto'
      ? filePath.endsWith('.ts') || filePath.endsWith('.tsx')
        ? 'typescript'
        : 'skill'
      : kind;

  if (effectiveKind === 'skill') {
    analyzeFrontmatter(source, findings);
    analyzeJsonBlocks(source, findings);
  } else {
    analyzeTsSource(source, findings);
  }

  // Sort by line number for deterministic output
  findings.sort((a, b) => a.line - b.line);

  return { file: filePath, findings };
}

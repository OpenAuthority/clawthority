#!/usr/bin/env node
/**
 * migrate-exec CLI
 *
 * Analyzes one or more skill/TypeScript files for shell.exec patterns and
 * emits advisory suggestions + unified diff output.
 *
 * Usage:
 *   migrate-exec [--diff] [--json] <file> [file...]
 *
 * Flags:
 *   --diff     Also emit unified diff output after the suggestion report
 *   --json     Emit machine-readable JSON instead of human-readable text
 *   --help     Show this help message
 *
 * Exit codes:
 *   0  No exec patterns found
 *   1  One or more exec patterns detected (advisory — does not block)
 *   2  Usage error
 */

import { readFileSync } from 'node:fs';
import { analyzeSource } from './analyzer.js';
import { formatReport, renderReport } from './suggestions.js';
import { buildDiff, renderDiff } from './diff.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  files: string[];
  diff: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions | null {
  const args = argv.slice(2); // strip 'node' and script path
  const files: string[] = [];
  let diff = false;
  let json = false;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return null;
    else if (arg === '--diff') diff = true;
    else if (arg === '--json') json = true;
    else if (arg.startsWith('--')) {
      process.stderr.write(`Unknown flag: ${arg}\n`);
      return null;
    } else {
      files.push(arg);
    }
  }

  return { files, diff, json };
}

function printUsage(): void {
  process.stdout.write(
    [
      'Usage: migrate-exec [--diff] [--json] <file> [file...]',
      '',
      'Options:',
      '  --diff   Emit unified diff suggestions after the report',
      '  --json   Emit machine-readable JSON output',
      '  --help   Show this help message',
      '',
      'Examples:',
      '  migrate-exec skills/my-skill/SKILL.md',
      '  migrate-exec --diff skills/*/SKILL.md',
      '  migrate-exec --json src/tools/my_tool/manifest.ts',
      '',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const options = parseArgs(process.argv);

  if (!options) {
    printUsage();
    process.exit(2);
  }

  if (options.files.length === 0) {
    process.stderr.write('Error: no input files specified\n\n');
    printUsage();
    process.exit(2);
  }

  let anyFindings = false;

  const jsonOutput: unknown[] = [];

  for (const filePath of options.files) {
    let source: string;
    try {
      source = readFileSync(filePath, 'utf8');
    } catch (err) {
      process.stderr.write(`Error reading ${filePath}: ${String(err)}\n`);
      continue;
    }

    const result = analyzeSource(source, filePath);
    if (result.findings.length > 0) anyFindings = true;

    if (options.json) {
      const report = formatReport(result);
      const diffOutput = options.diff ? buildDiff(result, source) : null;
      jsonOutput.push({ report, diff: diffOutput });
    } else {
      const report = formatReport(result);
      process.stdout.write(renderReport(report));

      if (options.diff) {
        const diff = buildDiff(result, source);
        const rendered = renderDiff(diff);
        process.stdout.write('\n' + rendered + '\n');
      }
    }
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
  }

  process.exit(anyFindings ? 1 : 0);
}

main();

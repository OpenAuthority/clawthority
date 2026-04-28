/**
 * Command explainer rule engine — type definitions and pattern table.
 *
 * Provides structured explanations (summary, effects, warnings,
 * inferred_action_class) for shell commands observed in agent audit logs.
 * Rules are matched against the raw command string via a RegExp; when a rule
 * fires, static fields are merged with any output from the rule's detectors.
 *
 * @module
 */
import { explain } from '../enforcement/command-explainer/patterns.js';

// ── Public interfaces ──────────────────────────────────────────────────────────

/**
 * Detector function that inspects tokenised command arguments and returns a
 * human-readable description of the detected condition, or `null` when the
 * condition is absent.
 *
 * `args[0]` is always the subcommand token (e.g. `"push"` for `git push`).
 */
export interface Effect {
  (args: string[]): string | null;
}

/**
 * A single entry in the command-explainer pattern table.
 *
 * `match` is tested against the raw command string; the first matching rule
 * wins.  `detectors` are called with tokenised args and may emit additional
 * effect or warning strings at runtime.
 */
export interface CommandRule {
  /** Regex tested against the raw command string to select this rule. */
  match: RegExp;
  /** Dynamic detector functions that produce runtime effects or warnings. */
  detectors: Effect[];
  /** Default one-line sentence-case summary of what the command does. */
  summary: string;
  /** Static observable side-effects (filesystem, network, registry, …). */
  effects: string[];
  /** Static security or operational warnings for this command class. */
  warnings: string[];
  /** Dot-notation action class inferred from the command (e.g. "git.push"). */
  inferred_action_class: string;
}

/** Structured explanation returned by {@link explainCommand}. */
export interface CommandExplanation {
  /** One-line sentence-case summary of what the command does. */
  summary: string;
  /** Observable side-effects, including any emitted by detectors. */
  effects: string[];
  /** Security or operational warnings, including any emitted by detectors. */
  warnings: string[];
  /** Dot-notation action class inferred from the command. */
  inferred_action_class: string;
}

// ── Pattern table ──────────────────────────────────────────────────────────────

/** Ordered list of command rules. First matching rule wins. */
export const patternTable: CommandRule[] = [];

// ── Private helpers ────────────────────────────────────────────────────────────

/** Returns the first non-flag token at position ≥ 1 (i.e. the subcommand). */
function firstSubcommand(tokens: string[]): string | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.startsWith('-')) return t;
  }
  return undefined;
}

/**
 * Maps a binary name and optional subcommand to a dot-notation action class.
 *
 * Convention: `<domain>.<verb>` — e.g. `git.push`, `fs.delete`, `network.ssh`.
 * Returns `'unknown'` when the binary is not recognised.
 */
function inferActionClass(binary: string, subcommand?: string): string {
  switch (binary) {
    // Version control
    case 'git':      return subcommand ? `git.${subcommand}` : 'git';
    // JavaScript / Node.js
    case 'npm':      return subcommand ? `npm.${subcommand}` : 'npm';
    // Python
    case 'pip':
    case 'pip3':     return 'python.install';
    case 'pytest':   return 'python.test';
    // Containers
    case 'docker':   return subcommand ? `docker.${subcommand}` : 'docker';
    // Build tools
    case 'make':     return 'build.make';
    case 'cargo':    return subcommand ? `cargo.${subcommand}` : 'cargo';
    case 'go':       return subcommand ? `go.${subcommand}` : 'go';
    // Linters / formatters
    case 'eslint':   return 'lint.eslint';
    case 'prettier': return 'lint.prettier';
    // File system operations
    case 'rm':       return 'fs.delete';
    case 'cp':       return 'fs.copy';
    case 'mv':       return 'fs.move';
    case 'chmod':    return 'fs.chmod';
    case 'chown':    return 'fs.chown';
    case 'mkdir':    return 'fs.mkdir';
    case 'rsync':    return 'fs.sync';
    // Network commands
    case 'curl':     return 'network.fetch';
    case 'wget':     return 'network.fetch';
    case 'ssh':      return 'network.ssh';
    case 'scp':      return 'network.scp';
    case 'nc':
    case 'netcat':   return 'network.connect';
    default:         return 'unknown';
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Explains a shell command by matching it against the pattern table.
 *
 * Tokenises `command`, finds the first matching {@link CommandRule}, merges
 * static fields with detector output, and returns a {@link CommandExplanation}.
 * Returns a generic fallback explanation when no rule matches.
 */
export function explainCommand(command: string): CommandExplanation {
  const trimmed = command.trim();
  if (!trimmed) {
    return { summary: 'Runs an unrecognised command', effects: [], warnings: [], inferred_action_class: 'unknown' };
  }

  const tokens = trimmed.split(/\s+/);
  const binary = tokens[0]!;
  const subcommand = firstSubcommand(tokens);

  const result = explain(trimmed);

  return {
    summary: result.summary,
    effects: result.effects,
    warnings: result.warnings,
    inferred_action_class: inferActionClass(binary, subcommand),
  };
}

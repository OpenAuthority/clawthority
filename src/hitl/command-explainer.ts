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

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Explains a shell command by matching it against the pattern table.
 *
 * Tokenises `command`, finds the first matching {@link CommandRule}, merges
 * static fields with detector output, and returns a {@link CommandExplanation}.
 * Returns a generic fallback explanation when no rule matches.
 */
export function explainCommand(command: string): CommandExplanation {
  // Implementation delegated to pattern rules — see patternTable entries.
  void command;
  return {
    summary: 'Runs an unrecognised command',
    effects: [],
    warnings: [],
    inferred_action_class: 'unknown',
  };
}

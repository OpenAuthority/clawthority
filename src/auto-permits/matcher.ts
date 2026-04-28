/**
 * Auto-permit pattern matcher.
 *
 * Compiles stored auto-permit patterns to regular expressions and matches
 * incoming command strings against the compiled cache. The tokenisation and
 * pattern grammar mirror those of the pattern derivation engine exactly:
 * a wildcard `*` as the final token means prefix-match; all other patterns
 * produce exact matches over the normalised (tokenised + space-joined) command.
 *
 * @module
 */

import type { AutoPermit } from '../models/auto-permit.js';

// ── Interface ─────────────────────────────────────────────────────────────────

/**
 * Minimal interface for checking a command string against stored auto-permit
 * rules. Accepted by `createCombinedStage2` as an optional file-based
 * auto-permit check that runs before Cedar and JSON rule engine evaluation.
 *
 * Accepting an interface (rather than the concrete class) keeps the stage-2
 * factory decoupled from storage details and makes unit testing
 * straightforward.
 */
export interface AutoPermitRuleChecker {
  /**
   * Returns the first stored rule whose pattern matches `command`, or `null`
   * when no rule matches.
   *
   * An empty string always returns `null`.
   */
  matchCommand(command: string): AutoPermit | null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Shell-aware tokeniser mirroring the private `tokenize` function in
 * `pattern-derivation.ts`. Single- and double-quoted groups are treated as
 * single tokens (quotes stripped); consecutive unquoted spaces are collapsed.
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;

  for (const ch of command) {
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === ' ' && !inDouble && !inSingle) {
      if (current.length > 0) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** Escapes all regex special characters in a literal string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── compilePatternRegex ───────────────────────────────────────────────────────

/**
 * Compiles a validated auto-permit pattern to a `RegExp`.
 *
 * Compilation rules (mirroring the pattern grammar enforced by
 * `validatePattern` in `pattern-derivation.ts`):
 * - Wildcard suffix: `"git commit *"` → `/^git commit( .+)?$/`
 * - Exact match: `"git commit -m msg"` → `/^git commit -m msg$/`
 * - Binary only: `"git"` → `/^git$/`
 *
 * Returns `null` when the pattern string is empty or when compilation fails.
 * A `null` result causes the corresponding rule to be skipped during
 * {@link FileAutoPermitChecker.matchCommand}, so the call falls through to
 * HITL gating — fail-safe behaviour.
 */
export function compilePatternRegex(pattern: string): RegExp | null {
  if (pattern.length === 0) return null;
  try {
    const tokens = pattern.split(' ');
    if (tokens.length === 0 || tokens[0] === '') return null;
    if (tokens[tokens.length - 1] === '*') {
      const prefix = tokens.slice(0, -1).map(escapeRegex).join(' ');
      return new RegExp(`^${prefix}( .+)?$`);
    }
    return new RegExp(`^${tokens.map(escapeRegex).join(' ')}$`);
  } catch {
    return null;
  }
}

/**
 * Normalises a raw command string to its canonical space-joined token form,
 * matching the normalisation applied by `derivePattern` before storing a
 * pattern. Tokenises with the shell-aware tokeniser, then joins the resulting
 * tokens with a single space.
 *
 * @example
 * normalizeCommand('git   commit  -m  "my message"')
 * // → 'git commit -m my message'
 */
function normalizeCommand(command: string): string {
  return tokenize(command.trim()).join(' ');
}

// ── FileAutoPermitChecker ─────────────────────────────────────────────────────

/**
 * In-memory {@link AutoPermitRuleChecker} backed by an array of
 * {@link AutoPermit} records loaded from the auto-permit store.
 *
 * Each pattern is compiled to a `RegExp` on first use and cached for the
 * lifetime of the instance. Failed compilations are cached as `null` so that
 * compilation is not retried on every call — the rule is silently skipped and
 * the command falls through to HITL gating.
 *
 * @example
 * ```ts
 * const checker = new FileAutoPermitChecker(rules);
 * const matched = checker.matchCommand('git commit -m "fix"');
 * // matched?.pattern → 'git commit *'
 * ```
 */
export class FileAutoPermitChecker implements AutoPermitRuleChecker {
  /**
   * Compiled regex cache.
   * Key: pattern string. Value: compiled regex, or `null` if compilation failed.
   */
  private readonly cache = new Map<string, RegExp | null>();

  constructor(private readonly rules: readonly AutoPermit[]) {}

  /** Returns the compiled regex for `pattern`, compiling on first use. */
  private compiled(pattern: string): RegExp | null {
    if (!this.cache.has(pattern)) {
      this.cache.set(pattern, compilePatternRegex(pattern));
    }
    return this.cache.get(pattern) ?? null;
  }

  /**
   * Returns the first stored rule whose pattern matches `command`, or `null`
   * when no rule matches or `command` is empty after normalisation.
   *
   * The command is normalised (tokenised + rejoined) before matching so that
   * quoted arguments and extra whitespace do not prevent a match.
   */
  matchCommand(command: string): AutoPermit | null {
    if (command.length === 0) return null;
    const normalized = normalizeCommand(command);
    if (normalized.length === 0) return null;
    for (const rule of this.rules) {
      const regex = this.compiled(rule.pattern);
      if (regex !== null && regex.test(normalized)) {
        return rule;
      }
    }
    return null;
  }
}

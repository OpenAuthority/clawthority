import type { Rule } from '../types.js';
import defaultRules from './default.js';

/**
 * Merges agent-specific rules with the baseline default rules.
 *
 * Agent-specific rules are prepended so their permit rules take precedence
 * over matching defaults when Cedar's first-permit-wins logic applies.
 * Forbid rules from either set win unconditionally per Cedar semantics
 * regardless of their position in the merged array.
 *
 * Rules are applied based on ctx.agentId at evaluation time: each
 * agent-specific rule carries a condition function that gates it to the
 * matching agent ID prefix, so loading all rules together does not grant
 * cross-agent access.
 *
 * @param agentSpecificRules Rules scoped to one or more agent types.
 * @param baseRules          Baseline rules that apply to all agents.
 */
export function mergeRules(agentSpecificRules: Rule[], baseRules: Rule[]): Rule[] {
  return [...agentSpecificRules, ...baseRules];
}

/**
 * Merged rule set combining all per-agent rule files with the baseline
 * defaults.
 *
 * Import this as the single source of truth when loading rules into a
 * PolicyEngine instance. The agent-specific rules include condition functions
 * that gate them to their respective agent IDs, so rules for one agent type
 * do not affect others.
 */
const allRules: Rule[] = mergeRules(
  [],
  defaultRules,
);

export default allRules;

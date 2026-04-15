/**
 * Budget pricing — model cost estimation table.
 *
 * Provides per-token USD pricing for known Claude models. Used by
 * `BudgetTracker` to attach an estimated cost to every usage event written
 * to `data/budget.jsonl`.
 *
 * Source: https://www.anthropic.com/pricing (verified 2026-04)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Cost rates for a single model, in USD per million tokens. */
export interface ModelPricing {
  /** USD cost per million input (prompt) tokens. */
  inputCostPerMillion: number;
  /** USD cost per million output (completion) tokens. */
  outputCostPerMillion: number;
}

// ─── Pricing table ────────────────────────────────────────────────────────────

/**
 * Published per-token pricing for known Claude models (USD per million tokens).
 *
 * Source: https://www.anthropic.com/pricing — verified 2026-04.
 *
 * Matching rules:
 *   1. Exact key match (e.g. `'claude-sonnet-4-6'`).
 *   2. Prefix match — longest matching prefix wins
 *      (e.g. `'claude-sonnet-4-6-20251022'` → `'claude-sonnet-4-6'`).
 *   3. `'default'` fallback (Sonnet-class pricing) for unrecognised models.
 */
export const PRICING: Readonly<Record<string, ModelPricing>> = {
  // Claude 4.x — https://www.anthropic.com/pricing#api-pricing
  'claude-opus-4-6': { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
  'claude-sonnet-4-6': { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  'claude-haiku-4-5': { inputCostPerMillion: 0.8, outputCostPerMillion: 4.0 },

  // Claude 3.5 — https://www.anthropic.com/pricing#api-pricing
  'claude-3-5-sonnet': { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  'claude-3-5-haiku': { inputCostPerMillion: 0.8, outputCostPerMillion: 4.0 },

  // Claude 3 — https://www.anthropic.com/pricing#api-pricing
  'claude-3-opus': { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
  'claude-3-sonnet': { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  'claude-3-haiku': { inputCostPerMillion: 0.25, outputCostPerMillion: 1.25 },

  // Fallback — Sonnet-class pricing for unrecognised models
  default: { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves pricing for a model identifier.
 *
 * Tries exact match first, then longest-prefix match, then `'default'`.
 *
 * @param model  LLM model identifier (e.g. `'claude-sonnet-4-6-20251022'`).
 */
export function resolvePricing(model: string): ModelPricing {
  const exact = PRICING[model];
  if (exact !== undefined) return exact;

  let bestKey: string | undefined;
  for (const key of Object.keys(PRICING)) {
    if (key === 'default') continue;
    if (model.startsWith(key) && (bestKey === undefined || key.length > bestKey.length)) {
      bestKey = key;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return bestKey !== undefined ? PRICING[bestKey]! : PRICING['default']!;
}

/**
 * Estimates the USD cost for a set of token counts using the model's pricing.
 *
 * @param model         LLM model identifier.
 * @param inputTokens   Input (prompt) tokens consumed.
 * @param outputTokens  Output (completion) tokens generated.
 * @returns             Estimated cost in USD.
 */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = resolvePricing(model);
  return (inputTokens / 1_000_000) * pricing.inputCostPerMillion
       + (outputTokens / 1_000_000) * pricing.outputCostPerMillion;
}

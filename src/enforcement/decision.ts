/**
 * StructuredDecision — enriched authorization decision type layer.
 *
 * Replaces the raw CeeDecision with a richer result that carries provenance
 * data (ruleId) and optional capability metadata through the pipeline.
 *
 * Phase 3 modification plan — 4 files to update:
 *   1. src/envelope.ts (new)         — canonical re-export for buildEnvelope,
 *                                      uuidv7, computePayloadHash, computeContextHash.
 *   2. src/index.ts                  — add Phase 3 re-exports block;
 *                                      update buildEnvelope import to envelope.js.
 *   3. src/adapter/file-adapter.ts   — update uuidv7/computeBinding imports to
 *                                      use envelope.js instead of hitl/approval-manager.js.
 *   4. src/enforcement/stage2-policy.ts (new) — Stage 2 evaluator factory.
 */

import type { CeeDecision } from './pipeline.js';

// ---------------------------------------------------------------------------
// StructuredDecision
// ---------------------------------------------------------------------------

/** Capability metadata bundled into a permitted StructuredDecision. */
export interface CapabilityInfo {
  /** Opaque capability identifier (UUID v7 recommended). */
  id: string;
  /** Unix epoch milliseconds when this capability expires. */
  expiresAt: number;
  /** List of scope strings constraining what this capability authorises. */
  scope: string[];
}

/**
 * Enriched authorization decision produced by the enforcement pipeline.
 *
 * Replaces the flat CeeDecision with a structured result that carries:
 *   - `outcome`    — ternary effect: 'permit' | 'forbid' | 'ask-user'
 *   - `ruleId`     — matched rule identifier for audit traceability
 *   - `reason`     — human-readable explanation (forwarded from CeeDecision)
 *   - `stage`      — pipeline stage that produced this decision
 *   - `capability` — credential metadata when the decision grants access
 */
export interface StructuredDecision {
  /** Authorization outcome. */
  outcome: 'permit' | 'forbid' | 'ask-user';
  /** Human-readable explanation of the decision. */
  reason: string;
  /** Identifier of the rule or stage that produced this decision. */
  ruleId?: string;
  /** Pipeline stage identifier. */
  stage?: string;
  /** Capability metadata present when `outcome === 'permit'`. */
  capability?: CapabilityInfo;
}

// ---------------------------------------------------------------------------
// Conversion utilities
// ---------------------------------------------------------------------------

/**
 * Converts a `CeeDecision` into a `StructuredDecision`.
 *
 * Mapping:
 *   - `effect`  → `outcome`  (direct 1:1; 'ask-user' is not produced by CeeDecision
 *                              but StructuredDecision is a superset)
 *   - `reason`  → `reason`   (forwarded unchanged)
 *   - `stage`   → `stage`    (forwarded unchanged)
 *   - `ruleId`  — not present in CeeDecision; defaults to undefined
 *   - `capability` — not present in CeeDecision; defaults to undefined
 *
 * @param decision  The raw CeeDecision from the enforcement pipeline.
 * @param ruleId    Optional rule identifier to attach for audit traceability.
 * @param capability Optional capability metadata to attach on permit decisions.
 */
export function fromCeeDecision(
  decision: CeeDecision,
  ruleId?: string,
  capability?: CapabilityInfo,
): StructuredDecision {
  return {
    outcome: decision.effect,
    reason: decision.reason,
    ...(decision.stage !== undefined ? { stage: decision.stage } : {}),
    ...(ruleId !== undefined ? { ruleId } : {}),
    ...(capability !== undefined && decision.effect === 'permit' ? { capability } : {}),
  };
}

/**
 * Creates a StructuredDecision for the `ask-user` outcome.
 *
 * Used when a HITL gate has been triggered and a human decision is pending.
 * The caller provides the human-readable reason and optional rule identifier.
 */
export function askUser(reason: string, ruleId?: string): StructuredDecision {
  return {
    outcome: 'ask-user',
    reason,
    ...(ruleId !== undefined ? { ruleId } : {}),
  };
}

/**
 * Creates a StructuredDecision for the `forbid` outcome.
 *
 * Convenience factory for fail-closed error paths.
 */
export function forbidDecision(reason: string, stage?: string): StructuredDecision {
  return {
    outcome: 'forbid',
    reason,
    ...(stage !== undefined ? { stage } : {}),
  };
}

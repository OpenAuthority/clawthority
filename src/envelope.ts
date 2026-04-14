/**
 * Canonical re-export point for execution envelope utilities.
 *
 * Consumers MUST import envelope helpers from this module rather than reaching
 * into `enforcement/pipeline.js` or `hitl/approval-manager.js` directly.
 *
 * Exported surface:
 *   - buildEnvelope       — constructs an ExecutionEnvelope from intent + metadata
 *   - uuidv7              — time-ordered UUID v7 token generator
 *   - computePayloadHash  — deterministic SHA-256 over sorted tool call params
 *   - computeContextHash  — SHA-256 over action_class|target|summary (context binding)
 */

export { buildEnvelope } from './enforcement/pipeline.js';
export { uuidv7 } from './hitl/approval-manager.js';

import { createHash } from 'node:crypto';
import { sortedJsonStringify } from './enforcement/normalize.js';

// ---------------------------------------------------------------------------
// computePayloadHash
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic SHA-256 hash over a tool call parameter map.
 *
 * Keys are sorted with `Array.prototype.sort` using `localeCompare` so the
 * hash is stable regardless of insertion order. Nested object key order is
 * NOT normalised — callers that need nested-key stability must sort
 * recursively before passing params (e.g. via `sortedJsonStringify`).
 *
 * @param toolName  Tool name string, included in the hash input.
 * @param params    Tool call parameters (shallow key-sort applied).
 * @returns Hex-encoded SHA-256 digest.
 */
export function computePayloadHash(
  toolName: string,
  params: Record<string, unknown>,
): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = params[key];
  }
  const payload = JSON.stringify({ tool: toolName, params: sorted });
  return createHash('sha256').update(payload).digest('hex');
}

// ---------------------------------------------------------------------------
// computeContextHash
// ---------------------------------------------------------------------------

/**
 * Computes a SHA-256 context hash using the canonical pipe-separated format.
 *
 * Format: `action_class|target|summary`
 *
 * This matches the `computeBinding` convention in `hitl/approval-manager.ts`
 * and is used to bind an execution context to an authorization decision for
 * traceability.
 *
 * @param action_class  Semantic action class (e.g. 'filesystem.read').
 * @param target        Target resource (e.g. file path, email address).
 * @param summary       Human-readable summary of the intended action.
 * @returns Hex-encoded SHA-256 digest.
 */
export function computeContextHash(
  action_class: string,
  target: string,
  summary: string,
): string {
  return createHash('sha256')
    .update(`${action_class}|${target}|${summary}`)
    .digest('hex');
}

// Re-export sortedJsonStringify for callers needing full recursive key sorting.
export { sortedJsonStringify } from './enforcement/normalize.js';

/**
 * PipelineContext builder.
 *
 * Constructs a fully-populated {@link PipelineContext} from a raw tool call
 * descriptor and caller identity. The normalized action is derived from the
 * tool name and parameters; the payload hash is computed deterministically
 * from those same inputs using the same algorithm as `envelope.computePayloadHash`.
 */

import { createHash } from 'node:crypto';
import type { RuleContext } from '../policy/types.js';
import { normalize_action } from './normalize.js';
import type { PipelineContext } from './pipeline.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw tool call descriptor passed to the context builder. */
export interface ActionDescriptor {
  /** Name of the tool being called (e.g. 'send_email', 'bash'). */
  toolName: string;
  /** Tool call parameters. Defaults to empty object when omitted. */
  params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// buildPipelineContext
// ---------------------------------------------------------------------------

/**
 * Builds a {@link PipelineContext} from a raw action descriptor, caller
 * identity, and an optional pre-issued capability approval ID.
 *
 * - Normalizes the action via `normalize_action` to derive `action_class`,
 *   `target`, `risk`, `hitl_mode`, and `intent_group`.
 * - Computes a deterministic SHA-256 `payload_hash` over the tool name and
 *   shallow-sorted parameters so stage 1 can verify payload binding.
 * - Copies `sessionId` from the rule context into `session_id`.
 *
 * @param action      Raw tool call descriptor (name + params).
 * @param identity    Cedar rule context for the calling agent.
 * @param approval_id Capability approval ID, if already granted.
 */
export function buildPipelineContext(
  action: ActionDescriptor,
  identity: RuleContext,
  approval_id?: string,
): PipelineContext {
  const params = action.params ?? {};
  const normalized = normalize_action(action.toolName, params);
  const payload_hash = _computePayloadHash(action.toolName, params);

  return {
    action_class: normalized.action_class,
    target: normalized.target,
    payload_hash,
    ...(approval_id !== undefined && { approval_id }),
    ...(identity.sessionId !== undefined && { session_id: identity.sessionId }),
    hitl_mode: normalized.hitl_mode,
    rule_context: identity,
    risk: normalized.risk,
    ...(normalized.intent_group !== undefined && { intent_group: normalized.intent_group }),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic SHA-256 hash over a tool call.
 *
 * Input format: `JSON.stringify({ tool: toolName, params: sorted })` where
 * `sorted` is a shallow key-sorted copy of `params`. Matches the algorithm
 * used by `computePayloadHash` in `src/envelope.ts`.
 */
function _computePayloadHash(toolName: string, params: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = params[key];
  }
  const payload = JSON.stringify({ tool: toolName, params: sorted });
  return createHash('sha256').update(payload).digest('hex');
}

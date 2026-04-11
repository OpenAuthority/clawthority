import { PolicyEngine } from '../policy/engine.js';
import type { RuleContext, Resource } from '../policy/types.js';
import type { EvaluationDecision } from '../policy/engine.js';
import type { RiskLevel } from './normalize.js';
import type { ExecutionEnvelope, Intent, Capability, Metadata } from '../types.js';

/** HITL enforcement mode for the capability gate. */
export type HitlMode = 'none' | 'per_request' | 'session_approval';

/** Context threaded through the two-stage enforcement pipeline. */
export interface PipelineContext {
  /** Logical action class (e.g. 'email.send', 'file.delete'). */
  action_class: string;
  /** Target resource of the action (e.g. email address, file path). */
  target: string;
  /** SHA-256 hex digest of the tool call payload used for binding verification. */
  payload_hash: string;
  /** Capability token issued after HITL approval. Absent when no approval has been granted. */
  approval_id?: string;
  /** Session identifier for session-scoped approvals. */
  session_id?: string;
  /** HITL mode driving capability gate behavior in Stage 1. */
  hitl_mode: HitlMode;
  /** Cedar rule evaluation context forwarded to Stage 2. */
  rule_context: RuleContext;
  /** Trust level of the source initiating this action ('user', 'agent', or 'untrusted'). */
  sourceTrustLevel?: string;
  /** Effective risk level of the normalized action. */
  risk?: RiskLevel;
}

export type CeeEffect = 'permit' | 'forbid';

/** Decision produced by a pipeline stage. */
export interface CeeDecision {
  effect: CeeEffect;
  reason: string;
  /** Identifier of the stage that produced this decision. */
  stage?: string;
}

/** Stage 1: capability gate — validates an issued capability token. */
export type Stage1Fn = (ctx: PipelineContext) => Promise<CeeDecision>;

/** Stage 2: policy evaluation — delegates to the Cedar engine. */
export type Stage2Fn = (ctx: PipelineContext) => Promise<CeeDecision>;

/** Maps action-class prefixes to Cedar Resource types. */
const ACTION_CLASS_PREFIXES: ReadonlyArray<readonly [string, Resource]> = [
  ['communication.', 'channel'],
  ['command.', 'command'],
  ['prompt.', 'prompt'],
  ['model.', 'model'],
];

/**
 * Builds an ExecutionEnvelope for the enforcement pipeline, stamping the
 * source trust level into envelope metadata for audit and tracing.
 *
 * @param intent           The agent's stated intent.
 * @param capability       Capability token, or null if not yet approved.
 * @param sourceTrustLevel Trust level of the source issuing the intent.
 * @param sessionId        Session identifier.
 * @param approvalId       UUID v7 of the backing approval, or empty string.
 * @param bundleVersion    Monotonically increasing policy bundle version.
 * @param traceId          Distributed trace identifier.
 */
export function buildEnvelope(
  intent: Intent,
  capability: Capability | null,
  sourceTrustLevel: string,
  sessionId: string,
  approvalId: string,
  bundleVersion: number,
  traceId: string,
): ExecutionEnvelope {
  const metadata: Metadata = {
    session_id: sessionId,
    approval_id: approvalId,
    timestamp: new Date().toISOString(),
    bundle_version: bundleVersion,
    trace_id: traceId,
    source_trust_level: sourceTrustLevel,
  };
  return {
    intent,
    capability,
    metadata,
    provenance: {},
  };
}

/**
 * Extends PolicyEngine with action-class-aware evaluation.
 *
 * Maps action-class prefixes to Cedar Resource types:
 *   communication.* → channel
 *   command.*       → command
 *   prompt.*        → prompt
 *   model.*         → model
 *   (all others)    → tool
 */
export class EnforcementPolicyEngine extends PolicyEngine {
  evaluateByActionClass(
    action_class: string,
    target: string,
    context: RuleContext,
  ): EvaluationDecision {
    let resource: Resource = 'tool';
    for (const [prefix, res] of ACTION_CLASS_PREFIXES) {
      if (action_class.startsWith(prefix)) {
        resource = res;
        break;
      }
    }
    return this.evaluate(resource, target, context);
  }
}

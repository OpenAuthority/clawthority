import { EventEmitter } from 'node:events';
import { PolicyEngine } from '../policy/engine.js';
import type { RuleContext, Resource } from '../policy/types.js';
import type { EvaluationDecision } from '../policy/engine.js';
import type { RiskLevel, IntentGroup } from './normalize.js';
import type { ExecutionEnvelope, Intent, Capability, Metadata } from '../types.js';

/**
 * Returns true when the process is running inside an npm install lifecycle
 * (install, preinstall, postinstall, or prepare). Policy enforcement is
 * bypassed in this phase to prevent blocking bootstrap commands.
 *
 * Detection relies on the `npm_lifecycle_event` environment variable set by
 * npm during lifecycle script execution. Set `OPENAUTH_FORCE_ACTIVE=1` to
 * suppress this bypass in development or CI environments.
 */
export function isInstallPhase(): boolean {
  if (process.env.OPENAUTH_FORCE_ACTIVE === '1') return false;
  const event = process.env.npm_lifecycle_event ?? '';
  return ['install', 'preinstall', 'postinstall', 'prepare'].includes(event);
}

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
  /** Raw source string from the hook event; used by Stage 1 to compute trust level when sourceTrustLevel is absent. */
  source?: string;
  /** Effective risk level of the normalized action. */
  risk?: RiskLevel;
  /** Intent group of the normalized action, used for broad intent-based policy matching. */
  intent_group?: IntentGroup;
}

export type CeeEffect = 'permit' | 'forbid';

/** Decision produced by a pipeline stage. */
export interface CeeDecision {
  effect: CeeEffect;
  reason: string;
  /** Identifier of the stage that produced this decision. */
  stage?: string;
  /**
   * Priority of the matched rule, if applicable.
   *
   * Populated by stage2 from `matchedRule.priority` to allow HITL-dispatch
   * wrappers to distinguish HITL-gated forbids (priority < 100) from
   * unconditional forbids (priority >= 100 or absent).
   */
  priority?: number;
  /**
   * Human-readable rule identifier forwarded from the stage that produced
   * this decision (e.g. `cedar:deny_file_delete`, `trust:untrusted+high`,
   * `intent:data_exfiltration`). Populated by stage closures so the audit
   * event listener can log it without needing inline access to rule metadata.
   */
  rule?: string;
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

/** Result returned by the runPipeline orchestrator. */
export interface OrchestratorResult {
  /** Authorization decision produced by the pipeline. */
  decision: CeeDecision;
  /** Wall-clock time elapsed during pipeline execution, in milliseconds. */
  latency_ms: number;
}

/**
 * Orchestrates the two-stage enforcement pipeline.
 *
 * Execution order:
 *   1. HITL pre-check — if `hitl_mode !== 'none'` and no `approval_id`,
 *      returns `pending_hitl_approval` without invoking either stage.
 *   2. Stage 1 (capability gate) — on `forbid`, returns early without Stage 2.
 *   3. Stage 2 (policy evaluation) — returns its decision.
 *   4. Any thrown error — returns `pipeline_error` forbid (fail-closed).
 *
 * Emits `'executionEvent'` on `emitter` with `{ decision, timestamp }` on
 * every execution path.
 */
export async function runPipeline(
  ctx: PipelineContext,
  stage1: Stage1Fn,
  stage2: Stage2Fn,
  emitter: EventEmitter,
): Promise<OrchestratorResult> {
  const start = Date.now();

  const finish = (decision: CeeDecision): OrchestratorResult => {
    const latency_ms = Date.now() - start;
    emitter.emit('executionEvent', { decision, timestamp: new Date().toISOString() });
    return { decision, latency_ms };
  };

  try {
    // Install phase bypass: skip enforcement during npm install lifecycle.
    if (isInstallPhase()) {
      return finish({ effect: 'permit', reason: 'install_phase_bypass', stage: 'pipeline' });
    }

    // HITL pre-check: approval required but not yet granted.
    if (ctx.hitl_mode !== 'none' && !ctx.approval_id) {
      return finish({ effect: 'forbid', reason: 'pending_hitl_approval', stage: 'hitl' });
    }

    // Stage 1: capability gate.
    const s1 = await stage1(ctx);
    if (s1.effect === 'forbid') {
      return finish(s1);
    }

    // Stage 2: policy evaluation.
    const s2 = await stage2(ctx);
    return finish(s2);
  } catch {
    return finish({ effect: 'forbid', reason: 'pipeline_error', stage: 'pipeline' });
  }
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
  override evaluateByActionClass(
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

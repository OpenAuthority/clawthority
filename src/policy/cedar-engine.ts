/**
 * CedarEngine — Cedar WASM-backed authorization engine for OpenAuthority.
 *
 * Implements the same public API as {@link PolicyEngine} (evaluate /
 * evaluateByActionClass) for seamless drop-in replacement in the enforcement
 * pipeline.  Authorization decisions are delegated to the Cedar WASM runtime
 * via `isAuthorized()`.
 *
 * @example
 * ```typescript
 * import { CedarEngine } from './cedar-engine.js';
 *
 * const engine = new CedarEngine();
 * await engine.init();
 *
 * const decision = engine.evaluate('tool', 'read_file', {
 *   agentId: 'agent-1',
 *   channel: 'default',
 * });
 * // decision.effect === 'permit' | 'forbid'
 * ```
 *
 * @module
 */

import type { RuleContext, Resource, EvaluationDecision } from './types.js';
import { buildEntities, buildResourceEntity } from './cedar-entities.js';

// ---------------------------------------------------------------------------
// Minimal typings for the Cedar WASM Node.js module
// ---------------------------------------------------------------------------

interface CedarIsAuthorizedRequest {
  principal: { type: string; id: string };
  action: { type: string; id: string };
  resource: { type: string; id: string };
  context: Record<string, unknown>;
  /** Cedar policy set. `staticPolicies` accepts a Cedar text string. */
  policies: { staticPolicies?: string };
  /** Cedar entity store — array of entity objects (NOT a JSON string). */
  entities: unknown[];
}

interface CedarAuthorizationAnswer {
  type: 'success' | 'failure';
  response?: {
    decision: 'allow' | 'deny';
    diagnostics: {
      reason: string[];
      errors: unknown[];
    };
  };
  errors?: unknown[];
}

interface CedarWasmModule {
  isAuthorized(request: CedarIsAuthorizedRequest): CedarAuthorizationAnswer;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown when Cedar policy files cannot be loaded, parsed, or schema-validated.
 * Mirrors {@link PolicyLoadError} from `loader.ts` for the Cedar layer.
 */
export class CedarPolicyLoadError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'CedarPolicyLoadError';
  }
}

// ---------------------------------------------------------------------------
// CedarEngine
// ---------------------------------------------------------------------------

/**
 * Cedar WASM-backed policy engine.
 *
 * Call {@link init} once to load the WASM module before calling
 * {@link evaluate} or {@link evaluateByActionClass}.
 */
export interface CedarEngineOptions {
  /**
   * Effect returned when the Cedar WASM module has not yet been initialised
   * (i.e. before {@link init} completes).
   *
   * - `'forbid'` (default) — fail-closed; no tool calls are permitted until
   *   Cedar is ready. Recommended for production deployments.
   * - `'permit'` — fail-open; useful in tests and development environments
   *   where the full WASM module is not loaded.
   */
  defaultEffect?: 'permit' | 'forbid';
}

export class CedarEngine {
  private cedar: CedarWasmModule | null = null;
  private readonly _defaultEffect: 'permit' | 'forbid';

  /** Cedar policy set text (populated externally or by a future loadPolicies() call). */
  policies: string = '';

  constructor(options?: CedarEngineOptions) {
    this._defaultEffect = options?.defaultEffect ?? 'forbid';
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Loads the Cedar WASM module.
   * Must be awaited before any call to {@link evaluate} (unless
   * {@link CedarEngineOptions.defaultEffect} is set to `'permit'`).
   */
  async init(): Promise<void> {
    const mod = await import('@cedar-policy/cedar-wasm/nodejs');
    this.cedar = mod as unknown as CedarWasmModule;
  }

  // ── Evaluation ────────────────────────────────────────────────────────────

  /**
   * Evaluates access for a resource using the Cedar WASM runtime.
   *
   * Cedar `'allow'` → `'permit'`; Cedar `'deny'` or any error → `'forbid'`.
   *
   * @param resource      Resource type (e.g. `'tool'`, `'file'`).
   * @param resourceName  Specific resource being accessed (e.g. `'read_file'`).
   * @param context       Evaluation context forwarded to the Cedar entity store.
   * @returns             An {@link EvaluationDecision} with `effect` and optional `reason`.
   * @throws              `Error` when {@link init} has not been called.
   */
  evaluate(
    resource: Resource,
    resourceName: string,
    context: RuleContext,
    actionClass?: string,
  ): EvaluationDecision {
    if (!this.cedar) {
      return { effect: this._defaultEffect, reason: 'cedar_not_initialized' };
    }

    const entities = buildEntities(context);
    if (actionClass !== undefined) {
      entities.push(buildResourceEntity(resource, resourceName, actionClass));
    }

    const request: CedarIsAuthorizedRequest = {
      principal: { type: 'OpenAuthority::Agent', id: context.agentId },
      action:    { type: 'OpenAuthority::Action', id: 'RequestAccess' },
      resource:  { type: 'OpenAuthority::Resource', id: `${resource}:${resourceName}` },
      context:   {},
      policies:  { staticPolicies: this.policies },
      entities,
    };

    const answer = this.cedar.isAuthorized(request);

    if (answer.type === 'success' && answer.response?.decision === 'allow') {
      return { effect: 'permit' };
    }

    const reasons = answer.response?.diagnostics?.reason ?? [];
    return {
      effect: 'forbid',
      ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    };
  }

  /**
   * Maps a semantic action class to a Cedar resource type then delegates to
   * {@link evaluate}.  Mirrors {@link PolicyEngine.evaluateByActionClass}.
   *
   * Action class prefix → Resource mapping:
   * - `filesystem.*`              → `'file'`
   * - `communication.*`           → `'external'`
   * - `payment.*`                 → `'payment'`
   * - `system.*`                  → `'system'`
   * - `credential.*`              → `'credential'`
   * - `browser.*`                 → `'web'`
   * - `memory.*`                  → `'memory'`
   * - `unknown_sensitive_action`  → `'unknown'`
   * - *(anything else)*           → `'unknown'`
   *
   * @param actionClass   Semantic action class (e.g. `'filesystem.read'`).
   * @param resourceName  Specific target resource being accessed.
   * @param context       Evaluation context forwarded to {@link evaluate}.
   * @returns             An {@link EvaluationDecision} with Cedar semantics applied.
   */
  evaluateByActionClass(
    actionClass: string,
    resourceName: string,
    context: RuleContext,
  ): EvaluationDecision {
    const resource = CedarEngine.mapActionClassToResource(actionClass);
    return this.evaluate(resource, resourceName, context, actionClass);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private static mapActionClassToResource(actionClass: string): Resource {
    if (actionClass === 'unknown_sensitive_action') return 'unknown';
    const prefix = actionClass.split('.')[0];
    switch (prefix) {
      case 'filesystem':    return 'file';
      case 'communication': return 'external';
      case 'payment':       return 'payment';
      case 'system':        return 'system';
      case 'credential':    return 'credential';
      case 'browser':       return 'web';
      case 'memory':        return 'memory';
      default:              return 'unknown';
    }
  }
}

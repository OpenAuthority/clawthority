/**
 * Cedar-style policy engine for OpenAuthority.
 *
 * Evaluates access control rules against a `(resource, name, context)` triple
 * using Cedar semantics: an explicit `forbid` rule always wins over any number
 * of `permit` rules for the same resource. Rate limiting is applied to `permit`
 * rules only — a rate-limited permit is surfaced as a `forbid` decision.
 *
 * @example
 * ```typescript
 * import { PolicyEngine } from './engine.js';
 * import defaultRules from './rules/default.js';
 *
 * const engine = new PolicyEngine({ defaultEffect: 'forbid' });
 * engine.addRules(defaultRules);
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
import type { Rule, RuleContext, Resource } from './types.js';

export type EvaluationEffect = 'permit' | 'forbid';

/** Rate limit status included in evaluation decisions when a rule carries rateLimit config. */
export interface RateLimitStatus {
  /** Whether this call was blocked by the rate limit */
  limited: boolean;
  /** Configured max calls for the matched rule */
  maxCalls: number;
  /** Configured window size in seconds for the matched rule */
  windowSeconds: number;
  /** Number of calls recorded in the current window (including this one if permitted) */
  currentCount: number;
  /** Timestamp (ms epoch) when the oldest in-window call expires; undefined if window is empty */
  oldestCallExpiresAt?: number;
}

/**
 * Decision returned by {@link PolicyEngine.evaluate} and
 * {@link PolicyEngine.evaluateByActionClass}.
 */
export interface EvaluationDecision {
  /** Authorization effect. */
  effect: EvaluationEffect;
  /** Human-readable explanation of the decision. */
  reason?: string;
  /** The rule whose effect determined the outcome. */
  matchedRule?: Rule;
  /** Present when rate limiting was evaluated for this decision. */
  rateLimit?: RateLimitStatus;
}

export interface PolicyEngineOptions {
  /**
   * Interval in milliseconds for automatic cleanup of expired rate-limit window entries.
   * Set to 0 to disable automatic cleanup (call cleanup() manually instead).
   * Defaults to 0.
   */
  cleanupIntervalMs?: number;

  /**
   * Default effect when no rule matches a request.
   * - `'permit'` (default) — implicit permit. No matching rule = allowed. Safe for plugin environments like OpenClaw where blocking unknown tools would break the agent.
   * - `'forbid'` — implicit deny, Cedar-standard. No matching rule = denied. Use for locked-down production deployments.
   */
  defaultEffect?: 'permit' | 'forbid';
}

function matchesPattern(pattern: string | RegExp, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern instanceof RegExp) return pattern.test(value);
  return pattern.toLowerCase() === value.toLowerCase();
}

type TimerHandle = { unref?: () => void };

const timerApi = globalThis as unknown as {
  setInterval: (callback: () => void, delay: number) => TimerHandle;
  clearInterval: (timer: TimerHandle) => void;
};

export class PolicyEngine {
  private _rules: Rule[] = [];
  private readonly _defaultEffect: 'permit' | 'forbid';

  /** Read-only view of loaded rules (for diagnostics / logging). */
  get rules(): readonly Rule[] {
    return this._rules;
  }
  /** Per-rule, per-(agentId:resourceName) sliding-window call timestamps. */
  private rateLimitTracking: Map<Rule, Map<string, number[]>> = new Map();
  private cleanupTimer?: TimerHandle;

  constructor(options: PolicyEngineOptions = {}) {
    this._defaultEffect = options.defaultEffect ?? 'permit';
    const intervalMs = options.cleanupIntervalMs ?? 0;
    if (intervalMs > 0) {
      this.cleanupTimer = timerApi.setInterval(() => this.cleanup(), intervalMs);
      // Don't block process exit
      this.cleanupTimer.unref?.();
    }
  }

  /**
   * Appends a single rule to the engine's rule set.
   *
   * @param rule  The rule to add.
   */
  addRule(rule: Rule): void {
    this._rules.push(rule);
  }

  /**
   * Appends an array of rules to the engine's rule set.
   * Rules are added in the order they appear in `rules`.
   *
   * @param rules  Rules to add.
   */
  addRules(rules: Rule[]): void {
    for (const rule of rules) {
      this._rules.push(rule);
    }
  }

  /**
   * Removes all rules and clears rate-limit tracking state.
   * After this call the engine behaves as if newly constructed.
   */
  clearRules(): void {
    this._rules = [];
    this.rateLimitTracking.clear();
  }

  /**
   * Remove expired time-window entries from rate-limit tracking to keep memory bounded.
   * Called automatically if cleanupIntervalMs > 0; otherwise call manually as needed.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [rule, windowMap] of this.rateLimitTracking) {
      if (!rule.rateLimit) continue;
      const windowMs = rule.rateLimit.windowSeconds * 1000;
      for (const [key, timestamps] of windowMap) {
        const fresh = timestamps.filter(ts => now - ts < windowMs);
        if (fresh.length === 0) {
          windowMap.delete(key);
        } else {
          windowMap.set(key, fresh);
        }
      }
      if (windowMap.size === 0) {
        this.rateLimitTracking.delete(rule);
      }
    }
  }

  /** Stop the automatic cleanup timer if one was started. */
  destroy(): void {
    if (this.cleanupTimer !== undefined) {
      timerApi.clearInterval(this.cleanupTimer);
      delete this.cleanupTimer;
    }
  }

  /**
   * Evaluates access for a resource using Cedar-style semantics:
   * - an explicit `forbid` rule wins over any number of `permit` rules
   * - rate-limited `permit` rules produce a `forbid` decision when the window is exceeded
   * - when no rule matches, the configurable `defaultEffect` applies (default: `'permit'`)
   *
   * @param resource      Resource type to match rules against (e.g. `'tool'`, `'channel'`).
   * @param resourceName  Name of the specific resource being accessed (e.g. `'read_file'`).
   * @param context       Evaluation context — agent ID, channel, and optional metadata.
   * @returns             An `EvaluationDecision` carrying the effect, optional reason,
   *                      matched rule reference, and rate-limit status if applicable.
   */
  evaluate(
    resource: Resource,
    resourceName: string,
    context: RuleContext
  ): EvaluationDecision {
    const matchingRules: Rule[] = [];

    for (const rule of this._rules) {
      if (rule.resource !== resource) continue;
      if (rule.match === undefined) continue;
      if (!matchesPattern(rule.match, resourceName)) continue;
      if (rule.condition !== undefined && !rule.condition(context)) continue;
      matchingRules.push(rule);
    }

    // Cedar semantics: any explicit forbid wins immediately; no rate-limit check needed
    for (const rule of matchingRules) {
      if (rule.effect === 'forbid') {
        return {
          effect: 'forbid',
          ...(rule.reason !== undefined ? { reason: rule.reason } : {}),
          matchedRule: rule,
        };
      }
    }

    // Check permit rules, enforcing rate limits where configured
    for (const rule of matchingRules) {
      if (rule.effect === 'permit') {
        if (rule.rateLimit) {
          const rl = this.checkAndRecordRateLimit(rule, resourceName, context);
          if (rl.exceeded) {
            const { maxCalls, windowSeconds } = rule.rateLimit;
            return {
              effect: 'forbid',
              reason: `Rate limit exceeded: ${maxCalls} calls per ${windowSeconds}s`,
              matchedRule: rule,
              rateLimit: {
                limited: true,
                maxCalls,
                windowSeconds,
                currentCount: rl.currentCount,
                ...(rl.oldestCallExpiresAt !== undefined
                  ? { oldestCallExpiresAt: rl.oldestCallExpiresAt }
                  : {}),
              },
            };
          }
          return {
            effect: 'permit',
            ...(rule.reason !== undefined ? { reason: rule.reason } : {}),
            matchedRule: rule,
            rateLimit: {
              limited: false,
              maxCalls: rule.rateLimit.maxCalls,
              windowSeconds: rule.rateLimit.windowSeconds,
              currentCount: rl.currentCount,
              ...(rl.oldestCallExpiresAt !== undefined
                ? { oldestCallExpiresAt: rl.oldestCallExpiresAt }
                : {}),
            },
          };
        }
        return {
          effect: 'permit',
          ...(rule.reason !== undefined ? { reason: rule.reason } : {}),
          matchedRule: rule,
        };
      }
    }

    // No matching rule — apply configured default effect
    return {
      effect: this._defaultEffect,
      reason: this._defaultEffect === 'forbid'
        ? 'No matching rule; implicit deny'
        : 'No matching rule; implicit permit',
    };
  }

  /**
   * Maps an action class string to a Cedar resource type then delegates to
   * {@link evaluate}. Use this when the caller works with semantic action
   * classes (e.g. `'filesystem.read'`) rather than raw resource types.
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
   * @returns             An `EvaluationDecision` with Cedar semantics applied.
   */
  evaluateByActionClass(
    actionClass: string,
    resourceName: string,
    context: RuleContext
  ): EvaluationDecision {
    const resource = PolicyEngine.mapActionClassToResource(actionClass);
    return this.evaluate(resource, resourceName, context);
  }

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

  private checkAndRecordRateLimit(
    rule: Rule,
    resourceName: string,
    context: RuleContext
  ): { exceeded: boolean; currentCount: number; oldestCallExpiresAt?: number } {
    const { maxCalls, windowSeconds } = rule.rateLimit!;
    const windowMs = windowSeconds * 1000;
    const now = Date.now();
    const trackingKey = `${context.agentId}:${resourceName}`;

    if (!this.rateLimitTracking.has(rule)) {
      this.rateLimitTracking.set(rule, new Map());
    }
    const windowMap = this.rateLimitTracking.get(rule)!;

    // Slide the window: drop timestamps older than windowMs
    const prev = windowMap.get(trackingKey) ?? [];
    const fresh = prev.filter(ts => now - ts < windowMs);

    if (fresh.length >= maxCalls) {
      // Limit exceeded; do not record this call
      windowMap.set(trackingKey, fresh);
      const oldestCallExpiresAt =
        fresh.length > 0 ? Math.min(...fresh) + windowMs : undefined;
      return {
        exceeded: true,
        currentCount: fresh.length,
        ...(oldestCallExpiresAt !== undefined ? { oldestCallExpiresAt } : {}),
      };
    }

    // Within limit; record this call
    fresh.push(now);
    windowMap.set(trackingKey, fresh);
    const oldestCallExpiresAt = Math.min(...fresh) + windowMs;
    return { exceeded: false, currentCount: fresh.length, oldestCallExpiresAt };
  }
}

import type { Rule, RuleContext, Resource } from './types.js';

export type EvaluationEffect = 'permit' | 'forbid' | 'deny';

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

export interface EvaluationDecision {
  effect: EvaluationEffect;
  reason?: string;
  matchedRule?: Rule;
  /** Present when rate limiting was evaluated for this decision */
  rateLimit?: RateLimitStatus;
}

export interface PolicyEngineOptions {
  /**
   * Interval in milliseconds for automatic cleanup of expired rate-limit window entries.
   * Set to 0 to disable automatic cleanup (call cleanup() manually instead).
   * Defaults to 0.
   */
  cleanupIntervalMs?: number;
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

  /** Read-only view of loaded rules (for diagnostics / logging). */
  get rules(): readonly Rule[] {
    return this._rules;
  }
  /** Per-rule, per-(agentId:resourceName) sliding-window call timestamps. */
  private rateLimitTracking: Map<Rule, Map<string, number[]>> = new Map();
  private cleanupTimer?: TimerHandle;

  constructor(options: PolicyEngineOptions = {}) {
    const intervalMs = options.cleanupIntervalMs ?? 0;
    if (intervalMs > 0) {
      this.cleanupTimer = timerApi.setInterval(() => this.cleanup(), intervalMs);
      // Don't block process exit
      this.cleanupTimer.unref?.();
    }
  }

  addRule(rule: Rule): void {
    this._rules.push(rule);
  }

  addRules(rules: Rule[]): void {
    for (const rule of rules) {
      this._rules.push(rule);
    }
  }

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
   * Evaluate access for a resource using Cedar-style semantics:
   * - explicit forbid wins over permit
   * - rate-limited permits synthesize a forbid decision
   * - implicit deny when no rules match
   */
  evaluate(
    resource: Resource,
    resourceName: string,
    context: RuleContext
  ): EvaluationDecision {
    const matchingRules: Rule[] = [];

    for (const rule of this._rules) {
      if (rule.resource !== resource) continue;
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

    // Implicit permit — allow unless explicitly forbidden
    return { effect: 'permit', reason: 'No matching rule; implicit permit' };
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

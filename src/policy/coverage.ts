import type { Rule, Resource } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The coverage state of a single resource/name cell.
 *
 * - `'unchecked'` — this pair has never been evaluated by the engine.
 * - `'permit'`    — the most recent evaluation resulted in a permit.
 * - `'forbid'`    — the most recent evaluation resulted in a forbid.
 * - `'rate-limited'` — the most recent evaluation was blocked by rate limiting.
 */
export type CoverageState = 'unchecked' | 'permit' | 'forbid' | 'rate-limited';

/**
 * Data associated with a single (resource, name) coverage cell.
 * Used by the dashboard to render the CoverageMap grid.
 */
export interface CoverageCell {
  /** Most recent evaluation outcome for this cell. */
  state: CoverageState;
  /** Total number of times this cell has been recorded. */
  hitCount: number;
  /** ISO 8601 timestamp of the most recent hit; absent until first hit. */
  lastHitAt?: string;
  /**
   * Rate limit config from the matched rule, when present.
   * The dashboard renders a ⏱ badge on cells where this field is defined.
   */
  rateLimit?: { maxCalls: number; windowSeconds: number };
}

/** A single row returned by {@link CoverageMap.entries}. */
export interface CoverageEntry {
  resource: Resource;
  name: string;
  cell: CoverageCell;
}

// ─── CoverageMap ──────────────────────────────────────────────────────────────

/**
 * Backend data structure for the OpenAuthority CoverageMap dashboard component.
 *
 * Tracks which (resource, name) pairs have been evaluated by a PolicyEngine and
 * what the outcome was. Each call to {@link record} increments the hit counter
 * and updates the cell state. Cells that have never been recorded are not stored
 * internally; callers receive `undefined` from {@link get} for unseen pairs.
 *
 * The CoverageMap is intentionally decoupled from the PolicyEngine: callers are
 * responsible for calling {@link record} after each evaluation decision.
 */
export class CoverageMap {
  private readonly cells = new Map<string, CoverageCell>();

  /** Build the internal map key from resource type and resource name. */
  private cellKey(resource: Resource, name: string): string {
    return `${resource}::${name}`;
  }

  /**
   * Records an evaluation result for the given resource/name pair.
   *
   * On each call the hit counter is incremented, `lastHitAt` is updated to the
   * current UTC time, and `state` is overwritten with `state`. If `matchedRule`
   * carries a `rateLimit` config it is stored on the cell so the dashboard can
   * render the ⏱ badge; otherwise the existing `rateLimit` value is retained.
   *
   * @param resource    The resource type that was evaluated.
   * @param name        The resource name (tool name, command, channel, etc.).
   * @param state       The outcome of the evaluation (never `'unchecked'`).
   * @param matchedRule The rule that produced the decision, if any.
   */
  record(
    resource: Resource,
    name: string,
    state: Exclude<CoverageState, 'unchecked'>,
    matchedRule?: Rule,
  ): void {
    const key = this.cellKey(resource, name);
    const existing = this.cells.get(key);
    const hitCount = (existing?.hitCount ?? 0) + 1;
    const lastHitAt = new Date().toISOString();

    const rateLimit =
      matchedRule?.rateLimit !== undefined
        ? { maxCalls: matchedRule.rateLimit.maxCalls, windowSeconds: matchedRule.rateLimit.windowSeconds }
        : existing?.rateLimit;

    const cell: CoverageCell = rateLimit !== undefined
      ? { state, hitCount, lastHitAt, rateLimit }
      : { state, hitCount, lastHitAt };

    this.cells.set(key, cell);
  }

  /**
   * Returns the current cell for the given resource/name pair, or `undefined`
   * if the pair has never been recorded.
   */
  get(resource: Resource, name: string): CoverageCell | undefined {
    return this.cells.get(this.cellKey(resource, name));
  }

  /**
   * Returns all recorded cells as an array of {@link CoverageEntry} objects.
   * The order matches insertion order (i.e. first-seen first).
   */
  entries(): CoverageEntry[] {
    return [...this.cells.entries()].map(([key, cell]) => {
      const sep = key.indexOf('::');
      const resource = key.slice(0, sep) as Resource;
      const name = key.slice(sep + 2);
      return { resource, name, cell };
    });
  }

  /** Clears all recorded cells, resetting the map to its initial empty state. */
  reset(): void {
    this.cells.clear();
  }
}

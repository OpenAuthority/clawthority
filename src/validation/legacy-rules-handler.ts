/**
 * Legacy rules.json compatibility handler.
 *
 * Processes rule records that use the deprecated `resource: 'command'` format,
 * which predates the action-class semantic evaluation system. When a rule with
 * `resource: 'command'` is detected:
 *
 *   1. A `console.warn` deprecation notice is emitted (with migration suggestion).
 *   2. An immutable audit entry is appended to the handler's in-memory log.
 *   3. The rule is normalised: `resource` is rewritten from `'command'` to
 *      `'tool'` so it is evaluated correctly by the Cedar engine.
 *
 * Compatibility guarantee:
 *   `resource: 'command'` rules are supported through one major version.
 *   They will be removed in the next major version. Migrate to
 *   `resource: 'tool'` for direct tool-name matching, or to `action_class`
 *   for semantic action-class matching.
 *
 * @see P-09
 */

import type { JsonlAuditLogger } from '../audit.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A rule record in the legacy `resource: 'command'` format.
 *
 * This format was used in early versions of `data/rules.json` before the
 * `resource: 'tool'` and `action_class` forms were introduced. It is still
 * accepted but deprecated.
 */
export interface LegacyCommandRule {
  /** Rule effect. */
  effect: 'permit' | 'forbid';
  /** Legacy resource type (deprecated). Use `'tool'` or `action_class` instead. */
  resource: 'command';
  /** Pattern or regex source matched against the command/tool name. */
  match: string;
  /** Optional rule priority. */
  priority?: number;
  /** Human-readable reason for the rule. */
  reason?: string;
  /** Rule tags for filtering / categorisation. */
  tags?: string[];
  [key: string]: unknown;
}

/**
 * A rule record in any supported format.
 *
 * Modern records use `resource: 'tool'` or `action_class` / `intent_group`.
 * Legacy records use `resource: 'command'` and are normalised by
 * {@link LegacyRulesHandler.process}.
 */
export interface AnyRuleRecord {
  effect: 'permit' | 'forbid';
  resource?: string;
  match?: string;
  action_class?: string;
  intent_group?: string;
  priority?: number;
  reason?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Audit entry emitted for every legacy `resource: 'command'` rule encountered.
 *
 * Appended to the handler's in-memory audit log and, when a
 * {@link JsonlAuditLogger} is supplied, also persisted to disk.
 */
export interface LegacyRuleAuditEntry {
  /** ISO 8601 timestamp of the detection event. */
  readonly ts: string;
  /** Entry type marker. */
  readonly type: 'legacy-rule';
  /** Audit stage identifier. */
  readonly stage: 'legacy-rule';
  /** The deprecated resource value that triggered this entry. */
  readonly originalResource: 'command';
  /** Match pattern from the legacy rule. */
  readonly match: string;
  /** Effect of the legacy rule. */
  readonly effect: 'permit' | 'forbid';
  /** Original reason field, if present. */
  readonly reason?: string;
  /** Migration suggestion included in the deprecation warning. */
  readonly migrationHint: string;
}

/**
 * Result returned by {@link LegacyRulesHandler.process}.
 *
 * `rules` contains all input records with legacy `resource: 'command'` entries
 * rewritten to `resource: 'tool'`. `legacyCount` is the number of legacy rules
 * that were detected and normalised. `auditEntries` mirrors the entries
 * appended to the handler's audit log during this call.
 */
export interface LegacyRulesProcessResult {
  /** Normalised rule records ready for the Cedar engine. */
  readonly rules: AnyRuleRecord[];
  /** Number of legacy `resource: 'command'` rules detected and normalised. */
  readonly legacyCount: number;
  /**
   * Audit entries produced for legacy rules during this call.
   * Empty when no legacy rules were found.
   */
  readonly auditEntries: ReadonlyArray<LegacyRuleAuditEntry>;
}

/** Options for constructing a {@link LegacyRulesHandler}. */
export interface LegacyRulesHandlerOptions {
  /**
   * Audit logger for persisting legacy-rule audit entries.
   *
   * When omitted, entries are still captured in the in-memory
   * {@link LegacyRulesHandler.getAuditLog} but not written to disk.
   */
  readonly logger?: Pick<JsonlAuditLogger, 'log'>;
  /**
   * Clock function returning the current `Date`.
   *
   * Overridable in tests to simulate time without mocking globals.
   *
   * @default () => new Date()
   */
  readonly clock?: () => Date;
  /**
   * Warning emitter.
   *
   * Defaults to `console.warn`. Override in tests to capture warnings without
   * polluting the test output.
   *
   * @default console.warn
   */
  readonly warn?: (...args: unknown[]) => void;
}

// ─── LegacyRulesHandler ───────────────────────────────────────────────────────

/**
 * Normalises rule records in the deprecated `resource: 'command'` format and
 * surfaces deprecation warnings with migration guidance.
 *
 * The handler is intentionally stateful (audit log accumulates across calls)
 * and injectable (clock, logger, warn emitter). Construct a fresh instance per
 * test suite to guarantee isolation.
 *
 * ### Migration guide
 *
 * **Before (legacy):**
 * ```json
 * { "effect": "forbid", "resource": "command", "match": "bash" }
 * ```
 *
 * **After — direct tool-name matching (preferred for single tool names):**
 * ```json
 * { "effect": "forbid", "resource": "tool", "match": "bash" }
 * ```
 *
 * **After — semantic action-class matching (preferred for whole action groups):**
 * ```json
 * { "effect": "forbid", "action_class": "shell.exec" }
 * ```
 *
 * @example
 * ```ts
 * const handler = new LegacyRulesHandler({ logger });
 *
 * const { rules, legacyCount } = handler.process(rawRecords);
 * // legacyCount — how many legacy rules were found
 * // rules      — normalised records ready for the Cedar engine
 * ```
 */
export class LegacyRulesHandler {
  private readonly logger: Pick<JsonlAuditLogger, 'log'> | undefined;
  private readonly clock: () => Date;
  private readonly warn: (...args: unknown[]) => void;

  /** Immutable audit trail accumulated across all {@link process} calls. */
  private readonly auditLog: LegacyRuleAuditEntry[] = [];

  constructor(options: LegacyRulesHandlerOptions = {}) {
    this.logger = options.logger;
    this.clock = options.clock ?? (() => new Date());
    this.warn = options.warn ?? ((...args) => console.warn(...args));
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  /**
   * Returns `true` when the given record uses the legacy `resource: 'command'`
   * format that must be normalised.
   */
  static isLegacyRule(record: AnyRuleRecord): record is LegacyCommandRule {
    return record.resource === 'command';
  }

  /**
   * Builds the migration hint string embedded in deprecation warnings and
   * audit entries.
   *
   * The hint recommends the two modern equivalents in order of preference:
   * 1. `resource: 'tool'` — for direct tool-name matching (simplest migration).
   * 2. `action_class` — for semantic matching that covers all aliases.
   */
  static buildMigrationHint(record: LegacyCommandRule): string {
    const matchRepr = JSON.stringify(record.match);
    return (
      `Replace \`resource: 'command'\` with \`resource: 'tool'\` for direct tool-name ` +
      `matching: { "resource": "tool", "match": ${matchRepr} }. ` +
      `For broader semantic matching use \`action_class\` (e.g. "shell.exec", ` +
      `"filesystem.read") — see docs/configuration.md for the full action-class list.`
    );
  }

  // ── Main API ──────────────────────────────────────────────────────────────

  /**
   * Processes an array of rule records, normalising any legacy
   * `resource: 'command'` entries to `resource: 'tool'`.
   *
   * For each legacy rule detected:
   *   1. A deprecation warning is emitted via the configured warn emitter.
   *   2. An audit entry is appended to the in-memory log and, when a logger
   *      was supplied, persisted to disk.
   *   3. The record's `resource` field is rewritten to `'tool'`.
   *
   * Non-legacy records are passed through unchanged.
   *
   * @param records  Raw rule records from `data/rules.json` or equivalent.
   * @returns        Normalised records and detection metadata.
   */
  async process(records: AnyRuleRecord[]): Promise<LegacyRulesProcessResult> {
    const normalized: AnyRuleRecord[] = [];
    const sessionEntries: LegacyRuleAuditEntry[] = [];

    for (const record of records) {
      if (LegacyRulesHandler.isLegacyRule(record)) {
        const ts = this.clock().toISOString();
        const migrationHint = LegacyRulesHandler.buildMigrationHint(record);

        this.warn(
          `[clawthority] DEPRECATION: Rule with resource: 'command' (match: ${JSON.stringify(record.match)}, ` +
          `effect: ${record.effect}) is deprecated and will be removed in the next major version. ` +
          migrationHint,
        );

        const entry: LegacyRuleAuditEntry = {
          ts,
          type: 'legacy-rule',
          stage: 'legacy-rule',
          originalResource: 'command',
          match: record.match,
          effect: record.effect,
          ...(record.reason !== undefined ? { reason: record.reason } : {}),
          migrationHint,
        };

        this.auditLog.push(entry);
        sessionEntries.push(entry);

        if (this.logger !== undefined) {
          await this.logger.log(entry);
        }

        // Normalise: rewrite resource from 'command' → 'tool'
        const { resource: _discarded, ...rest } = record;
        normalized.push({ ...rest, resource: 'tool' });
      } else {
        normalized.push(record);
      }
    }

    return {
      rules: normalized,
      legacyCount: sessionEntries.length,
      auditEntries: sessionEntries,
    };
  }

  // ── Query methods ─────────────────────────────────────────────────────────

  /**
   * Returns a snapshot of all audit entries accumulated across all
   * {@link process} calls, in chronological order.
   *
   * Returns a new array on each call; mutations do not affect the handler's
   * internal state.
   */
  getAuditLog(): ReadonlyArray<LegacyRuleAuditEntry> {
    return [...this.auditLog];
  }

  /**
   * Total count of legacy `resource: 'command'` rules detected across all
   * {@link process} calls.
   */
  get totalLegacyCount(): number {
    return this.auditLog.length;
  }
}

// ─── Default instance ─────────────────────────────────────────────────────────

/**
 * Shared `LegacyRulesHandler` instance for production use.
 *
 * Tests should construct their own `new LegacyRulesHandler()` to avoid
 * cross-test state leakage.
 */
export const defaultLegacyRulesHandler = new LegacyRulesHandler();

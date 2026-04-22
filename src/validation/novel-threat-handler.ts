/**
 * Novel threat vector handler.
 *
 * Provides structured response for novel threat vectors by routing them to
 * fine-grained tool creation or Cedar rule addition. Command-string regex
 * patterns are never used; all analysis is performed via Cedar-style typed
 * field rules over structured evidence records.
 *
 * Resolution paths:
 *   - `fine-grained-tool`: Files an RFC (G-01) to create a new action class / tool.
 *   - `cedar-rule`:        Registers a new Cedar-style typed field rule for use
 *                          with {@link AgentObfuscationDetector}.
 *
 * Both paths:
 *   - Record the threat vector pattern by category (de-duplicated aggregation).
 *   - Append an immutable entry to the handler's audit log.
 *
 * Integration points:
 *   - G-01 (RFCProcessor): Fine-grained-tool path files a `CapabilityRequest` RFC.
 *   - T89 (AgentObfuscationDetector): Registered Cedar rules are compatible with
 *     `additionalRules` passed to the detector constructor.
 *   - T177 (MCPToolGate): Fine-grained-tool RFCs propose new action classes for
 *     the MCP gate alias index.
 *
 * @see T89
 * @see T177
 */

import { randomUUID } from 'node:crypto';
import type { CedarFieldRule } from './agent-obfuscation-detector.js';
import { RFCProcessor, type CapabilityRequest, type RFC } from './rfc-processor.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Resolution path for a novel threat vector. */
export type ThreatResolutionPath = 'fine-grained-tool' | 'cedar-rule';

/**
 * A threat vector pattern tracked across multiple submissions of the same
 * category. Occurrence counts and timestamps are updated on each new
 * submission for the same `category` key.
 */
export interface ThreatVectorPattern {
  /** Threat category identifier (e.g. `'injection'`, `'exfiltration'`). */
  readonly category: string;
  /** Human-readable description of the threat pattern. */
  readonly description: string;
  /** ISO 8601 timestamp when this pattern was first observed. */
  readonly firstSeenAt: string;
  /** ISO 8601 timestamp when this pattern was most recently observed. */
  lastSeenAt: string;
  /** Total number of threat vectors submitted with this category. */
  occurrences: number;
  /** IDs of all threat vectors that matched this pattern, in receipt order. */
  readonly threatIds: string[];
}

/** A single audit entry for a novel threat handling event. */
export interface ThreatAuditEntry {
  /** ISO 8601 timestamp of the event. */
  readonly ts: string;
  /** Event type. */
  readonly event:
    | 'threat_received'
    | 'rfc_filed'
    | 'cedar_rule_registered'
    | 'tool_creation_initiated';
  /** UUID of the threat vector that triggered this entry. */
  readonly threatId: string;
  /** Human-readable description of what occurred. */
  readonly detail: string;
  /** Actor that triggered the event (agent ID, user ID, etc.). */
  readonly actor?: string;
}

/**
 * Submission for a novel threat that resolves via a new fine-grained tool.
 *
 * An RFC is filed via the G-01 path with the supplied `capabilityRequest`,
 * proposing a new action class for the @openclaw/action-registry.
 */
export interface ToolCreationSubmission {
  readonly resolutionPath: 'fine-grained-tool';
  /** Human-readable description of the novel threat. */
  readonly description: string;
  /**
   * Threat category used for pattern tracking.
   *
   * Use a stable, lowercase kebab-case identifier (e.g. `'dns-exfiltration'`).
   * Multiple submissions with the same `category` are aggregated into one
   * {@link ThreatVectorPattern}.
   */
  readonly category: string;
  /**
   * Structured evidence for the threat.
   *
   * Must contain only typed field values (strings, numbers, booleans, objects).
   * Raw command strings and regex pattern strings must NOT be included here;
   * use Cedar-style typed field predicates instead.
   */
  readonly evidence: Record<string, unknown>;
  /** Actor reporting this threat (agent ID, user ID, etc.). */
  readonly reportedBy: string;
  /** Structured proposal for the new action class / tool to be created. */
  readonly capabilityRequest: CapabilityRequest;
}

/**
 * Submission for a novel threat that resolves via a new Cedar-style typed
 * field rule.
 *
 * The rule is immediately registered in the handler and returned in the
 * result, ready to be passed as `additionalRules` to
 * {@link AgentObfuscationDetector}.
 */
export interface CedarRuleSubmission {
  readonly resolutionPath: 'cedar-rule';
  /** Human-readable description of the novel threat. */
  readonly description: string;
  /**
   * Threat category used for pattern tracking.
   *
   * Use a stable, lowercase kebab-case identifier (e.g. `'encoding-obfuscation'`).
   */
  readonly category: string;
  /**
   * Structured evidence for the threat.
   *
   * Must contain only typed field values. Raw command strings and regex
   * pattern strings must NOT be included here; the Cedar rule's `when`
   * predicate encapsulates the typed detection logic.
   */
  readonly evidence: Record<string, unknown>;
  /** Actor reporting this threat (agent ID, user ID, etc.). */
  readonly reportedBy: string;
  /**
   * Cedar-style typed field rule to register.
   *
   * `effect` is always `'forbid'` and is set by the handler; omit it here.
   * The rule's `when` predicate must inspect typed field values — never
   * match raw command strings with regex.
   */
  readonly cedarRule: Omit<CedarFieldRule, 'effect'>;
}

/** Union of all valid novel threat submissions. */
export type NovelThreatSubmission = ToolCreationSubmission | CedarRuleSubmission;

/** Result of handling a threat via the `fine-grained-tool` path. */
export interface ToolCreationResult {
  readonly resolutionPath: 'fine-grained-tool';
  /** UUID assigned to this novel threat vector. */
  readonly threatId: string;
  /** The RFC filed by the handler via the G-01 path. */
  readonly rfc: RFC;
  /** Audit entry appended to the handler's log for this event. */
  readonly auditEntry: ThreatAuditEntry;
}

/** Result of handling a threat via the `cedar-rule` path. */
export interface CedarRuleResult {
  readonly resolutionPath: 'cedar-rule';
  /** UUID assigned to this novel threat vector. */
  readonly threatId: string;
  /** The full {@link CedarFieldRule} registered by the handler. */
  readonly rule: CedarFieldRule;
  /** Audit entry appended to the handler's log for this event. */
  readonly auditEntry: ThreatAuditEntry;
}

/** Discriminated union result returned by {@link NovelThreatHandler.handle}. */
export type ThreatHandlingResult = ToolCreationResult | CedarRuleResult;

/** Options for constructing a {@link NovelThreatHandler}. */
export interface NovelThreatHandlerOptions {
  /**
   * `RFCProcessor` instance used for filing G-01 RFCs.
   *
   * When omitted, a fresh `new RFCProcessor()` is constructed. Tests should
   * supply their own instance to avoid cross-test state leakage.
   */
  readonly rfcProcessor?: RFCProcessor;
  /**
   * Clock function returning the current `Date`.
   *
   * Overridable in tests to simulate time without mocking globals.
   *
   * @default () => new Date()
   */
  readonly clock?: () => Date;
}

// ─── NovelThreatHandler ───────────────────────────────────────────────────────

/**
 * Handles novel threat vectors by routing to structured resolution paths.
 *
 * Novel threats are never handled via command-string regex patterns. Instead,
 * they are resolved via:
 *   - A G-01 RFC filing for fine-grained tool / action class creation.
 *   - A Cedar-style typed field rule registration for parameter-level detection.
 *
 * All submissions are tracked by category and recorded in an immutable audit
 * trail. The handler is intentionally stateful and injectable: construct a
 * fresh instance per test suite to guarantee isolation.
 *
 * @example
 * ```ts
 * const handler = new NovelThreatHandler();
 *
 * // Cedar rule path — adds a new typed field rule
 * const ruleResult = await handler.handle({
 *   resolutionPath: 'cedar-rule',
 *   description: 'Oversized base64 blobs in command arguments',
 *   category: 'encoding-obfuscation',
 *   evidence: { fieldName: 'args', estimatedEncodedSize: 'large' },
 *   reportedBy: 'security-scanner',
 *   cedarRule: {
 *     id: 'NTV-001',
 *     description: 'Oversized base64-only strings in args are forbidden.',
 *     field: 'args',
 *     when: (v) => typeof v === 'string' && v.length > 512 && /^[A-Za-z0-9+/]+=*$/.test(v),
 *     kind: 'encoding_pattern',
 *     risk: 'high',
 *   },
 * });
 * // ruleResult.resolutionPath === 'cedar-rule'
 * // ruleResult.rule.effect === 'forbid'
 *
 * // Fine-grained tool path — files RFC via G-01
 * const rfcResult = await handler.handle({
 *   resolutionPath: 'fine-grained-tool',
 *   description: 'Novel DNS exfiltration via unconstrained lookup',
 *   category: 'dns-exfiltration',
 *   evidence: { observedField: 'hostname', payloadSize: 253 },
 *   reportedBy: 'agent-47',
 *   capabilityRequest: {
 *     proposedActionClass: 'network.dns.controlled_lookup',
 *     proposedAliases: ['dns_lookup_safe'],
 *     riskLevel: 'high',
 *   },
 * });
 * // rfcResult.resolutionPath === 'fine-grained-tool'
 * // rfcResult.rfc.status === 'open'
 * ```
 */
export class NovelThreatHandler {
  private readonly rfcProcessor: RFCProcessor;
  private readonly clock: () => Date;

  /** Threat vector patterns keyed by category. */
  private readonly patterns = new Map<string, ThreatVectorPattern>();

  /** Cedar rules registered via the `cedar-rule` path, in registration order. */
  private readonly cedarRules: CedarFieldRule[] = [];

  /** Immutable audit trail; entries are appended and never mutated. */
  private readonly auditLog: ThreatAuditEntry[] = [];

  constructor(options: NovelThreatHandlerOptions = {}) {
    this.rfcProcessor = options.rfcProcessor ?? new RFCProcessor();
    this.clock = options.clock ?? (() => new Date());
  }

  // ── Main handler ──────────────────────────────────────────────────────────

  /**
   * Handles a novel threat vector submission.
   *
   * Processing order:
   *   1. Assign a UUID to the threat vector.
   *   2. Append a `threat_received` audit entry.
   *   3. Update (or create) the {@link ThreatVectorPattern} for the category.
   *   4. Route to {@link handleToolCreation} or {@link handleCedarRule}.
   *   5. Return a typed result discriminated by `resolutionPath`.
   *
   * @param submission  Typed threat submission specifying the resolution path.
   * @returns           Discriminated result with RFC or Cedar rule and audit entry.
   */
  async handle(submission: NovelThreatSubmission): Promise<ThreatHandlingResult> {
    const threatId = randomUUID();
    const ts = this.clock().toISOString();

    this.appendAudit({
      ts,
      event: 'threat_received',
      threatId,
      detail:
        `Novel threat received: "${submission.description}" ` +
        `(category: ${submission.category}, path: ${submission.resolutionPath})`,
      actor: submission.reportedBy,
    });

    this.trackPattern(submission.category, submission.description, threatId, ts);

    if (submission.resolutionPath === 'fine-grained-tool') {
      return this.handleToolCreation(submission, threatId, ts);
    }
    return this.handleCedarRule(submission, threatId, ts);
  }

  // ── Query methods ─────────────────────────────────────────────────────────

  /**
   * Returns all tracked threat vector patterns in insertion order.
   *
   * Each pattern represents a unique `category` and aggregates all threat
   * vectors submitted under that category.
   */
  listPatterns(): ThreatVectorPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Returns all Cedar rules registered via the `cedar-rule` path, in
   * registration order.
   *
   * The returned array may be passed directly to
   * `new AgentObfuscationDetector({ additionalRules: handler.listCedarRules() })`.
   */
  listCedarRules(): ReadonlyArray<CedarFieldRule> {
    return this.cedarRules;
  }

  /**
   * Returns a snapshot of the audit log in chronological order.
   *
   * Returns a new array on each call; mutations to the returned array do not
   * affect the handler's internal state. Entries themselves are never mutated.
   */
  getAuditLog(): ReadonlyArray<ThreatAuditEntry> {
    return [...this.auditLog];
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async handleToolCreation(
    submission: ToolCreationSubmission,
    threatId: string,
    ts: string,
  ): Promise<ToolCreationResult> {
    const rfc = await this.rfcProcessor.file({
      title: `Novel threat: ${submission.description}`,
      description:
        `Category: ${submission.category}\n` +
        `Proposed action class: ${submission.capabilityRequest.proposedActionClass}\n` +
        `Evidence: ${JSON.stringify(submission.evidence)}`,
      requestor: submission.reportedBy,
      capabilityRequest: submission.capabilityRequest,
    });

    const auditEntry: ThreatAuditEntry = {
      ts,
      event: 'tool_creation_initiated',
      threatId,
      detail:
        `RFC ${rfc.id} filed for fine-grained tool creation ` +
        `(${submission.capabilityRequest.proposedActionClass})`,
      actor: submission.reportedBy,
    };
    this.appendAudit(auditEntry);

    return { resolutionPath: 'fine-grained-tool', threatId, rfc, auditEntry };
  }

  private handleCedarRule(
    submission: CedarRuleSubmission,
    threatId: string,
    ts: string,
  ): CedarRuleResult {
    const rule: CedarFieldRule = { ...submission.cedarRule, effect: 'forbid' };
    this.cedarRules.push(rule);

    const auditEntry: ThreatAuditEntry = {
      ts,
      event: 'cedar_rule_registered',
      threatId,
      detail:
        `Cedar rule "${rule.id}" registered for threat category "${submission.category}"`,
      actor: submission.reportedBy,
    };
    this.appendAudit(auditEntry);

    return { resolutionPath: 'cedar-rule', threatId, rule, auditEntry };
  }

  private trackPattern(
    category: string,
    description: string,
    threatId: string,
    ts: string,
  ): void {
    const existing = this.patterns.get(category);
    if (existing !== undefined) {
      existing.lastSeenAt = ts;
      existing.occurrences += 1;
      (existing.threatIds as string[]).push(threatId);
    } else {
      this.patterns.set(category, {
        category,
        description,
        firstSeenAt: ts,
        lastSeenAt: ts,
        occurrences: 1,
        threatIds: [threatId],
      });
    }
  }

  private appendAudit(entry: ThreatAuditEntry): void {
    this.auditLog.push(entry);
  }
}

// ─── Default instance ─────────────────────────────────────────────────────────

/**
 * Shared `NovelThreatHandler` instance for production use.
 *
 * Tests should construct their own `new NovelThreatHandler()` instance to avoid
 * cross-test state leakage.
 */
export const defaultNovelThreatHandler = new NovelThreatHandler();

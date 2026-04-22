/**
 * One-off operation handler.
 *
 * Handles operations not present in the @openclaw/action-registry taxonomy by
 * routing them to the `request_new_capability` meta-tool (HITL) and filing an
 * RFC automatically via the G-01 process. The handler NEVER silently falls
 * back to exec — all unregistered operations result in a `forbid` decision
 * with explicit HITL routing, and all one-off requests are logged for analysis.
 *
 * Resolution steps for an unregistered operation:
 *   1. Detect the tool name is not in the taxonomy alias index.
 *   2. File a `CapabilityRequest` RFC via the G-01 `RFCProcessor`.
 *   3. Emit HITL routing information pointing to `request_new_capability`.
 *   4. Append audit entries and log the request.
 *   5. Return `decision: 'forbid'` — execution is never permitted.
 *
 * Exec wrapper tools (shell.exec class) are rejected immediately without RFC
 * filing; they are categorically forbidden regardless of taxonomy status.
 *
 * Integration points:
 *   - G-01 (RFCProcessor): Files a `CapabilityRequest` RFC for every
 *     unregistered one-off operation.
 *   - T89: Implements {@link EdgeCaseHandler} for the `one-off-operation`
 *     edge case type.
 *   - T177 (MCPToolGate): Complements gate-level E-07 enforcement with
 *     structured HITL routing and RFC lifecycle management.
 *
 * @see T89
 * @see T177
 */

import { randomUUID } from 'node:crypto';
import { REGISTRY, ActionClass } from '@openclaw/action-registry';
import type { ActionRegistryEntry } from '@openclaw/action-registry';
import { RFCProcessor, type RFC } from './rfc-processor.js';
import type { EdgeCaseHandler, EdgeCaseContext, EdgeCaseResult } from './edge-case-registry.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * HITL routing signal produced when an unregistered one-off operation is
 * detected. The `metaTool` field identifies the meta-tool the agent must use
 * to proceed; direct execution of the original tool is forbidden.
 */
export interface HITLRoutingResult {
  /** Meta-tool to invoke for capability request escalation. */
  readonly metaTool: 'request_new_capability';
  /** Unique ID assigned to this one-off request. */
  readonly requestId: string;
  /** ID of the RFC filed for this operation. */
  readonly rfcId: string;
  /** The unregistered tool name that triggered the routing. */
  readonly toolName: string;
  /** Human-readable explanation of why HITL routing was triggered. */
  readonly reason: string;
}

/**
 * A logged record of a one-off operation request.
 *
 * Every unregistered tool name that passes through the handler generates one
 * entry. Requests are accumulated in insertion order and never mutated.
 */
export interface OneOffRequest {
  /** UUID assigned to this request. */
  readonly requestId: string;
  /** Raw tool name as supplied in the operation context. */
  readonly toolName: string;
  /** Human-readable description of the operation. */
  readonly description: string;
  /** ISO 8601 timestamp when the request was received. */
  readonly requestedAt: string;
  /** ID of the RFC filed for this request. */
  readonly rfcId: string;
  /** Actor that submitted the operation (from context metadata). */
  readonly actor?: string;
}

/** A single audit entry for a one-off operation handling event. */
export interface OneOffAuditEntry {
  /** ISO 8601 timestamp of the event. */
  readonly ts: string;
  /** Event type. */
  readonly event: 'request_received' | 'rfc_filed' | 'hitl_routed';
  /** UUID of the one-off request that triggered this entry. */
  readonly requestId: string;
  /** Human-readable description of what occurred. */
  readonly detail: string;
  /** Actor that submitted the operation (from context metadata). */
  readonly actor?: string;
}

/** Options for constructing a {@link OneOffOperationHandler}. */
export interface OneOffOperationHandlerOptions {
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

// ─── OneOffOperationHandler ───────────────────────────────────────────────────

/**
 * Handles one-off operations not present in the action taxonomy.
 *
 * Implements {@link EdgeCaseHandler} for the `one-off-operation` edge case
 * type. Every unregistered tool call is routed to the `request_new_capability`
 * meta-tool and backed by an automatic RFC filing via the G-01 process.
 *
 * The handler is fail-closed and exec-safe:
 *   - Unregistered tools → `forbid` + HITL routing + RFC filing.
 *   - Exec wrapper tools → `forbid` immediately (no RFC; categorically banned).
 *   - Registered non-exec tools → `defer` (not a one-off; let the gate decide).
 *
 * All request dispatches are logged regardless of outcome.
 *
 * @example
 * ```ts
 * const handler = new OneOffOperationHandler();
 *
 * const result = await handler.handle({
 *   type: 'one-off-operation',
 *   command: 'custom_network_probe',
 *   metadata: { actor: 'agent-42', description: 'Custom network probe tool' },
 * });
 * // result.decision === 'forbid'
 * // result.metadata.hitlRouting.metaTool === 'request_new_capability'
 * // result.metadata.rfc.status === 'open'
 *
 * handler.listRequests();   // all logged one-off requests
 * handler.getAuditLog();    // immutable audit trail
 * ```
 */
export class OneOffOperationHandler implements EdgeCaseHandler {
  readonly edgeCaseType = 'one-off-operation' as const;

  private readonly rfcProcessor: RFCProcessor;
  private readonly clock: () => Date;
  private readonly aliasIndex: ReadonlyMap<string, ActionRegistryEntry>;

  /** Logged one-off requests in receipt order. */
  private readonly requests: OneOffRequest[] = [];

  /** Immutable audit trail; entries are appended and never mutated. */
  private readonly auditLog: OneOffAuditEntry[] = [];

  constructor(options: OneOffOperationHandlerOptions = {}) {
    this.rfcProcessor = options.rfcProcessor ?? new RFCProcessor();
    this.clock = options.clock ?? (() => new Date());

    const idx = new Map<string, ActionRegistryEntry>();
    for (const entry of REGISTRY) {
      for (const alias of entry.aliases) {
        idx.set(alias, entry);
      }
    }
    this.aliasIndex = idx;
  }

  // ── EdgeCaseHandler implementation ────────────────────────────────────────

  /**
   * Handles a one-off operation edge case context.
   *
   * Processing order:
   *   1. Extract tool name from `context.command`.
   *   2. Append a `request_received` audit entry.
   *   3. If tool resolves to `shell.exec` in the registry → `forbid` (no RFC).
   *   4. If tool is registered and non-exec → `defer`.
   *   5. If tool is unregistered → file RFC, emit HITL routing, `forbid`.
   *
   * The optional `actor` and `description` fields are read from
   * `context.metadata.actor` and `context.metadata.description`.
   *
   * @param context  Edge case context carrying the tool name as `command`.
   * @returns        Edge case result with decision, reason, and HITL metadata.
   */
  async handle(context: EdgeCaseContext): Promise<EdgeCaseResult> {
    const toolName = context.command.trim();
    const lowerName = toolName.toLowerCase();
    const ts = this.clock().toISOString();
    const requestId = randomUUID();

    const actor =
      typeof context.metadata?.['actor'] === 'string'
        ? context.metadata['actor']
        : undefined;

    this.appendAudit({
      ts,
      event: 'request_received',
      requestId,
      detail: `One-off operation request received: "${toolName}"`,
      ...(actor !== undefined ? { actor } : {}),
    });

    const entry = this.aliasIndex.get(lowerName);

    // Exec wrapper tools are categorically forbidden — no RFC needed
    if (entry !== undefined && entry.action_class === ActionClass.ShellExec) {
      return {
        handled: true,
        decision: 'forbid',
        reason:
          `"${toolName}" is a forbidden exec wrapper tool (shell.exec). ` +
          `One-off operations must never fall back to exec.`,
      };
    }

    // Registered non-exec tool — not a one-off operation
    if (entry !== undefined) {
      return {
        handled: true,
        decision: 'defer',
        reason: `"${toolName}" is a registered tool (${entry.action_class}). Not a one-off operation.`,
      };
    }

    // Unregistered tool — route to HITL + file RFC
    const description =
      typeof context.metadata?.['description'] === 'string'
        ? context.metadata['description']
        : `One-off operation: unregistered tool "${toolName}"`;

    const rfc = await this.rfcProcessor.file({
      title: `One-off operation: "${toolName}" not in taxonomy`,
      description:
        `Tool name: ${toolName}\n` +
        `Description: ${description}\n` +
        `Requested by: ${actor ?? 'unknown'}`,
      requestor: actor ?? 'one-off-operation-handler',
      capabilityRequest: {
        proposedActionClass: `one-off.unclassified.${lowerName}`,
        proposedAliases: [lowerName],
        riskLevel: 'high',
      },
    });

    this.appendAudit({
      ts,
      event: 'rfc_filed',
      requestId,
      detail: `RFC ${rfc.id} filed for one-off operation "${toolName}"`,
      ...(actor !== undefined ? { actor } : {}),
    });

    const hitlRouting: HITLRoutingResult = {
      metaTool: 'request_new_capability',
      requestId,
      rfcId: rfc.id,
      toolName,
      reason:
        `"${toolName}" is not registered in the action taxonomy. ` +
        `RFC ${rfc.id} has been filed. Use request_new_capability to proceed.`,
    };

    this.appendAudit({
      ts,
      event: 'hitl_routed',
      requestId,
      detail: `Routed to request_new_capability meta-tool for "${toolName}" (RFC: ${rfc.id})`,
      ...(actor !== undefined ? { actor } : {}),
    });

    this.requests.push({
      requestId,
      toolName,
      description,
      requestedAt: ts,
      rfcId: rfc.id,
      ...(actor !== undefined ? { actor } : {}),
    });

    return {
      handled: true,
      decision: 'forbid',
      reason: hitlRouting.reason,
      metadata: { hitlRouting, rfc },
    };
  }

  // ── Query methods ─────────────────────────────────────────────────────────

  /**
   * Returns all logged one-off requests in receipt order.
   *
   * Returns a new array on each call; mutations to the returned array do not
   * affect the handler's internal state.
   */
  listRequests(): ReadonlyArray<OneOffRequest> {
    return [...this.requests];
  }

  /**
   * Returns a snapshot of the audit log in chronological order.
   *
   * Returns a new array on each call; mutations to the returned array do not
   * affect the handler's internal state. Entries themselves are never mutated.
   */
  getAuditLog(): ReadonlyArray<OneOffAuditEntry> {
    return [...this.auditLog];
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private appendAudit(entry: OneOffAuditEntry): void {
    this.auditLog.push(entry);
  }
}

// ─── Default instance ─────────────────────────────────────────────────────────

/**
 * Shared `OneOffOperationHandler` instance for production use.
 *
 * Tests should construct their own `new OneOffOperationHandler()` instance to
 * avoid cross-test state leakage.
 */
export const defaultOneOffOperationHandler = new OneOffOperationHandler();

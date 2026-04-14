/**
 * Agent identity verification registry (V-03 v0.1 follow-up).
 *
 * This module is a port of the `AgentIdentityRegistry` originally proposed in
 * PR #6 against the pre-v0.1 architecture, adapted to today's main. It keeps
 * the same API shape — allow-list of (agentId → allowedChannels) plus a
 * `buildRuleContext()` helper that stamps `verified` onto `RuleContext` — so
 * the mental model stays continuous with the earlier work.
 *
 * Why it still matters on v0.1:
 *
 * The v0.1 pipeline removed every rule condition that trusted `agentId`
 * prefixes or channel membership, so spoofing those claims can no longer
 * elevate privilege at the rule-evaluation layer today. However, the claims
 * still flow unverified into:
 *
 *   1. The JSONL audit log — poisoning the forensic trail.
 *   2. Human-in-the-loop approval prompts — misleading the operator
 *      ("agent `admin-bot` wants to run X").
 *
 * Host callers register known agents at startup. Callers that don't register
 * any agents keep the legacy behaviour: every claim is treated as verified.
 * Once at least one agent is registered, unknown agents and off-channel
 * claims are flagged as unverified; the flag flows into `RuleContext.verified`
 * (for future rule conditions to opt in to) and into audit/HITL call sites
 * so forged claims are recorded and surfaced to the operator.
 */

import type { RuleContext } from './policy/types.js';

export interface RegisteredAgent {
  /** Canonical identifier for the agent (e.g. "support-bot"). */
  agentId: string;
  /** Channels this agent is authorised to speak on. */
  allowedChannels: string[];
  /** Optional human-readable role tag (e.g. "support", "admin"). */
  role?: string | undefined;
}

export interface IdentityVerificationResult {
  /** True when the registry is empty (back-compat) or the claim matched. */
  verified: boolean;
  /** The registered entry when verification succeeded; undefined otherwise. */
  registeredAgent?: RegisteredAgent | undefined;
}

export class AgentIdentityRegistry {
  private readonly agents = new Map<string, RegisteredAgent>();

  /** Registers or replaces an agent entry. */
  register(agent: RegisteredAgent): void {
    if (!agent.agentId) {
      throw new Error('agentId is required');
    }
    if (!Array.isArray(agent.allowedChannels) || agent.allowedChannels.length === 0) {
      throw new Error('allowedChannels must be a non-empty array');
    }
    this.agents.set(agent.agentId, {
      agentId: agent.agentId,
      allowedChannels: [...agent.allowedChannels],
      role: agent.role,
    });
  }

  /** Bulk-register helper. */
  registerMany(agents: RegisteredAgent[]): void {
    for (const agent of agents) this.register(agent);
  }

  /** Removes an entry. Returns true when the agent was present. */
  unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  /** Looks up a registered agent by id. */
  get(agentId: string): RegisteredAgent | undefined {
    return this.agents.get(agentId);
  }

  /** Snapshot of all registered agents. */
  list(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  /** Clears every registered entry. Primarily for tests. */
  clear(): void {
    this.agents.clear();
  }

  /** Number of registered agents. */
  get size(): number {
    return this.agents.size;
  }

  /**
   * Verifies a claim. When the registry is empty, every claim is verified
   * (back-compat). Otherwise, the agentId must be registered AND the claimed
   * channel must be in the agent's `allowedChannels` list.
   */
  verify(agentId: string, channel: string): IdentityVerificationResult {
    if (this.agents.size === 0) {
      return { verified: true };
    }

    const registered = this.agents.get(agentId);
    if (!registered) {
      return { verified: false };
    }

    const channelAllowed = registered.allowedChannels.includes(channel);
    return {
      verified: channelAllowed,
      registeredAgent: channelAllowed ? registered : undefined,
    };
  }

  /**
   * Builds a {@link RuleContext} with `verified` stamped on it. Rule
   * conditions that trust `agentId`/`channel` can opt in to this flag; rules
   * that don't use it are unaffected.
   */
  buildRuleContext(
    agentId: string,
    channel: string,
    extras?: { userId?: string; sessionId?: string; metadata?: Record<string, unknown> },
  ): RuleContext {
    const { verified } = this.verify(agentId, channel);
    return {
      agentId,
      channel,
      verified,
      ...extras,
    };
  }
}

/**
 * Process-wide default registry. Exposed so the host process can register
 * identities once at startup without threading a reference through every
 * plugin call site. Tests and embedders may create their own instance.
 */
export const defaultAgentIdentityRegistry = new AgentIdentityRegistry();

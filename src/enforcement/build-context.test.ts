/**
 * buildPipelineContext — unit tests
 *
 * Test ID prefix: TC-BPC-NN
 */

import { describe, it, expect } from 'vitest';
import { buildPipelineContext } from './build-context.js';
import type { ActionDescriptor } from './build-context.js';
import type { RuleContext } from '../policy/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const identity: RuleContext = { agentId: 'agent-1', channel: 'api' };

const emailAction: ActionDescriptor = {
  toolName: 'send_email',
  params: { to: 'user@example.com', subject: 'Hello' },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildPipelineContext', () => {
  // ── Normalized action fields ──────────────────────────────────────────────

  it('TC-BPC-01: action_class is derived from normalized action', () => {
    const ctx = buildPipelineContext(emailAction, identity);
    expect(ctx.action_class).toBe('communication.email');
  });

  it('TC-BPC-02: target is extracted from normalized action', () => {
    const ctx = buildPipelineContext(emailAction, identity);
    expect(ctx.target).toBe('user@example.com');
  });

  it('TC-BPC-03: risk is set from normalized action', () => {
    const ctx = buildPipelineContext(emailAction, identity);
    expect(ctx.risk).toBeDefined();
    expect(['low', 'medium', 'high', 'critical']).toContain(ctx.risk);
  });

  it('TC-BPC-04: hitl_mode is set from normalized action', () => {
    const ctx = buildPipelineContext(emailAction, identity);
    expect(['none', 'per_request', 'session_approval']).toContain(ctx.hitl_mode);
  });

  // ── payload_hash ──────────────────────────────────────────────────────────

  it('TC-BPC-05: payload_hash is a 64-character hex string', () => {
    const ctx = buildPipelineContext(emailAction, identity);
    expect(ctx.payload_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('TC-BPC-06: payload_hash is deterministic for identical inputs', () => {
    const ctx1 = buildPipelineContext(emailAction, identity);
    const ctx2 = buildPipelineContext(emailAction, identity);
    expect(ctx1.payload_hash).toBe(ctx2.payload_hash);
  });

  it('TC-BPC-07: payload_hash differs when params change', () => {
    const other: ActionDescriptor = {
      toolName: 'send_email',
      params: { to: 'other@example.com', subject: 'Hello' },
    };
    const ctx1 = buildPipelineContext(emailAction, identity);
    const ctx2 = buildPipelineContext(other, identity);
    expect(ctx1.payload_hash).not.toBe(ctx2.payload_hash);
  });

  it('TC-BPC-08: payload_hash differs when toolName changes', () => {
    const other: ActionDescriptor = {
      toolName: 'send_slack',
      params: { to: 'user@example.com', subject: 'Hello' },
    };
    const ctx1 = buildPipelineContext(emailAction, identity);
    const ctx2 = buildPipelineContext(other, identity);
    expect(ctx1.payload_hash).not.toBe(ctx2.payload_hash);
  });

  // ── approval_id ───────────────────────────────────────────────────────────

  it('TC-BPC-09: approval_id is set when provided', () => {
    const ctx = buildPipelineContext(emailAction, identity, 'approval-uuid-001');
    expect(ctx.approval_id).toBe('approval-uuid-001');
  });

  it('TC-BPC-10: approval_id is absent when not provided', () => {
    const ctx = buildPipelineContext(emailAction, identity);
    expect(ctx.approval_id).toBeUndefined();
  });

  // ── identity / rule_context ───────────────────────────────────────────────

  it('TC-BPC-11: rule_context is the provided identity object', () => {
    const ctx = buildPipelineContext(emailAction, identity);
    expect(ctx.rule_context).toBe(identity);
  });

  it('TC-BPC-12: session_id is copied from identity.sessionId', () => {
    const identityWithSession: RuleContext = {
      agentId: 'agent-1',
      channel: 'api',
      sessionId: 'sess-abc-123',
    };
    const ctx = buildPipelineContext(emailAction, identityWithSession);
    expect(ctx.session_id).toBe('sess-abc-123');
  });

  it('TC-BPC-13: session_id is absent when identity has no sessionId', () => {
    const ctx = buildPipelineContext(emailAction, identity);
    expect(ctx.session_id).toBeUndefined();
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  it('TC-BPC-14: params defaults to empty object when omitted', () => {
    const noParamsAction: ActionDescriptor = { toolName: 'read_file' };
    expect(() => buildPipelineContext(noParamsAction, identity)).not.toThrow();
  });

  it('TC-BPC-15: unknown tool resolves to unknown_sensitive_action', () => {
    const ctx = buildPipelineContext({ toolName: 'totally_unknown_tool' }, identity);
    expect(ctx.action_class).toBe('unknown_sensitive_action');
  });
});

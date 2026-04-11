/**
 * StructuredDecision — test suite
 *
 * Covers all conversion utilities in decision.ts:
 *   fromCeeDecision — converts a CeeDecision to StructuredDecision
 *   askUser         — creates an 'ask-user' StructuredDecision
 *   forbidDecision  — creates a 'forbid' StructuredDecision
 */
import { describe, it, expect } from 'vitest';
import { fromCeeDecision, askUser, forbidDecision } from './decision.js';
import type { CapabilityInfo, StructuredDecision } from './decision.js';
import type { CeeDecision } from './pipeline.js';

// ─── fromCeeDecision ──────────────────────────────────────────────────────────

describe('fromCeeDecision', () => {
  // ── outcome mapping ──────────────────────────────────────────────────────

  it('maps effect "permit" to outcome "permit"', () => {
    const d: CeeDecision = { effect: 'permit', reason: 'allowed' };
    const result = fromCeeDecision(d);
    expect(result.outcome).toBe('permit');
  });

  it('maps effect "forbid" to outcome "forbid"', () => {
    const d: CeeDecision = { effect: 'forbid', reason: 'policy_violation' };
    const result = fromCeeDecision(d);
    expect(result.outcome).toBe('forbid');
  });

  // ── reason forwarding ────────────────────────────────────────────────────

  it('forwards reason unchanged', () => {
    const d: CeeDecision = { effect: 'permit', reason: 'capability_valid' };
    const result = fromCeeDecision(d);
    expect(result.reason).toBe('capability_valid');
  });

  it('forwards an empty reason string unchanged', () => {
    const d: CeeDecision = { effect: 'forbid', reason: '' };
    const result = fromCeeDecision(d);
    expect(result.reason).toBe('');
  });

  // ── stage forwarding ─────────────────────────────────────────────────────

  it('includes stage when CeeDecision has a stage', () => {
    const d: CeeDecision = { effect: 'permit', reason: 'ok', stage: 'stage2' };
    const result = fromCeeDecision(d);
    expect(result.stage).toBe('stage2');
  });

  it('omits stage property when CeeDecision has no stage', () => {
    const d: CeeDecision = { effect: 'permit', reason: 'ok' };
    const result = fromCeeDecision(d);
    expect('stage' in result).toBe(false);
  });

  it('forwards stage "stage1" correctly', () => {
    const d: CeeDecision = { effect: 'forbid', reason: 'expired', stage: 'stage1' };
    const result = fromCeeDecision(d);
    expect(result.stage).toBe('stage1');
  });

  // ── ruleId attachment ────────────────────────────────────────────────────

  it('attaches ruleId when provided', () => {
    const d: CeeDecision = { effect: 'permit', reason: 'ok' };
    const result = fromCeeDecision(d, 'rule-001');
    expect(result.ruleId).toBe('rule-001');
  });

  it('omits ruleId when not provided', () => {
    const d: CeeDecision = { effect: 'permit', reason: 'ok' };
    const result = fromCeeDecision(d);
    expect('ruleId' in result).toBe(false);
  });

  it('omits ruleId when explicitly passed as undefined', () => {
    const d: CeeDecision = { effect: 'permit', reason: 'ok' };
    const result = fromCeeDecision(d, undefined);
    expect('ruleId' in result).toBe(false);
  });

  // ── capability attachment ────────────────────────────────────────────────

  it('attaches capability on permit decision when provided', () => {
    const cap: CapabilityInfo = {
      id: 'cap-001',
      expiresAt: Date.now() + 60_000,
      scope: ['filesystem.read'],
    };
    const d: CeeDecision = { effect: 'permit', reason: 'ok' };
    const result = fromCeeDecision(d, undefined, cap);
    expect(result.capability).toEqual(cap);
  });

  it('does NOT attach capability on forbid decision even when provided', () => {
    const cap: CapabilityInfo = {
      id: 'cap-001',
      expiresAt: Date.now() + 60_000,
      scope: ['filesystem.read'],
    };
    const d: CeeDecision = { effect: 'forbid', reason: 'policy_violation' };
    const result = fromCeeDecision(d, undefined, cap);
    expect('capability' in result).toBe(false);
  });

  it('omits capability when not provided', () => {
    const d: CeeDecision = { effect: 'permit', reason: 'ok' };
    const result = fromCeeDecision(d);
    expect('capability' in result).toBe(false);
  });

  // ── combined fields ──────────────────────────────────────────────────────

  it('produces a fully populated StructuredDecision with all optional fields', () => {
    const cap: CapabilityInfo = {
      id: 'cap-xyz',
      expiresAt: 9999999999000,
      scope: ['filesystem.read', 'filesystem.list'],
    };
    const d: CeeDecision = { effect: 'permit', reason: 'capability_valid', stage: 'stage1' };
    const result = fromCeeDecision(d, 'rule-99', cap);

    expect(result).toEqual<StructuredDecision>({
      outcome: 'permit',
      reason: 'capability_valid',
      stage: 'stage1',
      ruleId: 'rule-99',
      capability: cap,
    });
  });

  it('produces a minimal StructuredDecision with only required fields', () => {
    const d: CeeDecision = { effect: 'forbid', reason: 'stage2_error' };
    const result = fromCeeDecision(d);
    expect(result).toEqual<StructuredDecision>({
      outcome: 'forbid',
      reason: 'stage2_error',
    });
  });
});

// ─── askUser ──────────────────────────────────────────────────────────────────

describe('askUser', () => {
  it('returns outcome "ask-user"', () => {
    const result = askUser('approval required');
    expect(result.outcome).toBe('ask-user');
  });

  it('sets reason to the provided string', () => {
    const result = askUser('human approval required for high-risk action');
    expect(result.reason).toBe('human approval required for high-risk action');
  });

  it('attaches ruleId when provided', () => {
    const result = askUser('approval required', 'hitl-rule-001');
    expect(result.ruleId).toBe('hitl-rule-001');
  });

  it('omits ruleId when not provided', () => {
    const result = askUser('approval required');
    expect('ruleId' in result).toBe(false);
  });

  it('omits ruleId when explicitly passed as undefined', () => {
    const result = askUser('approval required', undefined);
    expect('ruleId' in result).toBe(false);
  });

  it('does not include stage field', () => {
    const result = askUser('approval required');
    expect('stage' in result).toBe(false);
  });

  it('does not include capability field', () => {
    const result = askUser('approval required');
    expect('capability' in result).toBe(false);
  });

  it('produces minimal shape with only outcome and reason', () => {
    const result = askUser('need approval');
    expect(result).toEqual<StructuredDecision>({
      outcome: 'ask-user',
      reason: 'need approval',
    });
  });

  it('produces full shape with ruleId', () => {
    const result = askUser('pending approval', 'rule-42');
    expect(result).toEqual<StructuredDecision>({
      outcome: 'ask-user',
      reason: 'pending approval',
      ruleId: 'rule-42',
    });
  });
});

// ─── forbidDecision ───────────────────────────────────────────────────────────

describe('forbidDecision', () => {
  it('returns outcome "forbid"', () => {
    const result = forbidDecision('policy error');
    expect(result.outcome).toBe('forbid');
  });

  it('sets reason to the provided string', () => {
    const result = forbidDecision('pipeline_error');
    expect(result.reason).toBe('pipeline_error');
  });

  it('attaches stage when provided', () => {
    const result = forbidDecision('stage2_error', 'stage2');
    expect(result.stage).toBe('stage2');
  });

  it('omits stage when not provided', () => {
    const result = forbidDecision('pipeline_error');
    expect('stage' in result).toBe(false);
  });

  it('omits stage when explicitly passed as undefined', () => {
    const result = forbidDecision('pipeline_error', undefined);
    expect('stage' in result).toBe(false);
  });

  it('does not include ruleId field', () => {
    const result = forbidDecision('error', 'pipeline');
    expect('ruleId' in result).toBe(false);
  });

  it('does not include capability field', () => {
    const result = forbidDecision('error', 'pipeline');
    expect('capability' in result).toBe(false);
  });

  it('produces minimal shape with only outcome and reason', () => {
    const result = forbidDecision('stage1_error');
    expect(result).toEqual<StructuredDecision>({
      outcome: 'forbid',
      reason: 'stage1_error',
    });
  });

  it('produces full shape with stage', () => {
    const result = forbidDecision('stage2_error', 'stage2');
    expect(result).toEqual<StructuredDecision>({
      outcome: 'forbid',
      reason: 'stage2_error',
      stage: 'stage2',
    });
  });

  it('works for fail-closed pipeline error convention', () => {
    const result = forbidDecision('pipeline_error', 'pipeline');
    expect(result.outcome).toBe('forbid');
    expect(result.reason).toBe('pipeline_error');
    expect(result.stage).toBe('pipeline');
  });
});

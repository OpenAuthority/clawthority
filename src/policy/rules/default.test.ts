import { describe, expect, it } from 'vitest';
import DEFAULT_RULES, { OPEN_MODE_RULES } from './default.js';

/**
 * The open-mode rule set is derived by filtering the full default rules
 * down to the critical-forbid action classes. These tests pin the filter
 * output so an accidental drop/addition of a critical class would surface
 * as a test failure (not a silent posture change).
 */

const EXPECTED_CRITICAL_CLASSES: readonly string[] = [
  'shell.exec',
  'code.execute',
  'payment.initiate',
  'credential.read',
  'credential.write',
  'unknown_sensitive_action',
];

describe('OPEN_MODE_RULES', () => {
  it('contains exactly the six critical action classes', () => {
    const classes = OPEN_MODE_RULES
      .map((r) => r.action_class)
      .filter((c): c is string => c !== undefined)
      .sort();
    expect(classes).toEqual([...EXPECTED_CRITICAL_CLASSES].sort());
  });

  it('contains only forbid rules', () => {
    for (const rule of OPEN_MODE_RULES) {
      expect(rule.effect).toBe('forbid');
    }
  });

  it('is a strict subset of DEFAULT_RULES (same literals, not copies)', () => {
    for (const rule of OPEN_MODE_RULES) {
      expect(DEFAULT_RULES).toContain(rule);
    }
  });

  it('omits the priority-10 filesystem.read permit', () => {
    const classes = OPEN_MODE_RULES.map((r) => r.action_class);
    expect(classes).not.toContain('filesystem.read');
  });

  it('omits the external_send intent-group rule (HITL, not hard forbid)', () => {
    for (const rule of OPEN_MODE_RULES) {
      expect(rule.intent_group).toBeUndefined();
    }
  });
});

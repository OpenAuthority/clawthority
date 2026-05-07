import { describe, it, expect } from 'vitest';
import * as hitl from './index.js';

describe('hitl barrel exports', () => {
  it('re-exports key runtime symbols', () => {
    expect(typeof hitl.parseHitlPolicyFile).toBe('function');
    expect(typeof hitl.matchesActionPattern).toBe('function');
    expect(typeof hitl.sendApprovalRequest).toBe('function');
    expect(typeof hitl.sendSlackApprovalRequest).toBe('function');
  });
});

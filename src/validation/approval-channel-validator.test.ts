/**
 * validateApprovalChannelScope — test suite
 *
 * Covers all acceptance criteria for the approval channel scope validator:
 *   TC-ACS-01: Identifies web approval channel code
 *   TC-ACS-02: Identifies webhook approval channel code
 *   TC-ACS-03: Identifies email approval channel code
 *   TC-ACS-04: Returns clear violation messages
 *   TC-ACS-05: Distinguishes from existing approval mechanisms
 */

import { describe, it, expect } from 'vitest';
import {
  validateApprovalChannelScope,
} from './approval-channel-validator.js';
import type {
  ApprovalChannelValidationResult,
} from './approval-channel-validator.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function clean(): ApprovalChannelValidationResult {
  return { valid: true, violations: [] };
}

// ─── TC-ACS-01: Web approval channel detection ────────────────────────────────

describe('TC-ACS-01: web approval channel detection', () => {
  it('flags webApproval identifier', () => {
    const result = validateApprovalChannelScope('const webApproval = createChannel();');
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.channel).toBe('web');
  });

  it('flags web_approval identifier (snake_case)', () => {
    const result = validateApprovalChannelScope('const web_approval = {};');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('web');
  });

  it('flags approvalUrl', () => {
    const result = validateApprovalChannelScope('const link = getApprovalUrl(token);');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('web');
  });

  it('flags approval_link', () => {
    const result = validateApprovalChannelScope('return { approval_link: url };');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('web');
  });

  it('flags approvalEndpoint', () => {
    const result = validateApprovalChannelScope('const approvalEndpoint = "/api/approve";');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('web');
  });

  it('flags approvalPortal', () => {
    const result = validateApprovalChannelScope('renderApprovalPortal(ctx);');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('web');
  });

  it('flags approvalPage', () => {
    const result = validateApprovalChannelScope('redirect(approvalPage);');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('web');
  });

  it('flags click-to-approve pattern', () => {
    const result = validateApprovalChannelScope('// clickToApprove: user opens link');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('web');
  });

  it('flags Express route for approval', () => {
    const result = validateApprovalChannelScope("app.get('/approve/:token', handler);");
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('web');
  });

  it('flags router.post approval route', () => {
    const result = validateApprovalChannelScope('router.post("/approval/callback", onApprove);');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('web');
  });
});

// ─── TC-ACS-02: Webhook approval channel detection ────────────────────────────

describe('TC-ACS-02: webhook approval channel detection', () => {
  it('flags webhookApproval identifier', () => {
    const result = validateApprovalChannelScope('const webhookApproval = new WebhookChannel();');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('webhook');
  });

  it('flags webhook_approval identifier (snake_case)', () => {
    const result = validateApprovalChannelScope('type: "webhook_approval"');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('webhook');
  });

  it('flags approvalWebhook identifier', () => {
    const result = validateApprovalChannelScope('const approvalWebhook = registerHandler();');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('webhook');
  });

  it('flags approval_webhook identifier (snake_case)', () => {
    const result = validateApprovalChannelScope('config.approval_webhook = url;');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('webhook');
  });

  it('flags send-webhook-for-approval pattern', () => {
    const result = validateApprovalChannelScope('await sendWebhook(url, { type: "approv" });');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('webhook');
  });
});

// ─── TC-ACS-03: Email approval channel detection ──────────────────────────────

describe('TC-ACS-03: email approval channel detection', () => {
  it('flags emailApproval identifier', () => {
    const result = validateApprovalChannelScope('const emailApproval = new EmailChannel();');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('email');
  });

  it('flags email_approval identifier (snake_case)', () => {
    const result = validateApprovalChannelScope('mode: "email_approval"');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('email');
  });

  it('flags approvalEmail identifier', () => {
    const result = validateApprovalChannelScope('sendApprovalEmail(recipient, token);');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('email');
  });

  it('flags approval_email identifier (snake_case)', () => {
    const result = validateApprovalChannelScope('const approval_email = compose(opts);');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('email');
  });

  it('flags sendApprovalEmail pattern', () => {
    const result = validateApprovalChannelScope('await sendApprovalEmail(user, requestId);');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('email');
  });

  it('flags send_approval_mail pattern', () => {
    const result = validateApprovalChannelScope('send_approval_mail(opts)');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('email');
  });

  it('flags mailApproval identifier', () => {
    const result = validateApprovalChannelScope('mailApproval({ to: addr });');
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.channel).toBe('email');
  });
});

// ─── TC-ACS-04: Violation message clarity ─────────────────────────────────────

describe('TC-ACS-04: violation message clarity', () => {
  it('violation message includes the channel name', () => {
    const { violations } = validateApprovalChannelScope('const webApproval = x;');
    expect(violations[0]!.message).toContain('web');
  });

  it('violation message includes a human-readable label', () => {
    const { violations } = validateApprovalChannelScope('const webApproval = x;');
    expect(violations[0]!.message.length).toBeGreaterThan(10);
  });

  it('violation exposes the matched source substring', () => {
    const { violations } = validateApprovalChannelScope('const webApproval = x;');
    expect(violations[0]!.match).toBeTruthy();
    expect('const webApproval = x;').toContain(violations[0]!.match);
  });

  it('webhook violation message includes "webhook"', () => {
    const { violations } = validateApprovalChannelScope('const webhookApproval = x;');
    expect(violations[0]!.message).toContain('webhook');
  });

  it('email violation message includes "email"', () => {
    const { violations } = validateApprovalChannelScope('const emailApproval = x;');
    expect(violations[0]!.message).toContain('email');
  });

  it('returns multiple violations when multiple patterns match', () => {
    const source = 'const webApproval = x; const emailApproval = y;';
    const { violations } = validateApprovalChannelScope(source);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    const channels = violations.map((v) => v.channel);
    expect(channels).toContain('web');
    expect(channels).toContain('email');
  });
});

// ─── TC-ACS-05: Distinguishes from existing approval mechanisms ───────────────

describe('TC-ACS-05: existing approval mechanisms are not flagged', () => {
  it('does not flag ApprovalManager class usage', () => {
    const result = validateApprovalChannelScope(
      'const mgr = new ApprovalManager(); mgr.createApproval(opts);',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag approval_id field', () => {
    const result = validateApprovalChannelScope(
      'const cap = { approval_id: uuid(), binding, issued_at };',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag HitlDecision type', () => {
    const result = validateApprovalChannelScope(
      'export type HitlDecision = "approved" | "denied" | "expired";',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag createApproval method call', () => {
    const result = validateApprovalChannelScope(
      'const handle = await approvalManager.createApproval(opts);',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag the send_email tool name', () => {
    // send_email is an existing tool that flows through the HITL pipeline;
    // it is NOT a new email approval channel.
    const result = validateApprovalChannelScope(
      'action_class: "communication.external.send", toolName: "send_email"',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag web.post action class', () => {
    const result = validateApprovalChannelScope(
      'action_class: "web.post", target: "https://api.example.com"',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag web.fetch action class', () => {
    const result = validateApprovalChannelScope(
      'action_class: "web.fetch", target: "https://api.example.com"',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag pending_hitl_approval decision string', () => {
    const result = validateApprovalChannelScope(
      'return { effect: "pending_hitl_approval", token };',
    );
    expect(result).toEqual(clean());
  });

  it('does not flag approval token consumption check', () => {
    const result = validateApprovalChannelScope(
      'if (this.consumed.has(approval_id)) return "expired";',
    );
    expect(result).toEqual(clean());
  });

  it('returns valid:true and empty violations for clean source', () => {
    const result = validateApprovalChannelScope('const x = 42;');
    expect(result).toEqual(clean());
  });

  it('returns valid:true for empty string', () => {
    const result = validateApprovalChannelScope('');
    expect(result).toEqual(clean());
  });
});

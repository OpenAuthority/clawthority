/**
 * Slack Approve Always — end-to-end workflow tests
 *
 * Integration-level tests that exercise the complete Approve Always workflow
 * by combining SlackInteractionServer, ApprovalManager, and sendSlackApprovalRequest.
 *
 * Acceptance criteria:
 *  - Button appears in HITL messages
 *  - Interaction server dispatches approve_always command
 *  - Session auto-approval registration (auto-permit creation)
 *  - Approval resolution as 'approved'
 *  - Feature flag controls button visibility
 *  - Error handling (unknown/expired tokens)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  SlackInteractionServer,
  sendSlackApprovalRequest,
  type SlackActionCommand,
} from './slack.js';
import { ApprovalManager } from './approval-manager.js';
import type { HitlPolicy } from './types.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const slackConfig = {
  botToken: 'xoxb-test',
  channelId: 'C123',
  signingSecret: 'test-secret',
  interactionPort: 0,
  interactionHost: '127.0.0.1',
};

const testPolicy: HitlPolicy = {
  name: 'Shell commands',
  actions: ['shell.exec'],
  approval: { channel: 'slack', timeout: 300, fallback: 'deny' },
};

function makeSignature(signingSecret: string, timestamp: string, body: string): string {
  const basestring = `v0:${timestamp}:${body}`;
  return 'v0=' + createHmac('sha256', signingSecret).update(basestring).digest('hex');
}

async function sendInteraction(
  port: number,
  signingSecret: string,
  actionId: string,
  value: string,
): Promise<Response> {
  const payload = JSON.stringify({
    type: 'block_actions',
    actions: [{ action_id: actionId, value }],
  });
  const body = `payload=${encodeURIComponent(payload)}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = makeSignature(signingSecret, ts, body);
  return fetch(`http://${slackConfig.interactionHost}:${port}/slack/interactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Slack-Request-Timestamp': ts,
      'X-Slack-Signature': sig,
    },
    body,
  });
}

// ─── Approve Always — button in HITL messages ─────────────────────────────────

describe('Approve Always — button in HITL messages', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes an Approve Always button by default', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: '111.222' }), { status: 200 }),
    );

    await sendSlackApprovalRequest(slackConfig, {
      token: 'abc12345',
      toolName: 'bash',
      agentId: 'agent-1',
      policyName: 'Shell policy',
      timeoutSeconds: 300,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    const buttons: Array<{ value: string }> = body.blocks.at(-1).elements;
    const values = buttons.map((b) => b.value);
    expect(values).toContain('approve_always:abc12345');
  });

  it('Approve Always button value embeds the correct token', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: '111.222' }), { status: 200 }),
    );

    const token = '019daa50-5dc1-78ee-9ab4-bcf652bddfa3';
    await sendSlackApprovalRequest(slackConfig, {
      token,
      toolName: 'bash',
      agentId: 'agent-1',
      policyName: 'Shell policy',
      timeoutSeconds: 300,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    const buttons: Array<{ value: string; action_id: string }> = body.blocks.at(-1).elements;
    const approveAlwaysBtn = buttons.find((b) => b.value.startsWith('approve_always:'));
    expect(approveAlwaysBtn).toBeDefined();
    expect(approveAlwaysBtn!.value).toBe(`approve_always:${token}`);
    expect(approveAlwaysBtn!.action_id).toBe('hitl_approve_always');
  });

  it('shows three buttons by default (Approve, Approve Always, Deny)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: '111.222' }), { status: 200 }),
    );

    await sendSlackApprovalRequest(slackConfig, {
      token: 'abc12345',
      toolName: 'bash',
      agentId: 'agent-1',
      policyName: 'Shell policy',
      timeoutSeconds: 300,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    const buttons: Array<{ value: string }> = body.blocks.at(-1).elements;
    expect(buttons).toHaveLength(3);
    const values = buttons.map((b) => b.value);
    expect(values).toContain('approve:abc12345');
    expect(values).toContain('approve_always:abc12345');
    expect(values).toContain('deny:abc12345');
  });

  it('omits Approve Always button when showApproveAlways is false', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: '111.222' }), { status: 200 }),
    );

    await sendSlackApprovalRequest(slackConfig, {
      token: 'abc12345',
      toolName: 'bash',
      agentId: 'agent-1',
      policyName: 'Shell policy',
      timeoutSeconds: 300,
      showApproveAlways: false,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    const buttons: Array<{ value: string }> = body.blocks.at(-1).elements;
    expect(buttons).toHaveLength(2);
    const values = buttons.map((b) => b.value);
    expect(values).not.toContain('approve_always:abc12345');
    expect(values).toContain('approve:abc12345');
    expect(values).toContain('deny:abc12345');
  });
});

// ─── Approve Always — session auto-approval registration ─────────────────────

describe('Approve Always — session auto-approval registration', () => {
  let server: SlackInteractionServer;
  let manager: ApprovalManager;
  let port: number;

  beforeEach(async () => {
    manager = new ApprovalManager();
    server = new SlackInteractionServer(
      0,
      slackConfig.signingSecret,
      (command: SlackActionCommand, token: string) => {
        if (command === 'approve_always') {
          const pending = manager.getPending(token);
          if (pending) {
            manager.addSessionAutoApproval(pending.channelId, pending.action_class);
          }
        }
        const decision = command === 'deny' ? ('denied' as const) : ('approved' as const);
        manager.resolveApproval(token, decision);
      },
      slackConfig.interactionHost,
    );
    await server.start();
    port = server.address().port;
  });

  afterEach(async () => {
    await server.stop();
    manager.shutdown();
  });

  it('approve_always registers session auto-approval via addSessionAutoApproval', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'C123',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    await sendInteraction(port, slackConfig.signingSecret, 'hitl_approve_always', `approve_always:${token}`);
    await new Promise((r) => setTimeout(r, 50));

    expect(manager.isSessionAutoApproved('C123', 'shell.exec')).toBe(true);
    expect(manager.isConsumed(token)).toBe(true);
  });

  it('approve_always resolves the approval as approved', async () => {
    let resolvedDecision: string | undefined;
    const { token, promise } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'C123',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });
    promise.then((d) => {
      resolvedDecision = d;
    });

    await sendInteraction(port, slackConfig.signingSecret, 'hitl_approve_always', `approve_always:${token}`);
    await new Promise((r) => setTimeout(r, 50));

    expect(resolvedDecision).toBe('approved');
  });

  it('approve_always for unknown token does not register session auto-approval', async () => {
    const unknownToken = 'nonexistent-token-1234';

    await sendInteraction(port, slackConfig.signingSecret, 'hitl_approve_always', `approve_always:${unknownToken}`);
    await new Promise((r) => setTimeout(r, 50));

    expect(manager.isSessionAutoApproved('C123', 'shell.exec')).toBe(false);
  });

  it('session auto-approval is scoped to channelId and action class', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'C123',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    await sendInteraction(port, slackConfig.signingSecret, 'hitl_approve_always', `approve_always:${token}`);
    await new Promise((r) => setTimeout(r, 50));

    // Same channel, different action class — not auto-approved
    expect(manager.isSessionAutoApproved('C123', 'filesystem.read')).toBe(false);
    // Different channel, same action class — not auto-approved
    expect(manager.isSessionAutoApproved('C999', 'shell.exec')).toBe(false);
    // Original pair — auto-approved
    expect(manager.isSessionAutoApproved('C123', 'shell.exec')).toBe(true);
  });

  it('deny interaction does not register session auto-approval', async () => {
    const { token } = manager.createApprovalRequest({
      toolName: 'bash',
      agentId: 'agent-1',
      channelId: 'C123',
      policy: testPolicy,
      action_class: 'shell.exec',
      target: 'git commit -m "msg"',
    });

    await sendInteraction(port, slackConfig.signingSecret, 'hitl_deny', `deny:${token}`);
    await new Promise((r) => setTimeout(r, 50));

    expect(manager.isSessionAutoApproved('C123', 'shell.exec')).toBe(false);
    expect(manager.isConsumed(token)).toBe(true);
  });
});

// ─── Approve Always — isSessionAutoApproved prevents duplicate HITL prompts ───

describe('Approve Always — isSessionAutoApproved prevents duplicate HITL prompts', () => {
  it('addSessionAutoApproval makes isSessionAutoApproved return true', () => {
    const manager = new ApprovalManager();
    expect(manager.isSessionAutoApproved('C123', 'shell.exec')).toBe(false);
    manager.addSessionAutoApproval('C123', 'shell.exec');
    expect(manager.isSessionAutoApproved('C123', 'shell.exec')).toBe(true);
    manager.shutdown();
  });

  it('multiple approve_always clicks for different action classes are tracked independently', () => {
    const manager = new ApprovalManager();
    manager.addSessionAutoApproval('C123', 'shell.exec');
    manager.addSessionAutoApproval('C123', 'filesystem.read');
    expect(manager.isSessionAutoApproved('C123', 'shell.exec')).toBe(true);
    expect(manager.isSessionAutoApproved('C123', 'filesystem.read')).toBe(true);
    expect(manager.isSessionAutoApproved('C123', 'email.send')).toBe(false);
    manager.shutdown();
  });

  it('shutdown clears all session auto-approvals', () => {
    const manager = new ApprovalManager();
    manager.addSessionAutoApproval('C123', 'shell.exec');
    expect(manager.isSessionAutoApproved('C123', 'shell.exec')).toBe(true);
    manager.shutdown();
    expect(manager.isSessionAutoApproved('C123', 'shell.exec')).toBe(false);
  });
});

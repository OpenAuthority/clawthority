import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  resolveSlackConfig,
  sendSlackApprovalRequest,
  verifySlackSignature,
  SlackInteractionServer,
} from './slack.js';
import { CircuitBreaker } from './retry.js';
import type { SlackConfig } from './types.js';

// ─── resolveSlackConfig ─────────────────────────────────────────────────────

describe('resolveSlackConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null when no config or env vars are set', () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.SLACK_SIGNING_SECRET;
    expect(resolveSlackConfig()).toBeNull();
    expect(resolveSlackConfig({})).toBeNull();
  });

  it('returns config values when env vars are not set', () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_INTERACTION_PORT;
    const config: SlackConfig = {
      botToken: 'xoxb-cfg',
      channelId: 'C123',
      signingSecret: 'secret-cfg',
      interactionPort: 4000,
    };
    const result = resolveSlackConfig(config);
    expect(result).toEqual({
      botToken: 'xoxb-cfg',
      channelId: 'C123',
      signingSecret: 'secret-cfg',
      interactionPort: 4000,
    });
  });

  it('env vars take precedence over config values', () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-env';
    process.env.SLACK_CHANNEL_ID = 'C999';
    process.env.SLACK_SIGNING_SECRET = 'secret-env';
    process.env.SLACK_INTERACTION_PORT = '5000';
    const config: SlackConfig = {
      botToken: 'xoxb-cfg',
      channelId: 'C123',
      signingSecret: 'secret-cfg',
      interactionPort: 4000,
    };
    const result = resolveSlackConfig(config);
    expect(result).toEqual({
      botToken: 'xoxb-env',
      channelId: 'C999',
      signingSecret: 'secret-env',
      interactionPort: 5000,
    });
  });

  it('returns null if signingSecret is missing', () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-env';
    process.env.SLACK_CHANNEL_ID = 'C999';
    delete process.env.SLACK_SIGNING_SECRET;
    expect(resolveSlackConfig()).toBeNull();
  });

  it('defaults interactionPort to 3201', () => {
    delete process.env.SLACK_INTERACTION_PORT;
    const config: SlackConfig = {
      botToken: 'xoxb-test',
      channelId: 'C123',
      signingSecret: 'secret',
    };
    const result = resolveSlackConfig(config);
    expect(result?.interactionPort).toBe(3201);
  });
});

// ─── sendSlackApprovalRequest ───────────────────────────────────────────────

describe('sendSlackApprovalRequest', () => {
  const config = { botToken: 'xoxb-test', channelId: 'C123', signingSecret: 'secret', interactionPort: 3201 };
  const opts = {
    token: 'abc12345',
    toolName: 'email.send',
    agentId: 'agent-1',
    policyName: 'Email policy',
    timeoutSeconds: 300,
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a POST to chat.postMessage with Block Kit blocks', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: '1234567890.123456' }), { status: 200 }),
    );

    const result = await sendSlackApprovalRequest(config, opts);
    expect(result.ok).toBe(true);
    expect(result.messageTs).toBe('1234567890.123456');

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(init?.headers).toHaveProperty('Authorization', 'Bearer xoxb-test');

    const body = JSON.parse(init?.body as string);
    expect(body.channel).toBe('C123');
    expect(body.blocks).toHaveLength(2);
    expect(body.blocks[0].type).toBe('section');
    expect(body.blocks[1].type).toBe('actions');

    // Check buttons
    const buttons = body.blocks[1].elements;
    expect(buttons).toHaveLength(2);
    expect(buttons[0].value).toBe('approve:abc12345');
    expect(buttons[1].value).toBe('deny:abc12345');
  });

  it('returns ok:false on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Server Error', { status: 500 }));
    const result = await sendSlackApprovalRequest(config, opts);
    expect(result.ok).toBe(false);
  });

  it('returns ok:false on Slack API error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 }),
    );
    const result = await sendSlackApprovalRequest(config, opts);
    expect(result.ok).toBe(false);
  });

  it('returns ok:false on fetch error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
    const result = await sendSlackApprovalRequest(config, opts);
    expect(result.ok).toBe(false);
  });

  it('retries on 429 and returns ok:true when the retry succeeds', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, ts: '111.222' }), { status: 200 }),
      );

    const breaker = new CircuitBreaker();
    const result = await sendSlackApprovalRequest(config, opts, breaker);
    expect(result.ok).toBe(true);
    expect(result.messageTs).toBe('111.222');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns ok:false immediately when circuit is open (no fetch)', async () => {
    const breaker = new CircuitBreaker();
    breaker.trip();

    const result = await sendSlackApprovalRequest(config, opts, breaker);
    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── verifySlackSignature ───────────────────────────────────────────────────

describe('verifySlackSignature', () => {
  const secret = 'test-signing-secret';

  function makeSignature(timestamp: string, body: string): string {
    const basestring = `v0:${timestamp}:${body}`;
    return 'v0=' + createHmac('sha256', secret).update(basestring).digest('hex');
  }

  it('accepts a valid signature', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = 'payload=test';
    const sig = makeSignature(ts, body);
    expect(verifySlackSignature(secret, ts, body, sig)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = 'payload=test';
    expect(verifySlackSignature(secret, ts, body, 'v0=invalid')).toBe(false);
  });

  it('rejects a request older than 5 minutes', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 400);
    const body = 'payload=test';
    const sig = makeSignature(ts, body);
    expect(verifySlackSignature(secret, ts, body, sig)).toBe(false);
  });

  it('rejects non-numeric timestamp', () => {
    expect(verifySlackSignature(secret, 'abc', 'body', 'v0=xxx')).toBe(false);
  });
});

// ─── SlackInteractionServer ─────────────────────────────────────────────────

describe('SlackInteractionServer', () => {
  const signingSecret = 'test-secret';
  let server: SlackInteractionServer;
  let onAction: ReturnType<typeof vi.fn>;
  let port: number;

  function makeSignature(timestamp: string, body: string): string {
    const basestring = `v0:${timestamp}:${body}`;
    return 'v0=' + createHmac('sha256', signingSecret).update(basestring).digest('hex');
  }

  beforeEach(async () => {
    onAction = vi.fn();
    // Bind to port 0 — let the OS pick a free port. Required because vitest
    // runs test files in parallel workers; a hardcoded or randomly-chosen
    // port hits EADDRINUSE often enough to break CI flakily. The actual
    // bound port is read back via server.address() after start() resolves.
    server = new SlackInteractionServer(0, signingSecret, onAction);
    await server.start();
    port = server.address().port;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('handles a valid approve interaction', async () => {
    const payload = JSON.stringify({
      type: 'block_actions',
      actions: [{ action_id: 'hitl_approve', value: 'approve:abc12345' }],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeSignature(ts, body);

    const res = await fetch(`http://localhost:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': ts,
        'X-Slack-Signature': sig,
      },
      body,
    });

    expect(res.status).toBe(200);
    // Give async processing time
    await new Promise((r) => setTimeout(r, 50));
    expect(onAction).toHaveBeenCalledWith('approve', 'abc12345');
  });

  it('handles a valid deny interaction', async () => {
    const payload = JSON.stringify({
      type: 'block_actions',
      actions: [{ action_id: 'hitl_deny', value: 'deny:XyZ98765' }],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeSignature(ts, body);

    const res = await fetch(`http://localhost:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': ts,
        'X-Slack-Signature': sig,
      },
      body,
    });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(onAction).toHaveBeenCalledWith('deny', 'XyZ98765');
  });

  it('handles an approve interaction with a UUID v7 token (36 chars)', async () => {
    const uuid = '019daa50-5dc1-78ee-9ab4-bcf652bddfa3';
    const payload = JSON.stringify({
      type: 'block_actions',
      actions: [{ action_id: 'hitl_approve', value: `approve:${uuid}` }],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeSignature(ts, body);

    const res = await fetch(`http://localhost:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': ts,
        'X-Slack-Signature': sig,
      },
      body,
    });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(onAction).toHaveBeenCalledWith('approve', uuid);
  });

  it('handles an approve interaction with a session_approval token', async () => {
    const sessionToken = 'sess-abc:filesystem.delete';
    const payload = JSON.stringify({
      type: 'block_actions',
      actions: [{ action_id: 'hitl_approve', value: `approve:${sessionToken}` }],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeSignature(ts, body);

    const res = await fetch(`http://localhost:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': ts,
        'X-Slack-Signature': sig,
      },
      body,
    });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(onAction).toHaveBeenCalledWith('approve', sessionToken);
  });

  it('rejects requests with invalid signature', async () => {
    const payload = JSON.stringify({
      type: 'block_actions',
      actions: [{ action_id: 'hitl_approve', value: 'approve:abc12345' }],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const ts = String(Math.floor(Date.now() / 1000));

    const res = await fetch(`http://localhost:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': ts,
        'X-Slack-Signature': 'v0=invalidsignature',
      },
      body,
    });

    expect(res.status).toBe(401);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('returns 404 for non-interaction paths', async () => {
    const res = await fetch(`http://localhost:${port}/other-path`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for GET on the interactions path', async () => {
    const res = await fetch(`http://localhost:${port}/slack/interactions`, { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('ignores valid-signature requests with a malformed JSON payload', async () => {
    // The body has a payload= field, but the value is not valid JSON, so the
    // try/catch around JSON.parse triggers and onAction is never called.
    const body = `payload=${encodeURIComponent('{not-valid-json{{')}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeSignature(ts, body);

    const res = await fetch(`http://localhost:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': ts,
        'X-Slack-Signature': sig,
      },
      body,
    });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('ignores valid-signature requests missing the payload field', async () => {
    const body = 'other=field';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeSignature(ts, body);

    const res = await fetch(`http://localhost:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': ts,
        'X-Slack-Signature': sig,
      },
      body,
    });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('start and stop lifecycle works', async () => {
    // Already started in beforeEach, just verify stop works cleanly
    await server.stop();
    // Re-create for afterEach to not error
    server = new SlackInteractionServer(port, signingSecret, onAction);
    await server.start();
  });

  it('stop() is a no-op when the server was never started', async () => {
    const fresh = new SlackInteractionServer(port + 1, signingSecret, onAction);
    await expect(fresh.stop()).resolves.toBeUndefined();
  });

  it('stop() is idempotent (second call resolves immediately)', async () => {
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
    // Re-create for afterEach to not error
    server = new SlackInteractionServer(port, signingSecret, onAction);
    await server.start();
  });
});

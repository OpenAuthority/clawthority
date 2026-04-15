import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveTelegramConfig, sendApprovalRequest, TelegramListener } from './telegram.js';
import { CircuitBreaker } from './retry.js';
import type { TelegramConfig } from './types.js';

// ─── resolveTelegramConfig ──────────────────────────────────────────────────

describe('resolveTelegramConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null when neither env vars nor config are set', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    expect(resolveTelegramConfig()).toBeNull();
    expect(resolveTelegramConfig({})).toBeNull();
  });

  it('returns config values when env vars are not set', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const config: TelegramConfig = { botToken: 'cfg-token', chatId: 'cfg-chat' };
    const result = resolveTelegramConfig(config);
    expect(result).toEqual({ botToken: 'cfg-token', chatId: 'cfg-chat' });
  });

  it('env vars take precedence over config values', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    process.env.TELEGRAM_CHAT_ID = 'env-chat';
    const config: TelegramConfig = { botToken: 'cfg-token', chatId: 'cfg-chat' };
    const result = resolveTelegramConfig(config);
    expect(result).toEqual({ botToken: 'env-token', chatId: 'env-chat' });
  });

  it('returns null if only botToken is set (chatId missing)', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    delete process.env.TELEGRAM_CHAT_ID;
    expect(resolveTelegramConfig()).toBeNull();
  });

  it('returns null if only chatId is set (botToken missing)', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_CHAT_ID = 'env-chat';
    expect(resolveTelegramConfig()).toBeNull();
  });

  it('mixes env var for botToken with config for chatId', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    delete process.env.TELEGRAM_CHAT_ID;
    const config: TelegramConfig = { chatId: 'cfg-chat' };
    const result = resolveTelegramConfig(config);
    expect(result).toEqual({ botToken: 'env-token', chatId: 'cfg-chat' });
  });
});

// ─── sendApprovalRequest ────────────────────────────────────────────────────

describe('sendApprovalRequest', () => {
  const config = { botToken: 'test-token', chatId: '12345' };
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

  it('sends a POST to the Telegram sendMessage endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    const result = await sendApprovalRequest(config, opts);
    expect(result).toBe(true);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    expect(init?.method).toBe('POST');

    const body = JSON.parse(init?.body as string);
    expect(body.chat_id).toBe('12345');
    expect(body.text).toContain('abc12345');
    expect(body.text).toContain('email.send');
    expect(body.text).toContain('agent-1');
    expect(body.text).toContain('Email policy');
    expect(body.text).toContain('300s');
    expect(body.text).toContain('/approve abc12345');
    expect(body.text).toContain('/deny abc12345');
  });

  it('returns false on non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const result = await sendApprovalRequest(config, opts);
    expect(result).toBe(false);
  });

  it('returns false on fetch error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
    const result = await sendApprovalRequest(config, opts);
    expect(result).toBe(false);
  });

  it('retries on 429 and returns true when the retry succeeds', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const breaker = new CircuitBreaker();
    const result = await sendApprovalRequest(config, opts, breaker);
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns false immediately when circuit is open (no fetch)', async () => {
    const breaker = new CircuitBreaker();
    breaker.trip();

    const result = await sendApprovalRequest(config, opts, breaker);
    expect(result).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── TelegramListener ───────────────────────────────────────────────────────

describe('TelegramListener', () => {
  let listener: TelegramListener;
  let onCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    onCommand = vi.fn();
  });

  afterEach(() => {
    listener?.stop();
    vi.unstubAllGlobals();
  });

  it('parses /approve TOKEN correctly', async () => {
    const updates = {
      ok: true,
      result: [
        { update_id: 1, message: { text: '/approve abc12345', chat: { id: 12345 } } },
      ],
    };

    // First call returns updates, second hangs until stopped
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(updates), { status: 200 }))
      .mockImplementation(() => new Promise(() => {})); // hang

    listener = new TelegramListener('test-token', onCommand);
    listener.start();

    // Wait for the poll to process
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    expect(onCommand).toHaveBeenCalledWith('approve', 'abc12345');
  });

  it('parses /deny TOKEN correctly', async () => {
    const updates = {
      ok: true,
      result: [
        { update_id: 2, message: { text: '/deny XyZ98765', chat: { id: 12345 } } },
      ],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(updates), { status: 200 }))
      .mockImplementation(() => new Promise(() => {}));

    listener = new TelegramListener('test-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());
    expect(onCommand).toHaveBeenCalledWith('deny', 'XyZ98765');
  });

  it('ignores non-command messages', async () => {
    const updates = {
      ok: true,
      result: [
        { update_id: 3, message: { text: 'hello world', chat: { id: 12345 } } },
        { update_id: 4, message: { text: '/start', chat: { id: 12345 } } },
        { update_id: 5, message: { text: '/approve', chat: { id: 12345 } } }, // no token
      ],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(updates), { status: 200 }))
      .mockImplementation(() => new Promise(() => {}));

    listener = new TelegramListener('test-token', onCommand);
    listener.start();

    // Give it time to process, then verify no commands were dispatched
    await new Promise((r) => setTimeout(r, 50));
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('stop() prevents further polling', async () => {
    vi.mocked(fetch).mockImplementation(
      () => new Promise((_, reject) => {
        setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 10);
      }),
    );

    listener = new TelegramListener('test-token', onCommand);
    listener.start();
    listener.stop();

    // Should not throw or hang
    await new Promise((r) => setTimeout(r, 50));
  });

  it('processes multiple updates in one poll', async () => {
    const updates = {
      ok: true,
      result: [
        { update_id: 10, message: { text: '/approve token001', chat: { id: 12345 } } },
        { update_id: 11, message: { text: '/deny token002', chat: { id: 12345 } } },
      ],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(updates), { status: 200 }))
      .mockImplementation(() => new Promise(() => {}));

    listener = new TelegramListener('test-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledTimes(2));
    expect(onCommand).toHaveBeenCalledWith('approve', 'token001');
    expect(onCommand).toHaveBeenCalledWith('deny', 'token002');
  });

  it('logs and recovers when a poll throws a non-abort error', async () => {
    // First poll throws a regular error → catch block logs and schedules a
    // 5s retry delay. We just need to verify the listener does not crash
    // and onCommand is never called for the failed poll.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetch).mockImplementationOnce(() => Promise.reject(new Error('Transient network error')));
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {})); // hang subsequent polls

    listener = new TelegramListener('test-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(errorSpy.mock.calls[0]?.[0]).toContain('[hitl-telegram] poll error');
    expect(onCommand).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('backs off when getUpdates returns 429', async () => {
    // 429 on the first poll → listener backs off (30s) before retrying.
    // We verify: (a) onCommand is never called, (b) a second fetch is eventually
    // attempted after the rate-limit delay. We mock the second call to hang.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockImplementation(() => new Promise(() => {})); // hang subsequent polls

    listener = new TelegramListener('test-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[hitl-telegram] getUpdates rate-limited');
    expect(onCommand).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('skips a poll when Telegram returns ok:false', async () => {
    // ok:false branches into the retry-delay path (RETRY_DELAY_MS) without
    // dispatching any command. We verify onCommand is not invoked.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 200 }));
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));

    listener = new TelegramListener('test-token', onCommand);
    listener.start();

    // Give the listener a tick to consume the ok:false response
    await new Promise((r) => setTimeout(r, 50));
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('updates offset after processing', async () => {
    const updates = {
      ok: true,
      result: [
        { update_id: 42, message: { text: '/approve abc12345', chat: { id: 12345 } } },
      ],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(updates), { status: 200 }))
      .mockImplementation(() => new Promise(() => {}));

    listener = new TelegramListener('test-token', onCommand);
    listener.start();

    await vi.waitFor(() => expect(onCommand).toHaveBeenCalled());

    // Second fetch call should have offset=43
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondCallUrl = vi.mocked(fetch).mock.calls[1]![0] as string;
    expect(secondCallUrl).toContain('offset=43');
  });
});

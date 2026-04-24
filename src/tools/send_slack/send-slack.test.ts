/**
 * Unit tests for the send_slack tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 * SLACK_BOT_TOKEN env var is never set in these tests; the token is injected
 * via options.token to keep tests hermetic.
 *
 * Test IDs:
 *   TC-SSL-01: Successful post — returns ts and channel
 *   TC-SSL-02: Thread reply — thread_ts forwarded in request body
 *   TC-SSL-03: missing-token — throws when no token configured
 *   TC-SSL-04: network-error — fetch rejection throws SendSlackError
 *   TC-SSL-05: timeout — AbortError surfaces as code 'timeout'
 *   TC-SSL-06: slack-api-error — ok:false response throws SendSlackError
 *   TC-SSL-07: Result shape — ts and channel fields present with correct types
 *   TC-SSL-08: Authorization header — Bearer token forwarded to Slack API
 *   TC-SSL-09: Non-JSON response — surfaces as slack-api-error
 *   TC-SSL-10: username — username forwarded in request body when provided
 *   TC-SSL-11: username omitted — username absent from body when not provided
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendSlack, SendSlackError } from './send-slack.js';

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubSlackSuccess(ts = '1512085950.000216', channel = 'C01234ABCDE'): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status: 200,
    text: async () => JSON.stringify({ ok: true, ts, channel }),
  }));
}

function stubSlackError(errorCode: string): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status: 200,
    text: async () => JSON.stringify({ ok: false, error: errorCode }),
  }));
}

function stubFetchRejected(message: string): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const TEST_TOKEN = 'xoxb-test-token-001';

// ─── TC-SSL-01: Successful post ───────────────────────────────────────────────

describe('TC-SSL-01: successful post — returns ts and channel', () => {
  it('returns ts and channel from Slack response', async () => {
    stubSlackSuccess('1512085950.000216', 'C01234ABCDE');
    const result = await sendSlack(
      { channel: 'C01234ABCDE', text: 'Hello, world!' },
      { token: TEST_TOKEN },
    );
    expect(result.ts).toBe('1512085950.000216');
    expect(result.channel).toBe('C01234ABCDE');
  });

  it('accepts channel name instead of ID', async () => {
    stubSlackSuccess('1612085950.000111', 'C99999ZZZZZ');
    const result = await sendSlack(
      { channel: '#general', text: 'Hello!' },
      { token: TEST_TOKEN },
    );
    expect(result.ts).toBe('1612085950.000111');
    expect(result.channel).toBe('C99999ZZZZZ');
  });
});

// ─── TC-SSL-02: Thread reply ──────────────────────────────────────────────────

describe('TC-SSL-02: thread reply — thread_ts forwarded in request body', () => {
  it('includes thread_ts in the POST body when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true, ts: '1512085950.000999', channel: 'C01234ABCDE' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendSlack(
      { channel: 'C01234ABCDE', text: 'reply', thread_ts: '1512085950.000001' },
      { token: TEST_TOKEN },
    );

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, string>;
    expect(body['thread_ts']).toBe('1512085950.000001');
  });

  it('omits thread_ts from body when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true, ts: '1512085950.000200', channel: 'C01234ABCDE' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendSlack(
      { channel: 'C01234ABCDE', text: 'no thread' },
      { token: TEST_TOKEN },
    );

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, string>;
    expect(body['thread_ts']).toBeUndefined();
  });
});

// ─── TC-SSL-03: missing-token ─────────────────────────────────────────────────

describe('TC-SSL-03: missing-token — throws when no token configured', () => {
  it('throws SendSlackError with code missing-token when token is absent', async () => {
    // Do not stub fetch — it should never be called
    let err: SendSlackError | undefined;
    try {
      // No options.token and SLACK_BOT_TOKEN is not set in test env
      await sendSlack({ channel: '#general', text: 'hello' });
    } catch (e) {
      err = e as SendSlackError;
    }
    expect(err).toBeInstanceOf(SendSlackError);
    expect(err!.code).toBe('missing-token');
  });

  it('error name is SendSlackError', async () => {
    let err: SendSlackError | undefined;
    try {
      await sendSlack({ channel: '#general', text: 'hello' });
    } catch (e) {
      err = e as SendSlackError;
    }
    expect(err!.name).toBe('SendSlackError');
  });
});

// ─── TC-SSL-04: network-error ─────────────────────────────────────────────────

describe('TC-SSL-04: network-error — fetch rejection throws SendSlackError', () => {
  it('throws SendSlackError with code network-error when fetch rejects', async () => {
    stubFetchRejected('connection refused');
    let err: SendSlackError | undefined;
    try {
      await sendSlack({ channel: '#general', text: 'hello' }, { token: TEST_TOKEN });
    } catch (e) {
      err = e as SendSlackError;
    }
    expect(err).toBeInstanceOf(SendSlackError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original failure cause', async () => {
    stubFetchRejected('ECONNREFUSED');
    let err: SendSlackError | undefined;
    try {
      await sendSlack({ channel: '#general', text: 'hello' }, { token: TEST_TOKEN });
    } catch (e) {
      err = e as SendSlackError;
    }
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-SSL-05: timeout ───────────────────────────────────────────────────────

describe('TC-SSL-05: timeout — AbortError surfaces as code timeout', () => {
  it('throws SendSlackError with code timeout when fetch is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: SendSlackError | undefined;
    try {
      await sendSlack({ channel: '#general', text: 'hello' }, { token: TEST_TOKEN });
    } catch (e) {
      err = e as SendSlackError;
    }
    expect(err).toBeInstanceOf(SendSlackError);
    expect(err!.code).toBe('timeout');
  });

  it('timeout error is distinct from network-error', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: SendSlackError | undefined;
    try {
      await sendSlack({ channel: '#general', text: 'hello' }, { token: TEST_TOKEN });
    } catch (e) {
      err = e as SendSlackError;
    }
    expect(err!.code).not.toBe('network-error');
    expect(err!.code).toBe('timeout');
  });
});

// ─── TC-SSL-06: slack-api-error ───────────────────────────────────────────────

describe('TC-SSL-06: slack-api-error — ok:false response throws SendSlackError', () => {
  it('throws SendSlackError with code slack-api-error when ok is false', async () => {
    stubSlackError('channel_not_found');
    let err: SendSlackError | undefined;
    try {
      await sendSlack({ channel: '#nonexistent', text: 'hello' }, { token: TEST_TOKEN });
    } catch (e) {
      err = e as SendSlackError;
    }
    expect(err).toBeInstanceOf(SendSlackError);
    expect(err!.code).toBe('slack-api-error');
  });

  it('error message includes the Slack error code', async () => {
    stubSlackError('not_in_channel');
    let err: SendSlackError | undefined;
    try {
      await sendSlack({ channel: '#private', text: 'hello' }, { token: TEST_TOKEN });
    } catch (e) {
      err = e as SendSlackError;
    }
    expect(err!.message).toContain('not_in_channel');
  });

  it('handles missing error field in Slack response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: false }),
    }));
    let err: SendSlackError | undefined;
    try {
      await sendSlack({ channel: '#general', text: 'hello' }, { token: TEST_TOKEN });
    } catch (e) {
      err = e as SendSlackError;
    }
    expect(err!.code).toBe('slack-api-error');
    expect(err!.message).toContain('unknown_error');
  });
});

// ─── TC-SSL-07: Result shape ──────────────────────────────────────────────────

describe('TC-SSL-07: result shape — ts and channel fields present', () => {
  it('result has a ts string field', async () => {
    stubSlackSuccess();
    const result = await sendSlack(
      { channel: 'C01234ABCDE', text: 'test' },
      { token: TEST_TOKEN },
    );
    expect(typeof result.ts).toBe('string');
  });

  it('result has a channel string field', async () => {
    stubSlackSuccess();
    const result = await sendSlack(
      { channel: 'C01234ABCDE', text: 'test' },
      { token: TEST_TOKEN },
    );
    expect(typeof result.channel).toBe('string');
  });
});

// ─── TC-SSL-08: Authorization header ─────────────────────────────────────────

describe('TC-SSL-08: authorization header — Bearer token forwarded', () => {
  it('sends Authorization: Bearer <token> header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true, ts: '1512085950.000216', channel: 'C01234ABCDE' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendSlack(
      { channel: 'C01234ABCDE', text: 'test' },
      { token: 'xoxb-my-secret-token' },
    );

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer xoxb-my-secret-token');
  });

  it('POSTs to the Slack chat.postMessage endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true, ts: '1512085950.000216', channel: 'C01234ABCDE' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendSlack(
      { channel: 'C01234ABCDE', text: 'test' },
      { token: TEST_TOKEN },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

// ─── TC-SSL-09: Non-JSON response ─────────────────────────────────────────────

describe('TC-SSL-09: non-JSON response — surfaces as slack-api-error', () => {
  it('throws SendSlackError with code slack-api-error for non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'not json at all',
    }));

    let err: SendSlackError | undefined;
    try {
      await sendSlack({ channel: '#general', text: 'hello' }, { token: TEST_TOKEN });
    } catch (e) {
      err = e as SendSlackError;
    }
    expect(err).toBeInstanceOf(SendSlackError);
    expect(err!.code).toBe('slack-api-error');
  });
});

// ─── TC-SSL-10: username forwarded ────────────────────────────────────────────

describe('TC-SSL-10: username — username forwarded in request body when provided', () => {
  it('includes username in the POST body when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true, ts: '1512085950.000216', channel: 'C01234ABCDE' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendSlack(
      { channel: 'C01234ABCDE', text: 'hello', username: 'MyBot' },
      { token: TEST_TOKEN },
    );

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, string>;
    expect(body['username']).toBe('MyBot');
  });
});

// ─── TC-SSL-11: username omitted ──────────────────────────────────────────────

describe('TC-SSL-11: username omitted — username absent from body when not provided', () => {
  it('omits username from body when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true, ts: '1512085950.000216', channel: 'C01234ABCDE' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendSlack(
      { channel: 'C01234ABCDE', text: 'hello' },
      { token: TEST_TOKEN },
    );

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, string>;
    expect(body['username']).toBeUndefined();
  });
});

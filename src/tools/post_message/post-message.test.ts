/**
 * Unit tests for the post_message tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 * The Slack token is injected via options.token to keep tests hermetic.
 *
 * Test IDs:
 *   TC-PMS-01: Successful post — returns message_id and posted:true
 *   TC-PMS-02: Thread reply — thread_ts forwarded to sendSlack
 *   TC-PMS-03: unsupported-platform — throws for non-slack platform
 *   TC-PMS-04: missing-token — propagated from sendSlack as PostMessageError
 *   TC-PMS-05: network-error — propagated from sendSlack as PostMessageError
 *   TC-PMS-06: timeout — propagated from sendSlack as PostMessageError
 *   TC-PMS-07: platform-error — slack-api-error mapped to platform-error
 *   TC-PMS-08: Result shape — message_id and posted fields present with correct types
 *   TC-PMS-09: message_id — equals the Slack ts timestamp
 *   TC-PMS-10: channel forwarded — channel passed through to Slack API body
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { postMessage, PostMessageError } from './post-message.js';

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubSlackSuccess(ts = '1512085950.000216', channel = 'C01234ABCDE'): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status: 200,
    text: async () => JSON.stringify({ ok: true, ts, channel }),
  }));
}

function stubSlackApiError(errorCode: string): void {
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

// ─── TC-PMS-01: Successful post ───────────────────────────────────────────────

describe('TC-PMS-01: successful post — returns message_id and posted:true', () => {
  it('returns message_id and posted:true on success', async () => {
    stubSlackSuccess('1512085950.000216', 'C01234ABCDE');
    const result = await postMessage(
      { platform: 'slack', message: 'Hello, world!', channel: '#general' },
      { token: TEST_TOKEN },
    );
    expect(result.message_id).toBe('1512085950.000216');
    expect(result.posted).toBe(true);
  });

  it('accepts channel ID format', async () => {
    stubSlackSuccess('1612085950.000111', 'C99999ZZZZZ');
    const result = await postMessage(
      { platform: 'slack', message: 'Hello!', channel: 'C99999ZZZZZ' },
      { token: TEST_TOKEN },
    );
    expect(result.message_id).toBe('1612085950.000111');
    expect(result.posted).toBe(true);
  });
});

// ─── TC-PMS-02: Thread reply ──────────────────────────────────────────────────

describe('TC-PMS-02: thread reply — thread_ts forwarded to sendSlack', () => {
  it('includes thread_ts in the Slack API request body when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true, ts: '1512085950.000999', channel: 'C01234ABCDE' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await postMessage(
      { platform: 'slack', message: 'reply', channel: '#general', thread_ts: '1512085950.000001' },
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

    await postMessage(
      { platform: 'slack', message: 'no thread', channel: '#general' },
      { token: TEST_TOKEN },
    );

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, string>;
    expect(body['thread_ts']).toBeUndefined();
  });
});

// ─── TC-PMS-03: unsupported-platform ──────────────────────────────────────────

describe('TC-PMS-03: unsupported-platform — throws for non-slack platform', () => {
  it('throws PostMessageError with code unsupported-platform for unknown platform', async () => {
    let err: PostMessageError | undefined;
    try {
      await postMessage(
        // @ts-expect-error intentional invalid platform for test
        { platform: 'teams', message: 'hello', channel: '#general' },
        { token: TEST_TOKEN },
      );
    } catch (e) {
      err = e as PostMessageError;
    }
    expect(err).toBeInstanceOf(PostMessageError);
    expect(err!.code).toBe('unsupported-platform');
  });

  it('error message includes the invalid platform name', async () => {
    let err: PostMessageError | undefined;
    try {
      // @ts-expect-error intentional invalid platform for test
      await postMessage({ platform: 'discord', message: 'hello', channel: '#general' });
    } catch (e) {
      err = e as PostMessageError;
    }
    expect(err!.message).toContain('discord');
  });
});

// ─── TC-PMS-04: missing-token ─────────────────────────────────────────────────

describe('TC-PMS-04: missing-token — propagated from sendSlack as PostMessageError', () => {
  it('throws PostMessageError with code missing-token when no token configured', async () => {
    let err: PostMessageError | undefined;
    try {
      await postMessage({ platform: 'slack', message: 'hello', channel: '#general' });
    } catch (e) {
      err = e as PostMessageError;
    }
    expect(err).toBeInstanceOf(PostMessageError);
    expect(err!.code).toBe('missing-token');
  });

  it('error name is PostMessageError', async () => {
    let err: PostMessageError | undefined;
    try {
      await postMessage({ platform: 'slack', message: 'hello', channel: '#general' });
    } catch (e) {
      err = e as PostMessageError;
    }
    expect(err!.name).toBe('PostMessageError');
  });
});

// ─── TC-PMS-05: network-error ─────────────────────────────────────────────────

describe('TC-PMS-05: network-error — propagated from sendSlack as PostMessageError', () => {
  it('throws PostMessageError with code network-error when fetch rejects', async () => {
    stubFetchRejected('connection refused');
    let err: PostMessageError | undefined;
    try {
      await postMessage(
        { platform: 'slack', message: 'hello', channel: '#general' },
        { token: TEST_TOKEN },
      );
    } catch (e) {
      err = e as PostMessageError;
    }
    expect(err).toBeInstanceOf(PostMessageError);
    expect(err!.code).toBe('network-error');
  });
});

// ─── TC-PMS-06: timeout ───────────────────────────────────────────────────────

describe('TC-PMS-06: timeout — propagated from sendSlack as PostMessageError', () => {
  it('throws PostMessageError with code timeout when fetch is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    let err: PostMessageError | undefined;
    try {
      await postMessage(
        { platform: 'slack', message: 'hello', channel: '#general' },
        { token: TEST_TOKEN },
      );
    } catch (e) {
      err = e as PostMessageError;
    }
    expect(err).toBeInstanceOf(PostMessageError);
    expect(err!.code).toBe('timeout');
  });
});

// ─── TC-PMS-07: platform-error ────────────────────────────────────────────────

describe('TC-PMS-07: platform-error — slack-api-error mapped to platform-error', () => {
  it('throws PostMessageError with code platform-error on Slack API error', async () => {
    stubSlackApiError('channel_not_found');
    let err: PostMessageError | undefined;
    try {
      await postMessage(
        { platform: 'slack', message: 'hello', channel: '#nonexistent' },
        { token: TEST_TOKEN },
      );
    } catch (e) {
      err = e as PostMessageError;
    }
    expect(err).toBeInstanceOf(PostMessageError);
    expect(err!.code).toBe('platform-error');
  });

  it('error message includes the Slack error code', async () => {
    stubSlackApiError('not_in_channel');
    let err: PostMessageError | undefined;
    try {
      await postMessage(
        { platform: 'slack', message: 'hello', channel: '#private' },
        { token: TEST_TOKEN },
      );
    } catch (e) {
      err = e as PostMessageError;
    }
    expect(err!.message).toContain('not_in_channel');
  });
});

// ─── TC-PMS-08: Result shape ──────────────────────────────────────────────────

describe('TC-PMS-08: result shape — message_id and posted fields present', () => {
  it('result has a message_id string field', async () => {
    stubSlackSuccess();
    const result = await postMessage(
      { platform: 'slack', message: 'test', channel: '#general' },
      { token: TEST_TOKEN },
    );
    expect(typeof result.message_id).toBe('string');
  });

  it('result has a posted boolean field', async () => {
    stubSlackSuccess();
    const result = await postMessage(
      { platform: 'slack', message: 'test', channel: '#general' },
      { token: TEST_TOKEN },
    );
    expect(typeof result.posted).toBe('boolean');
  });
});

// ─── TC-PMS-09: message_id equals Slack ts ────────────────────────────────────

describe('TC-PMS-09: message_id — equals the Slack ts timestamp', () => {
  it('message_id is the ts value returned by the Slack API', async () => {
    const expectedTs = '1699999999.123456';
    stubSlackSuccess(expectedTs, 'C01234ABCDE');
    const result = await postMessage(
      { platform: 'slack', message: 'hello', channel: '#general' },
      { token: TEST_TOKEN },
    );
    expect(result.message_id).toBe(expectedTs);
  });
});

// ─── TC-PMS-10: channel forwarded ─────────────────────────────────────────────

describe('TC-PMS-10: channel forwarded — channel passed through to Slack API body', () => {
  it('sends channel in the Slack API request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true, ts: '1512085950.000216', channel: 'C01234ABCDE' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await postMessage(
      { platform: 'slack', message: 'hello', channel: '#ops-alerts' },
      { token: TEST_TOKEN },
    );

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, string>;
    expect(body['channel']).toBe('#ops-alerts');
  });
});

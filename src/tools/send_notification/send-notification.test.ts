/**
 * Unit tests for the send_notification tool.
 *
 * The global fetch is stubbed so no real network requests are made.
 *
 * Test IDs:
 *   TC-SNF-01: Successful delivery — slack platform returns delivered:true and status_code
 *   TC-SNF-02: Successful delivery — discord platform returns delivered:true
 *   TC-SNF-03: Successful delivery — teams platform returns delivered:true
 *   TC-SNF-04: Successful delivery — generic platform returns delivered:true
 *   TC-SNF-05: unsupported-platform — throws for unrecognised platform value
 *   TC-SNF-06: invalid-url — propagated from sendWebhook as SendNotificationError
 *   TC-SNF-07: network-error — propagated from sendWebhook as SendNotificationError
 *   TC-SNF-08: timeout — propagated from sendWebhook as SendNotificationError
 *   TC-SNF-09: delivery-error — non-2xx response throws SendNotificationError
 *   TC-SNF-10: slack adapter — payload has 'text' field
 *   TC-SNF-11: discord adapter — payload has 'content' field
 *   TC-SNF-12: teams adapter — payload has 'text' field
 *   TC-SNF-13: generic adapter — payload has 'message' field
 *   TC-SNF-14: Result shape — delivered and status_code fields present with correct types
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendNotification, SendNotificationError } from './send-notification.js';

// ─── Fetch stub helpers ───────────────────────────────────────────────────────

function stubWebhookSuccess(statusCode = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status: statusCode,
    text: async () => 'ok',
    headers: { get: () => null },
  }));
}

function stubWebhookStatus(statusCode: number): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    status: statusCode,
    text: async () => 'error',
    headers: { get: () => null },
  }));
}

function stubFetchRejected(message: string): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

function stubFetchAborted(): void {
  const abortError = new Error('The operation was aborted');
  abortError.name = 'AbortError';
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const TEST_URL = 'https://hooks.example.com/notify';

// ─── TC-SNF-01: Successful delivery — slack ───────────────────────────────────

describe('TC-SNF-01: successful delivery — slack platform returns delivered:true and status_code', () => {
  it('returns delivered:true and status_code 200 for slack', async () => {
    stubWebhookSuccess(200);
    const result = await sendNotification({ platform: 'slack', message: 'Hello!', url: TEST_URL });
    expect(result.delivered).toBe(true);
    expect(result.status_code).toBe(200);
  });
});

// ─── TC-SNF-02: Successful delivery — discord ────────────────────────────────

describe('TC-SNF-02: successful delivery — discord platform returns delivered:true', () => {
  it('returns delivered:true for discord', async () => {
    stubWebhookSuccess(204);
    const result = await sendNotification({ platform: 'discord', message: 'Hello!', url: TEST_URL });
    expect(result.delivered).toBe(true);
    expect(result.status_code).toBe(204);
  });
});

// ─── TC-SNF-03: Successful delivery — teams ──────────────────────────────────

describe('TC-SNF-03: successful delivery — teams platform returns delivered:true', () => {
  it('returns delivered:true for teams', async () => {
    stubWebhookSuccess(200);
    const result = await sendNotification({ platform: 'teams', message: 'Hello!', url: TEST_URL });
    expect(result.delivered).toBe(true);
  });
});

// ─── TC-SNF-04: Successful delivery — generic ────────────────────────────────

describe('TC-SNF-04: successful delivery — generic platform returns delivered:true', () => {
  it('returns delivered:true for generic', async () => {
    stubWebhookSuccess(200);
    const result = await sendNotification({ platform: 'generic', message: 'Hello!', url: TEST_URL });
    expect(result.delivered).toBe(true);
  });
});

// ─── TC-SNF-05: unsupported-platform ─────────────────────────────────────────

describe('TC-SNF-05: unsupported-platform — throws for unrecognised platform value', () => {
  it('throws SendNotificationError with code unsupported-platform', async () => {
    let err: SendNotificationError | undefined;
    try {
      await sendNotification(
        // @ts-expect-error intentional invalid platform for test
        { platform: 'whatsapp', message: 'hello', url: TEST_URL },
      );
    } catch (e) {
      err = e as SendNotificationError;
    }
    expect(err).toBeInstanceOf(SendNotificationError);
    expect(err!.code).toBe('unsupported-platform');
  });

  it('error message includes the invalid platform name', async () => {
    let err: SendNotificationError | undefined;
    try {
      // @ts-expect-error intentional invalid platform for test
      await sendNotification({ platform: 'telegram', message: 'hello', url: TEST_URL });
    } catch (e) {
      err = e as SendNotificationError;
    }
    expect(err!.message).toContain('telegram');
  });

  it('error name is SendNotificationError', async () => {
    let err: SendNotificationError | undefined;
    try {
      // @ts-expect-error intentional invalid platform for test
      await sendNotification({ platform: 'signal', message: 'hello', url: TEST_URL });
    } catch (e) {
      err = e as SendNotificationError;
    }
    expect(err!.name).toBe('SendNotificationError');
  });
});

// ─── TC-SNF-06: invalid-url ───────────────────────────────────────────────────

describe('TC-SNF-06: invalid-url — propagated from sendWebhook as SendNotificationError', () => {
  it('throws SendNotificationError with code invalid-url for non-http URL', async () => {
    let err: SendNotificationError | undefined;
    try {
      await sendNotification({ platform: 'slack', message: 'hello', url: 'ftp://bad.example.com' });
    } catch (e) {
      err = e as SendNotificationError;
    }
    expect(err).toBeInstanceOf(SendNotificationError);
    expect(err!.code).toBe('invalid-url');
  });
});

// ─── TC-SNF-07: network-error ─────────────────────────────────────────────────

describe('TC-SNF-07: network-error — propagated from sendWebhook as SendNotificationError', () => {
  it('throws SendNotificationError with code network-error when fetch rejects', async () => {
    stubFetchRejected('connection refused');
    let err: SendNotificationError | undefined;
    try {
      await sendNotification({ platform: 'slack', message: 'hello', url: TEST_URL });
    } catch (e) {
      err = e as SendNotificationError;
    }
    expect(err).toBeInstanceOf(SendNotificationError);
    expect(err!.code).toBe('network-error');
  });
});

// ─── TC-SNF-08: timeout ───────────────────────────────────────────────────────

describe('TC-SNF-08: timeout — propagated from sendWebhook as SendNotificationError', () => {
  it('throws SendNotificationError with code timeout when fetch is aborted', async () => {
    stubFetchAborted();
    let err: SendNotificationError | undefined;
    try {
      await sendNotification({ platform: 'slack', message: 'hello', url: TEST_URL });
    } catch (e) {
      err = e as SendNotificationError;
    }
    expect(err).toBeInstanceOf(SendNotificationError);
    expect(err!.code).toBe('timeout');
  });
});

// ─── TC-SNF-09: delivery-error ────────────────────────────────────────────────

describe('TC-SNF-09: delivery-error — non-2xx response throws SendNotificationError', () => {
  it('throws SendNotificationError with code delivery-error on HTTP 400', async () => {
    stubWebhookStatus(400);
    let err: SendNotificationError | undefined;
    try {
      await sendNotification({ platform: 'slack', message: 'hello', url: TEST_URL });
    } catch (e) {
      err = e as SendNotificationError;
    }
    expect(err).toBeInstanceOf(SendNotificationError);
    expect(err!.code).toBe('delivery-error');
  });

  it('throws SendNotificationError with code delivery-error on HTTP 500', async () => {
    stubWebhookStatus(500);
    let err: SendNotificationError | undefined;
    try {
      await sendNotification({ platform: 'generic', message: 'hello', url: TEST_URL });
    } catch (e) {
      err = e as SendNotificationError;
    }
    expect(err).toBeInstanceOf(SendNotificationError);
    expect(err!.code).toBe('delivery-error');
  });

  it('error message includes the HTTP status code', async () => {
    stubWebhookStatus(403);
    let err: SendNotificationError | undefined;
    try {
      await sendNotification({ platform: 'slack', message: 'hello', url: TEST_URL });
    } catch (e) {
      err = e as SendNotificationError;
    }
    expect(err!.message).toContain('403');
  });
});

// ─── TC-SNF-10: slack adapter ─────────────────────────────────────────────────

describe('TC-SNF-10: slack adapter — payload has text field', () => {
  it('sends payload with text field for slack platform', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'ok',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendNotification({ platform: 'slack', message: 'Deploy complete', url: TEST_URL });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, unknown>;
    expect(body['text']).toBe('Deploy complete');
  });
});

// ─── TC-SNF-11: discord adapter ───────────────────────────────────────────────

describe('TC-SNF-11: discord adapter — payload has content field', () => {
  it('sends payload with content field for discord platform', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      text: async () => '',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendNotification({ platform: 'discord', message: 'Build failed', url: TEST_URL });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, unknown>;
    expect(body['content']).toBe('Build failed');
  });
});

// ─── TC-SNF-12: teams adapter ─────────────────────────────────────────────────

describe('TC-SNF-12: teams adapter — payload has text field', () => {
  it('sends payload with text field for teams platform', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '1',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendNotification({ platform: 'teams', message: 'Alert triggered', url: TEST_URL });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, unknown>;
    expect(body['text']).toBe('Alert triggered');
  });
});

// ─── TC-SNF-13: generic adapter ───────────────────────────────────────────────

describe('TC-SNF-13: generic adapter — payload has message field', () => {
  it('sends payload with message field for generic platform', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'ok',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendNotification({ platform: 'generic', message: 'System event', url: TEST_URL });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string) as Record<string, unknown>;
    expect(body['message']).toBe('System event');
  });
});

// ─── TC-SNF-14: Result shape ──────────────────────────────────────────────────

describe('TC-SNF-14: result shape — delivered and status_code fields present with correct types', () => {
  it('result has a delivered boolean field', async () => {
    stubWebhookSuccess();
    const result = await sendNotification({ platform: 'slack', message: 'test', url: TEST_URL });
    expect(typeof result.delivered).toBe('boolean');
  });

  it('result has a status_code number field', async () => {
    stubWebhookSuccess(200);
    const result = await sendNotification({ platform: 'slack', message: 'test', url: TEST_URL });
    expect(typeof result.status_code).toBe('number');
  });
});

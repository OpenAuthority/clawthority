/**
 * Unit tests for the send_email tool.
 *
 * SMTP delivery is stubbed via the injectable options.transport; no real network
 * calls are made. SMTP environment variables are never set in these tests;
 * all config is injected via options to keep tests hermetic.
 *
 * Test IDs:
 *   TC-SEM-01: Successful send — returns message_id and sent:true
 *   TC-SEM-02: HTML body — html flag set to true in envelope
 *   TC-SEM-03: Plain text body — html flag set to false in envelope
 *   TC-SEM-04: missing-config (host) — throws when no SMTP host configured
 *   TC-SEM-05: missing-config (from) — throws when no sender address configured
 *   TC-SEM-06: network-error — transport rejection surfaces as network-error
 *   TC-SEM-07: timeout — transport timeout error surfaces as timeout
 *   TC-SEM-08: smtp-error — SMTP server error surfaces as smtp-error
 *   TC-SEM-09: CC recipients — cc addresses forwarded in envelope
 */

import { describe, it, expect, vi } from 'vitest';
import { sendEmail, SendEmailError } from './send-email.js';
import type { SmtpTransport, SmtpEnvelope } from './send-email.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TEST_HOST = 'smtp.test.example.com';
const TEST_FROM = 'agent@test.example.com';
const TEST_TO = 'ops@test.example.com';
const TEST_SUBJECT = 'Test Subject';
const TEST_BODY = 'Hello, world!';
const TEST_MESSAGE_ID = '<1234567890.abc123@smtp.test.example.com>';

function makeTransport(messageId = TEST_MESSAGE_ID): SmtpTransport {
  return { send: vi.fn().mockResolvedValue(messageId) };
}

function baseOptions(overrides: Partial<Parameters<typeof sendEmail>[1]> = {}) {
  return {
    smtpHost: TEST_HOST,
    smtpFrom: TEST_FROM,
    transport: makeTransport(),
    ...overrides,
  };
}

function captureEnvelope(transport: SmtpTransport): SmtpEnvelope {
  return (transport.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as SmtpEnvelope;
}

// ─── TC-SEM-01: Successful send ───────────────────────────────────────────────

describe('TC-SEM-01: successful send — returns message_id and sent:true', () => {
  it('returns message_id from transport', async () => {
    const result = await sendEmail(
      { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
      baseOptions(),
    );
    expect(result.message_id).toBe(TEST_MESSAGE_ID);
  });

  it('returns sent:true on success', async () => {
    const result = await sendEmail(
      { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
      baseOptions(),
    );
    expect(result.sent).toBe(true);
  });
});

// ─── TC-SEM-02: HTML body ─────────────────────────────────────────────────────

describe('TC-SEM-02: HTML body — html flag set to true in envelope', () => {
  it('sets html:true when body contains HTML tags', async () => {
    const transport = makeTransport();
    await sendEmail(
      { to: TEST_TO, subject: TEST_SUBJECT, body: '<p>Hello</p>' },
      { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
    );
    expect(captureEnvelope(transport).html).toBe(true);
  });

  it('sets html:true for a full HTML document', async () => {
    const transport = makeTransport();
    await sendEmail(
      { to: TEST_TO, subject: TEST_SUBJECT, body: '<html><body><h1>Hi</h1></body></html>' },
      { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
    );
    expect(captureEnvelope(transport).html).toBe(true);
  });
});

// ─── TC-SEM-03: Plain text body ───────────────────────────────────────────────

describe('TC-SEM-03: plain text body — html flag set to false in envelope', () => {
  it('sets html:false for plain text body', async () => {
    const transport = makeTransport();
    await sendEmail(
      { to: TEST_TO, subject: TEST_SUBJECT, body: 'Just plain text.' },
      { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
    );
    expect(captureEnvelope(transport).html).toBe(false);
  });

  it('sets html:false when body has no HTML tags', async () => {
    const transport = makeTransport();
    await sendEmail(
      { to: TEST_TO, subject: TEST_SUBJECT, body: 'Hello\nWorld\n1 < 2' },
      { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
    );
    expect(captureEnvelope(transport).html).toBe(false);
  });
});

// ─── TC-SEM-04: missing-config (no host) ──────────────────────────────────────

describe('TC-SEM-04: missing-config (host) — throws when no SMTP host configured', () => {
  it('throws SendEmailError with code missing-config when host is absent', async () => {
    let err: SendEmailError | undefined;
    try {
      await sendEmail(
        { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
        { smtpFrom: TEST_FROM, transport: makeTransport() },
      );
    } catch (e) {
      err = e as SendEmailError;
    }
    expect(err).toBeInstanceOf(SendEmailError);
    expect(err!.code).toBe('missing-config');
  });

  it('error name is SendEmailError', async () => {
    let err: SendEmailError | undefined;
    try {
      await sendEmail(
        { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
        { smtpFrom: TEST_FROM, transport: makeTransport() },
      );
    } catch (e) {
      err = e as SendEmailError;
    }
    expect(err!.name).toBe('SendEmailError');
  });
});

// ─── TC-SEM-05: missing-config (no from) ──────────────────────────────────────

describe('TC-SEM-05: missing-config (from) — throws when no sender address configured', () => {
  it('throws SendEmailError with code missing-config when sender is absent', async () => {
    let err: SendEmailError | undefined;
    try {
      await sendEmail(
        { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
        { smtpHost: TEST_HOST, transport: makeTransport() },
      );
    } catch (e) {
      err = e as SendEmailError;
    }
    expect(err).toBeInstanceOf(SendEmailError);
    expect(err!.code).toBe('missing-config');
  });

  it('uses from param instead of smtpFrom when provided', async () => {
    const result = await sendEmail(
      { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY, from: 'sender@example.com' },
      { smtpHost: TEST_HOST, transport: makeTransport() },
    );
    expect(result.sent).toBe(true);
  });
});

// ─── TC-SEM-06: network-error ─────────────────────────────────────────────────

describe('TC-SEM-06: network-error — transport rejection surfaces as network-error', () => {
  it('throws SendEmailError with code network-error when transport rejects', async () => {
    const transport: SmtpTransport = {
      send: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    let err: SendEmailError | undefined;
    try {
      await sendEmail(
        { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
        { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
      );
    } catch (e) {
      err = e as SendEmailError;
    }
    expect(err).toBeInstanceOf(SendEmailError);
    expect(err!.code).toBe('network-error');
  });

  it('error message includes the original failure cause', async () => {
    const transport: SmtpTransport = {
      send: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    let err: SendEmailError | undefined;
    try {
      await sendEmail(
        { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
        { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
      );
    } catch (e) {
      err = e as SendEmailError;
    }
    expect(err!.message).toContain('ECONNREFUSED');
  });
});

// ─── TC-SEM-07: timeout ───────────────────────────────────────────────────────

describe('TC-SEM-07: timeout — transport timeout error surfaces as timeout', () => {
  it('throws SendEmailError with code timeout when transport indicates timeout', async () => {
    const transport: SmtpTransport = {
      send: vi.fn().mockRejectedValue(new Error('SMTP timeout waiting for 220')),
    };
    let err: SendEmailError | undefined;
    try {
      await sendEmail(
        { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
        { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
      );
    } catch (e) {
      err = e as SendEmailError;
    }
    expect(err).toBeInstanceOf(SendEmailError);
    expect(err!.code).toBe('timeout');
  });

  it('timeout error is distinct from network-error', async () => {
    const transport: SmtpTransport = {
      send: vi.fn().mockRejectedValue(new Error('SMTP timed out')),
    };
    let err: SendEmailError | undefined;
    try {
      await sendEmail(
        { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
        { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
      );
    } catch (e) {
      err = e as SendEmailError;
    }
    expect(err!.code).not.toBe('network-error');
    expect(err!.code).toBe('timeout');
  });
});

// ─── TC-SEM-08: smtp-error ────────────────────────────────────────────────────

describe('TC-SEM-08: smtp-error — SMTP server error surfaces as smtp-error', () => {
  it('throws SendEmailError with code smtp-error for SMTP 5xx errors', async () => {
    const transport: SmtpTransport = {
      send: vi.fn().mockRejectedValue(new Error('SMTP 550: mailbox not found')),
    };
    let err: SendEmailError | undefined;
    try {
      await sendEmail(
        { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
        { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
      );
    } catch (e) {
      err = e as SendEmailError;
    }
    expect(err).toBeInstanceOf(SendEmailError);
    expect(err!.code).toBe('smtp-error');
  });

  it('error message includes the SMTP error detail', async () => {
    const transport: SmtpTransport = {
      send: vi.fn().mockRejectedValue(new Error('SMTP 550: user unknown')),
    };
    let err: SendEmailError | undefined;
    try {
      await sendEmail(
        { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
        { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
      );
    } catch (e) {
      err = e as SendEmailError;
    }
    expect(err!.message).toContain('550');
  });
});

// ─── TC-SEM-09: CC recipients ─────────────────────────────────────────────────

describe('TC-SEM-09: CC recipients — cc addresses forwarded in envelope', () => {
  it('includes cc addresses in envelope when provided', async () => {
    const transport = makeTransport();
    await sendEmail(
      {
        to: TEST_TO,
        subject: TEST_SUBJECT,
        body: TEST_BODY,
        cc: 'manager@test.example.com, audit@test.example.com',
      },
      { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
    );
    const envelope = captureEnvelope(transport);
    expect(envelope.cc).toContain('manager@test.example.com');
    expect(envelope.cc).toContain('audit@test.example.com');
  });

  it('cc is empty array when not provided', async () => {
    const transport = makeTransport();
    await sendEmail(
      { to: TEST_TO, subject: TEST_SUBJECT, body: TEST_BODY },
      { smtpHost: TEST_HOST, smtpFrom: TEST_FROM, transport },
    );
    expect(captureEnvelope(transport).cc).toEqual([]);
  });
});

/**
 * send_email tool implementation.
 *
 * Sends an email via a configured SMTP provider.
 * SMTP connection details are read from environment variables;
 * injectable overrides and a transport abstraction are accepted for testing.
 *
 * Policy enforcement (HITL gating and Cedar stage2 policy) is handled
 * at the pipeline layer; this module performs only the SMTP delivery.
 *
 * Action class: communication.email
 */

import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { hostname as osHostname } from 'node:os';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SMTP_PORT = 587;
const REQUEST_TIMEOUT_MS = 30_000;
const CRLF = '\r\n';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the send_email tool. */
export interface SendEmailParams {
  /** Recipient email address. Use a comma-separated list for multiple recipients. */
  to: string;
  /** Email subject line. */
  subject: string;
  /** Email body content (plain text or HTML). */
  body: string;
  /** Sender email address. Uses SMTP_FROM when omitted. */
  from?: string;
  /** CC recipient email addresses as a comma-separated list. Optional. */
  cc?: string;
}

/** Successful result from the send_email tool. */
export interface SendEmailResult {
  /** Unique message identifier assigned by the mail server. */
  message_id: string;
  /** Whether the email was accepted for delivery. */
  sent: boolean;
}

/** SMTP delivery envelope passed to the transport abstraction. */
export interface SmtpEnvelope {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** Whether the body is HTML (true) or plain text (false). */
  html: boolean;
}

/** Injectable SMTP transport abstraction (for testing). */
export interface SmtpTransport {
  /** Delivers the envelope and returns the server-assigned message-id. */
  send(envelope: SmtpEnvelope): Promise<string>;
}

/** Injectable options for the sendEmail function (used in tests). */
export interface SendEmailOptions {
  /** SMTP hostname override (falls back to SMTP_HOST env var). */
  smtpHost?: string;
  /** SMTP port override (falls back to SMTP_PORT env var, default 587). */
  smtpPort?: number;
  /** SMTP username override (falls back to SMTP_USER env var). */
  smtpUser?: string;
  /** SMTP password override (falls back to SMTP_PASS env var). */
  smtpPass?: string;
  /** Default sender address override (falls back to SMTP_FROM env var). */
  smtpFrom?: string;
  /** Use direct TLS override (falls back to SMTP_SECURE env var or port===465). */
  smtpSecure?: boolean;
  /** Injectable transport for testing. When absent, uses the default SMTP transport. */
  transport?: SmtpTransport;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `sendEmail`.
 *
 * - `missing-config` — SMTP host or sender address not configured.
 * - `network-error`  — network-level failure during SMTP connection.
 * - `timeout`        — SMTP exchange exceeded the 30 s timeout.
 * - `smtp-error`     — SMTP server returned an error response.
 */
export class SendEmailError extends Error {
  constructor(
    message: string,
    public readonly code: 'missing-config' | 'network-error' | 'timeout' | 'smtp-error',
  ) {
    super(message);
    this.name = 'SendEmailError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const HTML_TAG_RE = /<[a-z][a-z0-9]*[\s>/]/i;

function isHtml(body: string): boolean {
  return HTML_TAG_RE.test(body);
}

function splitAddresses(value: string): string[] {
  return value
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

function generateMessageId(host: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 10);
  return `<${ts}.${rand}@${host}>`;
}

function buildMimeMessage(envelope: SmtpEnvelope, messageId: string): string {
  const parts: string[] = [
    `Message-ID: ${messageId}`,
    `From: ${envelope.from}`,
    `To: ${envelope.to.join(', ')}`,
    ...(envelope.cc.length > 0 ? [`Cc: ${envelope.cc.join(', ')}`] : []),
    `Subject: ${envelope.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: ${envelope.html ? 'text/html' : 'text/plain'}; charset=UTF-8`,
    'Content-Transfer-Encoding: 8bit',
    '',
    // RFC 5321 dot-stuffing: lines beginning with '.' get an extra '.'
    envelope.body.replace(/^\./gm, '..'),
    '',
    '.',
  ];
  return parts.join(CRLF);
}

// ─── Default SMTP transport ───────────────────────────────────────────────────

type AnySocket = Socket | TLSSocket;

/**
 * Waits for a complete SMTP response and verifies the status code.
 * An SMTP response is complete when a line has a space at position 3 (not '-').
 */
function waitForSmtpResponse(
  socket: AnySocket,
  expectedCode: number,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`SMTP timeout waiting for ${expectedCode}`));
    }, timeoutMs);

    function onData(chunk: Buffer) {
      buf += chunk.toString();
      const lines = buf.split('\n');
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        if (line.length >= 4 && line[3] === ' ') {
          const code = parseInt(line.substring(0, 3), 10);
          cleanup();
          if (code === expectedCode) {
            resolve(buf);
          } else {
            reject(new Error(`SMTP ${code}: ${buf.trim()}`));
          }
          return;
        }
      }
    }

    function onError(err: Error) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    }

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function connectSocket(host: string, port: number, secure: boolean): Promise<AnySocket> {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tlsConnect({ host, port, servername: host })
      : createConnection({ host, port });

    const eventName = secure ? 'secureConnect' : 'connect';

    function onConnect() {
      socket.off('error', onError);
      resolve(socket as AnySocket);
    }

    function onError(err: Error) {
      socket.off(eventName, onConnect);
      reject(err);
    }

    socket.once(eventName, onConnect);
    socket.once('error', onError);
  });
}

async function defaultSmtpSend(envelope: SmtpEnvelope): Promise<string> {
  const cmdTimeout = REQUEST_TIMEOUT_MS;
  const ehloHost = osHostname();
  const messageId = generateMessageId(envelope.host);

  let socket: AnySocket;
  try {
    socket = await connectSocket(envelope.host, envelope.port, envelope.secure);
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`network error connecting to SMTP server: ${cause}`);
  }

  try {
    // Greeting
    await waitForSmtpResponse(socket, 220, cmdTimeout);

    // EHLO
    socket.write(`EHLO ${ehloHost}${CRLF}`);
    const ehloResp = await waitForSmtpResponse(socket, 250, cmdTimeout);

    // STARTTLS — upgrade to TLS if not already secure and server offers it
    if (!envelope.secure && ehloResp.includes('STARTTLS')) {
      socket.write(`STARTTLS${CRLF}`);
      await waitForSmtpResponse(socket, 220, cmdTimeout);
      const upgraded = tlsConnect({
        socket: socket as Socket,
        host: envelope.host,
        servername: envelope.host,
      });
      await new Promise<void>((resolve, reject) => {
        upgraded.once('secureConnect', resolve);
        upgraded.once('error', reject);
      });
      socket = upgraded;
      // EHLO again after TLS upgrade
      socket.write(`EHLO ${ehloHost}${CRLF}`);
      await waitForSmtpResponse(socket, 250, cmdTimeout);
    }

    // AUTH LOGIN
    if (envelope.user && envelope.pass) {
      socket.write(`AUTH LOGIN${CRLF}`);
      await waitForSmtpResponse(socket, 334, cmdTimeout);
      socket.write(`${btoa(envelope.user)}${CRLF}`);
      await waitForSmtpResponse(socket, 334, cmdTimeout);
      socket.write(`${btoa(envelope.pass)}${CRLF}`);
      await waitForSmtpResponse(socket, 235, cmdTimeout);
    }

    // MAIL FROM
    socket.write(`MAIL FROM:<${envelope.from}>${CRLF}`);
    await waitForSmtpResponse(socket, 250, cmdTimeout);

    // RCPT TO for each address
    for (const addr of [...envelope.to, ...envelope.cc]) {
      socket.write(`RCPT TO:<${addr}>${CRLF}`);
      await waitForSmtpResponse(socket, 250, cmdTimeout);
    }

    // DATA
    socket.write(`DATA${CRLF}`);
    await waitForSmtpResponse(socket, 354, cmdTimeout);

    // Message body + end-of-data marker
    socket.write(buildMimeMessage(envelope, messageId));
    await waitForSmtpResponse(socket, 250, cmdTimeout);

    // QUIT
    socket.write(`QUIT${CRLF}`);
    await waitForSmtpResponse(socket, 221, cmdTimeout).catch(() => {
      // Ignore QUIT errors — message has already been accepted.
    });

    return messageId;
  } finally {
    socket.destroy();
  }
}

const defaultTransport: SmtpTransport = {
  send: defaultSmtpSend,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends an email via a configured SMTP provider.
 *
 * @param params   To, subject, body, and optional from/cc.
 * @param options  Injectable SMTP config overrides and transport.
 * @returns        `{ message_id, sent: true }` on success.
 *
 * @throws {SendEmailError} code `missing-config` — SMTP_HOST or sender not set.
 * @throws {SendEmailError} code `network-error`  — connection or I/O failure.
 * @throws {SendEmailError} code `timeout`        — SMTP exchange timed out.
 * @throws {SendEmailError} code `smtp-error`     — server returned an error.
 */
export async function sendEmail(
  params: SendEmailParams,
  options: SendEmailOptions = {},
): Promise<SendEmailResult> {
  const { to, subject, body, from: fromParam, cc } = params;

  const host = options.smtpHost ?? process.env['SMTP_HOST'];
  if (!host) {
    throw new SendEmailError(
      'send_email: no SMTP host configured — set the SMTP_HOST environment variable.',
      'missing-config',
    );
  }

  const port =
    options.smtpPort ??
    (process.env['SMTP_PORT'] !== undefined
      ? parseInt(process.env['SMTP_PORT']!, 10)
      : DEFAULT_SMTP_PORT);

  const smtpSecure =
    options.smtpSecure ?? (process.env['SMTP_SECURE'] === 'true' || port === 465);

  const from =
    fromParam ?? options.smtpFrom ?? process.env['SMTP_FROM'] ?? '';
  if (!from) {
    throw new SendEmailError(
      'send_email: no sender address configured — set the SMTP_FROM environment variable or provide a from parameter.',
      'missing-config',
    );
  }

  const smtpUser = options.smtpUser ?? process.env['SMTP_USER'];
  const smtpPass = options.smtpPass ?? process.env['SMTP_PASS'];
  const envelope: SmtpEnvelope = {
    host,
    port,
    secure: smtpSecure,
    ...(smtpUser !== undefined ? { user: smtpUser } : {}),
    ...(smtpPass !== undefined ? { pass: smtpPass } : {}),
    from,
    to: splitAddresses(to),
    cc: cc ? splitAddresses(cc) : [],
    subject,
    body,
    html: isHtml(body),
  };

  const transport = options.transport ?? defaultTransport;

  let messageId: string;
  try {
    messageId = await transport.send(envelope);
  } catch (err: unknown) {
    if (err instanceof SendEmailError) {
      throw err;
    }
    if (err instanceof Error) {
      if (err.message.includes('timed out') || err.message.includes('timeout')) {
        throw new SendEmailError(
          `send_email: SMTP exchange timed out: ${err.message}`,
          'timeout',
        );
      }
      if (err.message.startsWith('SMTP ')) {
        throw new SendEmailError(
          `send_email: ${err.message}`,
          'smtp-error',
        );
      }
      throw new SendEmailError(
        `send_email: network error during SMTP delivery: ${err.message}`,
        'network-error',
      );
    }
    throw new SendEmailError(
      `send_email: unexpected error: ${String(err)}`,
      'network-error',
    );
  }

  return {
    message_id: messageId,
    sent: true,
  };
}

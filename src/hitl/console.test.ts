import { describe, it, expect, vi } from 'vitest';
import { sendConsoleApprovalRequest } from './console.js';
import type { SendApprovalOpts, ConsoleIo } from './console.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a mock ConsoleIo that feeds the given answers in sequence.
 * The readline mock calls each answer via queueMicrotask so recursive
 * `ask()` calls unwind through the microtask queue rather than the stack.
 */
function makeIo(answers: string[]): { io: ConsoleIo; text: () => string } {
  const chunks: string[] = [];
  const stdout = {
    write(chunk: string) {
      chunks.push(chunk);
      return true as const;
    },
  };
  let idx = 0;
  const io: ConsoleIo = {
    stdout,
    stdin: {} as NodeJS.ReadableStream,
    createRl: () => ({
      question(_q: string, cb: (answer: string) => void) {
        queueMicrotask(() => cb(answers[idx++] ?? ''));
      },
      close: vi.fn(),
    }),
  };
  return { io, text: () => chunks.join('') };
}

const BASE: SendApprovalOpts = {
  token: 'tok-abc-123',
  toolName: 'bash',
  agentId: 'agent-001',
  policyName: 'My Policy',
  timeoutSeconds: 300,
};

// ─── Decision resolution ─────────────────────────────────────────────────────

describe('sendConsoleApprovalRequest — decision resolution', () => {
  it('resolves approved_once when user enters 1', async () => {
    const { io } = makeIo(['1']);
    const result = await sendConsoleApprovalRequest(BASE, io);
    expect(result.decision).toBe('approved_once');
  });

  it('resolves approved_always when user enters 2 (showApproveAlways default)', async () => {
    const { io } = makeIo(['2']);
    const result = await sendConsoleApprovalRequest(BASE, io);
    expect(result.decision).toBe('approved_always');
  });

  it('resolves approved_always when user enters 2 (showApproveAlways: true)', async () => {
    const { io } = makeIo(['2']);
    const result = await sendConsoleApprovalRequest({ ...BASE, showApproveAlways: true }, io);
    expect(result.decision).toBe('approved_always');
  });

  it('resolves denied when user enters 3', async () => {
    const { io } = makeIo(['3']);
    const result = await sendConsoleApprovalRequest(BASE, io);
    expect(result.decision).toBe('denied');
  });

  it('closes the readline interface after a decision', async () => {
    const closeFn = vi.fn();
    const io: ConsoleIo = {
      stdout: { write: vi.fn().mockReturnValue(true) },
      stdin: {} as NodeJS.ReadableStream,
      createRl: () => ({
        question(_q: string, cb: (a: string) => void) {
          queueMicrotask(() => cb('1'));
        },
        close: closeFn,
      }),
    };
    await sendConsoleApprovalRequest(BASE, io);
    expect(closeFn).toHaveBeenCalledOnce();
  });
});

// ─── Invalid input / re-prompt ───────────────────────────────────────────────

describe('sendConsoleApprovalRequest — invalid input', () => {
  it('re-prompts on invalid input and resolves on subsequent valid choice', async () => {
    const { io, text } = makeIo(['x', '', '0', '1']);
    const result = await sendConsoleApprovalRequest(BASE, io);
    expect(result.decision).toBe('approved_once');
    // Each invalid answer triggers one "Invalid choice" message.
    const invalidCount = (text().match(/Invalid choice/g) ?? []).length;
    expect(invalidCount).toBe(3);
  });

  it('treats "2" as invalid when showApproveAlways is false', async () => {
    const { io, text } = makeIo(['2', '3']);
    const result = await sendConsoleApprovalRequest({ ...BASE, showApproveAlways: false }, io);
    expect(result.decision).toBe('denied');
    expect(text()).toContain('Invalid choice');
  });

  it('accepts leading/trailing whitespace in the answer', async () => {
    const { io } = makeIo(['  3  ']);
    const result = await sendConsoleApprovalRequest(BASE, io);
    expect(result.decision).toBe('denied');
  });
});

// ─── Output content ──────────────────────────────────────────────────────────

describe('sendConsoleApprovalRequest — output content', () => {
  it('renders core required fields', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest(BASE, io);
    const out = text();
    expect(out).toContain('bash');
    expect(out).toContain('agent-001');
    expect(out).toContain('My Policy');
    expect(out).toContain('tok-abc-123');
    expect(out).toContain('300s');
  });

  it('renders optional action class and target', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest(
      { ...BASE, action_class: 'filesystem.delete', target: '/tmp/test.txt' },
      io,
    );
    const out = text();
    expect(out).toContain('filesystem.delete');
    expect(out).toContain('/tmp/test.txt');
  });

  it('renders summary', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest({ ...BASE, summary: 'Delete temp file' }, io);
    expect(text()).toContain('Delete temp file');
  });

  it('renders explanation', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest(
      { ...BASE, explanation: 'This will remove the file permanently' },
      io,
    );
    expect(text()).toContain('This will remove the file permanently');
  });

  it('renders effects as a bullet list', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest(
      { ...BASE, effects: ['Deletes /tmp/a.txt', 'Frees 4 KB'] },
      io,
    );
    const out = text();
    expect(out).toContain('Deletes /tmp/a.txt');
    expect(out).toContain('Frees 4 KB');
    expect(out).toContain('•');
  });

  it('renders warnings as a bullet list', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest(
      { ...BASE, warnings: ['This action is irreversible'] },
      io,
    );
    const out = text();
    expect(out).toContain('This action is irreversible');
    expect(out).toContain('Warnings');
  });

  it('renders risk level', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest({ ...BASE, riskLevel: 'high' }, io);
    expect(text()).toContain('high');
  });

  it('renders expires_at when provided', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest({ ...BASE, expires_at: '2024-01-01T00:05:00Z' }, io);
    expect(text()).toContain('2024-01-01T00:05:00Z');
  });

  it('omits expires_at section when not provided', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest(BASE, io);
    expect(text()).not.toContain('Expires at:');
  });
});

// ─── Truncation ──────────────────────────────────────────────────────────────

describe('sendConsoleApprovalRequest — truncation', () => {
  it('does not truncate explanation at exactly 500 characters', async () => {
    const explanation = 'A'.repeat(500);
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest({ ...BASE, explanation }, io);
    expect(text()).toContain('A'.repeat(500));
    expect(text()).not.toContain('\u2026');
  });

  it('truncates explanation longer than 500 characters with ellipsis', async () => {
    const explanation = 'B'.repeat(600);
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest({ ...BASE, explanation }, io);
    expect(text()).toContain('B'.repeat(499) + '\u2026');
    expect(text()).not.toContain('B'.repeat(500));
  });
});

// ─── Unverified agent banner ─────────────────────────────────────────────────

describe('sendConsoleApprovalRequest — unverified agent', () => {
  it('shows UNVERIFIED AGENT warning when verified is false', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest({ ...BASE, verified: false }, io);
    expect(text()).toContain('UNVERIFIED AGENT');
    expect(text()).toContain('agent-001');
  });

  it('does not show warning when verified is true', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest({ ...BASE, verified: true }, io);
    expect(text()).not.toContain('UNVERIFIED AGENT');
  });

  it('does not show warning when verified is omitted', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest(BASE, io);
    expect(text()).not.toContain('UNVERIFIED AGENT');
  });
});

// ─── showApproveAlways flag ──────────────────────────────────────────────────

describe('sendConsoleApprovalRequest — showApproveAlways', () => {
  it('shows [2] Approve Always option when showApproveAlways is true', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest({ ...BASE, showApproveAlways: true }, io);
    expect(text()).toContain('[2] Approve Always');
  });

  it('shows [2] Approve Always option when showApproveAlways is omitted (default)', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest(BASE, io);
    expect(text()).toContain('[2] Approve Always');
  });

  it('hides [2] Approve Always option when showApproveAlways is false', async () => {
    const { io, text } = makeIo(['1']);
    await sendConsoleApprovalRequest({ ...BASE, showApproveAlways: false }, io);
    expect(text()).not.toContain('[2] Approve Always');
    expect(text()).not.toContain('Approve Always');
  });

  it('invalid message mentions only 1/3 when showApproveAlways is false', async () => {
    const { io, text } = makeIo(['bad', '1']);
    await sendConsoleApprovalRequest({ ...BASE, showApproveAlways: false }, io);
    const invalidMsg = text().split('Invalid choice')[1] ?? '';
    expect(invalidMsg).not.toContain('Approve Always');
    expect(invalidMsg).toContain('Approve Once');
    expect(invalidMsg).toContain('Deny');
  });
});

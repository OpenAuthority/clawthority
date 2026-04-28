/**
 * Console fallback channel for HITL approval requests — T25.
 *
 * Renders a rich, coloured prompt to the terminal when no external
 * notification channel (Telegram / Slack) is configured, enabling local
 * development and testing of the full HITL flow without external services.
 *
 * The operator is prompted to enter a numbered choice:
 *   1 — Approve Once
 *   2 — Approve Always  (omitted when opts.showApproveAlways === false)
 *   3 — Deny
 *
 * Invalid input is re-prompted until a valid choice is entered.
 */
import { createInterface } from 'node:readline';
import type { SendApprovalOpts } from './telegram.js';

export type { SendApprovalOpts } from './telegram.js';

/** Maximum characters for explanation text before truncation — mirrors telegram.ts. */
const MAX_EXPLANATION_LENGTH = 500;

function truncate(s: string, max = MAX_EXPLANATION_LENGTH): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

// ─── ANSI helpers (no external deps) ─────────────────────────────────────────

const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const RULE   = dim('\u2500'.repeat(68));

// ─── Types ───────────────────────────────────────────────────────────────────

/** Decision returned by {@link sendConsoleApprovalRequest}. */
export interface ConsoleSendApprovalResult {
  decision: 'approved_once' | 'approved_always' | 'denied';
}

/** Minimal readline-like interface used internally. */
interface RlLike {
  question(query: string, callback: (answer: string) => void): void;
  close(): void;
}

/**
 * Optional I/O overrides for {@link sendConsoleApprovalRequest}.
 * Production callers should omit this parameter; it is provided for testing.
 */
export interface ConsoleIo {
  /** Writable stream for output. Defaults to process.stdout. */
  stdout?: { write(chunk: string): boolean | void };
  /** Readable stream for input. Defaults to process.stdin. */
  stdin?: NodeJS.ReadableStream;
  /**
   * Factory that produces a readline interface from the given streams.
   * Defaults to node:readline createInterface.
   */
  createRl?: (
    input: NodeJS.ReadableStream,
    output: { write(chunk: string): boolean | void },
  ) => RlLike;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Renders a rich, coloured HITL approval prompt to the console and waits
 * for the operator to enter a numbered choice.
 *
 * Displays the same semantic content as the Telegram and Slack templates:
 * unverified-agent banner, core fields, action class, target, summary,
 * explanation (truncated at 500 chars), effects, warnings, and expiry.
 *
 * Uses process.stdout for output and process.stdin for input unless
 * overridden via `io` (intended for testing only).
 */
export async function sendConsoleApprovalRequest(
  opts: SendApprovalOpts,
  io?: ConsoleIo,
): Promise<ConsoleSendApprovalResult> {
  const out = io?.stdout ?? process.stdout;
  const inp = io?.stdin ?? process.stdin;

  const lines: string[] = [];

  lines.push(RULE, '');

  // Unverified agent warning — prepended when identity cannot be confirmed.
  if (opts.verified === false) {
    lines.push(
      yellow('\u26A0\uFE0F  UNVERIFIED AGENT') +
        ` \u2014 the identity claim ${bold(`"${opts.agentId}"`)} could not be verified. Treat with caution.`,
      '',
    );
  }

  lines.push(bold('\uD83D\uDEA8 HITL Approval Request'), '');

  // Core fields — mirrors Telegram's layout.
  lines.push(
    `${bold('Tool:')}       ${opts.toolName}`,
    `${bold('Agent:')}      ${opts.agentId}`,
    `${bold('Policy:')}     ${opts.policyName}`,
  );
  if (opts.riskLevel) {
    lines.push(`${bold('Risk:')}       ${opts.riskLevel}`);
  }
  lines.push(`${bold('Expires in:')} ${opts.timeoutSeconds}s`);

  if (opts.action_class) {
    lines.push(`\uD83D\uDD10 ${bold('Action Class:')} ${opts.action_class}`);
  }
  if (opts.target) {
    lines.push(`\uD83C\uDFAF ${bold('Target:')}       ${opts.target}`);
  }

  if (opts.summary) {
    lines.push('', `\uD83D\uDCCB ${bold('Summary:')} ${opts.summary}`);
  }

  if (opts.explanation) {
    lines.push('', `\uD83D\uDCCB ${bold('Explanation:')}`, truncate(opts.explanation));
  }

  if (opts.effects && opts.effects.length > 0) {
    lines.push('', bold('Effects:'));
    for (const effect of opts.effects) {
      lines.push(`  \u2022 ${effect}`);
    }
  }

  if (opts.warnings && opts.warnings.length > 0) {
    lines.push('', yellow('\u26A0\uFE0F  Warnings:'));
    for (const warning of opts.warnings) {
      lines.push(`  \u2022 ${yellow(warning)}`);
    }
  }

  lines.push('');
  if (opts.expires_at) {
    lines.push(`\u23F1  ${bold('Expires at:')} ${opts.expires_at}`);
  }
  lines.push(`\uD83D\uDD11 ${bold('Approval ID:')} ${cyan(opts.token)}`);
  lines.push('', RULE);

  // Action menu
  const showApproveAlways = opts.showApproveAlways !== false;
  if (showApproveAlways) {
    lines.push(
      `  ${green('[1] Approve Once')}   ${bold('[2] Approve Always')}   ${red('[3] Deny')}`,
    );
  } else {
    lines.push(`  ${green('[1] Approve Once')}   ${red('[3] Deny')}`);
  }
  lines.push(RULE, '');

  out.write(lines.join('\n') + '\n');

  // ── Prompt ──────────────────────────────────────────────────────────────────
  const rl = (io?.createRl ?? defaultCreateRl)(inp, out);
  const validChoices = showApproveAlways ? '1/2/3' : '1/3';

  return new Promise<ConsoleSendApprovalResult>((resolve) => {
    const ask = (): void => {
      rl.question(`Enter choice (${validChoices}): `, (answer) => {
        const ch = answer.trim();
        if (ch === '1') {
          rl.close();
          resolve({ decision: 'approved_once' });
        } else if (ch === '2' && showApproveAlways) {
          rl.close();
          resolve({ decision: 'approved_always' });
        } else if (ch === '3') {
          rl.close();
          resolve({ decision: 'denied' });
        } else {
          const validList = showApproveAlways
            ? `${green('1')} (Approve Once), ${bold('2')} (Approve Always), or ${red('3')} (Deny)`
            : `${green('1')} (Approve Once) or ${red('3')} (Deny)`;
          out.write(`\nInvalid choice. Enter ${validList}.\n`);
          ask();
        }
      });
    };
    ask();
  });
}

function defaultCreateRl(
  input: NodeJS.ReadableStream,
  output: { write(chunk: string): boolean | void },
): RlLike {
  return createInterface({ input, output: output as unknown as NodeJS.WritableStream });
}

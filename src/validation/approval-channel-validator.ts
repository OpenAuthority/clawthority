/**
 * Approval channel scope validator.
 *
 * Provides `validateApprovalChannelScope` — a pure function that scans source
 * code for patterns indicating a new approval channel implementation (web,
 * webhook, or email). These channels are out of scope for the current project;
 * the existing token-based HITL approval mechanism (`ApprovalManager`,
 * `approval_id`, `HitlDecision`) is the only supported approval path.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Recognised out-of-scope approval channel types. */
export type ApprovalChannel = 'web' | 'webhook' | 'email';

/** A single scope violation detected in source code. */
export interface ApprovalChannelViolation {
  /** The channel type that was detected. */
  channel: ApprovalChannel;
  /** Human-readable description of the violation. */
  message: string;
  /** The matched substring that triggered the violation. */
  match: string;
}

/** Result returned by `validateApprovalChannelScope`. */
export interface ApprovalChannelValidationResult {
  /** `true` when no new approval channel patterns are detected. */
  valid: boolean;
  /** Ordered list of violations. Empty when `valid` is `true`. */
  violations: ApprovalChannelViolation[];
}

// ─── Pattern tables ───────────────────────────────────────────────────────────

interface ChannelPattern {
  pattern: RegExp;
  label: string;
}

/**
 * Patterns that indicate a web-based approval channel implementation.
 *
 * Matches constructs that expose approval decisions through a web UI,
 * click-through URLs, or HTTP routes dedicated to approval handling.
 * Does NOT match the existing `web.post` / `web.fetch` action-class names
 * used in the policy engine.
 */
const WEB_CHANNEL_PATTERNS: ReadonlyArray<ChannelPattern> = [
  { pattern: /\bweb[_-]?approval\b/i, label: 'web approval identifier' },
  {
    // No leading \b: matches camelCase forms like getApprovalUrl and
    // renderApprovalPortal as well as standalone approval_url / approval-link.
    pattern: /approval[_-]?(?:url|link|endpoint|portal|page)\b/i,
    label: 'approval URL/link/endpoint/portal/page',
  },
  { pattern: /\bclick[_-]?to[_-]?approv/i, label: 'click-to-approve pattern' },
  {
    pattern: /(?:app|router)\.[a-z]+\s*\(\s*['"`][^'"`]*\/approv/i,
    label: 'HTTP route for approval',
  },
];

/**
 * Patterns that indicate a webhook-based approval channel implementation.
 *
 * Matches constructs that deliver or receive approval decisions via outbound
 * or inbound webhooks.
 */
const WEBHOOK_CHANNEL_PATTERNS: ReadonlyArray<ChannelPattern> = [
  { pattern: /\bwebhook[_-]?approv/i, label: 'webhook approval identifier' },
  { pattern: /\bapprov\w*[_-]?webhook\b/i, label: 'approval webhook identifier' },
  {
    pattern: /\bsend[_-]?webhook\b[\s\S]{0,40}\bapprov/i,
    label: 'send-webhook-for-approval pattern',
  },
];

/**
 * Patterns that indicate an email-based approval channel implementation.
 *
 * Matches constructs that send approval requests or collect approval decisions
 * via email. Does NOT match the existing `send_email` tool name, which is
 * itself subject to HITL approval through the standard pipeline.
 */
const EMAIL_CHANNEL_PATTERNS: ReadonlyArray<ChannelPattern> = [
  { pattern: /\bemail[_-]?approv/i, label: 'email approval identifier' },
  { pattern: /\bapprov\w*[_-]?email\b/i, label: 'approval email identifier' },
  {
    pattern: /\bsend[_-]?approval[_-]?(?:email|mail|notification)\b/i,
    label: 'send-approval-email pattern',
  },
  { pattern: /\bmail[_-]?approv/i, label: 'mail approval identifier' },
];

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Scans source code for patterns that would implement a new approval channel.
 *
 * Checks `source` against three sets of patterns (web, webhook, email) and
 * collects a violation for each match found. The existing token-based HITL
 * approval mechanism (`ApprovalManager`, `approval_id`, `HitlDecision`) does
 * not trigger violations.
 *
 * @param source  Raw source code string to scan.
 * @returns       A result with `valid` flag and any `violations`.
 */
export function validateApprovalChannelScope(
  source: string,
): ApprovalChannelValidationResult {
  const violations: ApprovalChannelViolation[] = [];

  collectViolations(source, 'web', WEB_CHANNEL_PATTERNS, violations);
  collectViolations(source, 'webhook', WEBHOOK_CHANNEL_PATTERNS, violations);
  collectViolations(source, 'email', EMAIL_CHANNEL_PATTERNS, violations);

  return { valid: violations.length === 0, violations };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function collectViolations(
  source: string,
  channel: ApprovalChannel,
  patterns: ReadonlyArray<ChannelPattern>,
  out: ApprovalChannelViolation[],
): void {
  for (const { pattern, label } of patterns) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = globalPattern.exec(source)) !== null) {
      out.push({
        channel,
        message: `New ${channel} approval channel detected: ${label}.`,
        match: m[0],
      });
    }
  }
}

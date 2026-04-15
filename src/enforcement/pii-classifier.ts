/**
 * PII (Personally Identifiable Information) classifier.
 *
 * Provides a pure function `detectSensitiveData` that scans text for common
 * PII categories. Suitable for use in rule condition functions where payload
 * inspection is required.
 */

/** Categories of sensitive data that can be detected. */
export type PiiCategory = 'ssn' | 'credit_card' | 'private_key' | 'credential';

/** Result of PII detection on a text string. */
export interface PiiDetectionResult {
  /** True when at least one PII category was detected. */
  hasPii: boolean;
  /** List of detected PII categories. */
  categories: PiiCategory[];
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

/** US Social Security Number: XXX-XX-XXXX */
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;

/**
 * Credit card candidates: 16-digit groups of 4 (optionally separated by
 * spaces or dashes), 15-digit AmEx (4-6-5 format), or 13-digit Visa.
 * Matches are then validated with the Luhn algorithm.
 */
const CC_CANDIDATE_RE = /\b(?:\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|\d{4}[ -]?\d{6}[ -]?\d{5}|\d{13})\b/g;

/** PEM-encoded private key header. */
const PRIVATE_KEY_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;

/**
 * Credential key-value pairs:
 * password=secret, api_key: value, access_token=..., etc.
 */
const CREDENTIAL_RE =
  /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*\S+/i;

// ─── Luhn algorithm ───────────────────────────────────────────────────────────

/**
 * Returns true when the digit string passes the Luhn checksum.
 * The input must contain only digit characters.
 */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ─── Detector functions ───────────────────────────────────────────────────────

function detectCreditCard(text: string): boolean {
  const matches = text.match(CC_CANDIDATE_RE);
  if (!matches) return false;
  for (const match of matches) {
    const digits = match.replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      return true;
    }
  }
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scans `text` for common PII patterns and returns a detection result.
 *
 * Detection categories:
 *   - `'ssn'`         — US Social Security Numbers (XXX-XX-XXXX)
 *   - `'credit_card'` — Credit card numbers (Luhn-valid, 13–19 digits)
 *   - `'private_key'` — PEM-encoded private key headers
 *   - `'credential'`  — Credential key-value pairs (password=, api_key:, …)
 *
 * @param text  Plain-text string to scan.
 * @returns     Detection result with `hasPii` flag and `categories` list.
 */
export function detectSensitiveData(text: string): PiiDetectionResult {
  const categories: PiiCategory[] = [];

  if (SSN_RE.test(text)) categories.push('ssn');
  if (detectCreditCard(text)) categories.push('credit_card');
  if (PRIVATE_KEY_RE.test(text)) categories.push('private_key');
  if (CREDENTIAL_RE.test(text)) categories.push('credential');

  return { hasPii: categories.length > 0, categories };
}

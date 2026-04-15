/**
 * PII classifier — test suite
 *
 * Tests grouped by detection category:
 *   - SSN
 *   - credit card
 *   - private key
 *   - password / credentials
 *   - clean text
 *   - multiple categories
 */
import { describe, it, expect } from 'vitest';
import { detectSensitiveData } from './pii-classifier.js';

// ─── SSN ──────────────────────────────────────────────────────────────────────

describe('SSN', () => {
  it('detects a standalone SSN', () => {
    const result = detectSensitiveData('My SSN is 123-45-6789.');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('ssn');
  });

  it('detects an SSN embedded in longer text', () => {
    const result = detectSensitiveData('Customer record: name=Alice, ssn=987-65-4321, dob=1990-01-01');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('ssn');
  });

  it('does not flag a non-SSN digit sequence with dashes', () => {
    // 12-34-56789 does not match the XXX-XX-XXXX pattern
    const result = detectSensitiveData('reference: 12-34-56789');
    expect(result.categories).not.toContain('ssn');
  });

  it('does not flag an SSN-like sequence without word boundaries', () => {
    const result = detectSensitiveData('code1234567890end');
    expect(result.categories).not.toContain('ssn');
  });
});

// ─── Credit card ──────────────────────────────────────────────────────────────

describe('credit card', () => {
  it('detects a Visa test number (no separators)', () => {
    const result = detectSensitiveData('card: 4111111111111111');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credit_card');
  });

  it('detects a Visa number with space separators', () => {
    const result = detectSensitiveData('card: 4111 1111 1111 1111');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credit_card');
  });

  it('detects a Visa number with dash separators', () => {
    const result = detectSensitiveData('card: 4111-1111-1111-1111');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credit_card');
  });

  it('detects a Mastercard test number', () => {
    const result = detectSensitiveData('5500005555555559');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credit_card');
  });

  it('detects an AmEx test number', () => {
    const result = detectSensitiveData('amex: 371449635398431');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credit_card');
  });

  it('detects an AmEx number in 4-6-5 format', () => {
    const result = detectSensitiveData('3714 496353 98431');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credit_card');
  });

  it('detects a Discover test number', () => {
    const result = detectSensitiveData('6011111111111117');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credit_card');
  });

  it('does not flag a 16-digit number that fails Luhn', () => {
    // 1234567890123456 is not Luhn-valid
    const result = detectSensitiveData('1234567890123456');
    expect(result.categories).not.toContain('credit_card');
  });

  it('does not flag a short digit sequence', () => {
    const result = detectSensitiveData('ref: 12345678');
    expect(result.categories).not.toContain('credit_card');
  });
});

// ─── Private key ──────────────────────────────────────────────────────────────

describe('private key', () => {
  it('detects a generic PRIVATE KEY header', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----';
    const result = detectSensitiveData(pem);
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('private_key');
  });

  it('detects an RSA PRIVATE KEY header', () => {
    const result = detectSensitiveData('-----BEGIN RSA PRIVATE KEY-----');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('private_key');
  });

  it('detects an EC PRIVATE KEY header', () => {
    const result = detectSensitiveData('-----BEGIN EC PRIVATE KEY-----');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('private_key');
  });

  it('detects an OPENSSH PRIVATE KEY header', () => {
    const result = detectSensitiveData('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('private_key');
  });

  it('does not flag a PUBLIC KEY header', () => {
    const result = detectSensitiveData('-----BEGIN PUBLIC KEY-----');
    expect(result.categories).not.toContain('private_key');
  });
});

// ─── Password / credentials ───────────────────────────────────────────────────

describe('password / credentials', () => {
  it('detects password= assignment', () => {
    const result = detectSensitiveData('db config: password=s3cr3t123');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credential');
  });

  it('detects password: YAML-style assignment', () => {
    const result = detectSensitiveData('password: hunter2');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credential');
  });

  it('detects api_key= assignment', () => {
    const result = detectSensitiveData('api_key=sk-abc123');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credential');
  });

  it('detects access_token= assignment', () => {
    const result = detectSensitiveData('access_token=ghp_xxxxxxxxxxxx');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credential');
  });

  it('detects auth_token= assignment', () => {
    const result = detectSensitiveData('auth_token=Bearer eyJhbGci');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credential');
  });

  it('detects secret= assignment', () => {
    const result = detectSensitiveData('secret=my-very-secret-value');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credential');
  });

  it('detects case-insensitively (PASSWORD=)', () => {
    const result = detectSensitiveData('PASSWORD=admin123');
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('credential');
  });

  it('does not flag the word password alone without an assignment', () => {
    const result = detectSensitiveData('Please enter your password');
    expect(result.categories).not.toContain('credential');
  });
});

// ─── Clean text ───────────────────────────────────────────────────────────────

describe('clean text', () => {
  it('returns hasPii=false for plain text', () => {
    const result = detectSensitiveData('Hello, world! This is a safe message.');
    expect(result.hasPii).toBe(false);
    expect(result.categories).toHaveLength(0);
  });

  it('returns hasPii=false for an empty string', () => {
    const result = detectSensitiveData('');
    expect(result.hasPii).toBe(false);
    expect(result.categories).toHaveLength(0);
  });

  it('returns hasPii=false for a message with numbers but no PII', () => {
    const result = detectSensitiveData('Order #12345 shipped on 2024-01-15 for $99.00');
    expect(result.hasPii).toBe(false);
  });
});

// ─── Multiple categories ──────────────────────────────────────────────────────

describe('multiple categories', () => {
  it('detects both credit_card and ssn in the same text', () => {
    const text = 'SSN: 123-45-6789, card: 4111111111111111';
    const result = detectSensitiveData(text);
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('ssn');
    expect(result.categories).toContain('credit_card');
  });

  it('detects all four categories in the same text', () => {
    const text = [
      'ssn: 123-45-6789',
      'card: 4111111111111111',
      '-----BEGIN PRIVATE KEY-----',
      'api_key=sk-abc123',
    ].join('\n');
    const result = detectSensitiveData(text);
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('ssn');
    expect(result.categories).toContain('credit_card');
    expect(result.categories).toContain('private_key');
    expect(result.categories).toContain('credential');
    expect(result.categories).toHaveLength(4);
  });

  it('detects private_key and credential together', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\npassword=topsecret';
    const result = detectSensitiveData(text);
    expect(result.hasPii).toBe(true);
    expect(result.categories).toContain('private_key');
    expect(result.categories).toContain('credential');
  });
});

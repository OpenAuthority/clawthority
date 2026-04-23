/**
 * Fuzz test: exec normalization never routes to specific action classes.
 *
 * D-06 — Regression guard confirming that command-string regex retirement
 * (Rules 4–8) did not introduce a path where `normalize_action('exec', ...)`
 * can resolve to domain-specific action classes by inspecting the `command`
 * parameter value.
 *
 * 10 000 random command strings are generated and fed into normalize_action
 * with the generic tool name 'exec'. Every result must be either
 * 'shell.exec' or 'unknown_sensitive_action' — never any domain-specific
 * class from the vcs.*, package.*, build.*, credential.*, communication.*,
 * or filesystem.* namespaces.
 */

import { describe, it, expect } from 'vitest';
import { normalize_action } from './normalize.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Action class prefixes that must never appear for an 'exec' tool call. */
const FORBIDDEN_PREFIXES = [
  'vcs.',
  'package.',
  'build.',
  'credential.',
  'communication.',
  'filesystem.',
] as const;

/** The only action classes that 'exec' is permitted to resolve to. */
const ALLOWED_CLASSES = new Set(['shell.exec', 'unknown_sensitive_action']);

// ---------------------------------------------------------------------------
// Deterministic random string generator (no external deps)
// ---------------------------------------------------------------------------

/** Printable ASCII characters including common shell metacharacters. */
const CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ' +
  '-_./\\|&;><`$(){}[]~!@#%^*+=:,?"\'';

/**
 * Generates a deterministic pseudo-random string using a Knuth LCG.
 * Using Math.imul keeps multiplication within 32-bit integer range so the
 * output is stable across environments.
 */
function randomString(minLen: number, maxLen: number, seed: number): string {
  let s = (seed & 0x7fffffff) || 1; // ensure positive, non-zero
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) & 0x7fffffff;
    return s;
  };
  const span = maxLen - minLen + 1;
  const len = minLen + (next() % span);
  let result = '';
  for (let i = 0; i < len; i++) {
    result += CHARS[next() % CHARS.length];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Realistic command corpus — commands that historically triggered Rules 4–8
// ---------------------------------------------------------------------------

const REALISTIC_COMMANDS = [
  // VCS-like
  'git commit -m "fix: update deps"',
  'git push origin main',
  'git pull --rebase',
  'git status',
  'git add .',
  'git clone https://github.com/org/repo',
  'git checkout -b feature/branch',
  'git merge --no-ff develop',
  'git reset --hard HEAD~1',
  // Package-like
  'npm install',
  'npm run build',
  'npm run test -- --coverage',
  'pip install requests',
  'pip3 install -r requirements.txt',
  'yarn add lodash',
  'brew install node',
  'apt-get install -y curl',
  // Build-like
  'make clean && make all',
  'tsc --noEmit',
  'cargo build --release',
  'go build ./...',
  'mvn compile',
  'gradle build',
  'gcc -o out main.c',
  // Credential-like
  'aws configure',
  'gcloud auth login',
  'vault read secret/db/password',
  'keychain get-password service app',
  // Communication-like
  'sendmail user@example.com < body.txt',
  'curl -X POST https://hooks.slack.com/services/TOKEN',
  'mail -s "subject" recipient@domain.com',
  // Filesystem-like
  'cat /etc/passwd',
  'rm -rf /tmp/cache',
  'find / -name "*.pem"',
  'ls -la /var/log',
  'chmod 600 ~/.ssh/id_rsa',
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function assertAllowed(command: string): { command: string; action_class: string } | null {
  const result = normalize_action('exec', { command });
  const isForbiddenPrefix = FORBIDDEN_PREFIXES.some(p => result.action_class.startsWith(p));
  const isAllowed = ALLOWED_CLASSES.has(result.action_class);
  if (isForbiddenPrefix || !isAllowed) {
    return { command, action_class: result.action_class };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalize.fuzz — exec never maps to domain-specific action classes (D-06)', () => {
  it('returns only shell.exec or unknown_sensitive_action for 10 000 random command strings', () => {
    const violations: Array<{ command: string; action_class: string }> = [];

    for (let i = 0; i < 10_000; i++) {
      const command = randomString(0, 200, i * 31337 + 1);
      const violation = assertAllowed(command);
      if (violation !== null) {
        violations.push(violation);
      }
    }

    if (violations.length > 0) {
      const examples = violations
        .slice(0, 5)
        .map(v => `  ${JSON.stringify(v.command)} → ${v.action_class}`)
        .join('\n');
      throw new Error(
        `normalize_action('exec', { command }) routed to forbidden class in ${violations.length} case(s):\n${examples}`,
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('never returns vcs.*, package.*, build.*, credential.*, communication.*, filesystem.* for any random command', () => {
    const forbidden: Array<{ command: string; action_class: string; matchedPrefix: string }> = [];

    for (let i = 0; i < 10_000; i++) {
      const command = randomString(1, 150, (i + 10_000) * 48271 + 7);
      const result = normalize_action('exec', { command });
      for (const prefix of FORBIDDEN_PREFIXES) {
        if (result.action_class.startsWith(prefix)) {
          forbidden.push({ command, action_class: result.action_class, matchedPrefix: prefix });
          break;
        }
      }
    }

    if (forbidden.length > 0) {
      const examples = forbidden
        .slice(0, 5)
        .map(v => `  [${v.matchedPrefix}] ${JSON.stringify(v.command)} → ${v.action_class}`)
        .join('\n');
      throw new Error(
        `normalize_action('exec', { command }) matched forbidden prefix in ${forbidden.length} case(s):\n${examples}`,
      );
    }

    expect(forbidden).toHaveLength(0);
  });

  it('never routes realistic command strings (former Rules 4–8 triggers) to domain-specific classes', () => {
    const violations: Array<{ command: string; action_class: string }> = [];

    for (const base of REALISTIC_COMMANDS) {
      // Test base and a few common shell continuations to maximise coverage.
      const variants = [
        base,
        `${base} --verbose`,
        `${base} 2>&1 | tee output.log`,
        `${base} && echo done`,
      ];

      for (const command of variants) {
        const violation = assertAllowed(command);
        if (violation !== null) {
          violations.push(violation);
        }
      }
    }

    if (violations.length > 0) {
      const examples = violations
        .slice(0, 5)
        .map(v => `  ${JSON.stringify(v.command)} → ${v.action_class}`)
        .join('\n');
      throw new Error(
        `exec routed to forbidden class for realistic command in ${violations.length} case(s):\n${examples}`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});

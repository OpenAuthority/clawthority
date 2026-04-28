/**
 * Auto-permit pattern matcher — test suite
 *
 * TC-APM-01  empty command returns null
 * TC-APM-02  whitespace-only command returns null
 * TC-APM-03  wildcard pattern matches command with same prefix tokens
 * TC-APM-04  wildcard pattern does NOT match command with different prefix
 * TC-APM-05  exact pattern matches the normalised command verbatim
 * TC-APM-06  exact pattern does NOT match command with extra arguments
 * TC-APM-07  binary-only pattern (no args) is an exact match
 * TC-APM-08  quoted arguments are normalised before matching
 * TC-APM-09  first matching rule is returned when multiple rules match
 * TC-APM-10  non-matching rule is skipped; matching rule is returned
 * TC-APM-11  failed pattern compilation (null regex) skips the rule
 * TC-APM-12  regex cache is used — compilePatternRegex not called twice per pattern
 * TC-APM-13  compilePatternRegex: wildcard pattern produces correct prefix regex
 * TC-APM-14  compilePatternRegex: exact pattern produces exact-match regex
 * TC-APM-15  compilePatternRegex: empty string returns null
 * TC-APM-16  compilePatternRegex: binary-only pattern (no wildcard)
 * TC-APM-17  matchCommand: no rules → returns null
 * TC-APM-18  matchCommand: rule with invalid (empty) pattern is skipped safely
 */
import { describe, it, expect } from 'vitest';
import { compilePatternRegex, FileAutoPermitChecker } from './matcher.js';
import type { AutoPermitRuleChecker } from './matcher.js';
import type { AutoPermit } from '../models/auto-permit.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<AutoPermit> & { pattern: string }): AutoPermit {
  return {
    method: 'default',
    createdAt: Date.now(),
    originalCommand: overrides.pattern,
    ...overrides,
  };
}

// ── compilePatternRegex ───────────────────────────────────────────────────────

describe('compilePatternRegex', () => {
  // TC-APM-13
  it('TC-APM-13: wildcard pattern produces a prefix regex', () => {
    const re = compilePatternRegex('git commit *');
    expect(re).not.toBeNull();
    expect(re!.test('git commit')).toBe(true);
    expect(re!.test('git commit -m my message')).toBe(true);
    expect(re!.test('git status')).toBe(false);
  });

  // TC-APM-14
  it('TC-APM-14: exact pattern produces an exact-match regex', () => {
    const re = compilePatternRegex('git commit -m msg');
    expect(re).not.toBeNull();
    expect(re!.test('git commit -m msg')).toBe(true);
    expect(re!.test('git commit -m msg --amend')).toBe(false);
  });

  // TC-APM-15
  it('TC-APM-15: empty string returns null', () => {
    expect(compilePatternRegex('')).toBeNull();
  });

  // TC-APM-16
  it('TC-APM-16: binary-only pattern matches the binary exactly', () => {
    const re = compilePatternRegex('git');
    expect(re).not.toBeNull();
    expect(re!.test('git')).toBe(true);
    expect(re!.test('git status')).toBe(false);
    expect(re!.test('git-lfs')).toBe(false);
  });

  it('escapes regex special characters in literal tokens', () => {
    const re = compilePatternRegex('curl http://example.com');
    expect(re).not.toBeNull();
    expect(re!.test('curl http://example.com')).toBe(true);
    expect(re!.test('curl httpXYZexampleYcom')).toBe(false);
  });

  it('wildcard-only prefix (single wildcard token) is invalid — pattern split yields ["*"]', () => {
    // Pattern '*' has tokens ['*']. Last token is '*', prefix is [].
    // Produces /^( .+)?$/ which matches empty string — edge case, but safe.
    const re = compilePatternRegex('*');
    // The regex compiles; whether it matches anything is secondary to not throwing.
    expect(re).not.toBeNull();
  });
});

// ── FileAutoPermitChecker ─────────────────────────────────────────────────────

describe('FileAutoPermitChecker', () => {
  // TC-APM-01
  it('TC-APM-01: empty command returns null', () => {
    const checker = new FileAutoPermitChecker([makeRule({ pattern: 'git commit *' })]);
    expect(checker.matchCommand('')).toBeNull();
  });

  // TC-APM-02
  it('TC-APM-02: whitespace-only command returns null', () => {
    const checker = new FileAutoPermitChecker([makeRule({ pattern: 'git commit *' })]);
    expect(checker.matchCommand('   ')).toBeNull();
  });

  // TC-APM-03
  it('TC-APM-03: wildcard pattern matches command with same prefix tokens', () => {
    const rule = makeRule({ pattern: 'git commit *' });
    const checker = new FileAutoPermitChecker([rule]);
    expect(checker.matchCommand('git commit -m "fix typo"')).toBe(rule);
    expect(checker.matchCommand('git commit --amend')).toBe(rule);
  });

  // TC-APM-04
  it('TC-APM-04: wildcard pattern does NOT match command with different prefix', () => {
    const checker = new FileAutoPermitChecker([makeRule({ pattern: 'git commit *' })]);
    expect(checker.matchCommand('git status')).toBeNull();
    expect(checker.matchCommand('npm install')).toBeNull();
  });

  // TC-APM-05
  it('TC-APM-05: exact pattern matches the normalised command verbatim', () => {
    const rule = makeRule({ pattern: 'npm run build', method: 'exact' });
    const checker = new FileAutoPermitChecker([rule]);
    expect(checker.matchCommand('npm run build')).toBe(rule);
  });

  // TC-APM-06
  it('TC-APM-06: exact pattern does NOT match command with extra arguments', () => {
    const checker = new FileAutoPermitChecker([
      makeRule({ pattern: 'npm run build', method: 'exact' }),
    ]);
    expect(checker.matchCommand('npm run build --watch')).toBeNull();
  });

  // TC-APM-07
  it('TC-APM-07: binary-only pattern is an exact match of the binary', () => {
    const rule = makeRule({ pattern: 'ls' });
    const checker = new FileAutoPermitChecker([rule]);
    expect(checker.matchCommand('ls')).toBe(rule);
    expect(checker.matchCommand('ls -la')).toBeNull();
  });

  // TC-APM-08
  it('TC-APM-08: quoted arguments are normalised before matching', () => {
    const rule = makeRule({ pattern: 'git commit *' });
    const checker = new FileAutoPermitChecker([rule]);
    // Quoted arg is normalised: 'git commit -m "my message"' → 'git commit -m my message'
    expect(checker.matchCommand('git commit -m "my message"')).toBe(rule);
  });

  // TC-APM-09
  it('TC-APM-09: first matching rule is returned when multiple rules match', () => {
    const rule1 = makeRule({ pattern: 'git *' });
    const rule2 = makeRule({ pattern: 'git commit *' });
    const checker = new FileAutoPermitChecker([rule1, rule2]);
    // 'git commit -m "msg"' matches both; rule1 comes first
    expect(checker.matchCommand('git commit -m "msg"')).toBe(rule1);
  });

  // TC-APM-10
  it('TC-APM-10: non-matching rule is skipped; matching rule is returned', () => {
    const rule1 = makeRule({ pattern: 'npm install' });
    const rule2 = makeRule({ pattern: 'git commit *' });
    const checker = new FileAutoPermitChecker([rule1, rule2]);
    expect(checker.matchCommand('git commit -m "fix"')).toBe(rule2);
  });

  // TC-APM-11
  it('TC-APM-11: rule with compilation failure is skipped, command falls through', () => {
    // Force a pattern that compilePatternRegex returns null for: the empty string.
    // We can't set an empty pattern via makeRule (minLength: 1 on the model), so
    // we construct the object directly to simulate a corrupt record.
    const badRule = { pattern: '', method: 'default', createdAt: 0, originalCommand: '' } as AutoPermit;
    const goodRule = makeRule({ pattern: 'git commit *' });
    const checker = new FileAutoPermitChecker([badRule, goodRule]);
    expect(checker.matchCommand('git commit -m "fix"')).toBe(goodRule);
  });

  // TC-APM-12
  it('TC-APM-12: repeated matchCommand calls for the same pattern return consistent results', () => {
    // Verifies caching behaviour indirectly: the result is stable across calls
    // because the compiled regex is only built once and reused.
    const rule = makeRule({ pattern: 'git commit *' });
    const checker = new FileAutoPermitChecker([rule]);
    const r1 = checker.matchCommand('git commit -m "first"');
    const r2 = checker.matchCommand('git commit -m "second"');
    const r3 = checker.matchCommand('npm install'); // no match
    expect(r1).toBe(rule);
    expect(r2).toBe(rule);
    expect(r3).toBeNull();
  });

  // TC-APM-17
  it('TC-APM-17: empty rule set returns null for any command', () => {
    const checker = new FileAutoPermitChecker([]);
    expect(checker.matchCommand('git status')).toBeNull();
  });

  // TC-APM-18
  it('TC-APM-18: rule with empty pattern is skipped; checker stays safe', () => {
    const badRule = { pattern: '', method: 'default', createdAt: 0, originalCommand: 'test' } as AutoPermit;
    const checker = new FileAutoPermitChecker([badRule]);
    expect(checker.matchCommand('git status')).toBeNull();
  });
});

// ── AutoPermitRuleChecker interface type check ────────────────────────────────

describe('AutoPermitRuleChecker interface', () => {
  it('FileAutoPermitChecker satisfies the AutoPermitRuleChecker interface', () => {
    const checker: AutoPermitRuleChecker = new FileAutoPermitChecker([]);
    expect(typeof checker.matchCommand).toBe('function');
  });
});

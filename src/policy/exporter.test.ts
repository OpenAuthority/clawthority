import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { exportBuiltinRules, writeBuiltinRulesJson } from './exporter.js';
import type { ExportedRule, BuiltinRulesManifest } from './exporter.js';

// Mock ./rules.js with a controlled set of rules covering all serialization variants
vi.mock('./rules.js', () => ({
  default: [
    // Rule 0: RegExp match, no condition, no optional fields
    { effect: 'permit', resource: 'tool', match: /^read_/ },
    // Rule 1: string match, no condition, with reason and tags
    { effect: 'forbid', resource: 'tool', match: 'exec', reason: 'Direct exec forbidden', tags: ['security', 'exec'] },
    // Rule 2: string match, with condition function
    { effect: 'permit', resource: 'tool', match: '*', condition: () => true },
    // Rule 3: string match, with rateLimit
    { effect: 'permit', resource: 'tool', match: 'api', rateLimit: { maxCalls: 10, windowSeconds: 60 } },
    // Rule 4: string match, with action_class
    { effect: 'permit', resource: 'file', match: 'docs', action_class: 'filesystem.read' },
  ],
}));

describe('exportBuiltinRules', () => {
  it('returns a BuiltinRulesManifest with schemaVersion "1.0.0"', () => {
    const manifest = exportBuiltinRules();
    expect(manifest.schemaVersion).toBe('1.0.0');
  });

  it('ruleCount equals the length of the rules array', () => {
    const manifest = exportBuiltinRules();
    expect(manifest.ruleCount).toBe(manifest.rules.length);
  });

  it('generatedAt is a valid ISO 8601 timestamp', () => {
    const before = new Date().toISOString();
    const manifest = exportBuiltinRules();
    const after = new Date().toISOString();
    expect(manifest.generatedAt >= before).toBe(true);
    expect(manifest.generatedAt <= after).toBe(true);
  });

  it('includes all default and support rules (non-empty rules array)', () => {
    const manifest = exportBuiltinRules();
    expect(manifest.rules.length).toBeGreaterThan(0);
    // mocked set has exactly 5 rules
    expect(manifest.ruleCount).toBe(5);
  });

  it('serializes RegExp match patterns as their source string with matchIsRegExp: true', () => {
    const manifest = exportBuiltinRules();
    const regexpRule = manifest.rules.find(r => r.matchIsRegExp);
    expect(regexpRule).toBeDefined();
    expect(regexpRule!.matchIsRegExp).toBe(true);
    expect(regexpRule!.match).toBe('^read_'); // source of /^read_/
  });

  it('serializes plain string match patterns with matchIsRegExp: false', () => {
    const manifest = exportBuiltinRules();
    const stringRule = manifest.rules.find(r => r.match === 'exec');
    expect(stringRule).toBeDefined();
    expect(stringRule!.matchIsRegExp).toBe(false);
  });

  it('marks rules with condition functions as hasCondition: true', () => {
    const manifest = exportBuiltinRules();
    const conditionRule = manifest.rules.find(r => r.hasCondition);
    expect(conditionRule).toBeDefined();
    expect(conditionRule!.hasCondition).toBe(true);
  });

  it('marks rules without condition functions as hasCondition: false', () => {
    const manifest = exportBuiltinRules();
    // Rule 0 (RegExp, no condition) should have hasCondition: false
    const noConditionRule = manifest.rules.find(r => r.matchIsRegExp);
    expect(noConditionRule).toBeDefined();
    expect(noConditionRule!.hasCondition).toBe(false);
  });

  it('preserves reason field when present on a rule', () => {
    const manifest = exportBuiltinRules();
    const ruleWithReason = manifest.rules.find(r => r.reason !== undefined);
    expect(ruleWithReason).toBeDefined();
    expect(ruleWithReason!.reason).toBe('Direct exec forbidden');
  });

  it('preserves tags field when present on a rule', () => {
    const manifest = exportBuiltinRules();
    const ruleWithTags = manifest.rules.find(r => r.tags !== undefined);
    expect(ruleWithTags).toBeDefined();
    expect(ruleWithTags!.tags).toEqual(['security', 'exec']);
  });

  it('preserves rateLimit field when present on a rule', () => {
    const manifest = exportBuiltinRules();
    const ruleWithRateLimit = manifest.rules.find(r => r.rateLimit !== undefined);
    expect(ruleWithRateLimit).toBeDefined();
    expect(ruleWithRateLimit!.rateLimit).toEqual({ maxCalls: 10, windowSeconds: 60 });
  });

  it('preserves action_class field when present on a rule', () => {
    const manifest = exportBuiltinRules();
    const ruleWithActionClass = manifest.rules.find(r => r.action_class !== undefined);
    expect(ruleWithActionClass).toBeDefined();
    expect(ruleWithActionClass!.action_class).toBe('filesystem.read');
  });

  it('omits optional fields entirely when they are absent from the rule', () => {
    const manifest = exportBuiltinRules();
    // Rule 0 has no reason, tags, rateLimit, or action_class
    const plainRule = manifest.rules.find(r => r.matchIsRegExp && !r.hasCondition);
    expect(plainRule).toBeDefined();
    expect('reason' in plainRule!).toBe(false);
    expect('tags' in plainRule!).toBe(false);
    expect('rateLimit' in plainRule!).toBe(false);
    expect('action_class' in plainRule!).toBe(false);
  });
});

describe('writeBuiltinRulesJson', () => {
  let tempPath: string;

  beforeEach(() => {
    // Unique temp path per test — guaranteed not to pre-exist
    tempPath = join(
      tmpdir(),
      `builtin-rules-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
  });

  afterEach(async () => {
    try { await unlink(tempPath); } catch { /* file may not exist if test failed early */ }
  });

  it('writes pretty-printed JSON to the specified output path', async () => {
    await writeBuiltinRulesJson(tempPath);
    const content = await readFile(tempPath, 'utf-8');
    // JSON.stringify with 2-space indent puts keys on indented lines
    expect(content).toContain('  "schemaVersion"');
    expect(content).toContain('\n');
  });

  it('written JSON parses back to a valid BuiltinRulesManifest', async () => {
    await writeBuiltinRulesJson(tempPath);
    const content = await readFile(tempPath, 'utf-8');
    const manifest = JSON.parse(content) as BuiltinRulesManifest;
    expect(manifest.schemaVersion).toBe('1.0.0');
    expect(typeof manifest.ruleCount).toBe('number');
    expect(Array.isArray(manifest.rules)).toBe(true);
    expect(manifest.rules).toHaveLength(manifest.ruleCount);
    expect(typeof manifest.generatedAt).toBe('string');
    expect(() => new Date(manifest.generatedAt)).not.toThrow();
  });

  it('creates the output file if it does not exist', async () => {
    // tempPath is guaranteed not to exist before this call
    await writeBuiltinRulesJson(tempPath);
    const content = await readFile(tempPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('overwrites an existing file at the output path', async () => {
    await writeFile(tempPath, '{"old":"content"}', 'utf-8');
    await writeBuiltinRulesJson(tempPath);
    const content = await readFile(tempPath, 'utf-8');
    const manifest = JSON.parse(content) as BuiltinRulesManifest;
    expect(manifest.schemaVersion).toBe('1.0.0');
  });
});

void exportBuiltinRules;
void writeBuiltinRulesJson;
void ({} as ExportedRule);
void ({} as BuiltinRulesManifest);

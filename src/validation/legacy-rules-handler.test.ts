/**
 * Legacy rules.json compatibility handler tests.
 *
 * Verifies that `LegacyRulesHandler` correctly detects `resource: 'command'`
 * rules, emits deprecation warnings with migration hints, appends audit
 * entries, and normalises legacy rules to `resource: 'tool'`.
 *
 * Test IDs:
 *   TC-LRH-01: isLegacyRule correctly identifies legacy command rules
 *   TC-LRH-02: Non-legacy rules pass through unchanged
 *   TC-LRH-03: Legacy rules are normalised to resource: 'tool'
 *   TC-LRH-04: Deprecation warnings are emitted for legacy rules
 *   TC-LRH-05: Deprecation warnings include migration hints
 *   TC-LRH-06: Audit entries are appended for each legacy rule
 *   TC-LRH-07: Audit entries contain all required fields
 *   TC-LRH-08: Audit logging persists entries via the logger
 *   TC-LRH-09: Handler operates without a logger (no error)
 *   TC-LRH-10: Mixed legacy and modern rules processed correctly
 *   TC-LRH-11: legacyCount reflects only legacy rules detected
 *   TC-LRH-12: getAuditLog accumulates entries across process() calls
 *   TC-LRH-13: totalLegacyCount reflects cumulative count
 *   TC-LRH-14: buildMigrationHint produces actionable guidance
 */

import { describe, it, expect, vi } from 'vitest';
import {
  LegacyRulesHandler,
  defaultLegacyRulesHandler,
  type AnyRuleRecord,
  type LegacyRuleAuditEntry,
  type LegacyRulesHandlerOptions,
} from './legacy-rules-handler.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const legacyRule: AnyRuleRecord = {
  effect: 'forbid',
  resource: 'command',
  match: 'bash',
  reason: 'Shell exec is not allowed',
};

const legacyPermitRule: AnyRuleRecord = {
  effect: 'permit',
  resource: 'command',
  match: 'git_*',
};

const modernToolRule: AnyRuleRecord = {
  effect: 'forbid',
  resource: 'tool',
  match: 'web_search',
  reason: 'Web search disabled',
};

const modernActionClassRule: AnyRuleRecord = {
  effect: 'forbid',
  action_class: 'filesystem.delete',
  priority: 90,
};

const modernIntentGroupRule: AnyRuleRecord = {
  effect: 'forbid',
  intent_group: 'data_exfiltration',
  priority: 100,
};

function makeWarn() {
  return vi.fn();
}

function makeLogger() {
  const log = vi.fn().mockResolvedValue(undefined);
  return { log };
}

function makeHandler(opts?: LegacyRulesHandlerOptions) {
  return new LegacyRulesHandler({
    warn: makeWarn(),
    clock: () => new Date('2025-01-15T10:00:00.000Z'),
    ...opts,
  });
}

// ─── TC-LRH-01: isLegacyRule correctly identifies legacy command rules ─────────

describe('TC-LRH-01: isLegacyRule correctly identifies legacy command rules', () => {
  it('returns true for resource: command rules', () => {
    expect(LegacyRulesHandler.isLegacyRule({ effect: 'forbid', resource: 'command', match: 'bash' })).toBe(true);
  });

  it('returns true for permit command rules', () => {
    expect(LegacyRulesHandler.isLegacyRule({ effect: 'permit', resource: 'command', match: '*' })).toBe(true);
  });

  it('returns false for resource: tool rules', () => {
    expect(LegacyRulesHandler.isLegacyRule({ effect: 'forbid', resource: 'tool', match: 'bash' })).toBe(false);
  });

  it('returns false for action_class rules', () => {
    expect(LegacyRulesHandler.isLegacyRule({ effect: 'forbid', action_class: 'shell.exec' })).toBe(false);
  });

  it('returns false for intent_group rules', () => {
    expect(LegacyRulesHandler.isLegacyRule({ effect: 'forbid', intent_group: 'data_exfiltration' })).toBe(false);
  });

  it('returns false for rules without resource', () => {
    expect(LegacyRulesHandler.isLegacyRule({ effect: 'permit' })).toBe(false);
  });

  it('returns false for resource: file rules', () => {
    expect(LegacyRulesHandler.isLegacyRule({ effect: 'forbid', resource: 'file', match: '*.env' })).toBe(false);
  });
});

// ─── TC-LRH-02: Non-legacy rules pass through unchanged ───────────────────────

describe('TC-LRH-02: non-legacy rules pass through unchanged', () => {
  it('passes through resource: tool rules unmodified', async () => {
    const handler = makeHandler();
    const { rules } = await handler.process([modernToolRule]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual(modernToolRule);
  });

  it('passes through action_class rules unmodified', async () => {
    const handler = makeHandler();
    const { rules } = await handler.process([modernActionClassRule]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual(modernActionClassRule);
  });

  it('passes through intent_group rules unmodified', async () => {
    const handler = makeHandler();
    const { rules } = await handler.process([modernIntentGroupRule]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual(modernIntentGroupRule);
  });

  it('passes through an empty array', async () => {
    const handler = makeHandler();
    const { rules, legacyCount } = await handler.process([]);
    expect(rules).toHaveLength(0);
    expect(legacyCount).toBe(0);
  });
});

// ─── TC-LRH-03: Legacy rules are normalised to resource: 'tool' ───────────────

describe("TC-LRH-03: legacy rules are normalised to resource: 'tool'", () => {
  it("rewrites resource from 'command' to 'tool'", async () => {
    const handler = makeHandler();
    const { rules } = await handler.process([legacyRule]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.resource).toBe('tool');
  });

  it('preserves all other fields during normalisation', async () => {
    const handler = makeHandler();
    const { rules } = await handler.process([legacyRule]);
    const r = rules[0]!;
    expect(r.effect).toBe('forbid');
    expect(r.match).toBe('bash');
    expect(r.reason).toBe('Shell exec is not allowed');
  });

  it('normalises permit command rules to resource: tool', async () => {
    const handler = makeHandler();
    const { rules } = await handler.process([legacyPermitRule]);
    expect(rules[0]!.resource).toBe('tool');
    expect(rules[0]!.effect).toBe('permit');
    expect(rules[0]!.match).toBe('git_*');
  });

  it('preserves priority field during normalisation', async () => {
    const handler = makeHandler();
    const ruleWithPriority: AnyRuleRecord = {
      effect: 'forbid',
      resource: 'command',
      match: 'bash',
      priority: 90,
    };
    const { rules } = await handler.process([ruleWithPriority]);
    expect(rules[0]!.priority).toBe(90);
    expect(rules[0]!.resource).toBe('tool');
  });

  it('preserves tags field during normalisation', async () => {
    const handler = makeHandler();
    const ruleWithTags: AnyRuleRecord = {
      effect: 'forbid',
      resource: 'command',
      match: 'bash',
      tags: ['security', 'shell'],
    };
    const { rules } = await handler.process([ruleWithTags]);
    expect(rules[0]!.tags).toEqual(['security', 'shell']);
    expect(rules[0]!.resource).toBe('tool');
  });
});

// ─── TC-LRH-04: Deprecation warnings are emitted for legacy rules ─────────────

describe('TC-LRH-04: deprecation warnings are emitted for legacy rules', () => {
  it('emits one warning per legacy rule', async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([legacyRule]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('emits warnings for each legacy rule when multiple are present', async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([legacyRule, legacyPermitRule]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not emit warnings for non-legacy rules', async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([modernToolRule, modernActionClassRule]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warning message contains [clawthority] prefix', async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([legacyRule]);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain('[clawthority]');
  });

  it('warning message contains DEPRECATION keyword', async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([legacyRule]);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain('DEPRECATION');
  });

  it("warning message mentions resource: 'command'", async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([legacyRule]);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain("resource: 'command'");
  });

  it('warning message mentions the match pattern', async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([legacyRule]);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain('bash');
  });

  it('warning message mentions removal in next major version', async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([legacyRule]);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain('next major version');
  });
});

// ─── TC-LRH-05: Deprecation warnings include migration hints ──────────────────

describe('TC-LRH-05: deprecation warnings include migration hints', () => {
  it("warning suggests resource: 'tool' as migration target", async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([legacyRule]);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain("resource: 'tool'");
  });

  it('warning suggests action_class as an alternative', async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([legacyRule]);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain('action_class');
  });

  it('buildMigrationHint includes the match pattern in suggestion', () => {
    const hint = LegacyRulesHandler.buildMigrationHint({
      effect: 'forbid',
      resource: 'command',
      match: 'my_tool',
    });
    expect(hint).toContain('"my_tool"');
  });

  it('buildMigrationHint mentions resource: tool', () => {
    const hint = LegacyRulesHandler.buildMigrationHint({
      effect: 'forbid',
      resource: 'command',
      match: 'my_tool',
    });
    expect(hint).toContain("resource: 'tool'");
  });

  it('buildMigrationHint mentions action_class examples', () => {
    const hint = LegacyRulesHandler.buildMigrationHint({
      effect: 'forbid',
      resource: 'command',
      match: 'my_tool',
    });
    expect(hint).toContain('action_class');
  });

  it('buildMigrationHint references configuration docs', () => {
    const hint = LegacyRulesHandler.buildMigrationHint({
      effect: 'forbid',
      resource: 'command',
      match: 'bash',
    });
    expect(hint).toContain('docs/configuration.md');
  });
});

// ─── TC-LRH-06: Audit entries are appended for each legacy rule ───────────────

describe('TC-LRH-06: audit entries are appended for each legacy rule', () => {
  it('appends one audit entry per legacy rule', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyRule]);
    expect(auditEntries).toHaveLength(1);
  });

  it('appends one audit entry per legacy rule when multiple present', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyRule, legacyPermitRule]);
    expect(auditEntries).toHaveLength(2);
  });

  it('returns empty auditEntries for non-legacy rules', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([modernToolRule]);
    expect(auditEntries).toHaveLength(0);
  });

  it('getAuditLog is updated after process()', async () => {
    const handler = makeHandler();
    expect(handler.getAuditLog()).toHaveLength(0);
    await handler.process([legacyRule]);
    expect(handler.getAuditLog()).toHaveLength(1);
  });

  it('returns a snapshot array (mutations do not affect internal state)', async () => {
    const handler = makeHandler();
    await handler.process([legacyRule]);
    const log = handler.getAuditLog() as LegacyRuleAuditEntry[];
    log.push({} as LegacyRuleAuditEntry);
    expect(handler.getAuditLog()).toHaveLength(1);
  });
});

// ─── TC-LRH-07: Audit entries contain all required fields ─────────────────────

describe('TC-LRH-07: audit entries contain all required fields', () => {
  it('entry has type: legacy-rule', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyRule]);
    expect(auditEntries[0]!.type).toBe('legacy-rule');
  });

  it('entry has stage: legacy-rule', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyRule]);
    expect(auditEntries[0]!.stage).toBe('legacy-rule');
  });

  it("entry has originalResource: 'command'", async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyRule]);
    expect(auditEntries[0]!.originalResource).toBe('command');
  });

  it('entry has correct match', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyRule]);
    expect(auditEntries[0]!.match).toBe('bash');
  });

  it('entry has correct effect', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyRule]);
    expect(auditEntries[0]!.effect).toBe('forbid');
  });

  it('entry has ISO 8601 timestamp', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyRule]);
    expect(auditEntries[0]!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('entry has migrationHint field', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyRule]);
    expect(auditEntries[0]!.migrationHint).toBeTruthy();
  });

  it('entry includes reason when present in original rule', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyRule]);
    expect(auditEntries[0]!.reason).toBe('Shell exec is not allowed');
  });

  it('entry omits reason when absent from original rule', async () => {
    const handler = makeHandler();
    const { auditEntries } = await handler.process([legacyPermitRule]);
    expect(Object.prototype.hasOwnProperty.call(auditEntries[0], 'reason')).toBe(false);
  });

  it('clock is used for the timestamp', async () => {
    const fixedDate = new Date('2025-06-01T12:00:00.000Z');
    const handler = new LegacyRulesHandler({
      warn: makeWarn(),
      clock: () => fixedDate,
    });
    const { auditEntries } = await handler.process([legacyRule]);
    expect(auditEntries[0]!.ts).toBe('2025-06-01T12:00:00.000Z');
  });
});

// ─── TC-LRH-08: Audit logging persists entries via the logger ─────────────────

describe('TC-LRH-08: audit logging persists entries via the logger', () => {
  it('calls logger.log once per legacy rule', async () => {
    const logger = makeLogger();
    const handler = new LegacyRulesHandler({ warn: makeWarn(), logger });
    await handler.process([legacyRule]);
    expect(logger.log).toHaveBeenCalledOnce();
  });

  it('calls logger.log for each of multiple legacy rules', async () => {
    const logger = makeLogger();
    const handler = new LegacyRulesHandler({ warn: makeWarn(), logger });
    await handler.process([legacyRule, legacyPermitRule]);
    expect(logger.log).toHaveBeenCalledTimes(2);
  });

  it('does not call logger.log for non-legacy rules', async () => {
    const logger = makeLogger();
    const handler = new LegacyRulesHandler({ warn: makeWarn(), logger });
    await handler.process([modernToolRule]);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('logged entry matches the returned audit entry', async () => {
    const logger = makeLogger();
    const handler = new LegacyRulesHandler({ warn: makeWarn(), logger });
    const { auditEntries } = await handler.process([legacyRule]);
    const loggedEntry = logger.log.mock.calls[0]![0] as LegacyRuleAuditEntry;
    expect(loggedEntry).toEqual(auditEntries[0]);
  });

  it('logged entry has all required fields', async () => {
    const logger = makeLogger();
    const handler = new LegacyRulesHandler({ warn: makeWarn(), logger });
    await handler.process([legacyRule]);
    const entry = logger.log.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry['type']).toBe('legacy-rule');
    expect(entry['stage']).toBe('legacy-rule');
    expect(entry['originalResource']).toBe('command');
    expect(entry['match']).toBe('bash');
    expect(entry['effect']).toBe('forbid');
    expect(entry['migrationHint']).toBeTruthy();
    expect(entry['ts']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── TC-LRH-09: Handler operates without a logger (no error) ──────────────────

describe('TC-LRH-09: handler operates without a logger', () => {
  it('does not throw when no logger is supplied', async () => {
    const handler = new LegacyRulesHandler({ warn: makeWarn() });
    await expect(handler.process([legacyRule])).resolves.toBeDefined();
  });

  it('still normalises rules without a logger', async () => {
    const handler = new LegacyRulesHandler({ warn: makeWarn() });
    const { rules } = await handler.process([legacyRule]);
    expect(rules[0]!.resource).toBe('tool');
  });

  it('still emits warnings without a logger', async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([legacyRule]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('no-argument constructor does not throw', () => {
    expect(() => new LegacyRulesHandler()).not.toThrow();
  });
});

// ─── TC-LRH-10: Mixed legacy and modern rules processed correctly ──────────────

describe('TC-LRH-10: mixed legacy and modern rules processed correctly', () => {
  it('normalises only legacy rules in a mixed batch', async () => {
    const handler = makeHandler();
    const records = [modernToolRule, legacyRule, modernActionClassRule, legacyPermitRule];
    const { rules } = await handler.process(records);
    expect(rules).toHaveLength(4);
    expect(rules[0]!.resource).toBe('tool');       // modern, unchanged
    expect(rules[1]!.resource).toBe('tool');       // legacy → normalised
    expect(rules[2]!.action_class).toBe('filesystem.delete'); // modern, unchanged
    expect(rules[3]!.resource).toBe('tool');       // legacy → normalised
    expect(rules[3]!.effect).toBe('permit');
  });

  it('emits warnings only for legacy rules in a mixed batch', async () => {
    const warn = makeWarn();
    const handler = new LegacyRulesHandler({ warn });
    await handler.process([modernToolRule, legacyRule, modernActionClassRule]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('legacyCount reflects only legacy rules in a mixed batch', async () => {
    const handler = makeHandler();
    const { legacyCount } = await handler.process([
      modernToolRule, legacyRule, modernActionClassRule, legacyPermitRule,
    ]);
    expect(legacyCount).toBe(2);
  });
});

// ─── TC-LRH-11: legacyCount reflects only legacy rules detected ───────────────

describe('TC-LRH-11: legacyCount reflects only legacy rules detected', () => {
  it('is 0 when no legacy rules present', async () => {
    const handler = makeHandler();
    const { legacyCount } = await handler.process([modernToolRule]);
    expect(legacyCount).toBe(0);
  });

  it('is 1 for a single legacy rule', async () => {
    const handler = makeHandler();
    const { legacyCount } = await handler.process([legacyRule]);
    expect(legacyCount).toBe(1);
  });

  it('is 2 for two legacy rules', async () => {
    const handler = makeHandler();
    const { legacyCount } = await handler.process([legacyRule, legacyPermitRule]);
    expect(legacyCount).toBe(2);
  });

  it('reflects only this call, not cumulative', async () => {
    const handler = makeHandler();
    await handler.process([legacyRule]);
    const { legacyCount } = await handler.process([modernToolRule]);
    expect(legacyCount).toBe(0);
  });
});

// ─── TC-LRH-12: getAuditLog accumulates entries across process() calls ─────────

describe('TC-LRH-12: getAuditLog accumulates entries across process() calls', () => {
  it('accumulates entries from multiple process() calls', async () => {
    const handler = makeHandler();
    await handler.process([legacyRule]);
    await handler.process([legacyPermitRule]);
    expect(handler.getAuditLog()).toHaveLength(2);
  });

  it('does not accumulate entries for non-legacy rules', async () => {
    const handler = makeHandler();
    await handler.process([modernToolRule]);
    await handler.process([modernActionClassRule]);
    expect(handler.getAuditLog()).toHaveLength(0);
  });

  it('accumulates across mixed batches', async () => {
    const handler = makeHandler();
    await handler.process([modernToolRule, legacyRule]);
    await handler.process([legacyPermitRule, modernActionClassRule]);
    expect(handler.getAuditLog()).toHaveLength(2);
  });
});

// ─── TC-LRH-13: totalLegacyCount reflects cumulative count ────────────────────

describe('TC-LRH-13: totalLegacyCount reflects cumulative count', () => {
  it('starts at 0', () => {
    const handler = makeHandler();
    expect(handler.totalLegacyCount).toBe(0);
  });

  it('increments after processing legacy rules', async () => {
    const handler = makeHandler();
    await handler.process([legacyRule]);
    expect(handler.totalLegacyCount).toBe(1);
  });

  it('accumulates across multiple process() calls', async () => {
    const handler = makeHandler();
    await handler.process([legacyRule]);
    await handler.process([legacyPermitRule]);
    expect(handler.totalLegacyCount).toBe(2);
  });

  it('does not increment for non-legacy rules', async () => {
    const handler = makeHandler();
    await handler.process([modernToolRule, modernActionClassRule]);
    expect(handler.totalLegacyCount).toBe(0);
  });
});

// ─── TC-LRH-14: buildMigrationHint produces actionable guidance ───────────────

describe('TC-LRH-14: buildMigrationHint produces actionable guidance', () => {
  it('is a non-empty string', () => {
    const hint = LegacyRulesHandler.buildMigrationHint({
      effect: 'forbid',
      resource: 'command',
      match: 'bash',
    });
    expect(hint.length).toBeGreaterThan(0);
  });

  it('includes the exact match value in the suggested replacement', () => {
    const hint = LegacyRulesHandler.buildMigrationHint({
      effect: 'permit',
      resource: 'command',
      match: 'custom_tool_name',
    });
    expect(hint).toContain('"custom_tool_name"');
  });

  it('mentions shell.exec action class as an example', () => {
    const hint = LegacyRulesHandler.buildMigrationHint({
      effect: 'forbid',
      resource: 'command',
      match: 'bash',
    });
    expect(hint).toContain('shell.exec');
  });

  it('mentions filesystem.read action class as an example', () => {
    const hint = LegacyRulesHandler.buildMigrationHint({
      effect: 'forbid',
      resource: 'command',
      match: 'read_file',
    });
    expect(hint).toContain('filesystem.read');
  });
});

// ─── Default instance sanity check ───────────────────────────────────────────

describe('defaultLegacyRulesHandler', () => {
  it('is exported and is a LegacyRulesHandler instance', () => {
    expect(defaultLegacyRulesHandler).toBeInstanceOf(LegacyRulesHandler);
  });
});

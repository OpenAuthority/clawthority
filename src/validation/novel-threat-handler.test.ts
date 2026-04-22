/**
 * Novel threat vector handler tests.
 *
 * Verifies that `NovelThreatHandler` correctly routes novel threat vectors to
 * fine-grained tool creation (RFC filing) or Cedar rule registration, tracks
 * threat vector patterns by category, and maintains an immutable audit trail.
 * Command-string regex patterns are never used in any resolution path.
 *
 * Test IDs:
 *   TC-NTH-01: Cedar rule path registers rule with effect: forbid
 *   TC-NTH-02: Cedar rule result has correct shape (resolutionPath, threatId, rule, auditEntry)
 *   TC-NTH-03: Fine-grained tool path files an RFC via the G-01 processor
 *   TC-NTH-04: Fine-grained tool result has correct shape (resolutionPath, threatId, rfc, auditEntry)
 *   TC-NTH-05: First submission creates a new ThreatVectorPattern
 *   TC-NTH-06: Second submission for the same category increments occurrences
 *   TC-NTH-07: Different categories produce separate patterns
 *   TC-NTH-08: Audit log records threat_received and resolution events
 *   TC-NTH-09: listCedarRules returns all registered rules in order
 *   TC-NTH-10: listPatterns returns all tracked patterns
 *   TC-NTH-11: RFC includes capabilityRequest and evidence in description
 *   TC-NTH-12: getAuditLog returns entries in chronological order
 *   TC-NTH-13: default instance is exported
 *   TC-NTH-14: Multiple handlers are isolated (no shared state)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  NovelThreatHandler,
  defaultNovelThreatHandler,
  type ToolCreationSubmission,
  type CedarRuleSubmission,
  type ThreatHandlingResult,
  type ThreatVectorPattern,
} from './novel-threat-handler.js';
import { RFCProcessor } from './rfc-processor.js';
import type { CedarFieldRule } from './agent-obfuscation-detector.js';

// ─── Fixture helpers ───────────────────────────────────────────────────────────

/** Minimal valid cedar-rule submission. */
function cedarSubmission(overrides: Partial<CedarRuleSubmission> = {}): CedarRuleSubmission {
  return {
    resolutionPath: 'cedar-rule',
    description: 'Oversized base64 blob in args field',
    category: 'encoding-obfuscation',
    evidence: { fieldName: 'args', estimatedSize: 'large' },
    reportedBy: 'security-scanner',
    cedarRule: {
      id: 'NTV-001',
      description: 'Oversized base64-only strings in args are forbidden.',
      field: 'args',
      when: (v) => typeof v === 'string' && v.length > 512,
      kind: 'encoding_pattern',
      risk: 'high',
    },
    ...overrides,
  };
}

/** Minimal valid fine-grained-tool submission. */
function toolSubmission(
  overrides: Partial<ToolCreationSubmission> = {},
): ToolCreationSubmission {
  return {
    resolutionPath: 'fine-grained-tool',
    description: 'Novel DNS exfiltration via unconstrained lookup',
    category: 'dns-exfiltration',
    evidence: { observedField: 'hostname', payloadSize: 253 },
    reportedBy: 'agent-47',
    capabilityRequest: {
      proposedActionClass: 'network.dns.controlled_lookup',
      proposedAliases: ['dns_lookup_safe'],
      riskLevel: 'high',
    },
    ...overrides,
  };
}

/** Returns a fixed-clock RFCProcessor + handler pair for deterministic tests. */
function fixedClockHandler(isoTs = '2026-01-15T12:00:00.000Z') {
  const clock = () => new Date(isoTs);
  const rfcProcessor = new RFCProcessor({ clock });
  const handler = new NovelThreatHandler({ rfcProcessor, clock });
  return { handler, rfcProcessor, clock };
}

// ─── TC-NTH-01: Cedar rule path registers rule with effect: forbid ─────────────

describe('TC-NTH-01: cedar rule path registers rule with effect: forbid', () => {
  it('sets effect: forbid on the registered rule regardless of submission', async () => {
    const handler = new NovelThreatHandler();
    const result = await handler.handle(cedarSubmission());

    expect(result.resolutionPath).toBe('cedar-rule');
    if (result.resolutionPath !== 'cedar-rule') return;

    expect(result.rule.effect).toBe('forbid');
  });

  it('preserves all other rule fields from the submission', async () => {
    const handler = new NovelThreatHandler();
    const sub = cedarSubmission();
    const result = await handler.handle(sub);

    if (result.resolutionPath !== 'cedar-rule') return;

    expect(result.rule.id).toBe(sub.cedarRule.id);
    expect(result.rule.description).toBe(sub.cedarRule.description);
    expect(result.rule.field).toBe(sub.cedarRule.field);
    expect(result.rule.kind).toBe(sub.cedarRule.kind);
    expect(result.rule.risk).toBe(sub.cedarRule.risk);
    expect(result.rule.when).toBe(sub.cedarRule.when);
  });

  it('the registered when predicate evaluates correctly', async () => {
    const handler = new NovelThreatHandler();
    const result = await handler.handle(cedarSubmission());

    if (result.resolutionPath !== 'cedar-rule') return;

    // The fixture rule blocks strings longer than 512 chars
    expect(result.rule.when('a'.repeat(513))).toBe(true);
    expect(result.rule.when('a'.repeat(512))).toBe(false);
    expect(result.rule.when(42)).toBe(false);
  });
});

// ─── TC-NTH-02: Cedar rule result shape ────────────────────────────────────────

describe('TC-NTH-02: cedar rule result has correct shape', () => {
  it('result has resolutionPath, threatId, rule, auditEntry', async () => {
    const { handler } = fixedClockHandler();
    const result = await handler.handle(cedarSubmission());

    expect(result).toMatchObject({
      resolutionPath: 'cedar-rule',
      threatId: expect.any(String),
      rule: expect.objectContaining({ id: 'NTV-001', effect: 'forbid' }),
      auditEntry: expect.objectContaining({
        event: 'cedar_rule_registered',
        threatId: expect.any(String),
      }),
    });
  });

  it('threatId is a valid UUID', async () => {
    const { handler } = fixedClockHandler();
    const result = await handler.handle(cedarSubmission());

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(result.threatId).toMatch(uuidPattern);
  });

  it('auditEntry.threatId matches result.threatId', async () => {
    const { handler } = fixedClockHandler();
    const result = await handler.handle(cedarSubmission());

    if (result.resolutionPath !== 'cedar-rule') return;
    expect(result.auditEntry.threatId).toBe(result.threatId);
  });

  it('auditEntry.actor matches submission.reportedBy', async () => {
    const { handler } = fixedClockHandler();
    const sub = cedarSubmission({ reportedBy: 'my-scanner' });
    const result = await handler.handle(sub);

    if (result.resolutionPath !== 'cedar-rule') return;
    expect(result.auditEntry.actor).toBe('my-scanner');
  });
});

// ─── TC-NTH-03: Fine-grained tool path files an RFC ───────────────────────────

describe('TC-NTH-03: fine-grained tool path files an RFC via the G-01 processor', () => {
  it('files an RFC with status: open', async () => {
    const { handler } = fixedClockHandler();
    const result = await handler.handle(toolSubmission());

    expect(result.resolutionPath).toBe('fine-grained-tool');
    if (result.resolutionPath !== 'fine-grained-tool') return;

    expect(result.rfc.status).toBe('open');
  });

  it('RFC requestor matches submission.reportedBy', async () => {
    const { handler } = fixedClockHandler();
    const result = await handler.handle(toolSubmission({ reportedBy: 'agent-99' }));

    if (result.resolutionPath !== 'fine-grained-tool') return;
    expect(result.rfc.requestor).toBe('agent-99');
  });

  it('RFC capabilityRequest matches submission', async () => {
    const { handler } = fixedClockHandler();
    const sub = toolSubmission();
    const result = await handler.handle(sub);

    if (result.resolutionPath !== 'fine-grained-tool') return;
    expect(result.rfc.capabilityRequest).toEqual(sub.capabilityRequest);
  });

  it('RFC is retrievable from the rfcProcessor by ID', async () => {
    const { handler, rfcProcessor } = fixedClockHandler();
    const result = await handler.handle(toolSubmission());

    if (result.resolutionPath !== 'fine-grained-tool') return;
    const retrieved = rfcProcessor.getById(result.rfc.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(result.rfc.id);
  });
});

// ─── TC-NTH-04: Fine-grained tool result shape ─────────────────────────────────

describe('TC-NTH-04: fine-grained tool result has correct shape', () => {
  it('result has resolutionPath, threatId, rfc, auditEntry', async () => {
    const { handler } = fixedClockHandler();
    const result = await handler.handle(toolSubmission());

    expect(result).toMatchObject({
      resolutionPath: 'fine-grained-tool',
      threatId: expect.any(String),
      rfc: expect.objectContaining({ id: expect.any(String), status: 'open' }),
      auditEntry: expect.objectContaining({
        event: 'tool_creation_initiated',
        threatId: expect.any(String),
      }),
    });
  });

  it('auditEntry.event is tool_creation_initiated', async () => {
    const { handler } = fixedClockHandler();
    const result = await handler.handle(toolSubmission());

    if (result.resolutionPath !== 'fine-grained-tool') return;
    expect(result.auditEntry.event).toBe('tool_creation_initiated');
  });

  it('auditEntry.detail mentions the RFC ID and action class', async () => {
    const { handler } = fixedClockHandler();
    const sub = toolSubmission();
    const result = await handler.handle(sub);

    if (result.resolutionPath !== 'fine-grained-tool') return;
    expect(result.auditEntry.detail).toContain(result.rfc.id);
    expect(result.auditEntry.detail).toContain(
      sub.capabilityRequest.proposedActionClass,
    );
  });
});

// ─── TC-NTH-05: First submission creates a new ThreatVectorPattern ─────────────

describe('TC-NTH-05: first submission creates a new ThreatVectorPattern', () => {
  it('creates one pattern after a single cedar-rule submission', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission());

    const patterns = handler.listPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.category).toBe('encoding-obfuscation');
    expect(patterns[0]!.occurrences).toBe(1);
  });

  it('pattern description matches submission description', async () => {
    const { handler } = fixedClockHandler();
    const sub = cedarSubmission({ description: 'My custom threat' });
    await handler.handle(sub);

    const pattern = handler.listPatterns()[0]!;
    expect(pattern.description).toBe('My custom threat');
  });

  it('pattern.firstSeenAt matches the clock timestamp', async () => {
    const ts = '2026-06-01T08:00:00.000Z';
    const { handler } = fixedClockHandler(ts);
    await handler.handle(cedarSubmission());

    const pattern = handler.listPatterns()[0]!;
    expect(pattern.firstSeenAt).toBe(ts);
    expect(pattern.lastSeenAt).toBe(ts);
  });

  it('pattern.threatIds contains the threat UUID', async () => {
    const { handler } = fixedClockHandler();
    const result = await handler.handle(cedarSubmission());

    const pattern = handler.listPatterns()[0]!;
    expect(pattern.threatIds).toContain(result.threatId);
  });
});

// ─── TC-NTH-06: Second submission increments occurrences ──────────────────────

describe('TC-NTH-06: second submission for the same category increments occurrences', () => {
  it('occurrences is 2 after two submissions with the same category', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission({ category: 'injection' }));
    await handler.handle(
      cedarSubmission({
        category: 'injection',
        cedarRule: { ...cedarSubmission().cedarRule, id: 'NTV-002' },
      }),
    );

    const pattern = handler.listPatterns().find((p) => p.category === 'injection');
    expect(pattern).toBeDefined();
    expect(pattern!.occurrences).toBe(2);
  });

  it('threatIds accumulates both threat UUIDs', async () => {
    const { handler } = fixedClockHandler();
    const r1 = await handler.handle(cedarSubmission({ category: 'injection' }));
    const r2 = await handler.handle(
      cedarSubmission({
        category: 'injection',
        cedarRule: { ...cedarSubmission().cedarRule, id: 'NTV-002' },
      }),
    );

    const pattern = handler.listPatterns().find((p) => p.category === 'injection')!;
    expect(pattern.threatIds).toContain(r1.threatId);
    expect(pattern.threatIds).toContain(r2.threatId);
  });

  it('still only one pattern entry for the category', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission({ category: 'pivot' }));
    await handler.handle(
      cedarSubmission({
        category: 'pivot',
        cedarRule: { ...cedarSubmission().cedarRule, id: 'NTV-003' },
      }),
    );

    const patterns = handler.listPatterns().filter((p) => p.category === 'pivot');
    expect(patterns).toHaveLength(1);
  });
});

// ─── TC-NTH-07: Different categories produce separate patterns ─────────────────

describe('TC-NTH-07: different categories produce separate patterns', () => {
  it('two different categories yield two patterns', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission({ category: 'cat-a' }));
    await handler.handle(
      cedarSubmission({
        category: 'cat-b',
        cedarRule: { ...cedarSubmission().cedarRule, id: 'NTV-B' },
      }),
    );

    expect(handler.listPatterns()).toHaveLength(2);
    const cats = handler.listPatterns().map((p) => p.category);
    expect(cats).toContain('cat-a');
    expect(cats).toContain('cat-b');
  });

  it('mixed tool and cedar submissions produce separate patterns per category', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission({ category: 'encoding-obfuscation' }));
    await handler.handle(toolSubmission({ category: 'dns-exfiltration' }));

    expect(handler.listPatterns()).toHaveLength(2);
  });
});

// ─── TC-NTH-08: Audit log records threat_received and resolution events ─────────

describe('TC-NTH-08: audit log records threat_received and resolution events', () => {
  it('cedar-rule submission appends threat_received then cedar_rule_registered', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission());

    const log = handler.getAuditLog();
    expect(log).toHaveLength(2);
    expect(log[0]!.event).toBe('threat_received');
    expect(log[1]!.event).toBe('cedar_rule_registered');
  });

  it('fine-grained-tool submission appends threat_received then tool_creation_initiated', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(toolSubmission());

    const log = handler.getAuditLog();
    expect(log).toHaveLength(2);
    expect(log[0]!.event).toBe('threat_received');
    expect(log[1]!.event).toBe('tool_creation_initiated');
  });

  it('threat_received entry contains category and description in detail', async () => {
    const { handler } = fixedClockHandler();
    const sub = cedarSubmission({
      description: 'My novel threat',
      category: 'my-category',
    });
    await handler.handle(sub);

    const received = handler.getAuditLog()[0]!;
    expect(received.detail).toContain('My novel threat');
    expect(received.detail).toContain('my-category');
  });

  it('all entries share the same threatId', async () => {
    const { handler } = fixedClockHandler();
    const result = await handler.handle(cedarSubmission());

    for (const entry of handler.getAuditLog()) {
      expect(entry.threatId).toBe(result.threatId);
    }
  });

  it('two submissions produce four total audit entries', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission());
    await handler.handle(
      cedarSubmission({
        category: 'other',
        cedarRule: { ...cedarSubmission().cedarRule, id: 'NTV-002' },
      }),
    );

    expect(handler.getAuditLog()).toHaveLength(4);
  });
});

// ─── TC-NTH-09: listCedarRules returns all registered rules in order ───────────

describe('TC-NTH-09: listCedarRules returns all registered rules in order', () => {
  it('empty when no cedar-rule submissions made', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(toolSubmission());

    expect(handler.listCedarRules()).toHaveLength(0);
  });

  it('one rule after one cedar-rule submission', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission());

    expect(handler.listCedarRules()).toHaveLength(1);
  });

  it('rules are ordered by registration time', async () => {
    const { handler } = fixedClockHandler();
    const sub1 = cedarSubmission({ cedarRule: { ...cedarSubmission().cedarRule, id: 'FIRST' } });
    const sub2 = cedarSubmission({
      category: 'other',
      cedarRule: { ...cedarSubmission().cedarRule, id: 'SECOND' },
    });
    await handler.handle(sub1);
    await handler.handle(sub2);

    const rules = handler.listCedarRules();
    expect(rules[0]!.id).toBe('FIRST');
    expect(rules[1]!.id).toBe('SECOND');
  });

  it('does not include rules from fine-grained-tool submissions', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(toolSubmission());
    await handler.handle(cedarSubmission());

    const rules = handler.listCedarRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe('NTV-001');
  });
});

// ─── TC-NTH-10: listPatterns returns all tracked patterns ──────────────────────

describe('TC-NTH-10: listPatterns returns all tracked patterns', () => {
  it('empty on a fresh handler', () => {
    const handler = new NovelThreatHandler();
    expect(handler.listPatterns()).toHaveLength(0);
  });

  it('returns patterns for both cedar-rule and tool submissions', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission({ category: 'encoding' }));
    await handler.handle(toolSubmission({ category: 'exfiltration' }));

    expect(handler.listPatterns()).toHaveLength(2);
  });
});

// ─── TC-NTH-11: RFC includes capabilityRequest and evidence in description ─────

describe('TC-NTH-11: RFC includes capabilityRequest and evidence in description', () => {
  it('RFC description contains the proposed action class', async () => {
    const { handler } = fixedClockHandler();
    const sub = toolSubmission();
    const result = await handler.handle(sub);

    if (result.resolutionPath !== 'fine-grained-tool') return;
    expect(result.rfc.description).toContain(
      sub.capabilityRequest.proposedActionClass,
    );
  });

  it('RFC description contains serialised evidence', async () => {
    const { handler } = fixedClockHandler();
    const sub = toolSubmission({ evidence: { key: 'value', num: 42 } });
    const result = await handler.handle(sub);

    if (result.resolutionPath !== 'fine-grained-tool') return;
    expect(result.rfc.description).toContain('value');
    expect(result.rfc.description).toContain('42');
  });

  it('RFC title includes the threat description', async () => {
    const { handler } = fixedClockHandler();
    const sub = toolSubmission({ description: 'Unique threat descriptor' });
    const result = await handler.handle(sub);

    if (result.resolutionPath !== 'fine-grained-tool') return;
    expect(result.rfc.title).toContain('Unique threat descriptor');
  });
});

// ─── TC-NTH-12: getAuditLog returns entries in chronological order ─────────────

describe('TC-NTH-12: getAuditLog returns entries in chronological order', () => {
  it('entries are in insertion order for a single submission', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission());

    const log = handler.getAuditLog();
    // threat_received always comes before the resolution event
    const receiptIdx = log.findIndex((e) => e.event === 'threat_received');
    const resolveIdx = log.findIndex((e) => e.event === 'cedar_rule_registered');
    expect(receiptIdx).toBeLessThan(resolveIdx);
  });

  it('entries across two submissions are all present', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission({ category: 'a' }));
    await handler.handle(toolSubmission({ category: 'b' }));

    const events = handler.getAuditLog().map((e) => e.event);
    expect(events).toContain('threat_received');
    expect(events).toContain('cedar_rule_registered');
    expect(events).toContain('tool_creation_initiated');
  });

  it('getAuditLog is readonly — mutations to the returned array do not affect internal state', async () => {
    const { handler } = fixedClockHandler();
    await handler.handle(cedarSubmission());

    const log = handler.getAuditLog() as ThreatAuditEntry[];
    const originalLength = log.length;
    // Attempt to push a fake entry
    log.push({
      ts: new Date().toISOString(),
      event: 'threat_received',
      threatId: 'fake',
      detail: 'injected',
    });

    // Internal state is not affected (handler returns a fresh reference)
    expect(handler.getAuditLog()).toHaveLength(originalLength);
  });
});

// ─── TC-NTH-13: default instance is exported ───────────────────────────────────

describe('TC-NTH-13: default instance is exported', () => {
  it('defaultNovelThreatHandler is an instance of NovelThreatHandler', () => {
    expect(defaultNovelThreatHandler).toBeInstanceOf(NovelThreatHandler);
  });

  it('defaultNovelThreatHandler exposes handle, listCedarRules, listPatterns, getAuditLog', () => {
    expect(typeof defaultNovelThreatHandler.handle).toBe('function');
    expect(typeof defaultNovelThreatHandler.listCedarRules).toBe('function');
    expect(typeof defaultNovelThreatHandler.listPatterns).toBe('function');
    expect(typeof defaultNovelThreatHandler.getAuditLog).toBe('function');
  });
});

// ─── TC-NTH-14: Multiple handlers are isolated ─────────────────────────────────

describe('TC-NTH-14: multiple handlers have isolated state', () => {
  it('registering a cedar rule in handlerA does not affect handlerB', async () => {
    const handlerA = new NovelThreatHandler();
    const handlerB = new NovelThreatHandler();

    await handlerA.handle(cedarSubmission());

    expect(handlerA.listCedarRules()).toHaveLength(1);
    expect(handlerB.listCedarRules()).toHaveLength(0);
  });

  it('patterns tracked in handlerA are not visible in handlerB', async () => {
    const handlerA = new NovelThreatHandler();
    const handlerB = new NovelThreatHandler();

    await handlerA.handle(cedarSubmission({ category: 'isolated-category' }));

    expect(handlerA.listPatterns()).toHaveLength(1);
    expect(handlerB.listPatterns()).toHaveLength(0);
  });
});

/**
 * Command explainer → audit log integration tests — T22, T42
 *
 * Verifies that CommandExplanation output from explainCommand() reaches the
 * JSONL audit trail with proper field serialisation. These tests exercise the
 * data-flow path from the command-explainer rule engine through
 * JsonlAuditLogger, mirroring what dispatchHitlChannel performs at runtime
 * (src/index.ts lines 999-1011).
 *
 * Test IDs:
 *   TC-CEA-01  explained command: summary, effects, warnings appear in audit log
 *   TC-CEA-02  catch-all command: generic summary, empty effects/warnings logged
 *   TC-CEA-03  explanation fields survive JSONL round-trip serialisation
 *   TC-CEA-04  both explained and catch-all commands log as independent JSONL lines
 *   TC-CEA-05  explainer error does not crash pipeline — fallback entry still written
 *   TC-CEA-06  explanation timeout does not break logging — entry written with available fields
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { explainCommand } from './command-explainer.js';
import type { CommandExplanation } from './command-explainer.js';
import { JsonlAuditLogger } from '../audit.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Mirrors the logic in dispatchHitlChannel (src/index.ts) that decides
 * whether to include the `explanation` field in the outgoing payload.
 *
 * The field is omitted when explainCommand returns the generic catch-all
 * summary ("Runs <binary>" or "Runs an unrecognised command").
 */
function resolveExplanationText(
  command: string,
  { summary }: CommandExplanation,
): string | undefined {
  const binary = command.trim().split(/\s+/)[0] ?? '';
  if (summary === `Runs ${binary}` || summary === 'Runs an unrecognised command') {
    return undefined;
  }
  return summary;
}

/**
 * Builds an audit log entry that includes CommandExplanation fields, matching
 * the shape that dispatchHitlChannel would produce before calling the channel
 * adapter (sharedOpts spread).
 */
function buildExplainerAuditEntry(
  command: string,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const result = explainCommand(command);
  const explanation = resolveExplanationText(command, result);
  return {
    ts: new Date().toISOString(),
    ...base,
    rawCommand: command,
    inferred_action_class: result.inferred_action_class,
    ...(explanation !== undefined ? { explanation } : {}),
    ...(result.effects.length > 0 ? { effects: result.effects } : {}),
    ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
  };
}

/** Wraps buildExplainerAuditEntry with a try-catch — simulates error-safe dispatch. */
function buildExplainerAuditEntrySafe(
  command: string,
  base: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return buildExplainerAuditEntry(command, base);
  } catch {
    return { ts: new Date().toISOString(), ...base, rawCommand: command };
  }
}

const HITL_BASE: Record<string, unknown> = {
  type: 'hitl',
  decision: 'approved',
  token: 'tok-cea-test',
  toolName: 'bash',
  agentId: 'agent-cea-01',
  channel: 'default',
  policyName: 'test-hitl-policy',
  timeoutSeconds: 30,
  verified: true,
};

// ── Fixtures ────────────────────────────────────────────────────────────────────

/** A well-known command that the explainer should recognise (git.push). */
const EXPLAINED_COMMAND = 'git push origin main';

/** A command that falls through to the catch-all rule. */
const CATCHALL_COMMAND = 'xyzfrobnicator --config /etc/foo.conf';

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('Command explainer → audit log integration', () => {
  const tmpDir = tmpdir();
  let logFile: string;
  let logger: JsonlAuditLogger;

  beforeEach(() => {
    logFile = join(tmpDir, `cea-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    logger = new JsonlAuditLogger({ logFile });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (existsSync(logFile)) {
      await rm(logFile);
    }
  });

  // ── TC-CEA-01 ─────────────────────────────────────────────────────────────

  describe('TC-CEA-01: explained command — explanation fields appear in audit log', () => {
    it('logs a non-empty explanation string for a recognised command', async () => {
      const entry = buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(typeof parsed.explanation).toBe('string');
      expect((parsed.explanation as string).length).toBeGreaterThan(0);
    });

    it('logs non-empty effects array for a recognised command', async () => {
      const entry = buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(Array.isArray(parsed.effects)).toBe(true);
      expect((parsed.effects as string[]).length).toBeGreaterThan(0);
    });

    it('logs inferred_action_class for a recognised command', async () => {
      const entry = buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(typeof parsed.inferred_action_class).toBe('string');
      expect(parsed.inferred_action_class).toMatch(/^git\./);
    });

    it('audit entry retains standard HITL fields alongside explanation', async () => {
      const entry = buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(parsed.type).toBe('hitl');
      expect(parsed.decision).toBe('approved');
      expect(parsed.toolName).toBe('bash');
      expect(parsed.agentId).toBe('agent-cea-01');
    });
  });

  // ── TC-CEA-02 ─────────────────────────────────────────────────────────────

  describe('TC-CEA-02: catch-all command — generic summary, no explanation field', () => {
    it('omits the explanation field when command is unrecognised', async () => {
      const entry = buildExplainerAuditEntry(CATCHALL_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(parsed.explanation).toBeUndefined();
    });

    it('omits effects array when explainer returns empty effects', async () => {
      const entry = buildExplainerAuditEntry(CATCHALL_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(parsed.effects).toBeUndefined();
    });

    it('logs rawCommand for catch-all commands', async () => {
      const entry = buildExplainerAuditEntry(CATCHALL_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(parsed.rawCommand).toBe(CATCHALL_COMMAND);
    });

    it('logs inferred_action_class as "unknown" for catch-all commands', async () => {
      const entry = buildExplainerAuditEntry(CATCHALL_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(parsed.inferred_action_class).toBe('unknown');
    });
  });

  // ── TC-CEA-03 ─────────────────────────────────────────────────────────────

  describe('TC-CEA-03: explanation fields survive JSONL round-trip serialisation', () => {
    it('effects array survives JSON serialisation as a string array', async () => {
      const entry = buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      const effects = parsed.effects as unknown[];
      expect(Array.isArray(effects)).toBe(true);
      effects.forEach((e) => expect(typeof e).toBe('string'));
    });

    it('warnings array survives JSON serialisation when present', async () => {
      // git push --force should trigger a force-push warning
      const forceCmd = 'git push --force origin main';
      const entry = buildExplainerAuditEntry(forceCmd, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      if (parsed.warnings !== undefined) {
        expect(Array.isArray(parsed.warnings)).toBe(true);
        (parsed.warnings as unknown[]).forEach((w) => expect(typeof w).toBe('string'));
      }
    });

    it('explanation string survives JSON serialisation without truncation', async () => {
      const entry = buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE);
      const originalExplanation = (entry as Record<string, unknown>)['explanation'] as string;
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(parsed.explanation).toBe(originalExplanation);
    });

    it('ts field is a valid ISO 8601 timestamp', async () => {
      const entry = buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(typeof parsed.ts).toBe('string');
      expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // ── TC-CEA-04 ─────────────────────────────────────────────────────────────

  describe('TC-CEA-04: explained and catch-all commands log as independent JSONL entries', () => {
    it('logs two entries as separate JSONL lines', async () => {
      await logger.log(buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE));
      await logger.log(buildExplainerAuditEntry(CATCHALL_COMMAND, { ...HITL_BASE, token: 'tok-cea-02' }));

      const lines = (await readFile(logFile, 'utf-8')).trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('first entry (explained) has explanation field; second (catch-all) does not', async () => {
      await logger.log(buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE));
      await logger.log(buildExplainerAuditEntry(CATCHALL_COMMAND, { ...HITL_BASE, token: 'tok-cea-02' }));

      const lines = (await readFile(logFile, 'utf-8')).trim().split('\n');
      const first = JSON.parse(lines[0]!);
      const second = JSON.parse(lines[1]!);

      expect(first.explanation).toBeDefined();
      expect(second.explanation).toBeUndefined();
    });

    it('entries are individually valid JSON', async () => {
      await logger.log(buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE));
      await logger.log(buildExplainerAuditEntry(CATCHALL_COMMAND, { ...HITL_BASE, token: 'tok-cea-02' }));

      const lines = (await readFile(logFile, 'utf-8')).trim().split('\n');
      expect(() => JSON.parse(lines[0]!)).not.toThrow();
      expect(() => JSON.parse(lines[1]!)).not.toThrow();
    });

    it('rawCommand in each entry matches the original command string', async () => {
      await logger.log(buildExplainerAuditEntry(EXPLAINED_COMMAND, HITL_BASE));
      await logger.log(buildExplainerAuditEntry(CATCHALL_COMMAND, { ...HITL_BASE, token: 'tok-cea-02' }));

      const lines = (await readFile(logFile, 'utf-8')).trim().split('\n');
      expect(JSON.parse(lines[0]!).rawCommand).toBe(EXPLAINED_COMMAND);
      expect(JSON.parse(lines[1]!).rawCommand).toBe(CATCHALL_COMMAND);
    });
  });

  // ── TC-CEA-05 ─────────────────────────────────────────────────────────────

  describe('TC-CEA-05: explainer error does not crash pipeline — fallback entry written', () => {
    it('logs a fallback entry when explainCommand throws', async () => {
      vi.spyOn(
        await import('./command-explainer.js'),
        'explainCommand',
      ).mockImplementation(() => {
        throw new Error('explainer internal failure');
      });

      const entry = buildExplainerAuditEntrySafe(EXPLAINED_COMMAND, HITL_BASE);
      // Should not throw
      await expect(logger.log(entry)).resolves.toBeUndefined();

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(parsed.type).toBe('hitl');
      expect(parsed.rawCommand).toBe(EXPLAINED_COMMAND);
    });

    it('fallback entry retains all HITL base fields when explainCommand throws', async () => {
      vi.spyOn(
        await import('./command-explainer.js'),
        'explainCommand',
      ).mockImplementation(() => {
        throw new Error('explainer internal failure');
      });

      const entry = buildExplainerAuditEntrySafe(EXPLAINED_COMMAND, HITL_BASE);
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(parsed.agentId).toBe('agent-cea-01');
      expect(parsed.policyName).toBe('test-hitl-policy');
      expect(parsed.decision).toBe('approved');
    });

    it('explainCommand returning empty string does not crash logging path', async () => {
      vi.spyOn(
        await import('./command-explainer.js'),
        'explainCommand',
      ).mockReturnValue({
        summary: 'Runs an unrecognised command',
        effects: [],
        warnings: [],
        inferred_action_class: 'unknown',
      });

      const entry = buildExplainerAuditEntry('', HITL_BASE);
      await expect(logger.log(entry)).resolves.toBeUndefined();
    });
  });

  // ── TC-CEA-06 ─────────────────────────────────────────────────────────────

  describe('TC-CEA-06: explanation timeout does not break logging — entry written with available fields', () => {
    it('audit entry is written even when explanation is resolved after a simulated delay', async () => {
      // Simulate a slow explanation by resolving a promise race with a short timeout.
      // The synchronous explainCommand always wins the race; this verifies the
      // pattern is safe when wrapped in async dispatch code.
      const TIMEOUT_MS = 50;

      async function explainWithTimeout(command: string): Promise<CommandExplanation | null> {
        return Promise.race([
          Promise.resolve(explainCommand(command)),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
        ]);
      }

      const result = await explainWithTimeout(EXPLAINED_COMMAND);
      const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        ...HITL_BASE,
        rawCommand: EXPLAINED_COMMAND,
      };
      if (result !== null) {
        const explanation = resolveExplanationText(EXPLAINED_COMMAND, result);
        if (explanation !== undefined) entry['explanation'] = explanation;
        if (result.effects.length > 0) entry['effects'] = result.effects;
        entry['inferred_action_class'] = result.inferred_action_class;
      }
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(parsed.type).toBe('hitl');
      expect(parsed.rawCommand).toBe(EXPLAINED_COMMAND);
      expect(typeof parsed.ts).toBe('string');
    });

    it('when timeout fires before explanation, audit entry is written without explanation fields', async () => {
      vi.useFakeTimers();

      // Deferred promise that never resolves during this test (simulates slow explainer)
      let resolveExplain!: (v: CommandExplanation) => void;
      const slowExplainPromise = new Promise<CommandExplanation>((res) => {
        resolveExplain = res;
      });

      const TIMEOUT_MS = 100;
      const racePromise = Promise.race([
        slowExplainPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
      ]);

      // Advance fake clock so the timeout fires — racePromise now resolves to null
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
      const raceResult = await racePromise;
      expect(raceResult).toBeNull();

      const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        ...HITL_BASE,
        rawCommand: EXPLAINED_COMMAND,
      };
      // No explanation fields because the timeout fired before the explainer resolved
      await logger.log(entry);

      const parsed = JSON.parse((await readFile(logFile, 'utf-8')).trim());
      expect(parsed.type).toBe('hitl');
      expect(parsed.explanation).toBeUndefined();

      // Clean up — resolve the pending promise and restore real timers
      resolveExplain({ summary: 'late', effects: [], warnings: [], inferred_action_class: 'unknown' });
      vi.useRealTimers();
    });
  });
});

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import {
  JsonlAuditLogger,
} from './audit.js';
import type { AutoPermitDerivationSkippedEntry, AutoPermitMatchedEntry, NormalizerUnclassifiedEntry } from './audit.js';

describe('JsonlAuditLogger', () => {
  const tmpDir = tmpdir();
  let logFile: string;

  beforeEach(() => {
    logFile = join(tmpDir, `audit-test-${Date.now()}.jsonl`);
  });

  afterEach(async () => {
    if (existsSync(logFile)) {
      await rm(logFile);
    }
  });

  it('creates the file and appends a JSONL line', async () => {
    const logger = new JsonlAuditLogger({ logFile });
    const entry = {
      ts: new Date().toISOString(),
      effect: 'permit',
      resource: 'tool',
      match: 'read_file',
      reason: 'default permit',
      agentId: 'agent-1',
      channel: 'default',
    };
    await logger.log(entry);

    const content = await readFile(logFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed).toMatchObject(entry);
  });

  it('appends multiple entries as separate JSONL lines', async () => {
    const logger = new JsonlAuditLogger({ logFile });
    await logger.log({ ts: '1', effect: 'permit', resource: 'tool', match: 'a', reason: '', agentId: 'a1', channel: 'default' });
    await logger.log({ ts: '2', effect: 'forbid', resource: 'tool', match: 'b', reason: '', agentId: 'a1', channel: 'default' });

    const lines = (await readFile(logFile, 'utf-8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).ts).toBe('1');
    expect(JSON.parse(lines[1]).ts).toBe('2');
  });

  it('creates intermediate directories if they do not exist', async () => {
    const nestedLog = join(tmpDir, `nested-${Date.now()}`, 'sub', 'audit.jsonl');
    const logger = new JsonlAuditLogger({ logFile: nestedLog });
    await logger.log({ ts: 'x', effect: 'permit', resource: 'tool', match: '*', reason: '', agentId: 'a', channel: 'c' });
    expect(existsSync(nestedLog)).toBe(true);
    await rm(join(tmpDir, `nested-${Date.now() - 1}`), { recursive: true, force: true });
    // Clean up
    const dirParts = nestedLog.split('/');
    dirParts.pop(); dirParts.pop();
    await rm(dirParts.join('/'), { recursive: true, force: true }).catch(() => {});
  });

  it('does not throw on write failure — logs to stderr instead', async () => {
    // Use an invalid path (directory as file) to force a write error
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new JsonlAuditLogger({ logFile: tmpDir }); // tmpDir is a directory, not a file
    await expect(
      logger.log({ ts: 'x', effect: 'permit', resource: 'tool', match: '*', reason: '', agentId: 'a', channel: 'c' })
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('logs normalizer-unclassified entries', async () => {
    const logger = new JsonlAuditLogger({ logFile });
    const entry: NormalizerUnclassifiedEntry = {
      ts: new Date().toISOString(),
      type: 'normalizer-unclassified',
      stage: 'normalizer-unclassified',
      toolName: 'some_unknown_tool',
      agentId: 'agent-1',
      channel: 'default',
      verified: false,
    };
    await logger.log(entry);

    const content = await readFile(logFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe('normalizer-unclassified');
    expect(parsed.stage).toBe('normalizer-unclassified');
    expect(parsed.toolName).toBe('some_unknown_tool');
    expect(parsed.agentId).toBe('agent-1');
    expect(parsed.verified).toBe(false);
  });

  it('logs HITL decision entries', async () => {
    const logger = new JsonlAuditLogger({ logFile });
    const entry = {
      ts: new Date().toISOString(),
      type: 'hitl' as const,
      decision: 'approved' as const,
      token: 'tok-123',
      toolName: 'delete_file',
      agentId: 'agent-1',
      channel: 'default',
      policyName: 'hitl-policy',
      timeoutSeconds: 30,
    };
    await logger.log(entry);

    const content = await readFile(logFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe('hitl');
    expect(parsed.decision).toBe('approved');
    expect(parsed.token).toBe('tok-123');
  });

  it('logs auto_permit_matched entries with all required fields', async () => {
    const logger = new JsonlAuditLogger({ logFile });
    const entry: AutoPermitMatchedEntry = {
      ts: new Date().toISOString(),
      type: 'auto_permit_matched',
      pattern: 'git commit *',
      method: 'default',
      command: 'git commit -m "fix auth"',
      toolName: 'bash',
      actionClass: 'shell.exec',
      agentId: 'agent-42',
      channel: 'telegram',
      verified: true,
      mode: 'closed',
    };
    await logger.log(entry);

    const content = await readFile(logFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe('auto_permit_matched');
    expect(parsed.pattern).toBe('git commit *');
    expect(parsed.method).toBe('default');
    expect(parsed.command).toBe('git commit -m "fix auth"');
    expect(parsed.toolName).toBe('bash');
    expect(parsed.actionClass).toBe('shell.exec');
    expect(parsed.agentId).toBe('agent-42');
    expect(parsed.channel).toBe('telegram');
    expect(parsed.verified).toBe(true);
    expect(parsed.mode).toBe('closed');
  });

  it('logs auto_permit_matched entries without optional fields', async () => {
    const logger = new JsonlAuditLogger({ logFile });
    const entry: AutoPermitMatchedEntry = {
      ts: new Date().toISOString(),
      type: 'auto_permit_matched',
      pattern: 'read_file',
      method: 'default',
      command: 'read_file',
      toolName: 'read_file',
      actionClass: 'filesystem.read',
      agentId: 'agent-1',
      channel: 'slack',
    };
    await logger.log(entry);

    const content = await readFile(logFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe('auto_permit_matched');
    expect(parsed.pattern).toBe('read_file');
    expect(parsed.verified).toBeUndefined();
    expect(parsed.mode).toBeUndefined();
  });

  it('logs auto_permit_derivation_skipped entries with operatorId', async () => {
    const logger = new JsonlAuditLogger({ logFile });
    const entry: AutoPermitDerivationSkippedEntry = {
      ts: new Date().toISOString(),
      type: 'auto_permit_derivation_skipped',
      reason: 'command contains shell metacharacters',
      command: 'git commit && git push',
      toolName: 'bash',
      actionClass: 'shell.exec',
      channel: 'telegram',
      agentId: 'agent-7',
      operatorId: '123456789@alice',
    };
    await logger.log(entry);

    const content = await readFile(logFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe('auto_permit_derivation_skipped');
    expect(parsed.reason).toBe('command contains shell metacharacters');
    expect(parsed.command).toBe('git commit && git push');
    expect(parsed.toolName).toBe('bash');
    expect(parsed.actionClass).toBe('shell.exec');
    expect(parsed.channel).toBe('telegram');
    expect(parsed.agentId).toBe('agent-7');
    expect(parsed.operatorId).toBe('123456789@alice');
  });

  it('logs auto_permit_derivation_skipped entries without operatorId', async () => {
    const logger = new JsonlAuditLogger({ logFile });
    const entry: AutoPermitDerivationSkippedEntry = {
      ts: new Date().toISOString(),
      type: 'auto_permit_derivation_skipped',
      reason: 'command is empty',
      command: '',
      toolName: 'bash',
      actionClass: 'shell.exec',
      channel: 'slack',
      agentId: 'agent-2',
    };
    await logger.log(entry);

    const content = await readFile(logFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe('auto_permit_derivation_skipped');
    expect(parsed.operatorId).toBeUndefined();
  });
});

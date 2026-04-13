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
});

/**
 * Unit tests for the read_files_batch tool.
 *
 * Each test group creates a fresh temporary directory so tests are
 * fully isolated and do not affect the project's own filesystem.
 *
 * Test IDs:
 *   TC-RFB-01: Successful batch reads
 *   TC-RFB-02: Partial failures (mixed ok / error results)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFilesBatch } from './read-files-batch.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'read-files-batch-'));
}

// ─── TC-RFB-01: Successful batch reads ───────────────────────────────────────

describe('TC-RFB-01: successful batch reads', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns ok results for all existing files', async () => {
    const fileA = join(dir, 'a.txt');
    const fileB = join(dir, 'b.txt');
    writeFileSync(fileA, 'content-a');
    writeFileSync(fileB, 'content-b');

    const result = await readFilesBatch({ paths: [fileA, fileB] });

    expect(result.results[fileA]).toEqual({ status: 'ok', content: 'content-a' });
    expect(result.results[fileB]).toEqual({ status: 'ok', content: 'content-b' });
  });

  it('returns an empty results map for an empty paths array', async () => {
    const result = await readFilesBatch({ paths: [] });

    expect(result.results).toEqual({});
  });

  it('reads a single file when paths has one element', async () => {
    const filePath = join(dir, 'single.txt');
    writeFileSync(filePath, 'only one');

    const result = await readFilesBatch({ paths: [filePath] });

    expect(result.results[filePath]).toEqual({ status: 'ok', content: 'only one' });
  });

  it('preserves unicode content for all files', async () => {
    const fileA = join(dir, 'unicode.txt');
    const fileB = join(dir, 'emoji.txt');
    writeFileSync(fileA, 'café résumé', 'utf-8');
    writeFileSync(fileB, 'hello 🌍', 'utf-8');

    const result = await readFilesBatch({ paths: [fileA, fileB] });

    expect((result.results[fileA] as { status: 'ok'; content: string }).content).toBe('café résumé');
    expect((result.results[fileB] as { status: 'ok'; content: string }).content).toBe('hello 🌍');
  });

  it('reads an empty file as ok with empty string content', async () => {
    const filePath = join(dir, 'empty.txt');
    writeFileSync(filePath, '');

    const result = await readFilesBatch({ paths: [filePath] });

    expect(result.results[filePath]).toEqual({ status: 'ok', content: '' });
  });

  it('reads files in nested subdirectories', async () => {
    const subDir = join(dir, 'sub', 'nested');
    mkdirSync(subDir, { recursive: true });
    const filePath = join(subDir, 'deep.txt');
    writeFileSync(filePath, 'deep content');

    const result = await readFilesBatch({ paths: [filePath] });

    expect(result.results[filePath]).toEqual({ status: 'ok', content: 'deep content' });
  });

  it('result keys match the original paths exactly', async () => {
    const fileA = join(dir, 'a.txt');
    const fileB = join(dir, 'b.txt');
    writeFileSync(fileA, 'a');
    writeFileSync(fileB, 'b');

    const paths = [fileA, fileB];
    const result = await readFilesBatch({ paths });

    expect(Object.keys(result.results).sort()).toEqual(paths.slice().sort());
  });
});

// ─── TC-RFB-02: Partial failures ─────────────────────────────────────────────

describe('TC-RFB-02: partial failures', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns error for a missing file while reading existing ones successfully', async () => {
    const existing = join(dir, 'exists.txt');
    writeFileSync(existing, 'I exist');
    const missing = join(tmpdir(), `rfb-missing-${Date.now()}`);

    const result = await readFilesBatch({ paths: [existing, missing] });

    expect(result.results[existing]).toEqual({ status: 'ok', content: 'I exist' });
    expect(result.results[missing]).toMatchObject({ status: 'error', code: 'not-found' });
  });

  it('returns not-found code for a non-existent path', async () => {
    const missing = join(tmpdir(), `rfb-nf-${Date.now()}`);

    const result = await readFilesBatch({ paths: [missing] });

    expect(result.results[missing]).toMatchObject({ status: 'error', code: 'not-found' });
  });

  it('returns not-a-file code when path is a directory', async () => {
    const result = await readFilesBatch({ paths: [dir] });

    expect(result.results[dir]).toMatchObject({ status: 'error', code: 'not-a-file' });
  });

  it('error result message includes the path', async () => {
    const missing = join(tmpdir(), `rfb-msg-${Date.now()}`);

    const result = await readFilesBatch({ paths: [missing] });

    const entry = result.results[missing] as { status: 'error'; code: string; message: string };
    expect(entry.message).toContain(missing);
  });

  it('all-missing paths still resolve — none throw', async () => {
    const missing1 = join(tmpdir(), `rfb-all1-${Date.now()}`);
    const missing2 = join(tmpdir(), `rfb-all2-${Date.now()}`);

    const result = await readFilesBatch({ paths: [missing1, missing2] });

    expect(result.results[missing1]).toMatchObject({ status: 'error' });
    expect(result.results[missing2]).toMatchObject({ status: 'error' });
  });

  it('result contains entries for every requested path even when all fail', async () => {
    const missing = join(tmpdir(), `rfb-keys-${Date.now()}`);

    const result = await readFilesBatch({ paths: [missing] });

    expect(missing in result.results).toBe(true);
  });
});

/**
 * e2e/runner.mjs — minimal OpenClaw host simulator
 *
 * Spawned as a child process by OpenClawHarness. Speaks a simple
 * newline-delimited JSON protocol over stdio:
 *
 *   stdout → { type: "ready" }                        (on startup)
 *   stdout → { type: "decision", id, effect, reason } (per tool call)
 *   stdin  ← { type: "tool_call", id, tool, params }
 *
 * Audit entries matching runPipeline's executionEvent shape are appended to
 * the JSONL file specified by the AUDIT_LOG env var.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

const auditLogPath = process.env['AUDIT_LOG'] ?? '/tmp/oa-smoke.jsonl';

// ─── Minimal policy engine ────────────────────────────────────────────────────

/**
 * Resolve a tool call to an authorization decision.
 *
 * Policy (mirrors the default filesystem e2e policy):
 *  - read_file  → filesystem.read → permit (action_class)
 *  - all others → forbid (not_permitted)
 */
function resolve(tool) {
  if (tool === 'read_file') {
    return { effect: 'permit', reason: 'action_class', stage: 'stage2' };
  }
  return { effect: 'forbid', reason: 'not_permitted', stage: 'stage2' };
}

// ─── Audit writer ─────────────────────────────────────────────────────────────

async function writeAuditEntry(decision) {
  const entry = JSON.stringify({
    decision,
    timestamp: new Date().toISOString(),
  }) + '\n';
  try {
    await mkdir(dirname(auditLogPath), { recursive: true });
    await appendFile(auditLogPath, entry, 'utf-8');
  } catch (err) {
    process.stderr.write(`[runner] audit write failed: ${err.message}\n`);
  }
}

// ─── Signal ready ─────────────────────────────────────────────────────────────

process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

// ─── Request loop ─────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    process.stderr.write(`[runner] invalid JSON: ${trimmed}\n`);
    return;
  }

  if (req.type === 'tool_call') {
    const decision = resolve(req.tool);
    await writeAuditEntry(decision);
    process.stdout.write(
      JSON.stringify({ type: 'decision', id: req.id, effect: decision.effect, reason: decision.reason }) + '\n',
    );
  }
});

rl.on('close', () => process.exit(0));

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGTERM', () => process.exit(0));

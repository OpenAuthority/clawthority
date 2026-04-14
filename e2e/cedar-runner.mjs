/**
 * e2e/cedar-runner.mjs — Cedar WASM-backed OpenClaw host simulator
 *
 * Extends the baseline runner with real Cedar WASM authorization decisions.
 * Speaks the same newline-delimited JSON protocol over stdio:
 *
 *   stdout → { type: "ready", engine: "cedar", engineVersion, policiesLoaded }
 *   stdout → { type: "decision", id, effect, reason }
 *   stdin  ← { type: "tool_call", id, tool, params }
 *
 * Flags:
 *   --engine <name>   Engine to use (must be "cedar"; any other value exits 1)
 *
 * Environment:
 *   AUDIT_LOG   Path for the JSONL audit log (default: /tmp/oa-smoke.jsonl)
 */

import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// ─── Parse --engine flag ──────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const engineIdx = argv.indexOf('--engine');
const engineArg = engineIdx >= 0 ? argv[engineIdx + 1] : 'cedar';

if (engineArg !== 'cedar') {
  process.stderr.write(`[cedar-runner] unsupported engine: ${String(engineArg)}\n`);
  process.exit(1);
}

const auditLogPath = process.env['AUDIT_LOG'] ?? '/tmp/oa-smoke.jsonl';

// ─── Tool → action class mapping ─────────────────────────────────────────────
// Mirrors the normalize.ts registry; covers the representative workload set.

const TOOL_TO_ACTION_CLASS = {
  // filesystem
  read_file:       'filesystem.read',
  readfile:        'filesystem.read',
  read_text:       'filesystem.read',
  write_file:      'filesystem.write',
  writefile:       'filesystem.write',
  create_file:     'filesystem.write',
  save_file:       'filesystem.write',
  edit_file:       'filesystem.write',
  delete_file:     'filesystem.delete',
  remove_file:     'filesystem.delete',
  list_files:      'filesystem.list',
  ls:              'filesystem.list',
  // browser
  navigate:        'browser.navigate',
  browser_navigate:'browser.navigate',
  go_to_url:       'browser.navigate',
  open_url:        'browser.navigate',
  // communication
  send_email:      'communication.send',
  send_sms:        'communication.send',
  send_message:    'communication.send',
  // system
  execute_command: 'system.execute',
  run_command:     'system.execute',
  bash:            'system.execute',
  shell:           'system.execute',
  // credential
  get_secret:      'credential.access',
  read_secret:     'credential.access',
  get_api_key:     'credential.access',
  get_password:    'credential.access',
  set_secret:      'credential.write',
  write_secret:    'credential.write',
  store_credential:'credential.write',
  set_api_key:     'credential.write',
  // payment
  transfer_funds:  'payment.transfer',
  send_payment:    'payment.transfer',
  process_payment: 'payment.transfer',
  initiate_payment:'payment.initiate',
  create_payment:  'payment.initiate',
  // account
  change_permissions: 'account.permission.change',
  set_permissions:    'account.permission.change',
  grant_access:       'account.permission.change',
  // memory
  memory_read:     'memory.read',
  memory_write:    'memory.write',
};

function resolveActionClass(tool) {
  return TOOL_TO_ACTION_CLASS[tool] ?? 'unknown_sensitive_action';
}

// ─── Action class → Cedar resource type ──────────────────────────────────────
// Mirrors EnforcementPolicyEngine prefix mapping in pipeline.ts.

function mapActionClassToResource(actionClass) {
  if (actionClass === 'unknown_sensitive_action') return 'unknown';
  const prefix = actionClass.split('.')[0];
  switch (prefix) {
    case 'filesystem':    return 'file';
    case 'communication': return 'channel';
    case 'payment':       return 'payment';
    case 'system':        return 'system';
    case 'credential':    return 'credential';
    case 'browser':       return 'web';
    case 'memory':        return 'memory';
    default:              return 'tool';
  }
}

// ─── Cedar entity builder ─────────────────────────────────────────────────────
// Builds Agent + Resource entities for the Cedar entity store.
// Follows the same pattern as buildEntities() / buildResourceEntity() in src/.

function buildCedarEntities(agentId, channel, resourceType, resourceName, actionClass) {
  return [
    {
      uid: { type: 'OpenAuthority::Agent', id: agentId },
      attrs: {
        agentId,
        channel,
      },
      parents: [],
    },
    {
      uid: { type: 'OpenAuthority::Resource', id: `${resourceType}:${resourceName}` },
      attrs: {
        actionClass,
      },
      parents: [],
    },
  ];
}

// ─── Load Cedar policies from data/policies/ ─────────────────────────────────

async function loadPolicies() {
  const policiesDir = resolve(projectRoot, 'data', 'policies');
  let files;
  try {
    files = await readdir(policiesDir);
  } catch {
    process.stderr.write('[cedar-runner] warn: data/policies/ not found; no policies loaded\n');
    return { text: '', fileCount: 0 };
  }

  const cedarFiles = files.filter(f => f.endsWith('.cedar')).sort();
  const parts = [];
  for (const file of cedarFiles) {
    const content = await readFile(join(policiesDir, file), 'utf-8');
    parts.push(content.trim());
  }
  return { text: parts.join('\n\n'), fileCount: cedarFiles.length };
}

// ─── Audit writer ─────────────────────────────────────────────────────────────

async function writeAuditEntry(decision, sessionId) {
  const entry = JSON.stringify({
    decision,
    timestamp: new Date().toISOString(),
    sessionId,
  }) + '\n';
  try {
    await mkdir(dirname(auditLogPath), { recursive: true });
    await appendFile(auditLogPath, entry, 'utf-8');
  } catch (err) {
    process.stderr.write(`[cedar-runner] audit write failed: ${err.message}\n`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load Cedar WASM module
  let cedar;
  try {
    cedar = await import('@cedar-policy/cedar-wasm/nodejs');
  } catch (err) {
    process.stderr.write(`[cedar-runner] fatal: failed to load cedar-wasm: ${err.message}\n`);
    process.exit(1);
  }

  // Load policies from data/policies/
  const { text: policies, fileCount: policiesLoaded } = await loadPolicies();

  // ── Emit activation banner ────────────────────────────────────────────────
  process.stdout.write(
    JSON.stringify({
      type: 'ready',
      engine: 'cedar',
      engineVersion: '4.9.1',
      policiesLoaded,
    }) + '\n',
  );

  // Each harness invocation uses a stable session ID for audit correlation.
  const sessionId = `e2e-${Date.now()}`;

  // ── Request loop ──────────────────────────────────────────────────────────
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      process.stderr.write(`[cedar-runner] invalid JSON frame: ${trimmed}\n`);
      return;
    }

    if (req.type !== 'tool_call') return;

    const tool       = String(req.tool ?? '');
    const agentId    = String(req.params?.agentId ?? 'e2e-agent');
    const channel    = String(req.params?.channel ?? 'default');

    const actionClass  = resolveActionClass(tool);
    const resourceType = mapActionClassToResource(actionClass);
    const resourceName = tool;

    const entities = buildCedarEntities(agentId, channel, resourceType, resourceName, actionClass);

    const cedarRequest = {
      principal: { type: 'OpenAuthority::Agent', id: agentId },
      action:    { type: 'OpenAuthority::Action', id: 'RequestAccess' },
      resource:  { type: 'OpenAuthority::Resource', id: `${resourceType}:${resourceName}` },
      context:   {},
      policies:  { staticPolicies: policies },
      entities,
    };

    let decision;
    try {
      const answer = cedar.isAuthorized(cedarRequest);
      if (answer.type === 'success' && answer.response?.decision === 'allow') {
        const reasons = answer.response?.diagnostics?.reason ?? [];
        decision = {
          effect: 'permit',
          reason: reasons.length > 0 ? reasons.join('; ') : 'cedar_permit',
          stage: 'stage2',
          engine: 'cedar',
        };
      } else {
        const reasons = answer.response?.diagnostics?.reason ?? [];
        const errors  = answer.errors ?? [];
        decision = {
          effect: 'forbid',
          reason: reasons.length > 0 ? reasons.join('; ')
                : errors.length > 0  ? `cedar_error: ${errors.join('; ')}`
                : 'cedar_deny',
          stage: 'stage2',
          engine: 'cedar',
        };
        if (answer.type !== 'success') {
          process.stderr.write(`[cedar-runner] cedar failure: ${JSON.stringify(answer.errors)}\n`);
        }
      }
    } catch (err) {
      process.stderr.write(`[cedar-runner] cedar threw: ${err.message}\n`);
      decision = { effect: 'forbid', reason: 'cedar_runtime_error', stage: 'stage2', engine: 'cedar' };
    }

    await writeAuditEntry(decision, sessionId);

    process.stdout.write(
      JSON.stringify({ type: 'decision', id: req.id, effect: decision.effect, reason: decision.reason }) + '\n',
    );
  });

  rl.on('close', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main().catch((err) => {
  process.stderr.write(`[cedar-runner] fatal: ${err.message}\n`);
  process.exit(1);
});

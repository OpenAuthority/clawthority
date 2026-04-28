#!/usr/bin/env node
/**
 * auto-permits.mjs
 *
 * CLI tool for managing auto-permit rules stored in the auto-permit JSON store.
 *
 * Usage:
 *   node scripts/auto-permits.mjs list   [--json] [--store <path>]
 *   node scripts/auto-permits.mjs show   <index|pattern> [--json] [--store <path>]
 *   node scripts/auto-permits.mjs remove <index|pattern> [--dry-run] [--store <path>]
 *
 * The store path is resolved from (highest precedence first):
 *   1. --store <path> CLI flag
 *   2. CLAWTHORITY_AUTO_PERMIT_STORE environment variable
 *   3. Default: data/auto-permits.json (relative to project root)
 *
 * npm script aliases (defined in package.json):
 *   npm run list-auto-permits
 *   npm run show-auto-permit   -- <index|pattern>
 *   npm run remove-auto-permit -- <index|pattern>
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Argument parsing ──────────────────────────────────────────────────────────

/**
 * Parses a flat argv array into structured flags, named options, and
 * positional arguments.  Recognised flags and options:
 *
 *   --json       → flags.has('json')
 *   --dry-run    → flags.has('dry-run')
 *   --store PATH → named.store = PATH
 *
 * All other `--foo` tokens are silently ignored.  Remaining non-flag tokens
 * become positional arguments in the order they appear.
 *
 * @param {string[]} args  Slice of `process.argv` after the subcommand token.
 * @returns {{ flags: Set<string>, named: Record<string,string>, positional: string[] }}
 */
function parseArgs(args) {
  const flags = new Set();
  const named = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') {
      flags.add('json');
    } else if (a === '--dry-run') {
      flags.add('dry-run');
    } else if (a === '--store') {
      if (i + 1 < args.length) {
        named.store = args[++i];
      }
    } else if (a.startsWith('--')) {
      // Unrecognised flag — ignore.
    } else {
      positional.push(a);
    }
  }

  return { flags, named, positional };
}

// ── Store helpers ─────────────────────────────────────────────────────────────

/**
 * Resolves the store file path from parsed args and the environment.
 *
 * @param {{ named: Record<string,string> }} parsed
 * @returns {string} Absolute path to the auto-permit store file.
 */
function resolveStorePath(parsed) {
  if (parsed.named.store) return resolve(root, parsed.named.store);
  const envPath = process.env.CLAWTHORITY_AUTO_PERMIT_STORE?.trim();
  if (envPath && envPath.length > 0) return resolve(root, envPath);
  return resolve(root, 'data/auto-permits.json');
}

/**
 * Reads and JSON-parses the auto-permit store file.
 *
 * Supports both the versioned `{ version, rules, checksum? }` envelope format
 * and the legacy flat-array format (pre-versioning).
 *
 * Returns `found: false` when the file does not exist (ENOENT); all other I/O
 * errors are re-thrown.
 *
 * @param {string} storePath  Absolute path to the store file.
 * @returns {{ version: number, rules: unknown[], found: boolean }}
 */
function loadStore(storePath) {
  let raw;
  try {
    raw = readFileSync(storePath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { version: 0, rules: [], found: false };
    }
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[auto-permits] ${storePath}: invalid JSON — ${err.message}`);
    process.exit(1);
  }

  if (Array.isArray(parsed)) {
    // Legacy flat-array format — treat as version 0.
    return { version: 0, rules: parsed, found: true };
  }

  const version = typeof parsed.version === 'number' ? parsed.version : 0;
  const rules = Array.isArray(parsed.rules) ? parsed.rules : [];
  return { version, rules, found: true };
}

/**
 * Atomically writes `rules` to the store file using the versioned envelope
 * format, matching the behaviour of `saveAutoPermitRules` in `src/auto-permits/store.ts`.
 *
 * Uses a write-to-temp-then-rename pattern for crash safety.
 *
 * @param {string}    storePath   Absolute path to the store file.
 * @param {unknown[]} rules       Updated rules array to persist.
 * @param {number}    nextVersion Store version to write.
 */
function saveStore(storePath, rules, nextVersion) {
  mkdirSync(dirname(storePath), { recursive: true });
  const tmpPath = `${storePath}.tmp`;
  const checksum = createHash('sha256').update(JSON.stringify(rules)).digest('hex');
  const store = { version: nextVersion, rules, checksum };
  const content = JSON.stringify(store, null, 2) + '\n';
  writeFileSync(tmpPath, content, { mode: 0o644 });
  renameSync(tmpPath, storePath);
  try {
    chmodSync(storePath, 0o644);
  } catch {
    // chmod may fail on some file-systems (e.g. FAT32) — non-fatal.
  }
}

/**
 * Finds an auto-permit by numeric index or exact pattern string.
 *
 * When `selector` is a non-negative integer string its value is used as a
 * 0-based index into `rules`.  Otherwise the selector is compared to each
 * rule's `pattern` field for an exact match.
 *
 * @param {unknown[]} rules     The loaded rules array.
 * @param {string}    selector  Index (as string) or pattern string.
 * @returns {{ rule: unknown, index: number } | null}
 */
function findRule(rules, selector) {
  const idx = Number(selector);
  if (Number.isInteger(idx) && idx >= 0 && String(idx) === selector && idx < rules.length) {
    return { rule: rules[idx], index: idx };
  }
  const index = rules.findIndex((r) => r != null && typeof r === 'object' && r.pattern === selector);
  if (index !== -1) return { rule: rules[index], index };
  return null;
}

/**
 * Returns a human-readable creation timestamp for a rule.
 *
 * Prefers `created_at` (ISO-8601 string) over computing from `createdAt`
 * (unix ms), falling back to `'(unknown)'` when neither field is present.
 *
 * @param {Record<string,unknown>} rule
 * @returns {string}
 */
function formatDate(rule) {
  if (typeof rule.created_at === 'string' && rule.created_at.length > 0) return rule.created_at;
  if (typeof rule.createdAt === 'number' && rule.createdAt > 0) {
    return new Date(rule.createdAt).toISOString();
  }
  return '(unknown)';
}

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * Lists all auto-permits.
 *
 * In default mode prints a numbered table with pattern, method, creation time,
 * creator, and optional intent hint.  In `--json` mode emits a single JSON
 * object containing `store`, `count`, and `rules`.
 *
 * @param {string[]} rawArgs  Argv slice after the `list` subcommand token.
 */
function cmdList(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const storePath = resolveStorePath(parsed);
  const jsonMode = parsed.flags.has('json');

  const { rules, found } = loadStore(storePath);

  if (jsonMode) {
    console.log(JSON.stringify({ store: storePath, count: rules.length, rules }, null, 2));
    return;
  }

  console.log(`Auto-permits store: ${storePath}`);

  if (!found) {
    console.log('Store file not found — no auto-permits configured.');
    return;
  }

  if (rules.length === 0) {
    console.log('No auto-permits found.');
    return;
  }

  console.log(`\n${rules.length} auto-permit(s):\n`);

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule == null || typeof rule !== 'object') {
      console.log(`  [${i}] (invalid entry — skipped)`);
      continue;
    }
    const date = formatDate(rule);
    const by = typeof rule.created_by === 'string' ? ` by ${rule.created_by}` : '';
    console.log(`  [${i}] ${rule.pattern ?? '(no pattern)'}`);
    console.log(`      method: ${rule.method ?? '(unknown)'}  created: ${date}${by}`);
    if (typeof rule.intentHint === 'string') {
      console.log(`      intent: ${rule.intentHint}`);
    }
  }

  console.log('');
}

/**
 * Shows detailed information for a single auto-permit.
 *
 * The first positional argument is the selector (0-based index or exact
 * pattern string).  In `--json` mode emits `{ index, rule }`.
 *
 * @param {string[]} rawArgs  Argv slice after the `show` subcommand token.
 */
function cmdShow(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const storePath = resolveStorePath(parsed);
  const jsonMode = parsed.flags.has('json');

  const selector = parsed.positional[0];
  if (!selector) {
    console.error('Error: a selector (index or pattern) is required.');
    console.error('Usage: auto-permits show <index|pattern> [--json] [--store <path>]');
    process.exit(1);
  }

  const { rules, found } = loadStore(storePath);

  if (!found) {
    console.error(`Error: store file not found: ${storePath}`);
    process.exit(1);
  }

  const match = findRule(rules, selector);
  if (!match) {
    console.error(`Error: no auto-permit found for selector: ${selector}`);
    process.exit(1);
  }

  const { rule, index } = match;

  if (jsonMode) {
    console.log(JSON.stringify({ index, rule }, null, 2));
    return;
  }

  console.log(`\nAuto-permit [${index}]`);
  console.log(`  pattern:          ${rule.pattern ?? '(none)'}`);
  console.log(`  method:           ${rule.method ?? '(unknown)'}`);
  console.log(`  originalCommand:  ${rule.originalCommand ?? rule.derived_from ?? '(none)'}`);
  console.log(`  created:          ${formatDate(rule)}`);
  if (typeof rule.created_by === 'string') {
    console.log(`  created_by:       ${rule.created_by}`);
  }
  if (typeof rule.intentHint === 'string') {
    console.log(`  intent:           ${rule.intentHint}`);
  }
  if (
    typeof rule.derived_from === 'string' &&
    rule.derived_from !== rule.originalCommand
  ) {
    console.log(`  derived_from:     ${rule.derived_from}`);
  }
  console.log('');
}

/**
 * Removes a single auto-permit from the store.
 *
 * The first positional argument is the selector (0-based index or exact
 * pattern string).  With `--dry-run` the removal is described but the store
 * file is not modified.
 *
 * Atomically saves the updated rules with an incremented version number to
 * maintain monotonic store versions.
 *
 * @param {string[]} rawArgs  Argv slice after the `remove` subcommand token.
 */
function cmdRemove(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const storePath = resolveStorePath(parsed);
  const dryRun = parsed.flags.has('dry-run');

  const selector = parsed.positional[0];
  if (!selector) {
    console.error('Error: a selector (index or pattern) is required.');
    console.error('Usage: auto-permits remove <index|pattern> [--dry-run] [--store <path>]');
    process.exit(1);
  }

  const { rules, version, found } = loadStore(storePath);

  if (!found) {
    console.error(`Error: store file not found: ${storePath}`);
    process.exit(1);
  }

  const match = findRule(rules, selector);
  if (!match) {
    console.error(`Error: no auto-permit found for selector: ${selector}`);
    process.exit(1);
  }

  const { rule, index } = match;
  const pattern = rule != null && typeof rule === 'object' ? (rule.pattern ?? '(no pattern)') : '(invalid)';

  console.log(`Removing auto-permit [${index}]: ${pattern}`);

  if (dryRun) {
    console.log('(dry-run — store was not modified)');
    return;
  }

  const updated = rules.filter((_, i) => i !== index);
  saveStore(storePath, updated, version + 1);
  console.log(`Removed. Store now contains ${updated.length} auto-permit(s).`);
}

// ── Usage ─────────────────────────────────────────────────────────────────────

function printUsage() {
  console.error('Usage: auto-permits <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error(
    '  list    [--json] [--store <path>]                      List all auto-permits',
  );
  console.error(
    '  show    <index|pattern> [--json] [--store <path>]      Show a single permit in detail',
  );
  console.error(
    '  remove  <index|pattern> [--dry-run] [--store <path>]   Remove a permit from the store',
  );
  console.error('');
  console.error('Selector:');
  console.error('  <index>    0-based position in the rules list (e.g. 0, 1, 2)');
  console.error('  <pattern>  Exact pattern string (e.g. "git commit *")');
  console.error('');
  console.error('Options:');
  console.error('  --json            Output in machine-readable JSON format (list, show)');
  console.error('  --dry-run         Print what would be removed without writing (remove)');
  console.error('  --store <path>    Override the auto-permit store file path');
  console.error('');
  console.error('Environment:');
  console.error('  CLAWTHORITY_AUTO_PERMIT_STORE   Overrides the default store path');
  console.error('                                  (data/auto-permits.json)');
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [, , command, ...rest] = process.argv;

switch (command) {
  case 'list':
    cmdList(rest);
    break;
  case 'show':
    cmdShow(rest);
    break;
  case 'remove':
    cmdRemove(rest);
    break;
  default:
    printUsage();
    process.exit(command ? 1 : 0);
}

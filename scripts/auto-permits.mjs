#!/usr/bin/env node
/**
 * auto-permits.mjs
 *
 * CLI tool for managing auto-permit rules stored in the auto-permit JSON store.
 *
 * Usage:
 *   node scripts/auto-permits.mjs list     [--json] [--store <path>]
 *   node scripts/auto-permits.mjs show     <index|pattern> [--json] [--store <path>]
 *   node scripts/auto-permits.mjs validate [--json] [--store <path>]
 *   node scripts/auto-permits.mjs test     <command> [--json] [--store <path>]
 *   node scripts/auto-permits.mjs remove   <index|pattern> [--dry-run] [--yes] [--store <path>]
 *   node scripts/auto-permits.mjs revoke   <index> [--store <path>]
 *
 * The store path is resolved from (highest precedence first):
 *   1. --store <path> CLI flag
 *   2. CLAWTHORITY_AUTO_PERMIT_STORE environment variable
 *   3. Default: data/auto-permits.json (relative to project root)
 *
 * npm script aliases (defined in package.json):
 *   npm run list-auto-permits
 *   npm run show-auto-permit      -- <index|pattern>
 *   npm run validate-auto-permits
 *   npm run test-auto-permit      -- <command>
 *   npm run remove-auto-permit    -- <index|pattern>
 *   npm run revoke-auto-permit    -- <index>
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

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
    } else if (a === '--yes' || a === '-y') {
      flags.add('yes');
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

// ── Inline validation helpers ─────────────────────────────────────────────────

/**
 * Validates a single rule entry against the AutoPermit schema requirements.
 * Mirrors the TypeBox AutoPermitSchema checks from src/models/auto-permit.ts.
 *
 * @param {unknown} rule   The candidate rule entry.
 * @param {number}  index  Zero-based index in the rules array (for error messages).
 * @returns {string[]} Array of error messages; empty when the entry is valid.
 */
function validateRule(rule, index) {
  const errors = [];
  if (rule == null || typeof rule !== 'object' || Array.isArray(rule)) {
    errors.push('entry must be a plain object');
    return errors;
  }
  if (typeof rule.pattern !== 'string' || rule.pattern.length === 0) {
    errors.push('pattern: must be a non-empty string');
  }
  if (rule.method !== 'default' && rule.method !== 'exact') {
    errors.push(`method: must be "default" or "exact", got ${JSON.stringify(rule.method)}`);
  }
  if (typeof rule.createdAt !== 'number' || rule.createdAt < 0) {
    errors.push('createdAt: must be a non-negative number');
  }
  if (typeof rule.originalCommand !== 'string' || rule.originalCommand.length === 0) {
    errors.push('originalCommand: must be a non-empty string');
  }
  if (rule.intentHint !== undefined && typeof rule.intentHint !== 'string') {
    errors.push('intentHint: must be a string when present');
  }
  if (
    rule.created_by !== undefined &&
    (typeof rule.created_by !== 'string' || rule.created_by.length === 0)
  ) {
    errors.push('created_by: must be a non-empty string when present');
  }
  if (
    rule.created_at !== undefined &&
    (typeof rule.created_at !== 'string' || rule.created_at.length === 0)
  ) {
    errors.push('created_at: must be a non-empty string when present');
  }
  if (
    rule.derived_from !== undefined &&
    (typeof rule.derived_from !== 'string' || rule.derived_from.length === 0)
  ) {
    errors.push('derived_from: must be a non-empty string when present');
  }
  return errors;
}

// ── Inline pattern-matching helpers ───────────────────────────────────────────
// These mirror the logic in src/auto-permits/matcher.ts so that the CLI can
// run without loading the compiled TypeScript bundle.

/**
 * Shell-aware tokeniser mirroring `tokenize` in matcher.ts.
 * Quoted groups are treated as single tokens (quotes stripped).
 *
 * @param {string} command
 * @returns {string[]}
 */
function tokenize(command) {
  const tokens = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;

  for (const ch of command) {
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === ' ' && !inDouble && !inSingle) {
      if (current.length > 0) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** Escapes all regex special characters in a literal string. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a stored auto-permit pattern to a RegExp.
 * Mirrors `compilePatternRegex` in src/auto-permits/matcher.ts.
 *
 * @param {string} pattern
 * @returns {RegExp | null}
 */
function compilePatternRegex(pattern) {
  if (pattern.length === 0) return null;
  try {
    const tokens = pattern.split(' ');
    if (tokens.length === 0 || tokens[0] === '') return null;
    if (tokens[tokens.length - 1] === '*') {
      const prefix = tokens.slice(0, -1).map(escapeRegex).join(' ');
      return new RegExp(`^${prefix}( .+)?$`);
    }
    return new RegExp(`^${tokens.map(escapeRegex).join(' ')}$`);
  } catch {
    return null;
  }
}

/**
 * Normalises a raw command string to its canonical space-joined token form.
 * Mirrors `normalizeCommand` in src/auto-permits/matcher.ts.
 *
 * @param {string} command
 * @returns {string}
 */
function normalizeCommandStr(command) {
  return tokenize(command.trim()).join(' ');
}

/**
 * Returns all rules whose patterns match the normalised command string.
 * (The runtime engine returns only the first match; this helper returns
 * all matches so the `test` command can surface every applicable rule.)
 *
 * @param {unknown[]} rules      Loaded rules array.
 * @param {string}    normalized Normalised command string.
 * @returns {{ index: number, rule: unknown }[]}
 */
function matchAllRules(rules, normalized) {
  const matches = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule == null || typeof rule !== 'object') continue;
    const pattern = typeof rule.pattern === 'string' ? rule.pattern : null;
    if (!pattern) continue;
    const regex = compilePatternRegex(pattern);
    if (regex !== null && regex.test(normalized)) {
      matches.push({ index: i, rule });
    }
  }
  return matches;
}

// ── Confirmation helper ───────────────────────────────────────────────────────

/**
 * Prompts the user for a y/N confirmation on stderr.
 * In non-interactive (piped) mode defaults to `false` without blocking.
 *
 * @param {string} question  The question to display (without the `[y/N]` suffix).
 * @returns {Promise<boolean>}
 */
function askConfirmation(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      process.stderr.write(`${question} [y/N] (non-interactive — defaulting to N)\n`);
      resolve(false);
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === 'y' || a === 'yes');
    });
  });
}

// ── Rule age helper ───────────────────────────────────────────────────────────

/**
 * Returns a human-readable "age" string for a rule based on its createdAt
 * unix-ms timestamp.  Returns `null` when no valid timestamp is available.
 *
 * @param {Record<string,unknown>} rule
 * @returns {string | null}
 */
function formatAge(rule) {
  const ms =
    typeof rule.createdAt === 'number' && rule.createdAt > 0
      ? rule.createdAt
      : null;
  if (ms === null) return null;
  const diffMs = Date.now() - ms;
  if (diffMs < 0) return null;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
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
    const age = formatAge(rule);
    const by = typeof rule.created_by === 'string' ? ` by ${rule.created_by}` : '';
    const ageSuffix = age ? `  (${age})` : '';
    console.log(`  [${i}] ${rule.pattern ?? '(no pattern)'}`);
    console.log(`      method: ${rule.method ?? '(unknown)'}  created: ${date}${by}${ageSuffix}`);
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

  const age = formatAge(rule);
  console.log(`\nAuto-permit [${index}]`);
  console.log(`  pattern:          ${rule.pattern ?? '(none)'}`);
  console.log(`  method:           ${rule.method ?? '(unknown)'}`);
  console.log(`  originalCommand:  ${rule.originalCommand ?? rule.derived_from ?? '(none)'}`);
  console.log(`  created:          ${formatDate(rule)}${age ? `  (${age})` : ''}`);
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
 * Validates the auto-permit store file: JSON syntax, envelope schema,
 * per-entry field checks, and checksum integrity.
 *
 * Exits with code 0 when the file is valid (or absent), code 1 when errors
 * are found.  In `--json` mode emits a structured result object.
 *
 * @param {string[]} rawArgs  Argv slice after the `validate` subcommand token.
 */
function cmdValidate(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const storePath = resolveStorePath(parsed);
  const jsonMode = parsed.flags.has('json');

  // ── Read raw content ──────────────────────────────────────────────────────
  let raw;
  try {
    raw = readFileSync(storePath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (jsonMode) {
        console.log(JSON.stringify({ store: storePath, found: false, valid: true, errors: [] }, null, 2));
      } else {
        console.log(`Auto-permits store: ${storePath}`);
        console.log('Store file not found — treating as valid (no rules configured).');
      }
      return;
    }
    throw err;
  }

  // ── Parse JSON ────────────────────────────────────────────────────────────
  let content;
  try {
    content = JSON.parse(raw);
  } catch (err) {
    const msg = `JSON syntax error: ${err.message}`;
    if (jsonMode) {
      console.log(JSON.stringify({ store: storePath, found: true, valid: false, errors: [msg] }, null, 2));
    } else {
      console.log(`Auto-permits store: ${storePath}`);
      console.error(`  ✗ ${msg}`);
    }
    process.exit(1);
  }

  // ── Detect format ─────────────────────────────────────────────────────────
  let version = 0;
  let rawRules;
  let storedChecksum;
  let isLegacy = false;
  const envelopeErrors = [];

  if (Array.isArray(content)) {
    isLegacy = true;
    rawRules = content;
  } else if (content !== null && typeof content === 'object') {
    if (typeof content.version !== 'number') {
      envelopeErrors.push('version: must be a number');
    } else {
      version = content.version;
    }
    if (!Array.isArray(content.rules)) {
      envelopeErrors.push('rules: must be an array');
    } else {
      rawRules = content.rules;
    }
    if (content.checksum !== undefined && typeof content.checksum !== 'string') {
      envelopeErrors.push('checksum: must be a string when present');
    } else if (typeof content.checksum === 'string') {
      storedChecksum = content.checksum;
    }
  } else {
    envelopeErrors.push('root: must be an object or array');
  }

  // ── Checksum verification ─────────────────────────────────────────────────
  let checksumMismatch = false;
  if (rawRules !== undefined && storedChecksum !== undefined) {
    const expected = createHash('sha256').update(JSON.stringify(rawRules)).digest('hex');
    checksumMismatch = storedChecksum !== expected;
    if (checksumMismatch) {
      envelopeErrors.push(`checksum mismatch: stored=${storedChecksum.slice(0, 12)}… expected=${expected.slice(0, 12)}…`);
    }
  }

  // ── Per-entry validation ──────────────────────────────────────────────────
  const entryErrors = [];
  if (rawRules !== undefined) {
    for (let i = 0; i < rawRules.length; i++) {
      const errors = validateRule(rawRules[i], i);
      if (errors.length > 0) entryErrors.push({ index: i, errors });
    }
  }

  const valid = envelopeErrors.length === 0 && entryErrors.length === 0;
  const count = rawRules?.length ?? 0;
  const skipped = entryErrors.length;

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          store: storePath,
          found: true,
          valid,
          version,
          isLegacy,
          count,
          skipped,
          checksumMismatch,
          envelopeErrors,
          entryErrors,
        },
        null,
        2,
      ),
    );
    if (!valid) process.exit(1);
    return;
  }

  console.log(`Auto-permits store: ${storePath}`);
  if (isLegacy) console.log('  Format: legacy flat-array (will be migrated on next save)');
  console.log(`  Version: ${version}  Rules: ${count}`);

  if (envelopeErrors.length > 0) {
    console.error('\nEnvelope errors:');
    for (const e of envelopeErrors) console.error(`  ✗ ${e}`);
  }
  if (entryErrors.length > 0) {
    console.error(`\nEntry errors (${entryErrors.length} invalid rule(s)):`);
    for (const { index, errors } of entryErrors) {
      console.error(`  [${index}]`);
      for (const e of errors) console.error(`    ✗ ${e}`);
    }
  }
  if (valid) {
    console.log('\n  ✓ Store is valid.');
  } else {
    console.error(`\n  ✗ Validation failed.`);
    process.exit(1);
  }
}

/**
 * Tests which stored auto-permit rules would match a given command string.
 *
 * Normalises the input command (shell-aware tokenisation) and tests it against
 * every rule's compiled pattern.  Reports all matching rules so operators can
 * audit overlapping permit coverage.
 *
 * @param {string[]} rawArgs  Argv slice after the `test` subcommand token.
 */
function cmdTest(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const storePath = resolveStorePath(parsed);
  const jsonMode = parsed.flags.has('json');

  const command = parsed.positional[0];
  if (!command) {
    console.error('Error: a command string is required.');
    console.error('Usage: auto-permits test <command> [--json] [--store <path>]');
    process.exit(1);
  }

  // Join any additional positional args (command may contain spaces when
  // passed without quoting via "npm run test-auto-permit -- git commit -m fix").
  const fullCommand = parsed.positional.join(' ');
  const normalized = normalizeCommandStr(fullCommand);

  const { rules, found } = loadStore(storePath);

  if (jsonMode) {
    if (!found) {
      console.log(JSON.stringify({ store: storePath, found: false, command: fullCommand, normalized, matches: [] }, null, 2));
      return;
    }
    const matches = matchAllRules(rules, normalized);
    console.log(JSON.stringify({ store: storePath, found: true, command: fullCommand, normalized, matches }, null, 2));
    return;
  }

  console.log(`Auto-permits store: ${storePath}`);
  console.log(`Command:    ${fullCommand}`);
  console.log(`Normalized: ${normalized}`);
  console.log('');

  if (!found) {
    console.log('Store file not found — no auto-permits configured.');
    return;
  }

  if (rules.length === 0) {
    console.log('No auto-permits in store — no match.');
    return;
  }

  const matches = matchAllRules(rules, normalized);
  if (matches.length === 0) {
    console.log('No matching auto-permit rules.');
    return;
  }

  console.log(`${matches.length} matching rule(s):\n`);
  for (const { index, rule } of matches) {
    const date = formatDate(rule);
    const age = formatAge(rule);
    const by = typeof rule.created_by === 'string' ? ` by ${rule.created_by}` : '';
    const ageSuffix = age ? `  (${age})` : '';
    console.log(`  [${index}] ${rule.pattern ?? '(no pattern)'}`);
    console.log(`      method: ${rule.method ?? '(unknown)'}  created: ${date}${by}${ageSuffix}`);
    if (typeof rule.intentHint === 'string') {
      console.log(`      intent: ${rule.intentHint}`);
    }
  }
  console.log('');
}

/**
 * Removes a single auto-permit from the store.
 *
 * The first positional argument is the selector (0-based index or exact
 * pattern string).  With `--dry-run` the removal is described but the store
 * file is not modified.  Without `--yes` the user is prompted to confirm.
 *
 * Atomically saves the updated rules with an incremented version number to
 * maintain monotonic store versions.
 *
 * @param {string[]} rawArgs  Argv slice after the `remove` subcommand token.
 */
async function cmdRemove(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const storePath = resolveStorePath(parsed);
  const dryRun = parsed.flags.has('dry-run');
  const skipConfirm = parsed.flags.has('yes');

  const selector = parsed.positional[0];
  if (!selector) {
    console.error('Error: a selector (index or pattern) is required.');
    console.error('Usage: auto-permits remove <index|pattern> [--dry-run] [--yes] [--store <path>]');
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

  console.log(`About to remove auto-permit [${index}]: ${pattern}`);

  if (dryRun) {
    console.log('(dry-run — store was not modified)');
    return;
  }

  if (!skipConfirm) {
    const confirmed = await askConfirmation('Continue?');
    if (!confirmed) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const updated = rules.filter((_, i) => i !== index);
  saveStore(storePath, updated, version + 1);
  console.log(`Removed. Store now contains ${updated.length} auto-permit(s).`);
}

/**
 * Revokes a single auto-permit by numeric index.
 *
 * Unlike `remove`, this command:
 *   - Accepts only a 0-based integer index (not a pattern string).
 *   - Does not prompt for confirmation — the explicit index is intent enough.
 *   - Prints a pretty summary of the revoked rule (creation date, origin).
 *
 * Atomically saves the updated rules with an incremented version number.
 *
 * @param {string[]} rawArgs  Argv slice after the `revoke` subcommand token.
 */
function cmdRevoke(rawArgs) {
  const parsed = parseArgs(rawArgs);
  const storePath = resolveStorePath(parsed);

  const selector = parsed.positional[0];
  if (!selector) {
    console.error('Error: an index is required.');
    console.error('Usage: auto-permits revoke <index> [--store <path>]');
    process.exit(1);
  }

  // Validate that the selector is a non-negative integer.
  const idx = Number(selector);
  if (!Number.isInteger(idx) || idx < 0 || String(idx) !== selector) {
    console.error(`Error: invalid index "${selector}" — must be a non-negative integer.`);
    console.error('Usage: auto-permits revoke <index> [--store <path>]');
    process.exit(1);
  }

  const { rules, version, found } = loadStore(storePath);

  if (!found) {
    console.error(`Error: store file not found: ${storePath}`);
    process.exit(1);
  }

  if (idx >= rules.length) {
    console.error(
      `Error: index ${idx} is out of range — store contains ${rules.length} rule(s) (valid indices: 0–${rules.length - 1}).`,
    );
    process.exit(1);
  }

  const rule = rules[idx];
  const pattern =
    rule != null && typeof rule === 'object' ? (rule.pattern ?? '(no pattern)') : '(invalid)';
  const date = rule != null && typeof rule === 'object' ? formatDate(rule) : '(unknown)';
  const origin =
    rule != null && typeof rule === 'object'
      ? (rule.originalCommand ?? rule.derived_from ?? '(unknown)')
      : '(unknown)';
  const by =
    rule != null && typeof rule === 'object' && typeof rule.created_by === 'string'
      ? rule.created_by
      : null;

  console.log(`Revoking auto-permit [${idx}]:`);
  console.log(`  Pattern:  ${pattern}`);
  console.log(`  Created:  ${date}`);
  console.log(`  Origin:   ${origin}`);
  if (by !== null) {
    console.log(`  By:       ${by}`);
  }

  const updated = rules.filter((_, i) => i !== idx);
  saveStore(storePath, updated, version + 1);

  console.log(`\nRevoked. Store now contains ${updated.length} auto-permit(s). (version ${version + 1})`);
}

// ── Usage ─────────────────────────────────────────────────────────────────────

function printUsage() {
  console.error('Usage: auto-permits <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error(
    '  list      [--json] [--store <path>]                           List all auto-permits with metadata',
  );
  console.error(
    '  show      <index|pattern> [--json] [--store <path>]           Show a single permit in detail',
  );
  console.error(
    '  validate  [--json] [--store <path>]                           Validate store JSON syntax and schema',
  );
  console.error(
    '  test      <command> [--json] [--store <path>]                 Test which rules match a command',
  );
  console.error(
    '  remove    <index|pattern> [--dry-run] [--yes] [--store <path>]  Remove a permit (prompts to confirm)',
  );
  console.error(
    '  revoke    <index> [--store <path>]                               Revoke a permit by index (no prompt)',
  );
  console.error('');
  console.error('Selector (list, show, remove):');
  console.error('  <index>    0-based position in the rules list (e.g. 0, 1, 2)');
  console.error('  <pattern>  Exact pattern string (e.g. "git commit *")');
  console.error('');
  console.error('Options:');
  console.error('  --json            Output in machine-readable JSON format');
  console.error('  --dry-run         Print what would be removed without writing (remove)');
  console.error('  --yes, -y         Skip confirmation prompt (remove)');
  console.error('  --store <path>    Override the auto-permit store file path');
  console.error('');
  console.error('Environment:');
  console.error('  CLAWTHORITY_AUTO_PERMIT_STORE   Overrides the default store path');
  console.error('                                  (data/auto-permits.json)');
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [, , command, ...rest] = process.argv;

(async () => {
  switch (command) {
    case 'list':
      cmdList(rest);
      break;
    case 'show':
      cmdShow(rest);
      break;
    case 'validate':
      cmdValidate(rest);
      break;
    case 'test':
      cmdTest(rest);
      break;
    case 'remove':
      await cmdRemove(rest);
      break;
    case 'revoke':
      cmdRevoke(rest);
      break;
    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
})().catch((err) => {
  console.error(`[auto-permits] Fatal: ${err.message}`);
  process.exit(1);
});

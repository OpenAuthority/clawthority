/**
 * Action normalization registry.
 *
 * Provides deterministic mapping from tool names to semantic action classes
 * with associated risk levels and HITL modes. Unknown tools fail closed to
 * `unknown_sensitive_action` with critical risk.
 *
 * Also exports `sortedJsonStringify` — the canonical serialiser for
 * deterministic SHA-256 hashes over `Record<string, unknown>` payloads.
 */

import { REGISTRY } from '@openclaw/action-registry';
import type {
  RiskLevel,
  HitlModeNorm,
  IntentGroup,
  ActionRegistryEntry,
} from '@openclaw/action-registry';

// Re-export types from the shared registry package for backward compatibility.
export type { RiskLevel, HitlModeNorm, IntentGroup, ActionRegistryEntry };

/** Result of normalizing a tool call. */
export interface NormalizedAction {
  /** Resolved semantic action class. */
  action_class: string;
  /** Effective risk level after parameter-level reclassification. */
  risk: RiskLevel;
  /** Effective HITL mode for this action. */
  hitl_mode: HitlModeNorm;
  /** Extracted target resource (file path, URL, email address, etc.). */
  target: string;
  /** Intent group for broader policy targeting, if applicable. */
  intent_group?: IntentGroup;
}

// ---------------------------------------------------------------------------
// Internal alias index — built once at module load for O(1) lookup
// ---------------------------------------------------------------------------

const ALIAS_INDEX = new Map<string, ActionRegistryEntry>();
for (const entry of REGISTRY) {
  for (const alias of entry.aliases) {
    ALIAS_INDEX.set(alias, entry);
  }
}

const UNKNOWN_ENTRY = REGISTRY[REGISTRY.length - 1] as ActionRegistryEntry;

// ---------------------------------------------------------------------------
// Shell metacharacter detection
// ---------------------------------------------------------------------------

const SHELL_METACHAR_RE = /[;|&><`$(){}[\]\\]/;

function containsShellMetachars(value: string): boolean {
  return SHELL_METACHAR_RE.test(value);
}

function hasShellMetacharsInParams(params: Record<string, unknown>): boolean {
  for (const val of Object.values(params)) {
    if (typeof val === 'string' && containsShellMetachars(val)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Target extraction
// ---------------------------------------------------------------------------

/**
 * Generic fallback param keys inspected when no per-class override exists.
 * Checked in priority order — first non-empty string wins.
 */
const TARGET_PARAM_KEYS = [
  'command',
  'cmd',
  'script',
  'file_path',
  'path',
  'file',
  'repo_url',
  'package_name',
  'query',
  'input',
  'args',
  'url',
  'destination',
  'to',
  'recipient',
  'email',
] as const;

/**
 * Per-action-class ordered param key lists for typed target extraction.
 * Each list is self-contained — it includes all generic keys relevant to that
 * class. When an action class has an entry here it is used in full; the
 * generic TARGET_PARAM_KEYS fallback is not consulted.
 */
const TARGET_KEYS_BY_CLASS: Readonly<Record<string, readonly string[]>> = {
  // Filesystem classes: typed `file_path` field takes priority over generic `path`/`file`.
  'filesystem.read':   ['file_path', 'path', 'file'],
  'filesystem.write':  ['file_path', 'path', 'file', 'destination', 'url', 'to', 'recipient', 'email'],
  'filesystem.delete': ['file_path', 'path', 'file'],
  'filesystem.list':   ['file_path', 'path', 'file'],
  // System read operations identify the target by variable name or info key.
  'system.read':       ['variable_name', 'name', 'key'],
  // VCS read operations (status, log, diff) target a file path or branch/ref.
  'vcs.read':          ['path', 'file_path', 'branch', 'ref', 'revision'],
  // VCS write operations (stage, commit) target a file path or working directory.
  'vcs.write':         ['path', 'file_path', 'working_dir'],
  // Remote VCS operations carry the target repository as `repo_url`.
  'vcs.remote':        ['repo_url', 'url', 'remote_url', 'remote'],
  // Package installation operations identify the target via `package_name`.
  'package.install':   ['package_name', 'package', 'name'],
  // Package run operations identify the target script name.
  'package.run':       ['script', 'script_name', 'name', 'package_name'],
  // Package read operations optionally filter by `package_name`.
  'package.read':      ['package_name', 'package', 'name'],
  // Build operations identify the target by working directory or specific file/target.
  'build.compile':     ['target', 'path', 'file_path', 'working_dir'],
  'build.test':        ['target', 'path', 'working_dir'],
  'build.lint':        ['target', 'path', 'file_path', 'working_dir'],
  // Archive operations: create/extract use output path; read uses archive path.
  'archive.create':    ['output_path', 'destination', 'archive_path', 'path', 'file_path'],
  'archive.extract':   ['destination', 'output_dir', 'archive_path', 'path', 'file_path'],
  'archive.read':      ['archive_path', 'path', 'file_path'],
  // Shell execution: the command string is the target for pattern derivation
  // and auto-permit matching. `command` is the canonical param name used by
  // bash/shell tools; `cmd` and `script` are common aliases.
  'shell.exec':        ['command', 'cmd', 'script'],
  // Code execution: the source code or script text is the semantic target.
  'code.execute':      ['code', 'script', 'command'],
};

/**
 * Sanitizes a command string for telemetry by redacting common credential
 * patterns, then truncates to the first 40 characters.
 *
 * Redacted patterns:
 *   - `$VAR` / `${VAR}` references to credential-named environment variables
 *   - `key=value`, `token=value`, `password=value` inline assignments
 *   - `Bearer <token>` authorization headers
 */
export function sanitizeCommandPrefix(cmd: string): string {
  const sanitized = cmd
    // $VAR and ${VAR} for credential-named env vars
    .replace(
      /\$\{?(?:AWS|GCP|GOOGLE|AZURE|GITHUB|GITLAB|STRIPE|OPENAI|ANTHROPIC|HEROKU|TWILIO|SENDGRID|SLACK|DISCORD|TELEGRAM|NPM|DOCKER|KUBE|VAULT|CIRCLECI|TRAVIS|DATADOG)_[A-Z0-9_]+\}?/g,
      '[REDACTED]',
    )
    .replace(
      /\$\{?[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|PASS|CREDENTIAL|CREDENTIALS)\}?/g,
      '[REDACTED]',
    )
    // key=value / token=value / password=value patterns
    .replace(
      /\b(?:token|key|secret|password|passwd|pass|api_?key|auth(?:_?token)?|credential)\s*[=:]\s*\S+/gi,
      (m) => m.replace(/[=:]\s*\S+$/, '=[REDACTED]'),
    )
    // Bearer <token>
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]');
  return sanitized.slice(0, 40);
}

function extractTarget(actionClass: string, params: Record<string, unknown>): string {
  const keys = TARGET_KEYS_BY_CLASS[actionClass] ?? TARGET_PARAM_KEYS;
  for (const key of keys) {
    const val = params[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the registry entry for a tool name using case-insensitive alias
 * matching. Always returns a valid entry — unknown tools return the
 * `unknown_sensitive_action` entry (fail closed).
 */
export function getRegistryEntry(toolName: string): ActionRegistryEntry {
  const key = toolName.toLowerCase();
  return ALIAS_INDEX.get(key) ?? UNKNOWN_ENTRY;
}

/**
 * Maps a tool name to its canonical action class string.
 * Case-insensitive; unknown tools resolve to `'unknown_sensitive_action'`.
 */
export function normalizeActionClass(toolName: string): string {
  return getRegistryEntry(toolName).action_class;
}

/**
 * Fully normalizes a tool call to a `NormalizedAction`.
 *
 * Post-lookup reclassification rules (applied in order):
 *   1. `filesystem.write` with a URL target → reclassified to `web.post`
 *   2. `filesystem.write` with an email address target (contains `@`) →
 *      reclassified to `communication.external.send`
 *   3. Any action class where a param value contains shell metacharacters
 *      → risk raised to `critical`
 *
 * @param toolName  Name of the tool being invoked (case-insensitive).
 * @param params    Tool call parameters used for target extraction and
 *                  parameter-level reclassification.
 */
export function normalize_action(
  toolName: string,
  params: Record<string, unknown> = {},
): NormalizedAction {
  const entry = getRegistryEntry(toolName);

  let action_class = entry.action_class;
  let risk: RiskLevel = entry.default_risk;
  let hitl_mode: HitlModeNorm = entry.default_hitl_mode;
  let intent_group: IntentGroup | undefined = entry.intent_group;
  const target = extractTarget(entry.action_class, params);

  // Rule 1: filesystem.write with a URL target → web.post
  if (
    action_class === 'filesystem.write' &&
    (target.startsWith('http://') || target.startsWith('https://'))
  ) {
    const webPostEntry = ALIAS_INDEX.get('http_post') ?? UNKNOWN_ENTRY;
    action_class = webPostEntry.action_class;
    risk = webPostEntry.default_risk;
  }

  // Rule 2: filesystem.write with an email address target → communication.external.send
  if (action_class === 'filesystem.write' && target.includes('@')) {
    action_class = 'communication.external.send';
    risk = 'high';
  }

  // Rule 3: Shell metacharacter detection → critical risk
  if (hasShellMetacharsInParams(params)) {
    risk = 'critical';
  }

  return {
    action_class,
    risk,
    hitl_mode,
    target,
    ...(intent_group !== undefined && { intent_group }),
  };
}

// ---------------------------------------------------------------------------
// sortedJsonStringify — canonical serialiser for deterministic SHA-256 hashes
// ---------------------------------------------------------------------------

/**
 * Recursively serialises a value to JSON with object keys sorted
 * alphabetically at every nesting level.
 *
 * Use this instead of `JSON.stringify` whenever computing a deterministic
 * SHA-256 hash over a `Record<string, unknown>` payload so the hash domain
 * is unambiguous regardless of key insertion order.
 */
export function sortedJsonStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return '[' + value.map(sortedJsonStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const pairs = Object.keys(obj)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + sortedJsonStringify(obj[k]));
  return '{' + pairs.join(',') + '}';
}

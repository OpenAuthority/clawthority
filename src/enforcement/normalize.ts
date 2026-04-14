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

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type HitlModeNorm = 'none' | 'per_request' | 'session_approval';

/** A single entry in the action normalization registry. */
export interface ActionRegistryEntry {
  /** Canonical dot-separated action class (e.g. 'filesystem.read'). */
  readonly action_class: string;
  /** Default risk level before parameter-level reclassification. */
  readonly default_risk: RiskLevel;
  /** Default HITL mode for this action class. */
  readonly default_hitl_mode: HitlModeNorm;
  /**
   * Lowercase tool name aliases that map to this action class.
   * All stored in lowercase; matching is case-insensitive.
   */
  readonly aliases: readonly string[];
}

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
}

// ---------------------------------------------------------------------------
// Registry — exactly 17 entries, aliases stored lowercase
// ---------------------------------------------------------------------------

const REGISTRY: readonly ActionRegistryEntry[] = [
  {
    action_class: 'filesystem.read',
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'read_file',
      'readfile',
      'read_files',
      'cat_file',
      'view_file',
      'open_file',
      'get_file_contents',
    ],
  },
  {
    action_class: 'filesystem.write',
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'write_file',
      'writefile',
      'create_file',
      'save_file',
      'update_file',
      'edit_file',
      'patch_file',
    ],
  },
  {
    action_class: 'filesystem.delete',
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'delete_file',
      'deletefile',
      'remove_file',
      'rm_file',
      'unlink_file',
    ],
  },
  {
    action_class: 'filesystem.list',
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'list_files',
      'listfiles',
      'list_directory',
      'list_dir',
      'read_directory',
      'ls',
    ],
  },
  {
    action_class: 'web.fetch',
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'fetch',
      'http_get',
      'web_fetch',
      'get_url',
      'fetch_url',
      'http_request',
    ],
  },
  {
    action_class: 'web.post',
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'http_post',
      'post_url',
      'web_post',
      'post_request',
      'submit_form',
    ],
  },
  {
    action_class: 'shell.exec',
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'bash',
      'shell_exec',
      'run_command',
      'execute_command',
      'run_terminal_cmd',
      'terminal_exec',
      'cmd',
    ],
  },
  {
    action_class: 'communication.email',
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'send_email',
      'email_send',
      'send_mail',
      'compose_email',
      'email',
    ],
  },
  {
    action_class: 'communication.slack',
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'send_slack',
      'slack_message',
      'slack_send',
      'post_slack',
    ],
  },
  {
    action_class: 'communication.webhook',
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'call_webhook',
      'webhook',
      'trigger_webhook',
      'post_webhook',
    ],
  },
  {
    action_class: 'memory.read',
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'memory_get',
      'read_memory',
      'get_memory',
      'recall',
      'retrieve_memory',
    ],
  },
  {
    action_class: 'memory.write',
    default_risk: 'medium',
    default_hitl_mode: 'none',
    aliases: [
      'memory_set',
      'write_memory',
      'set_memory',
      'store_memory',
      'save_memory',
      'remember',
    ],
  },
  {
    action_class: 'credential.read',
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'read_secret',
      'get_secret',
      'get_credential',
      'retrieve_secret',
      'read_credential',
    ],
  },
  {
    action_class: 'credential.write',
    default_risk: 'critical',
    default_hitl_mode: 'per_request',
    aliases: [
      'write_secret',
      'set_secret',
      'set_credential',
      'store_secret',
      'create_secret',
    ],
  },
  {
    action_class: 'code.execute',
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'run_code',
      'execute_code',
      'eval_code',
      'python',
      'javascript',
      'node_exec',
      'code_runner',
    ],
  },
  {
    action_class: 'payment.initiate',
    default_risk: 'critical',
    default_hitl_mode: 'per_request',
    aliases: [
      'pay',
      'payment',
      'initiate_payment',
      'create_payment',
      'charge',
      'stripe_payment',
    ],
  },
  {
    action_class: 'unknown_sensitive_action',
    default_risk: 'critical',
    default_hitl_mode: 'per_request',
    aliases: [],
  },
] as const;

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

/** Ordered list of param keys inspected when extracting the target resource. */
const TARGET_PARAM_KEYS = [
  'path',
  'file',
  'url',
  'destination',
  'to',
  'recipient',
  'email',
] as const;

function extractTarget(params: Record<string, unknown>): string {
  for (const key of TARGET_PARAM_KEYS) {
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
  const hitl_mode: HitlModeNorm = entry.default_hitl_mode;
  const target = extractTarget(params);

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

  return { action_class, risk, hitl_mode, target };
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

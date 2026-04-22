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
export type IntentGroup =
  | 'destructive_fs'
  | 'external_send'
  | 'data_exfiltration'
  | 'credential_access'
  | 'payment'
  | 'web_access';

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
  /** Optional intent group for broader policy targeting. */
  readonly intent_group?: IntentGroup;
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
  /** Intent group for broader policy targeting, if applicable. */
  intent_group?: IntentGroup;
}

// ---------------------------------------------------------------------------
// Registry — 20 entries, aliases stored lowercase
// ---------------------------------------------------------------------------

const REGISTRY: readonly ActionRegistryEntry[] = [
  {
    action_class: 'filesystem.read',
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'read',
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
      'write',
      'edit',
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
      'rm',
      'rm_rf',
      'unlink',
      'delete',
      'remove',
      'move_to_trash',
      'trash',
      'shred',
      'rmdir',
      'format',
      'empty_trash',
      'purge',
    ],
    intent_group: 'destructive_fs',
  },
  {
    action_class: 'filesystem.list',
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'list',
      'list_files',
      'listfiles',
      'list_directory',
      'list_dir',
      'read_directory',
      'ls',
    ],
  },
  {
    action_class: 'web.search',
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'web_search',
      'google_search',
      'bing_search',
      'duckduckgo_search',
      'ddg_search',
      'search_web',
      'web_research',
      'news_search',
    ],
  },
  {
    action_class: 'web.fetch',
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'fetch',
      'browser',
      'http_get',
      'web_fetch',
      'get_url',
      'fetch_url',
      'http_request',
      'curl',
      'wget',
      'download_url',
      'http_head',
      'head_url',
      'http_options',
    ],
    intent_group: 'data_exfiltration',
  },
  {
    action_class: 'browser.scrape',
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'scrape_page',
      'extract_page',
      'read_url',
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
      'http_put',
      'put_url',
      'web_put',
      'put_request',
      'http_patch',
      'patch_url',
      'web_patch',
      'patch_request',
    ],
    intent_group: 'web_access',
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
    intent_group: 'external_send',
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
    intent_group: 'external_send',
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
    intent_group: 'external_send',
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
    intent_group: 'credential_access',
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
    intent_group: 'credential_access',
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
    intent_group: 'payment',
  },
  {
    action_class: 'vcs.write',
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'git_add',
      'git-add',
      'git.add',
      'stage_file',
      'stage_files',
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

/**
 * Leading destructive commands we recognise inside a shell `command` param.
 * Matches at the start of the command string, optionally preceded by `sudo`.
 * Kept conservative to avoid false positives — only real Unix destructive
 * commands, not English words like `remove` or `purge`.
 */
const DESTRUCTIVE_SHELL_CMD_RE =
  /^\s*(?:sudo\s+)?(?:rm|rmdir|unlink|shred|trash-put|trash)\b/i;

/** Tool names that are generic shell-execution wrappers. */
const SHELL_WRAPPER_TOOL_NAMES = new Set<string>([
  'exec',
  'bash',
  'shell_exec',
  'run_command',
  'execute_command',
  'run_terminal_cmd',
  'terminal_exec',
  'cmd',
  'sh',
  'zsh',
]);

/**
 * Well-known credential file paths. Conservative — only paths where the
 * file contents are almost certainly secret. Matching is case-insensitive
 * and works against absolute paths, `~`-prefixed paths, and paths embedded
 * inside longer shell command strings. Public counterparts (`.pub` files,
 * `known_hosts`, `authorized_keys`) are explicitly NOT matched.
 */
const CREDENTIAL_PATH_PATTERNS: readonly string[] = [
  // AWS
  String.raw`\.aws/credentials\b`,
  String.raw`\.aws/config\b`,
  // SSH private keys — anchor on common algorithm names, exclude .pub
  String.raw`\.ssh/id_(?:rsa|ed25519|ecdsa|dsa)\b(?!\.pub)`,
  String.raw`\.ssh/[a-z0-9_-]+_(?:rsa|ed25519|ecdsa|dsa)\b(?!\.pub)`,
  // Kubernetes / Docker
  String.raw`\.kube/config\b`,
  String.raw`\.docker/config\.json\b`,
  // GCP application default credentials
  String.raw`\.config/gcloud/application_default_credentials\.json\b`,
  String.raw`\.config/gcloud/legacy_credentials\b`,
  // Generic home-directory credentials
  String.raw`\.netrc\b`,
  String.raw`\.pgpass\b`,
  String.raw`\.npmrc\b`,
  String.raw`\.gnupg(?:/|\b)`,
  // Dotenv files: .env, .env.local, .env.production, etc.
  String.raw`(?:^|[\s"'=/])\.env(?:\.[a-z0-9_-]+)?(?![a-z0-9_])`,
  // /etc/shadow
  String.raw`/etc/shadow\b`,
];
/**
 * Optional extra credential-path patterns supplied by operators via the
 * `CLAWTHORITY_CREDENTIAL_PATHS` environment variable. Format: a
 * comma-separated list of regex source strings. Each entry is compiled
 * once at module load and ORed with the built-in patterns above.
 *
 * Example:
 *   CLAWTHORITY_CREDENTIAL_PATHS='\\.company/secrets\\b,/var/run/my-secrets/\\w+'
 *
 * Invalid regex sources log a warning and are skipped; the rest of the
 * list is still loaded. Keep patterns narrow — matching is case-insensitive
 * and searches anywhere in the `target` or `command` string, so a loose
 * pattern like `password` will produce false positives on any tool call
 * that happens to mention the word.
 */
function loadExtraCredentialPathPatterns(): string[] {
  const raw = process.env['CLAWTHORITY_CREDENTIAL_PATHS'];
  if (raw === undefined || raw.trim() === '') return [];
  const patterns: string[] = [];
  for (const entry of raw.split(',')) {
    const source = entry.trim();
    if (source === '') continue;
    try {
      // Compile-test each entry so a syntactically broken pattern cannot
      // take down the combined regex below.
      new RegExp(source);
      patterns.push(source);
    } catch (err) {
      console.warn(
        `[clawthority] CLAWTHORITY_CREDENTIAL_PATHS skipping invalid pattern ${JSON.stringify(source)}: ${(err as Error).message}`,
      );
    }
  }
  return patterns;
}

const CREDENTIAL_PATH_RE = new RegExp(
  [...CREDENTIAL_PATH_PATTERNS, ...loadExtraCredentialPathPatterns()].join('|'),
  'i',
);

/**
 * Leading commands that indicate a write/copy into the target path (when the
 * target is a credential path, this flips Rule 5 to `credential.write`).
 */
const CREDENTIAL_WRITE_CMD_RE =
  /^\s*(?:sudo\s+)?(?:cp|mv|scp|install|rsync|ln)\b/i;

/**
 * Shell output redirect (`>`, `>>`) — flips Rule 5 to credential.write.
 * Excludes fd redirects like `2>&1` by requiring the `>` to be preceded
 * by whitespace or start-of-string and not followed by `&`.
 */
const SHELL_REDIRECT_RE = /(?:^|\s)>{1,2}(?!&)/;

/**
 * Leading CLI invocations that emit credentials without touching a file path.
 * Powers Rule 6. These are commands that interact with a secret store or
 * identity provider and return the secret material on stdout, so they should
 * be classified as `credential.read` regardless of how the host wraps them.
 *
 * Kept to well-known, unambiguous subcommands to avoid false positives on
 * generic tool invocations (e.g. `aws s3 ls` must NOT match).
 */
const CREDENTIAL_CLI_PATTERNS: readonly RegExp[] = [
  // AWS STS / Secrets Manager / SSM (SecureString with decryption)
  /^\s*(?:sudo\s+)?aws\s+sts\s+(?:get-session-token|get-caller-identity|assume-role(?:-with-(?:web-identity|saml))?|get-federation-token)\b/i,
  /^\s*(?:sudo\s+)?aws\s+configure\s+get\b/i,
  /^\s*(?:sudo\s+)?aws\s+secretsmanager\s+get-secret-value\b/i,
  /^\s*(?:sudo\s+)?aws\s+ssm\s+get-parameters?\b[^|;&<>]*--with-decryption\b/i,
  // GitHub CLI
  /^\s*(?:sudo\s+)?gh\s+auth\s+(?:token|status\s+.*--show-token)\b/i,
  // Google Cloud
  /^\s*(?:sudo\s+)?gcloud\s+auth\s+(?:print-access-token|print-identity-token|application-default\s+print-access-token)\b/i,
  // Azure
  /^\s*(?:sudo\s+)?az\s+account\s+get-access-token\b/i,
  // HashiCorp Vault
  /^\s*(?:sudo\s+)?vault\s+(?:kv\s+get|read|token\s+lookup|print\s+token|login)\b/i,
  // Kubernetes — reading secrets or raw kubeconfig
  /^\s*(?:sudo\s+)?kubectl\s+get\s+secret(?:s)?\b/i,
  /^\s*(?:sudo\s+)?kubectl\s+config\s+view\b[^|;&<>]*--raw\b/i,
  // 1Password CLI
  /^\s*(?:sudo\s+)?op\s+(?:read|item\s+get)\b/i,
  // pass (Unix password manager)
  /^\s*(?:sudo\s+)?pass\s+show\b/i,
  // Doppler
  /^\s*(?:sudo\s+)?doppler\s+secrets\s+get\b/i,
  // Heroku
  /^\s*(?:sudo\s+)?heroku\s+config:get\b/i,
];

/**
 * Detects shell commands that read credentials from environment variables.
 * Powers Rule 8. Covers the common exfiltration patterns:
 *
 *   - `echo $AWS_SECRET_ACCESS_KEY` / `echo ${OPENAI_API_KEY}`
 *   - `printenv GITHUB_TOKEN`
 *   - `env | grep -i token` (and variants)
 *   - `cat /proc/<pid>/environ`
 *
 * "Credential-named" variables match either a known cloud-vendor prefix
 * (AWS_*, GITHUB_*, OPENAI_*, ...) or a suffix naming the secret material
 * (_TOKEN, _KEY, _SECRET, _PASSWORD, _CREDENTIAL[S]). Names like `$HOME` or
 * `$PATH` deliberately do NOT match.
 */
const CRED_VAR_NAME_SOURCE = String.raw`(?:(?:AWS|GCP|GOOGLE|AZURE|GITHUB|GITLAB|STRIPE|OPENAI|ANTHROPIC|HEROKU|TWILIO|SENDGRID|SLACK|DISCORD|TELEGRAM|NPM|DOCKER|KUBE|VAULT|CIRCLECI|TRAVIS|DATADOG)_[A-Z0-9_]+|[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|PASS|CREDENTIAL|CREDENTIALS))`;

const CREDENTIAL_ENV_PATTERNS: readonly RegExp[] = [
  // $VAR or ${VAR} referenced anywhere in the command
  new RegExp(String.raw`\$\{?${CRED_VAR_NAME_SOURCE}\}?`),
  // printenv VAR
  new RegExp(
    String.raw`(?:^|[;|&])\s*(?:sudo\s+)?printenv\b[^|;&<>]*\b${CRED_VAR_NAME_SOURCE}\b`,
  ),
  // env | grep <credential-ish>
  /(?:^|[;|&])\s*(?:sudo\s+)?(?:env|printenv)\s*(?:\s+[-\w]+)*\s*\|\s*grep\b[^|;&]*?(?:token|key|secret|password|credential|api|aws|github|openai|anthropic)/i,
  // /proc/<pid>/environ — dumps the process env
  /\/proc\/[^/\s]+\/environ\b/,
];

/**
 * Detects outbound file-upload patterns in shell commands. Powers Rule 7.
 *
 * Covers the common transports agents use to exfiltrate data to an external
 * host: curl with an upload body from a file (`-F @path`, `--data @path`,
 * `--data-binary @path`, `-T path`, `--upload-file path`), and wget with
 * `--post-file=path`.
 *
 * scp / rsync are intentionally NOT matched — both have syntactically
 * ambiguous arg orders (`scp remote:/f local` is a download, `scp local
 * remote:/f` is an upload) and directional heuristics produce false
 * positives too easily. Operators who want to gate those should add
 * explicit `resource: tool` rules for `scp` / `rsync` in `data/rules.json`.
 */
const DATA_EXFIL_UPLOAD_PATTERNS: readonly RegExp[] = [
  // curl -F field=@path  OR  curl -F @path
  /\bcurl\b[^|;&<>]*\s-F\s+[^\s|;&<>]*@[^\s|;&<>]+/i,
  // curl --form (long form of -F)
  /\bcurl\b[^|;&<>]*\s--form\s+[^\s|;&<>]*@[^\s|;&<>]+/i,
  // curl -d @path / --data @path / --data-binary @path / --data-raw @path / --data-urlencode @path
  /\bcurl\b[^|;&<>]*\s(?:-d|--data|--data-binary|--data-raw|--data-urlencode)\s+@[^\s|;&<>]+/i,
  // curl -T path / --upload-file path
  /\bcurl\b[^|;&<>]*\s(?:-T|--upload-file)\s+[^\s|;&<>]+/i,
  // wget --post-file=path
  /\bwget\b[^|;&<>]*\s--post-file=[^\s|;&<>]+/i,
];

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
 *   4. Shell-wrapper tools (`exec`, `bash`, `cmd`, ...) whose `command` param
 *      begins with a destructive Unix command (`rm`, `rmdir`, `unlink`,
 *      `shred`, `trash`, optionally `sudo`-prefixed) → reclassified to
 *      `filesystem.delete`. Lets operators put `filesystem.delete` in HITL
 *      policy and have it actually fire for hosts that expose only a
 *      generic shell-exec tool (e.g. OpenClaw's `exec`).
 *   5. Any tool whose `target` or shell-wrapper `command` references a
 *      well-known credential file path (AWS creds, SSH private keys, kube
 *      config, .env*, /etc/shadow, ...) → reclassified to `credential.read`
 *      or `credential.write`. Write is picked when the starting class is
 *      already `filesystem.write`, when the command uses a shell redirect
 *      (`>`, `>>`), or when the command starts with `cp`/`mv`/`scp`/
 *      `rsync`/`install`/`ln`. Skipped when Rule 4 already reclassified to
 *      `filesystem.delete` — deleting a credential file stays a destructive
 *      fs action.
 *   6. Shell-wrapper tools invoking a credential-emitting CLI subcommand
 *      that returns the secret on stdout without touching a file path
 *      (`aws sts …`, `gh auth token`, `gcloud auth print-access-token`,
 *      `vault kv get`, `kubectl get secret`, `op read`, `pass show`,
 *      `doppler secrets get`, `heroku config:get`, `az account
 *      get-access-token`) → reclassified to `credential.read`. Skipped if
 *      Rule 4 or Rule 5 already reclassified.
 *   7. Shell-wrapper tools invoking an outbound file upload — `curl -F
 *      @path`, `curl -d @path`, `curl --data-binary @path`, `curl -T path`,
 *      `curl --upload-file path`, `wget --post-file=path` — → reclassified
 *      to `web.post` with `intent_group: 'data_exfiltration'` and `risk:
 *      'critical'`. The handler's intent-group evaluation pass lets
 *      operators gate all `data_exfiltration`-tagged calls via a single
 *      rules.json entry (or a HITL policy). Skipped when Rule 4 (destructive)
 *      or Rule 5 (credential) already reclassified, so `rm ... | curl -F
 *      @-` stays `filesystem.delete` and `curl -F @~/.aws/credentials`
 *      stays `credential.read`. scp / rsync are NOT matched — their arg
 *      order makes direction ambiguous.
 *   8. Shell-wrapper tools reading credentials from the environment —
 *      `echo $AWS_SECRET_ACCESS_KEY`, `printenv GITHUB_TOKEN`, `env |
 *      grep token`, `cat /proc/<pid>/environ` — → reclassified to
 *      `credential.read`. Skipped if Rule 4/5/6 already reclassified.
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

  // Rule 4: shell-wrapper tool + destructive command → filesystem.delete
  const toolKey = toolName.toLowerCase();
  const command = params['command'];
  const commandStr = typeof command === 'string' ? command : '';
  if (
    SHELL_WRAPPER_TOOL_NAMES.has(toolKey) &&
    commandStr !== '' &&
    DESTRUCTIVE_SHELL_CMD_RE.test(commandStr)
  ) {
    const deleteEntry = ALIAS_INDEX.get('rm') ?? UNKNOWN_ENTRY;
    action_class = deleteEntry.action_class;
    hitl_mode = deleteEntry.default_hitl_mode;
    intent_group = deleteEntry.intent_group;
    if (risk !== 'critical') risk = deleteEntry.default_risk;
  }

  // Rule 5: reference to a well-known credential path → credential.read / .write
  // Skip when Rule 4 already reclassified to filesystem.delete — a destructive
  // action on a credential file stays filesystem.delete.
  if (action_class !== 'filesystem.delete') {
    const targetHasCredPath = target !== '' && CREDENTIAL_PATH_RE.test(target);
    const commandHasCredPath = commandStr !== '' && CREDENTIAL_PATH_RE.test(commandStr);
    if (targetHasCredPath || commandHasCredPath) {
      const looksLikeWrite =
        action_class === 'filesystem.write' ||
        (commandStr !== '' &&
          (SHELL_REDIRECT_RE.test(commandStr) ||
            CREDENTIAL_WRITE_CMD_RE.test(commandStr)));
      const credAliasKey = looksLikeWrite ? 'write_secret' : 'read_secret';
      const credEntry = ALIAS_INDEX.get(credAliasKey) ?? UNKNOWN_ENTRY;
      action_class = credEntry.action_class;
      hitl_mode = credEntry.default_hitl_mode;
      intent_group = credEntry.intent_group;
      if (risk !== 'critical') risk = credEntry.default_risk;
    }
  }

  // Rule 6: shell-wrapper invoking a credential-emitting CLI subcommand →
  // credential.read. Skipped when an earlier rule already picked a more
  // specific class (filesystem.delete, credential.read/write).
  const alreadyReclassified =
    action_class === 'filesystem.delete' ||
    action_class === 'credential.read' ||
    action_class === 'credential.write';
  if (
    !alreadyReclassified &&
    SHELL_WRAPPER_TOOL_NAMES.has(toolKey) &&
    commandStr !== '' &&
    CREDENTIAL_CLI_PATTERNS.some((re) => re.test(commandStr))
  ) {
    const credEntry = ALIAS_INDEX.get('read_secret') ?? UNKNOWN_ENTRY;
    action_class = credEntry.action_class;
    hitl_mode = credEntry.default_hitl_mode;
    intent_group = credEntry.intent_group;
    if (risk !== 'critical') risk = credEntry.default_risk;
  }

  // Rule 8: shell-wrapper reading credentials from the environment →
  // credential.read. Same skip semantics as Rule 6.
  const stillUnclassifiedAfter6 =
    action_class !== 'filesystem.delete' &&
    action_class !== 'credential.read' &&
    action_class !== 'credential.write';
  if (
    stillUnclassifiedAfter6 &&
    SHELL_WRAPPER_TOOL_NAMES.has(toolKey) &&
    commandStr !== '' &&
    CREDENTIAL_ENV_PATTERNS.some((re) => re.test(commandStr))
  ) {
    const credEntry = ALIAS_INDEX.get('read_secret') ?? UNKNOWN_ENTRY;
    action_class = credEntry.action_class;
    hitl_mode = credEntry.default_hitl_mode;
    intent_group = credEntry.intent_group;
    if (risk !== 'critical') risk = credEntry.default_risk;
  }

  // Rule 7: shell-wrapper invoking an outbound file upload → web.post with
  // intent_group: 'data_exfiltration'. Skipped when an earlier rule already
  // produced a more specific class — destructive (Rule 4) or credential
  // (Rules 5/6/8) take precedence.
  const stillUnclassifiedAfter8 =
    action_class !== 'filesystem.delete' &&
    action_class !== 'credential.read' &&
    action_class !== 'credential.write';
  if (
    stillUnclassifiedAfter8 &&
    SHELL_WRAPPER_TOOL_NAMES.has(toolKey) &&
    commandStr !== '' &&
    DATA_EXFIL_UPLOAD_PATTERNS.some((re) => re.test(commandStr))
  ) {
    action_class = 'web.post';
    intent_group = 'data_exfiltration';
    risk = 'critical';
    // HITL mode follows web.post's default (per_request).
    const webPostEntry = ALIAS_INDEX.get('http_post') ?? UNKNOWN_ENTRY;
    hitl_mode = webPostEntry.default_hitl_mode;
  }

  return { action_class, risk, hitl_mode, target, ...(intent_group !== undefined && { intent_group }) };
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

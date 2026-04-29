/**
 * @openclaw/action-registry
 *
 * Single source of truth for the OpenClaw action class taxonomy.
 * Exports the frozen registry of all canonical action classes with their
 * default risk levels, HITL modes, and tool name aliases.
 *
 * Consumed by normalize.ts and the future Sidecar component.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Action class enum — frozen taxonomy (T4)
// ---------------------------------------------------------------------------

/**
 * All canonical action class strings recognized by the registry.
 * Use these constants instead of raw strings to avoid typos in policy code.
 */
export const ActionClass = {
  FilesystemRead: 'filesystem.read',
  FilesystemWrite: 'filesystem.write',
  FilesystemDelete: 'filesystem.delete',
  FilesystemList: 'filesystem.list',
  WebSearch: 'web.search',
  WebFetch: 'web.fetch',
  BrowserScrape: 'browser.scrape',
  WebPost: 'web.post',
  ShellExec: 'shell.exec',
  CommunicationEmail: 'communication.email',
  CommunicationSlack: 'communication.slack',
  CommunicationWebhook: 'communication.webhook',
  MemoryRead: 'memory.read',
  MemoryWrite: 'memory.write',
  CredentialRead: 'credential.read',
  CredentialWrite: 'credential.write',
  CredentialRotate: 'credential.rotate',
  CredentialList: 'credential.list',
  CodeExecute: 'code.execute',
  PaymentInitiate: 'payment.initiate',
  SystemRead: 'system.read',
  SystemService: 'system.service',
  PermissionsModify: 'permissions.modify',
  PermissionsElevate: 'permissions.elevate',
  ProcessSignal: 'process.signal',
  NetworkDiagnose: 'network.diagnose',
  NetworkScan: 'network.scan',
  SchedulingPersist: 'scheduling.persist',
  NetworkTransfer: 'network.transfer',
  NetworkShell: 'network.shell',
  ClusterRead: 'cluster.read',
  ClusterWrite: 'cluster.write',
  VcsRead: 'vcs.read',
  VcsWrite: 'vcs.write',
  VcsRemote: 'vcs.remote',
  PackageInstall: 'package.install',
  PackageRun: 'package.run',
  PackageRead: 'package.read',
  BuildCompile: 'build.compile',
  BuildTest: 'build.test',
  BuildLint: 'build.lint',
  ArchiveCreate: 'archive.create',
  ArchiveExtract: 'archive.extract',
  ArchiveRead: 'archive.read',
  UnknownSensitiveAction: 'unknown_sensitive_action',
} as const;

export type ActionClassValue = (typeof ActionClass)[keyof typeof ActionClass];

// ---------------------------------------------------------------------------
// Registry — 42 entries, aliases stored lowercase
// ---------------------------------------------------------------------------

export const REGISTRY: readonly ActionRegistryEntry[] = [
  {
    action_class: ActionClass.FilesystemRead,
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'read',
      'read_file',
      'readfile',
      'read_files',
      'read_files_batch',
      'cat_file',
      'view_file',
      'open_file',
      'get_file_contents',
      'find_files',
      'find_file',
      'search_files',
      'grep_files',
      'grep_file',
      'grep',
      'search_in_files',
      'check_exists',
      'exists',
      'file_exists',
      'path_exists',
      // Bare-binary aliases for read-only file utilities. All low-risk,
      // none-HITL by default — the destination is a local file and the
      // action does not modify it. `find` and `locate` are searches
      // (filesystem traversal / index query) and share the tier.
      'cat',
      'head',
      'tail',
      'less',
      'more',
      'diff',
      'find',
      'locate',
    ],
  },
  {
    action_class: ActionClass.FilesystemWrite,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'write',
      'edit',
      'apply_patch',
      'write_file',
      'writefile',
      'create_file',
      'save_file',
      'update_file',
      'edit_file',
      'patch_file',
      'make_dir',
      'mkdir',
      'create_dir',
      'create_directory',
      'copy_file',
      'copy',
      'cp',
      'duplicate_file',
      'copy_file_to',
      'move_file',
      'mv',
      'move',
      'rename_file',
      'rename',
      // Bare-binary aliases that produce or modify file content.
      // tee writes stdin to a file; touch creates an empty file or
      // updates timestamps. Both legitimately filesystem.write.
      'tee',
      'touch',
      // `install` (the BSD/GNU file-installer binary, not the package
      // manager) copies one file to another with explicit permission /
      // owner setting. Same blast-radius profile as cp.
      'install',
    ],
  },
  {
    action_class: ActionClass.FilesystemDelete,
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
    action_class: ActionClass.FilesystemList,
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
      'tree',
    ],
  },
  {
    action_class: ActionClass.WebSearch,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'web_search',
      'x_search',
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
    action_class: ActionClass.WebFetch,
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
    action_class: ActionClass.BrowserScrape,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'scrape_page',
      'extract_page',
      'read_url',
    ],
  },
  {
    action_class: ActionClass.WebPost,
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
      'http_delete',
      'delete_url',
      'web_delete',
      'delete_request',
    ],
    intent_group: 'web_access',
  },
  {
    action_class: ActionClass.ShellExec,
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
      'unsafe_admin_exec',
    ],
  },
  {
    action_class: ActionClass.CommunicationEmail,
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
    action_class: ActionClass.CommunicationSlack,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'send_slack',
      'slack_message',
      'slack_send',
      'post_slack',
      'post_message',
    ],
    intent_group: 'external_send',
  },
  {
    action_class: ActionClass.CommunicationWebhook,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'message',
      'call_webhook',
      'webhook',
      'trigger_webhook',
      'post_webhook',
      'send_notification',
    ],
    intent_group: 'external_send',
  },
  {
    action_class: ActionClass.MemoryRead,
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'memory_get',
      'memory_search',
      'read_memory',
      'get_memory',
      'recall',
      'retrieve_memory',
    ],
  },
  {
    action_class: ActionClass.MemoryWrite,
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
    action_class: ActionClass.CredentialRead,
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
    action_class: ActionClass.CredentialWrite,
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
    action_class: ActionClass.CredentialRotate,
    default_risk: 'critical',
    default_hitl_mode: 'per_request',
    aliases: [
      'rotate_secret',
      'rotate_credential',
    ],
    intent_group: 'credential_access',
  },
  {
    action_class: ActionClass.CredentialList,
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'list_secrets',
      'list_credentials',
      'list_credential_keys',
    ],
    intent_group: 'credential_access',
  },
  {
    action_class: ActionClass.CodeExecute,
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'code_execution',
      'run_code',
      'execute_code',
      'eval_code',
      'python',
      'javascript',
      'node_exec',
      'code_runner',
      'docker_run',
      'docker_exec',
      // Bare docker binary. Multi-subcommand (run / build / push / ps / exec /
      // ...) — most concerning subcommand is `docker run` which is arbitrary
      // code execution, so the bare alias inherits code.execute's high /
      // per_request tier. Explainer dispatches per-subcommand for messaging
      // detail; read-only `docker ps` inherits the conservative tier as a
      // trade-off until typed-tool wrappers split the modes.
      'docker',
    ],
  },
  {
    action_class: ActionClass.PaymentInitiate,
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
    action_class: ActionClass.SystemRead,
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'session_status',
      'sessions_list',
      'sessions_history',
      'sessions_spawn',
      'sessions_send',
      'sessions_yield',
      'subagents',
      'agents_list',
      'nodes',
      'image',
      'cron',
      'gateway',
      'get_system_info',
      'system_info',
      'get_env_var',
      'get_env',
      'read_env',
      'env_var',
      'get_hostname',
      'get_platform',
      'get_arch',
      'get_os_info',
      'uname',
      // Bare-binary aliases for read-only system-info utilities. All
      // low-risk, none-HITL — they query process / disk / memory state
      // without modifying anything. Same tier as `uname`.
      'ps',
      'top',
      'htop',
      'df',
      'du',
      'free',
      'hostname',
      'uptime',
      'lsof',
      'id',
      'whoami',
      // echo / printf are output utilities — by themselves they only write
      // to stdout. Side-effecting redirection (`echo > file`) happens at the
      // shell level and is invisible to us either way; classifying as
      // system.read avoids HITL noise on every echo while leaving the
      // redirection-write case at the unchanged shell-level posture.
      'echo',
      'printf',
    ],
  },
  {
    action_class: ActionClass.SystemService,
    default_risk: 'critical',
    default_hitl_mode: 'per_request',
    aliases: [
      'systemctl',
      'service',
      'init',
      'reboot',
      'shutdown',
      // virsh manages libvirt VM lifecycles — same operational tier as
      // systemctl: lifecycle ops on resources that other workloads depend on.
      'virsh',
      // v1.3.2 typed-tool aliases. The typed tools wrap the same binaries
      // with structured argv; the registry alias makes the typed-tool names
      // route to the same action class so policy rules targeting
      // system.service apply uniformly to bare-binary and typed-tool calls.
      'systemctl_unit_action',
    ],
  },
  {
    action_class: ActionClass.PermissionsModify,
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'chmod',
      'chown',
      'chgrp',
      'umask',
      // v1.3.2 typed-tool aliases.
      'chmod_path',
      'chown_path',
    ],
  },
  {
    action_class: ActionClass.PermissionsElevate,
    default_risk: 'critical',
    default_hitl_mode: 'per_request',
    aliases: [
      'sudo',
      'su',
      'doas',
      'passwd',
    ],
  },
  {
    action_class: ActionClass.ProcessSignal,
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'kill',
      'pkill',
      'killall',
      // v1.3.2 typed-tool aliases.
      'kill_process',
      'pkill_pattern',
    ],
  },
  {
    action_class: ActionClass.NetworkDiagnose,
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'ping',
      'traceroute',
      'nslookup',
      'dig',
      'netstat',
      'ss',
    ],
  },
  {
    action_class: ActionClass.NetworkScan,
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'nmap',
    ],
  },
  {
    action_class: ActionClass.SchedulingPersist,
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'crontab',
      'at',
      'batch',
      'atq',
      'atrm',
      // v1.3.2 typed-tool aliases. `crontab_list` is read-leaning but
      // kept on scheduling.persist for policy-targeting consistency;
      // operators can downgrade to system.read via reclassification.
      'crontab_list',
      'crontab_install_from_file',
      'crontab_remove',
    ],
  },
  {
    action_class: ActionClass.NetworkTransfer,
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'rsync',
      'scp',
      'sftp',
    ],
    intent_group: 'data_exfiltration',
  },
  {
    action_class: ActionClass.NetworkShell,
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      'ssh',
      'mosh',
      'telnet',
    ],
  },
  {
    action_class: ActionClass.ClusterRead,
    default_risk: 'low',
    default_hitl_mode: 'per_request',
    aliases: [
      // v1.3.2 typed-tool alias. Bare `kubectl` does NOT alias here —
      // see RFC-003: free-form `bash kubectl ...` cannot be parsed for
      // read-vs-write at alias level and routes to cluster.write as a
      // conservative default.
      'kubectl_get',
    ],
  },
  {
    action_class: ActionClass.ClusterWrite,
    default_risk: 'high',
    default_hitl_mode: 'per_request',
    aliases: [
      // Bare-binary fallback: free-form `bash kubectl ...` cannot be parsed
      // for read-vs-write at alias level, so we route it to the destructive
      // class as a conservative default. Typed tools (kubectl_get etc.)
      // declare cluster.read or cluster.write at the manifest level for
      // precision. See RFC-003.
      'kubectl',
      // v1.3.2 typed-tool aliases for kubectl write subcommands and
      // image-distribution operations.
      'kubectl_apply',
      'kubectl_delete',
      'kubectl_rollout',
      'docker_push',
    ],
  },
  {
    action_class: ActionClass.VcsRead,
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'git_status',
      'git-status',
      'git.status',
      'show_status',
      'git_log',
      'git-log',
      'git.log',
      'log_commits',
      'view_history',
      'git_diff',
      'git-diff',
      'git.diff',
      'view_diff',
      'show_diff',
    ],
  },
  {
    action_class: ActionClass.VcsWrite,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'git_commit',
      'git-commit',
      'git.commit',
      'commit_changes',
      'git_add',
      'git-add',
      'git.add',
      'stage_file',
      'stage_files',
      'git_merge',
      'git-merge',
      'git.merge',
      'merge_branch',
      'git_checkout',
      'git-checkout',
      'git.checkout',
      'checkout_branch',
      'switch_branch',
      'git_branch',
      'git-branch',
      'git.branch',
      'create_branch',
      'git_reset',
      'git-reset',
      'git.reset',
      'reset_head',
      'undo_commit',
    ],
  },
  {
    action_class: ActionClass.VcsRemote,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'git_clone',
      'git-clone',
      'git.clone',
      'clone_repo',
      'git_push',
      'git-push',
      'git.push',
      'push_commits',
      'git_pull',
      'git-pull',
      'git.pull',
      'pull_changes',
      'git_fetch',
      'git-fetch',
      'git.fetch',
      'fetch_remote',
    ],
  },
  {
    action_class: ActionClass.PackageInstall,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'install_package',
      'npm_install',
      'pip_install',
      'pip3_install',
      'yarn_add',
      'apt_install',
      'brew_install',
      'add_package',
      // Bare-binary aliases. Multi-subcommand binaries (install/remove/update/
      // upgrade) all share package.install's medium / per_request tier;
      // explainer dispatch per subcommand provides operator-readable detail.
      'apt',
      'apt-get',
      'yum',
      'dnf',
      'dpkg',
      'snap',
      'brew',
      'pacman',
    ],
  },
  {
    action_class: ActionClass.PackageRun,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'npm_run_script',
      'npm_run',
      'yarn_run',
      'pnpm_run',
      'run_script',
      'make_run',
    ],
  },
  {
    action_class: ActionClass.PackageRead,
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'pip_list',
      'pip3_list',
      'pip_freeze',
      'npm_list',
      'list_packages',
    ],
  },
  {
    action_class: ActionClass.BuildCompile,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'run_compiler',
      'compile',
      'build',
      'npm_run_build',
      'make',
      'tsc',
      'javac',
      'gcc',
      'cargo_build',
      'go_build',
      'mvn_compile',
      'gradle_build',
    ],
  },
  {
    action_class: ActionClass.BuildTest,
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'run_tests',
      'run_test',
      'npm_test',
      'npm_run_test',
      'yarn_test',
      'pytest',
      'jest',
      'vitest',
      'mocha',
      'go_test',
      'cargo_test',
      'mvn_test',
      'gradle_test',
    ],
  },
  {
    action_class: ActionClass.BuildLint,
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'run_linter',
      'run_formatter',
      'run_typecheck',
      'eslint',
      'prettier',
      'pylint',
      'flake8',
      'mypy',
      'cargo_clippy',
      'golangci_lint',
      'rubocop',
    ],
  },
  {
    action_class: ActionClass.ArchiveCreate,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'archive_create',
      'create_archive',
      'tar_create',
      'tar_czf',
      'tar_compress',
      'zip_create',
      'create_zip',
      'compress',
      'compress_files',
      'gzip',
      'bzip2',
      'zstd_compress',
      // Bare-binary aliases. tar / zip / xz / 7z are mode-flag driven —
      // most common invocation creates an archive, so the bare binary
      // inherits archive.create's medium / per_request tier. Flag-aware
      // detail is provided by the explainer (e.g. `tar -t` is summarised
      // as a list, even though it inherits the create-mode tier).
      'tar',
      'zip',
      'xz',
      '7z',
    ],
  },
  {
    action_class: ActionClass.ArchiveExtract,
    default_risk: 'medium',
    default_hitl_mode: 'per_request',
    aliases: [
      'archive_extract',
      'extract_archive',
      'unarchive',
      'tar_extract',
      'tar_xzf',
      'tar_decompress',
      'unzip',
      'gunzip',
      'bunzip2',
      'decompress',
      'extract_files',
      'zstd_decompress',
      // Bare-binary aliases for explicit-direction decompressors.
      'unxz',
    ],
  },
  {
    action_class: ActionClass.ArchiveRead,
    default_risk: 'low',
    default_hitl_mode: 'none',
    aliases: [
      'archive_list',
      'archive_read',
      'list_archive',
      'read_archive',
      'tar_list',
      'tar_tf',
      'zip_list',
      'list_zip',
      'inspect_archive',
      'peek_archive',
    ],
  },
  {
    action_class: ActionClass.UnknownSensitiveAction,
    default_risk: 'critical',
    default_hitl_mode: 'per_request',
    aliases: [],
  },
] as const;

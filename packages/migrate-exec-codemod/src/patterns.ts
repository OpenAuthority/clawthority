/**
 * Pattern recognition rules for the migrate-exec codemod.
 *
 * Defines the set of tool names that resolve to shell.exec and a ranked list
 * of command-level patterns that map a shell command string to a more
 * appropriate fine-grained tool and action class.
 */

// ---------------------------------------------------------------------------
// Exec tool name aliases
// ---------------------------------------------------------------------------

/**
 * Tool names that normalise to the shell.exec action class.
 * These are the canonical aliases from @openclaw/action-registry plus
 * the literal 'exec' name frequently used in legacy skills.
 */
export const EXEC_TOOL_NAMES = new Set<string>([
  'bash',
  'exec',
  'shell_exec',
  'run_command',
  'execute_command',
  'run_terminal_cmd',
  'terminal_exec',
  'cmd',
  'shell',
]);

// ---------------------------------------------------------------------------
// Suggestion types
// ---------------------------------------------------------------------------

export type RiskTier = 'low' | 'medium' | 'high';

export interface Suggestion {
  /** Recommended fine-grained tool name */
  tool: string;
  /** Canonical action class for the replacement */
  action_class: string;
  /** Risk tier of the replacement (always <= shell.exec's 'high') */
  risk_tier: RiskTier;
  /** Human-readable rationale for the replacement */
  rationale: string;
}

export interface CommandRule {
  /** Regex tested against the raw command string */
  pattern: RegExp;
  /** Short description of the matched command type */
  description: string;
  /** Suggested replacement tool + action class */
  suggestion: Suggestion;
}

// ---------------------------------------------------------------------------
// Command-to-tool mapping rules (ordered by specificity)
// ---------------------------------------------------------------------------

export const COMMAND_RULES: readonly CommandRule[] = [
  // --- VCS read ---
  {
    pattern: /^\s*git\s+status\b/,
    description: 'git status check',
    suggestion: {
      tool: 'git_status',
      action_class: 'vcs.read',
      risk_tier: 'low',
      rationale: 'git status is a non-mutating VCS read; use git_status (vcs.read, low risk)',
    },
  },
  {
    pattern: /^\s*git\s+log\b/,
    description: 'git log read',
    suggestion: {
      tool: 'git_log',
      action_class: 'vcs.read',
      risk_tier: 'low',
      rationale: 'git log is a non-mutating VCS read; use git_log (vcs.read, low risk)',
    },
  },
  {
    pattern: /^\s*git\s+diff\b/,
    description: 'git diff read',
    suggestion: {
      tool: 'git_diff',
      action_class: 'vcs.read',
      risk_tier: 'low',
      rationale: 'git diff is a non-mutating VCS read; use git_diff (vcs.read, low risk)',
    },
  },
  // --- VCS write ---
  {
    pattern: /^\s*git\s+checkout\b/,
    description: 'git checkout',
    suggestion: {
      tool: 'git_checkout',
      action_class: 'vcs.write',
      risk_tier: 'medium',
      rationale: 'git checkout modifies the working tree; use git_checkout (vcs.write, medium risk)',
    },
  },
  {
    pattern: /^\s*git\s+add\b/,
    description: 'git add',
    suggestion: {
      tool: 'git_add',
      action_class: 'vcs.write',
      risk_tier: 'medium',
      rationale: 'git add stages changes; use git_add (vcs.write, medium risk)',
    },
  },
  {
    pattern: /^\s*git\s+branch\b/,
    description: 'git branch',
    suggestion: {
      tool: 'git_branch',
      action_class: 'vcs.write',
      risk_tier: 'medium',
      rationale: 'git branch creates or lists branches; use git_branch (vcs.write, medium risk)',
    },
  },
  {
    pattern: /^\s*git\s+merge\b/,
    description: 'git merge',
    suggestion: {
      tool: 'git_merge',
      action_class: 'vcs.write',
      risk_tier: 'medium',
      rationale: 'git merge modifies history; use git_merge (vcs.write, medium risk)',
    },
  },
  // --- VCS remote ---
  {
    pattern: /^\s*git\s+push\b/,
    description: 'git push',
    suggestion: {
      tool: 'git_push',
      action_class: 'vcs.remote',
      risk_tier: 'medium',
      rationale: 'git push is a remote VCS operation; use git_push (vcs.remote, medium risk)',
    },
  },
  {
    pattern: /^\s*git\s+clone\b/,
    description: 'git clone',
    suggestion: {
      tool: 'git_clone',
      action_class: 'vcs.remote',
      risk_tier: 'medium',
      rationale: 'git clone fetches from remote; use git_clone (vcs.remote, medium risk)',
    },
  },
  // --- Filesystem list ---
  {
    pattern: /^\s*(ls|dir)(\s|$)/,
    description: 'directory listing',
    suggestion: {
      tool: 'list_dir',
      action_class: 'filesystem.list',
      risk_tier: 'low',
      rationale: 'Listing directory contents is read-only; use list_dir (filesystem.list, low risk)',
    },
  },
  {
    pattern: /^\s*find\s+/,
    description: 'file search',
    suggestion: {
      tool: 'find_files',
      action_class: 'filesystem.read',
      risk_tier: 'low',
      rationale: 'Finding files by pattern is read-only; use find_files (filesystem.read, low risk)',
    },
  },
  {
    pattern: /^\s*grep\s+/,
    description: 'grep content search',
    suggestion: {
      tool: 'grep_files',
      action_class: 'filesystem.read',
      risk_tier: 'low',
      rationale: 'Searching file contents is read-only; use grep_files (filesystem.read, low risk)',
    },
  },
  // --- Filesystem read ---
  {
    pattern: /^\s*(cat|head|tail|less|more|view)\s+/,
    description: 'file read command',
    suggestion: {
      tool: 'read_file',
      action_class: 'filesystem.read',
      risk_tier: 'low',
      rationale: 'Viewing file contents is read-only; use read_file (filesystem.read, low risk)',
    },
  },
  // --- Filesystem write ---
  {
    pattern: /^\s*(cp|copy)\s+/,
    description: 'file copy',
    suggestion: {
      tool: 'copy_file',
      action_class: 'filesystem.write',
      risk_tier: 'medium',
      rationale: 'Copying files writes to the filesystem; use copy_file (filesystem.write, medium risk)',
    },
  },
  {
    pattern: /^\s*(mv|move|rename)\s+/,
    description: 'file move/rename',
    suggestion: {
      tool: 'move_file',
      action_class: 'filesystem.write',
      risk_tier: 'medium',
      rationale: 'Moving/renaming files writes to the filesystem; use move_file (filesystem.write, medium risk)',
    },
  },
  {
    pattern: /^\s*mkdir\s+/,
    description: 'make directory',
    suggestion: {
      tool: 'make_dir',
      action_class: 'filesystem.write',
      risk_tier: 'medium',
      rationale: 'Creating directories writes to the filesystem; use make_dir (filesystem.write, medium risk)',
    },
  },
  // --- Filesystem delete ---
  {
    pattern: /^\s*(rm|del|unlink)\s+/,
    description: 'file delete',
    suggestion: {
      tool: 'delete_file',
      action_class: 'filesystem.delete',
      risk_tier: 'high',
      rationale: 'Deleting files is destructive; use delete_file (filesystem.delete, high risk) — still requires HITL',
    },
  },
  // --- Archive operations ---
  {
    pattern: /^\s*(tar\s+[^|]*-[zcj][^|]*|zip)\s+/,
    description: 'archive create',
    suggestion: {
      tool: 'archive_create',
      action_class: 'archive.create',
      risk_tier: 'medium',
      rationale: 'Creating archives is an archive write operation; use archive_create (archive.create, medium risk)',
    },
  },
  {
    pattern: /^\s*(tar\s+[^|]*-x[^|]*|unzip|gunzip|bunzip2)\s*/,
    description: 'archive extract',
    suggestion: {
      tool: 'archive_extract',
      action_class: 'archive.extract',
      risk_tier: 'medium',
      rationale: 'Extracting archives is an archive extract operation; use archive_extract (archive.extract, medium risk)',
    },
  },
  {
    pattern: /^\s*(tar\s+[^|]*-t[^|]*|unzip\s+-l|zipinfo)\s*/,
    description: 'archive list',
    suggestion: {
      tool: 'archive_read',
      action_class: 'archive.read',
      risk_tier: 'low',
      rationale: 'Listing archive contents is read-only; use archive_read (archive.read, low risk)',
    },
  },
  // --- System read ---
  {
    pattern: /^\s*(uname|hostname|sysctl|lscpu|nproc)(\s|$)/,
    description: 'system info query',
    suggestion: {
      tool: 'get_system_info',
      action_class: 'system.read',
      risk_tier: 'low',
      rationale: 'Reading system info is low-risk; use get_system_info (system.read, low risk)',
    },
  },
  {
    pattern: /^\s*(env|printenv|echo\s+\$[A-Z_][A-Z0-9_]*)(\s|$)/,
    description: 'environment variable read',
    suggestion: {
      tool: 'get_env_var',
      action_class: 'system.read',
      risk_tier: 'low',
      rationale: 'Reading env vars is low-risk; use get_env_var (system.read, low risk)',
    },
  },
  // --- Network ---
  {
    pattern: /^\s*(curl|wget|http[gs]?)\s+/,
    description: 'HTTP fetch',
    suggestion: {
      tool: 'web_fetch',
      action_class: 'web.fetch',
      risk_tier: 'medium',
      rationale: 'HTTP requests should use web.fetch action class for proper policy gating',
    },
  },
  // --- Package management ---
  {
    pattern: /^\s*(npm\s+install|yarn\s+add|pnpm\s+add|pip\s+install|pip3\s+install)\b/,
    description: 'package install',
    suggestion: {
      tool: 'package_install',
      action_class: 'package.install',
      risk_tier: 'medium',
      rationale: 'Package installation should use package.install action class',
    },
  },
  {
    pattern: /^\s*(npm\s+(run|test|build|start|exec)|yarn\s+(run|test|build|start)|pnpm\s+(run|test|build)|npx)\s+/,
    description: 'package script run',
    suggestion: {
      tool: 'package_run',
      action_class: 'package.run',
      risk_tier: 'medium',
      rationale: 'Running package scripts should use package.run action class',
    },
  },
  // --- Code execution ---
  {
    pattern: /^\s*(python|python3|node|ruby|perl|php|Rscript)\s+/,
    description: 'script execution',
    suggestion: {
      tool: 'code_execute',
      action_class: 'code.execute',
      risk_tier: 'high',
      rationale: 'Script execution is still high-risk; use code.execute action class with explicit HITL gating',
    },
  },
];

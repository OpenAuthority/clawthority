import type { Rule } from '../types.js';

/**
 * Baseline policy rules for the Open Authority openclaw plugin.
 *
 * Rules are evaluated with Cedar semantics: forbid always wins over permit,
 * and an implicit deny applies when no rule matches.
 *
 * These rules apply to all agents. Per-agent overrides and extensions live in
 * sibling rule files (e.g. support.ts) and are merged over these defaults
 * via mergeRules() in index.ts.
 *
 * Organisation:
 *   1. Tool rules   — control which Claude tools may be invoked
 *   2. Command rules — control which shell commands may be run
 *   3. Channel rules — control which channels agents may operate on
 *   4. Prompt rules  — control which prompt identifiers may be used
 *   5. Model rules   — control which AI models may be resolved
 */
const defaultRules: Rule[] = [

  // ─── Tool rules ───────────────────────────────────────────────────────────

  /**
   * Permit standard read-only file-system tools unconditionally.
   * These carry no mutation risk and are safe for all agents.
   */
  {
    effect: 'permit',
    resource: 'tool',
    match: /^(read_file|list_dir|search_files|get_file_info|glob)$/,
    reason: 'Read-only file-system tools are permitted for all agents',
    tags: ['file', 'read-only'],
  },

  /**
   * Forbid the exec tool entirely.
   * Direct shell execution bypasses command-level policy; use command rules
   * to grant access to specific shell commands instead.
   */
  {
    effect: 'forbid',
    resource: 'tool',
    match: 'exec',
    reason: 'exec is forbidden; add command rules for shell access',
    tags: ['security', 'exec'],
  },

  /**
   * Forbid tools that spawn interactive shells or raw terminal sessions.
   * These cannot be audited at the command level.
   */
  {
    effect: 'forbid',
    resource: 'tool',
    match: /^(bash|shell|terminal|run_command|spawn)$/,
    reason: 'Shell-spawning tools are forbidden by default',
    tags: ['security', 'shell'],
  },

  /**
   * Permit file-write tools only when the request arrives on a trusted
   * channel. Agents on untrusted channels must not be able to modify files.
   */
  {
    effect: 'permit',
    resource: 'tool',
    match: /^(write_file|edit_file|create_file|patch_file)$/,
    condition: (ctx) => ['admin', 'trusted', 'ci'].includes(ctx.channel),
    reason: 'Write tools are restricted to trusted and CI channels',
    tags: ['file', 'write'],
  },

  /**
   * Forbid the delete_file tool for all non-admin agents.
   * Deletion is irreversible; only admin-prefixed agents may use it.
   */
  {
    effect: 'forbid',
    resource: 'tool',
    match: 'delete_file',
    condition: (ctx) => !ctx.agentId.startsWith('admin-'),
    reason: 'File deletion is restricted to admin agents',
    tags: ['file', 'destructive'],
  },

  /**
   * Forbid web-fetch and web-search tools by default.
   * These tools allow agents to make outbound HTTP requests and should only
   * be permitted when explicitly overridden by a more specific rule.
   */
  {
    effect: 'forbid',
    resource: 'tool',
    match: /^(web_fetch|web_search)$/,
    reason: 'Outbound web tools are forbidden by default; add a permit rule to enable them',
    tags: ['security', 'network'],
  },

  /**
   * Permit all remaining tools for agents operating on the default or webchat
   * channel. More specific forbid rules above will still override this catch-all.
   * 'webchat' is included because OpenClaw routes browser-based sessions through
   * that channel identifier; it carries the same trust level as 'default'.
   */
  {
    effect: 'permit',
    resource: 'tool',
    match: '*',
    condition: (ctx) => ctx.channel === 'default' || ctx.channel === 'webchat',
    reason: 'Agents on the default/webchat channel have general tool access',
    tags: ['default'],
  },

  // ─── Command rules ────────────────────────────────────────────────────────

  /**
   * Permit a safe allow-list of read-only shell commands.
   * These commands do not modify system state and are suitable for any agent.
   */
  {
    effect: 'permit',
    resource: 'command',
    match: /^(ls|cat|pwd|echo|date|whoami|uname|env|ps|df|du|wc|head|tail|grep|find|sort|uniq)$/,
    reason: 'Safe read-only shell commands are permitted',
    tags: ['command', 'read-only'],
  },

  /**
   * Forbid destructive file-system commands.
   * Data loss from these commands is typically unrecoverable.
   */
  {
    effect: 'forbid',
    resource: 'command',
    match: /^(rm|rmdir|dd|shred|mkfs|fdisk|wipefs|truncate)$/,
    reason: 'Destructive file-system commands are forbidden',
    tags: ['command', 'destructive'],
  },

  /**
   * Forbid privilege-escalation commands.
   * Agents must not be able to elevate their own permissions.
   */
  {
    effect: 'forbid',
    resource: 'command',
    match: /^(sudo|su|chmod|chown|chattr|setuid|setgid|newgrp)$/,
    reason: 'Privilege-escalation commands are forbidden',
    tags: ['command', 'privilege'],
  },

  /**
   * Permit git commands on trusted and CI channels only.
   * git operations on production repositories must be controlled.
   */
  {
    effect: 'permit',
    resource: 'command',
    match: 'git',
    condition: (ctx) => ['admin', 'trusted', 'ci'].includes(ctx.channel),
    reason: 'git is permitted on trusted and CI channels',
    tags: ['command', 'git'],
  },

  /**
   * Permit package-manager invocations only for authenticated users on
   * trusted channels. This prevents arbitrary package installation.
   */
  {
    effect: 'permit',
    resource: 'command',
    match: /^(npm|yarn|pnpm|bun|pip|cargo|go)$/,
    condition: (ctx) =>
      Boolean(ctx.userId) && ['admin', 'trusted', 'ci'].includes(ctx.channel),
    reason: 'Package managers require an authenticated user on a trusted channel',
    tags: ['command', 'package-manager'],
  },

  // ─── Channel rules ────────────────────────────────────────────────────────

  /**
   * Permit the default channel for all agents.
   * This is the baseline channel every agent can access.
   */
  {
    effect: 'permit',
    resource: 'channel',
    match: 'default',
    reason: 'Default channel is accessible to all agents',
    tags: ['channel'],
  },

  /**
   * Forbid the untrusted channel entirely.
   * Requests arriving on this channel must always be rejected.
   */
  {
    effect: 'forbid',
    resource: 'channel',
    match: 'untrusted',
    reason: 'Untrusted channel is blocked by policy',
    tags: ['channel', 'security'],
  },

  /**
   * Permit the admin channel only for agents whose ID carries the admin-
   * prefix. This enforces a naming convention for privileged agents.
   */
  {
    effect: 'permit',
    resource: 'channel',
    match: 'admin',
    condition: (ctx) => ctx.agentId.startsWith('admin-'),
    reason: 'Admin channel is restricted to agents with the admin- id prefix',
    tags: ['channel', 'admin'],
  },

  /**
   * Permit the named trusted channels (trusted, ci, readonly).
   * These are purpose-built channels with pre-approved access profiles.
   */
  {
    effect: 'permit',
    resource: 'channel',
    match: /^(trusted|ci|readonly)$/,
    reason: 'Pre-approved named channels are permitted',
    tags: ['channel'],
  },

  // ─── Prompt rules ─────────────────────────────────────────────────────────

  /**
   * Permit standard user-scoped prompts.
   * Prompts prefixed with "user:" represent normal end-user interactions.
   */
  {
    effect: 'permit',
    resource: 'prompt',
    match: /^user:/,
    reason: 'User-scoped prompts are permitted',
    tags: ['prompt'],
  },

  /**
   * Forbid system prompt overrides.
   * Agents must not be able to replace or inject into the system prompt.
   */
  {
    effect: 'forbid',
    resource: 'prompt',
    match: /^system:/,
    reason: 'System prompt overrides are forbidden',
    tags: ['prompt', 'security'],
  },

  /**
   * Forbid known jailbreak prompt prefixes.
   * These patterns are commonly used to attempt policy bypass.
   */
  {
    effect: 'forbid',
    resource: 'prompt',
    match: /^(jailbreak:|override:|ignore-policy:|DAN:)/i,
    reason: 'Known jailbreak prompt prefixes are forbidden',
    tags: ['prompt', 'security'],
  },

  /**
   * Permit custom prompts only for sessions with an authenticated user.
   * Unauthenticated agents may not define arbitrary prompt identifiers.
   */
  {
    effect: 'permit',
    resource: 'prompt',
    match: /^custom:/,
    condition: (ctx) => Boolean(ctx.userId),
    reason: 'Custom prompts require an authenticated user',
    tags: ['prompt', 'custom'],
  },

  // ─── Model rules ──────────────────────────────────────────────────────────

  /**
   * Permit all Anthropic Claude models.
   * Matches both "claude-<version>" and "anthropic/claude-<version>" formats.
   */
  {
    effect: 'permit',
    resource: 'model',
    match: /^(anthropic\/)?claude-/,
    reason: 'Anthropic Claude models are permitted',
    tags: ['model', 'anthropic'],
  },

  /**
   * Forbid preview, experimental, alpha, and beta model variants for
   * non-admin agents. These variants have not been approved for production.
   */
  {
    effect: 'forbid',
    resource: 'model',
    match: /-(preview|experimental|alpha|beta)(\b|-|$)/i,
    condition: (ctx) => !ctx.agentId.startsWith('admin-'),
    reason: 'Preview and experimental model variants are restricted to admin agents',
    tags: ['model', 'security'],
  },

  /**
   * Forbid any model that specifies a non-Anthropic provider prefix.
   * Third-party providers (openai/, google/, etc.) are blocked by default.
   */
  {
    effect: 'forbid',
    resource: 'model',
    match: /^(?!anthropic\/).+\/.+/,
    reason: 'Non-Anthropic model providers are forbidden by default',
    tags: ['model', 'security'],
  },

];

export default defaultRules;

import chokidar from 'chokidar';
import { basename, extname } from 'node:path';
import { PolicyEngine } from './policy/engine.js';
import { mergeRules } from './policy/rules/index.js';
import type { Rule } from './policy/types.js';

/**
 * In-memory cache of last-successfully-loaded Rule arrays, keyed by file stem
 * (e.g. 'default', 'support'). Only the changed file is refreshed on reload;
 * all others are reused from cache.
 */
const ruleCache = new Map<string, Rule[]>();

/**
 * Registry of known rule files.
 * Add new entries here when introducing new per-agent rule modules.
 */
const KNOWN_RULE_FILES: Record<string, string> = {
  default: './policy/rules/default.js',
  support: './policy/rules/support.js',
};

/**
 * Re-imports a single rules module using URL query cache-busting.
 */
async function importRuleModule(relPath: string, name: string): Promise<Rule[]> {
  const t = Date.now();
  const url = new URL(`${relPath}?t=${t}`, import.meta.url).href;
  const mod = (await import(url)) as { default?: unknown };
  if (!Array.isArray(mod.default)) {
    throw new TypeError(
      `rules/${name}.ts must export a default array of Rule objects`,
    );
  }
  return mod.default as Rule[];
}

/**
 * Re-imports only the changed rule module (plus any missing cache entries),
 * then returns merged rules and the list of reloaded agent names.
 */
async function importFreshRules(changedPath?: string): Promise<{
  rules: Rule[];
  reloadedAgents: string[];
}> {
  const reloadedAgents: string[] = [];
  const changedStem = changedPath
    ? basename(changedPath, extname(changedPath))
    : null;

  // index.ts is a merger shim and does not contain rule definitions.
  if (changedStem === 'index') {
    return { rules: buildMergedFromCache(), reloadedAgents: [] };
  }

  if (
    changedStem !== null &&
    !Object.prototype.hasOwnProperty.call(KNOWN_RULE_FILES, changedStem)
  ) {
    console.warn(
      `[hot-reload] unknown rule file changed: ${changedStem}.ts - add it to KNOWN_RULE_FILES in watcher.ts and restart to pick up new agent rules`,
    );
    return { rules: buildMergedFromCache(), reloadedAgents: [] };
  }

  for (const [name, relPath] of Object.entries(KNOWN_RULE_FILES)) {
    const isChanged = changedStem === null || changedStem === name;
    if (isChanged || !ruleCache.has(name)) {
      const fresh = await importRuleModule(relPath, name);
      ruleCache.set(name, fresh);
      if (isChanged) reloadedAgents.push(name);
    }
  }

  return {
    rules: buildMergedFromCache(),
    reloadedAgents,
  };
}

/** Merges all cached rule arrays into ordered [agentSpecific..., default]. */
function buildMergedFromCache(): Rule[] {
  const defaultRules = ruleCache.get('default') ?? [];
  const agentSpecific: Rule[] = [];
  for (const [name, rules] of ruleCache) {
    if (name !== 'default') agentSpecific.push(...rules);
  }
  return mergeRules(agentSpecific, defaultRules);
}

export interface WatcherHandle {
  stop(): Promise<void>;
}

/**
 * Starts a chokidar watcher on the src/policy/rules/ directory.
 *
 * On each detected change (debounced by `debounceMs`), only the changed rule
 * file is cache-busted and reloaded. A fresh PolicyEngine instance is created
 * and swapped into `engineRef.current` on successful reload.
 */
export function startRulesWatcher(
  engineRef: { current: PolicyEngine },
  debounceMs = 300,
): WatcherHandle {
  const rulesDirUrl = new URL('./policy/rules/', import.meta.url);
  const watchPath = rulesDirUrl.pathname;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const reload = async (changedFile?: string): Promise<void> => {
    try {
      const { rules, reloadedAgents } = await importFreshRules(changedFile);
      if (reloadedAgents.length === 0) return;
      const newEngine = new PolicyEngine();
      newEngine.addRules(rules);
      engineRef.current = newEngine;
      console.log(
        `[hot-reload] reloaded agent rules: ${reloadedAgents.join(', ')} - ${rules.length} rule${rules.length !== 1 ? 's' : ''} total`,
      );
    } catch (err) {
      const hint = changedFile ? ` (${basename(changedFile)})` : '';
      console.error(
        `[hot-reload] failed to reload rules${hint} (previous rules remain active):`,
        err,
      );
    }
  };

  const watcher = chokidar.watch(watchPath, {
    persistent: false,
    ignoreInitial: true,
  });

  watcher.on('change', (filePath: string) => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => reload(filePath), debounceMs);
  });

  console.log(`[hot-reload] watching ${watchPath} for rule changes`);

  return {
    async stop(): Promise<void> {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      await watcher.close();
      console.log('[hot-reload] watcher stopped');
    },
  };
}

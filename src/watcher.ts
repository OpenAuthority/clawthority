import chokidar from 'chokidar';
import { readFileSync, existsSync } from 'node:fs';
import { basename, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolicyEngine } from './policy/engine.js';
import type { PolicyEngineOptions } from './policy/engine.js';
import { mergeRules } from './policy/rules/index.js';
import type { Rule, Effect, Resource } from './policy/types.js';
import { CoverageMap } from './policy/coverage.js';
import { resolveModeValue, type ClawMode } from './policy/mode.js';

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
};

/** Resolve paths to data/bundle.json and data/rules.json relative to the plugin root. */
const __srcDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__srcDir, '..');
const JSON_BUNDLE_FILE = resolve(PLUGIN_ROOT, 'data', 'bundle.json');
const JSON_RULES_FILE = resolve(PLUGIN_ROOT, 'data', 'rules.json');
const MODE_FILE = resolve(PLUGIN_ROOT, 'data', 'mode.json');

/**
 * Returns the active JSON rules file path.
 * data/bundle.json takes precedence over data/rules.json when present.
 */
export function resolveActiveJsonRulesFile(): string {
  return existsSync(JSON_BUNDLE_FILE) ? JSON_BUNDLE_FILE : JSON_RULES_FILE;
}

interface JsonRule {
  id?: string;
  effect: string;
  resource: string;
  match: string;
  reason?: string;
  tags?: string[];
  rateLimit?: { maxCalls: number; windowSeconds: number };
}

/**
 * Loads rules from the UI-managed data/bundle.json (preferred) or
 * data/rules.json (fallback) file and converts them to Cedar Rule objects.
 *
 * Accepts both formats:
 *  - bundle.json: `{ version, rules, checksum }` object — `rules` array is extracted.
 *  - rules.json:  plain JSON array of rule objects.
 */
function loadJsonRules(filePath: string = resolveActiveJsonRulesFile()): Rule[] {
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    // Detect format: bundle.json has { version, rules } shape; rules.json is a plain array.
    let rulesArray: unknown[];
    if (Array.isArray(parsed)) {
      rulesArray = parsed;
    } else if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'rules' in (parsed as object) &&
      Array.isArray((parsed as { rules: unknown }).rules)
    ) {
      rulesArray = (parsed as { rules: unknown[] }).rules;
    } else {
      return [];
    }

    return (rulesArray as JsonRule[])
      .filter((r) => r.effect && r.resource && r.match)
      .map((r) => {
        const rule: Rule = {
          effect: r.effect as Effect,
          resource: r.resource as Resource,
          match: r.match,
        };
        if (r.reason) rule.reason = r.reason;
        if (r.tags) rule.tags = r.tags;
        if (r.rateLimit) rule.rateLimit = r.rateLimit;
        return rule;
      });
  } catch (err) {
    console.error('[hot-reload] failed to load JSON rules:', err);
    return [];
  }
}

/**
 * Re-imports a single rules module using URL query cache-busting.
 */
async function importRuleModule(relPath: string, name: string): Promise<Rule[]> {
  const t = Date.now();
  const url = new URL(`${relPath}?t=${t}`, import.meta.url).href;
  const mod = (await import(url)) as { default?: unknown; OPEN_MODE_RULES?: unknown };
  const exportedRules = name === 'default' && currentMode === 'open'
    ? mod.OPEN_MODE_RULES
    : mod.default;
  if (!Array.isArray(exportedRules)) {
    throw new TypeError(
      `rules/${name}.ts must export a default array of Rule objects`,
    );
  }
  return exportedRules as Rule[];
}

let currentMode: ClawMode = 'open';

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

export interface ModeWatcherOptions {
  /** Current mode used to choose baseline rules and engine defaultEffect. */
  getMode?: () => ClawMode;
  /** Called after data/mode.json changes to update the owning runtime. */
  setMode?: (mode: ClawMode) => void;
  /** Returns the compiled baseline rules for the current mode. */
  getBaseRules?: () => Rule[];
  /** Returns engine options for the current mode. */
  getEngineOptions?: () => PolicyEngineOptions;
  /** Optional override for tests or non-standard installs. */
  modeFile?: string;
}

/** Log all loaded rules to the console for visibility at startup / reload. */
function logRules(rules: Rule[], source: string): void {
  if (rules.length === 0) return;
  console.log(`[clawthority] ${source} rules (${rules.length}):`);
  for (const r of rules) {
    const matchStr = r.match instanceof RegExp ? r.match.toString() : r.match;
    const reason = r.reason ? ` — ${r.reason}` : '';
    console.log(`[clawthority]   ${r.effect.toUpperCase().padEnd(6)} ${r.resource}:${matchStr}${reason}`);
  }
}

function loadModeFile(filePath: string): ClawMode | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    const rawMode = typeof parsed === 'string'
      ? parsed
      : parsed !== null && typeof parsed === 'object' && 'mode' in parsed
        ? (parsed as { mode?: unknown }).mode
        : undefined;
    return resolveModeValue(rawMode, basename(filePath));
  } catch (err) {
    console.error('[hot-reload] failed to load mode file:', err);
    return null;
  }
}

/**
 * Starts watchers on both src/policy/rules/ (TypeScript) and data/rules.json.
 *
 * On each detected change (debounced by `debounceMs`), rules are reloaded and
 * a fresh PolicyEngine instance is swapped into `engineRef.current`.
 */
// Phase 2 modification point: add an optional `onCoverageReset?: () => void`
// parameter to startRulesWatcher so the dashboard server can refresh its
// cached coverage snapshot whenever rules are hot-reloaded and the map is reset.
export function startRulesWatcher(
  engineRef: { current: PolicyEngine },
  debounceMs = 300,
  onReload?: (compiledRules: Rule[]) => void,
  engineOptions?: PolicyEngineOptions,
  initialRules?: Rule[],
  coverageMap?: CoverageMap,
  modeOptions: ModeWatcherOptions = {},
): WatcherHandle {
  const rulesDirUrl = new URL('./policy/rules/', import.meta.url);
  const watchPath = rulesDirUrl.pathname;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const getEngineOptions = (): PolicyEngineOptions | undefined =>
    modeOptions.getEngineOptions?.() ?? engineOptions;
  const getBaseRules = (): Rule[] => {
    const provided = modeOptions.getBaseRules?.() ?? initialRules;
    if (provided !== undefined) return provided;
    const merged = buildMergedFromCache();
    return Array.isArray(merged) ? merged : [];
  };
  const syncCurrentMode = (): void => {
    currentMode = modeOptions.getMode?.() ?? currentMode;
  };
  syncCurrentMode();
  if (initialRules !== undefined) {
    ruleCache.set('default', initialRules);
  }

  const rebuildEngine = (rules: Rule[]): void => {
    const newEngine = new PolicyEngine(getEngineOptions());
    newEngine.addRules(rules);
    engineRef.current = newEngine;
  };

  const reload = async (changedFile?: string): Promise<void> => {
    try {
      syncCurrentMode();
      const { rules, reloadedAgents } = await importFreshRules(changedFile);
      if (reloadedAgents.length === 0) return;

      // Also include JSON rules from the UI
      const jsonRules = loadJsonRules();
      ruleCache.set('json', jsonRules);
      const allRules = [...jsonRules, ...rules];

      rebuildEngine(allRules);
      coverageMap?.reset();
      logRules(rules, 'compiled');
      logRules(jsonRules, 'UI (data/rules.json)');
      onReload?.(rules);
      console.log(
        `[hot-reload] reloaded agent rules: ${reloadedAgents.join(', ')} - ${allRules.length} rule${allRules.length !== 1 ? 's' : ''} total`,
      );
    } catch (err) {
      const hint = changedFile ? ` (${basename(changedFile)})` : '';
      console.error(
        `[hot-reload] failed to reload rules${hint} (previous rules remain active):`,
        err,
      );
    }
  };

  const reloadJsonRules = (): void => {
    try {
      syncCurrentMode();
      const jsonRules = loadJsonRules();
      ruleCache.set('json', jsonRules);
      const allRules = [...jsonRules, ...getBaseRules()];
      rebuildEngine(allRules);
      coverageMap?.reset();
      logRules(jsonRules, 'UI (data/bundle.json | data/rules.json)');
      console.log(
        `[hot-reload] reloaded UI rules - ${allRules.length} rule${allRules.length !== 1 ? 's' : ''} total`,
      );
    } catch (err) {
      console.error(
        '[hot-reload] failed to reload JSON rules (previous rules remain active):',
        err,
      );
    }
  };

  const reloadMode = (): void => {
    const mode = loadModeFile(modeOptions.modeFile ?? MODE_FILE);
    if (mode === null) return;
    modeOptions.setMode?.(mode);
    syncCurrentMode();
    const jsonRules = loadJsonRules();
    ruleCache.set('json', jsonRules);
    const baseRules = getBaseRules();
    ruleCache.set('default', baseRules);
    rebuildEngine([...jsonRules, ...baseRules]);
    coverageMap?.reset();
    console.log(
      `[hot-reload] switched mode to ${mode.toUpperCase()} - ${jsonRules.length + baseRules.length} rule${jsonRules.length + baseRules.length !== 1 ? 's' : ''} total`,
    );
  };

  // Watch TypeScript rule files
  const tsWatcher = chokidar.watch(watchPath, {
    persistent: false,
    ignoreInitial: true,
  });

  tsWatcher.on('change', (filePath: string) => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => reload(filePath), debounceMs);
  });

  // Watch data/rules.json for UI-managed rules (legacy format fallback)
  let jsonDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const jsonWatcher = chokidar.watch(JSON_RULES_FILE, {
    persistent: false,
    ignoreInitial: true,
  });

  jsonWatcher.on('change', () => {
    if (jsonDebounceTimer !== null) clearTimeout(jsonDebounceTimer);
    jsonDebounceTimer = setTimeout(reloadJsonRules, debounceMs);
  });
  jsonWatcher.on('add', () => {
    if (jsonDebounceTimer !== null) clearTimeout(jsonDebounceTimer);
    jsonDebounceTimer = setTimeout(reloadJsonRules, debounceMs);
  });

  // Watch data/bundle.json — takes precedence over rules.json when present.
  // Also handles 'unlink' so that deleting bundle.json falls back to rules.json.
  let bundleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const bundleWatcher = chokidar.watch(JSON_BUNDLE_FILE, {
    persistent: false,
    ignoreInitial: true,
  });

  bundleWatcher.on('change', () => {
    if (bundleDebounceTimer !== null) clearTimeout(bundleDebounceTimer);
    bundleDebounceTimer = setTimeout(reloadJsonRules, debounceMs);
  });
  bundleWatcher.on('add', () => {
    if (bundleDebounceTimer !== null) clearTimeout(bundleDebounceTimer);
    bundleDebounceTimer = setTimeout(reloadJsonRules, debounceMs);
  });
  bundleWatcher.on('unlink', () => {
    // bundle.json removed — fall back to rules.json automatically
    if (bundleDebounceTimer !== null) clearTimeout(bundleDebounceTimer);
    bundleDebounceTimer = setTimeout(reloadJsonRules, debounceMs);
  });

  let modeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const modeWatcher = chokidar.watch(modeOptions.modeFile ?? MODE_FILE, {
    persistent: false,
    ignoreInitial: true,
  });

  modeWatcher.on('change', () => {
    if (modeDebounceTimer !== null) clearTimeout(modeDebounceTimer);
    modeDebounceTimer = setTimeout(reloadMode, debounceMs);
  });
  modeWatcher.on('add', () => {
    if (modeDebounceTimer !== null) clearTimeout(modeDebounceTimer);
    modeDebounceTimer = setTimeout(reloadMode, debounceMs);
  });

  // Initial load of JSON rules — rebuild the engine so the ref is replaced with
  // a new instance that includes both JSON rules and any pre-compiled TypeScript
  // rules passed via `initialRules`.
  const jsonRules = loadJsonRules();
  if (jsonRules.length > 0) {
    ruleCache.set('json', jsonRules);
    const allRules = [...jsonRules, ...getBaseRules()];
    rebuildEngine(allRules);
    logRules(jsonRules, 'UI (data/bundle.json | data/rules.json)');
  }

  console.log(`[hot-reload] watching ${watchPath} for rule changes`);
  console.log(`[hot-reload] watching ${JSON_RULES_FILE} for UI rule changes`);
  console.log(`[hot-reload] watching ${JSON_BUNDLE_FILE} for bundle rule changes (takes precedence)`);
  console.log(`[hot-reload] watching ${modeOptions.modeFile ?? MODE_FILE} for mode changes`);

  return {
    async stop(): Promise<void> {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (jsonDebounceTimer !== null) {
        clearTimeout(jsonDebounceTimer);
        jsonDebounceTimer = null;
      }
      if (bundleDebounceTimer !== null) {
        clearTimeout(bundleDebounceTimer);
        bundleDebounceTimer = null;
      }
      if (modeDebounceTimer !== null) {
        clearTimeout(modeDebounceTimer);
        modeDebounceTimer = null;
      }
      await tsWatcher.close();
      await jsonWatcher.close();
      await bundleWatcher.close();
      await modeWatcher.close();
      console.log('[hot-reload] watchers stopped');
    },
  };
}

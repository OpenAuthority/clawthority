import chokidar from 'chokidar';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CedarEngine } from './policy/cedar-engine.js';
import { CoverageMap } from './policy/coverage.js';

/** Resolve path to data/rules.json relative to the plugin root. */
const __srcDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__srcDir, '..');
const JSON_RULES_FILE = resolve(PLUGIN_ROOT, 'data', 'rules.json');

/**
 * Checks whether `data/rules.json` exists and contains a valid JSON array.
 * Returns `true` when valid rules are present so callers can decide whether
 * to rebuild the engine.
 */
function hasValidJsonRules(filePath: string = JSON_RULES_FILE): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const raw = readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export interface WatcherHandle {
  stop(): Promise<void>;
}

/**
 * Starts a watcher on `data/rules.json`.
 *
 * On each detected change (debounced by `debounceMs`), a new `CedarEngine`
 * instance is created and swapped into `engineRef.current`. The new engine is
 * initialised asynchronously; callers should handle the brief transition period
 * during which the engine is not yet ready (the engine returns its configured
 * `defaultEffect` until Cedar WASM finishes loading).
 *
 * Note: TypeScript-based rule files (`policy/rules/`) are no longer supported.
 * Policy configuration is managed through Cedar policy text loaded via
 * `CedarEngine.policies`.
 */
export function startRulesWatcher(
  engineRef: { current: CedarEngine },
  debounceMs = 300,
  coverageMap?: CoverageMap,
): WatcherHandle {
  let jsonDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rebuildEngine = (): void => {
    const newEngine = new CedarEngine();
    // Initialise Cedar WASM asynchronously. During the brief window before
    // init() completes, evaluate() returns the engine's configured defaultEffect.
    newEngine.init().catch((err: unknown) => {
      console.error('[hot-reload] failed to initialise new Cedar engine:', err);
    });
    engineRef.current = newEngine;
    coverageMap?.reset();
  };

  const reloadJsonRules = (): void => {
    try {
      if (hasValidJsonRules()) {
        console.log(
          '[hot-reload] data/rules.json changed — Cedar engine reloaded. ' +
          'Note: JSON rule format is deprecated; use Cedar policy text via engine.policies.',
        );
        rebuildEngine();
      }
    } catch (err) {
      console.error(
        '[hot-reload] failed to reload on JSON rules change (previous engine remains active):',
        err,
      );
    }
  };

  // Watch data/rules.json for UI-managed rule changes.
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

  // Initial load: if a valid rules.json already exists, rebuild the engine now.
  if (hasValidJsonRules()) {
    rebuildEngine();
    console.log('[hot-reload] loaded initial rules from data/rules.json (Cedar engine rebuilt)');
  }

  console.log(`[hot-reload] watching ${JSON_RULES_FILE} for rule changes`);

  return {
    async stop(): Promise<void> {
      if (jsonDebounceTimer !== null) {
        clearTimeout(jsonDebounceTimer);
        jsonDebounceTimer = null;
      }
      await jsonWatcher.close();
      console.log('[hot-reload] watcher stopped');
    },
  };
}

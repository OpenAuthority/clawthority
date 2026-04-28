/**
 * Auto-permit store — persistence layer for auto-permit rules.
 *
 * Provides atomic read/write access to the auto-permit JSON store file and
 * a debounced file-system watcher for hot-reloading rules when the store is
 * modified externally.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import chokidar from 'chokidar';
import type { AutoPermit } from '../models/auto-permit.js';
import { validateAutoPermitContent } from './validation.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the SHA-256 hex digest of `data`.
 *
 * Used to compute the `checksum` field written into the auto-permit store
 * envelope, matching the checksum convention established by `bundle.json`
 * (`SHA-256(JSON.stringify(rules))`).
 */
function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Result returned by {@link loadAutoPermitRulesFromFile}.
 *
 * When `found` is `false` the store file did not exist (ENOENT) and
 * `rules` / `skipped` will both be zero.  Callers should treat the absent
 * file as an empty store without logging an error.
 */
export interface LoadResult {
  /** Validated auto-permit records parsed from the file. */
  rules: AutoPermit[];
  /** Number of records that failed schema validation and were skipped. */
  skipped: number;
  /** Absolute path of the store file that was (attempted to be) read. */
  path: string;
  /** Whether the store file was found on disk. */
  found: boolean;
  /**
   * Store format version from the file.
   *
   * `0` when the file does not exist, could not be parsed, or uses the legacy
   * flat-array format (pre-versioning).  A positive integer when the file uses
   * the versioned `{ version, rules }` envelope.
   */
  version: number;

  /**
   * SHA-256 hex checksum field from the file envelope, if present.
   *
   * `undefined` when the file does not exist, uses the legacy flat-array
   * format, or the envelope omits the `checksum` field.  Present only when
   * the file uses the versioned `{ version, rules, checksum }` bundle format.
   */
  checksum?: string;

  /**
   * All validation error messages collected during loading.
   *
   * Includes:
   * - Envelope-level TypeBox errors (when the top-level structure is invalid).
   * - Per-entry TypeBox errors (for each rule entry that failed schema validation).
   * - A checksum mismatch message (when the stored checksum does not match the
   *   computed SHA-256 of the rules array).
   * - A JSON parse error message (when the file content is not valid JSON).
   *
   * Empty when the file does not exist (ENOENT) or when all content is valid.
   * Callers should log these at `warn` level.
   */
  validationErrors: string[];

  /**
   * Human-readable description of the JSON parse failure, if any.
   *
   * `undefined` when the file content was valid JSON (or the file did not
   * exist).  When set, `validationErrors` will also contain this message.
   */
  parseError?: string;
}

/**
 * Handle returned by {@link watchAutoPermitStore}.
 *
 * Call {@link stop} to close the underlying chokidar watcher and cancel any
 * pending debounce timer.
 */
export interface AutoPermitWatchHandle {
  /** Stops watching the store file and clears any pending debounce timer. */
  stop(): void;
}

// ── loadAutoPermitRulesFromFile ───────────────────────────────────────────────

/**
 * Loads auto-permit rules from a JSON store file.
 *
 * Reads and parses the file at `storePath`.  If the file does not exist
 * (ENOENT) the function returns a {@link LoadResult} with `found: false` and
 * empty `rules` — this is not treated as an error.  All other I/O errors are
 * re-thrown.
 *
 * Records that fail the {@link isAutoPermit} type-guard are silently skipped;
 * their count is reflected in `skipped` so callers can emit a warning.
 *
 * @param storePath Absolute path to the auto-permit JSON store file.
 * @returns A {@link LoadResult} describing the loaded rules and metadata.
 */
export async function loadAutoPermitRulesFromFile(storePath: string): Promise<LoadResult> {
  let raw: string;
  try {
    raw = await readFile(storePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { rules: [], skipped: 0, path: storePath, found: false, version: 0, validationErrors: [] };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const parseError = `[auto-permits] ${storePath}: invalid JSON — ${String(err)}`;
    return {
      rules: [],
      skipped: 0,
      path: storePath,
      found: true,
      version: 0,
      validationErrors: [parseError],
      parseError,
    };
  }

  const validation = validateAutoPermitContent(parsed);

  // Collect all validation error messages for callers to log.
  const validationErrors: string[] = [
    ...validation.envelopeErrors.map((e) => `[auto-permits] ${storePath} envelope: ${e}`),
    ...validation.entryErrors.flatMap(({ index, errors }) =>
      errors.map((e) => `[auto-permits] ${storePath} rules[${index}]: ${e}`),
    ),
    ...(validation.checksumMismatch
      ? [`[auto-permits] ${storePath}: checksum mismatch — file may have been modified externally`]
      : []),
  ];

  return {
    rules: validation.rules,
    skipped: validation.skipped,
    path: storePath,
    found: true,
    version: validation.version,
    ...(validation.checksum !== undefined ? { checksum: validation.checksum } : {}),
    validationErrors,
  };
}

// ── saveAutoPermitRules ───────────────────────────────────────────────────────

/**
 * Atomically writes `rules` to the auto-permit store file at `storePath`
 * using the versioned `{ version, rules }` envelope format.
 *
 * Uses a write-to-temp-then-rename pattern to ensure the file is never left
 * in a partially written state.  The file (and the temp file) are created
 * with mode `0o644`.
 *
 * The `nextVersion` parameter must be strictly greater than the version read
 * from the existing store (monotonically increasing).  Callers are responsible
 * for computing the next version — typically `existingResult.version + 1`.
 *
 * @param storePath   Absolute path to the target auto-permit JSON store file.
 * @param rules       Array of {@link AutoPermit} records to persist.
 * @param nextVersion Store version to write (default: `1`).
 */
export async function saveAutoPermitRules(
  storePath: string,
  rules: AutoPermit[],
  nextVersion: number = 1,
): Promise<void> {
  // Ensure the parent directory exists before writing (crash-safe first write).
  await mkdir(dirname(storePath), { recursive: true });

  const tmpPath = `${storePath}.tmp`;
  const checksum = sha256(JSON.stringify(rules));
  const store = { version: nextVersion, rules, checksum };
  const content = JSON.stringify(store, null, 2) + '\n';
  await writeFile(tmpPath, content, { mode: 0o644 });
  await rename(tmpPath, storePath);
  await chmod(storePath, 0o644);
}

// ── watchAutoPermitStore ──────────────────────────────────────────────────────

/** Options for {@link watchAutoPermitStore}. */
export interface WatchAutoPermitStoreOpts {
  /** Debounce window in milliseconds (default: `300`). */
  debounceMs?: number;
}

/**
 * Starts a file-system watcher on the auto-permit store file.
 *
 * Both `add` and `change` chokidar events trigger `callback` after the
 * debounce window expires.  Rapid successive events (e.g. write + chmod from
 * {@link saveAutoPermitRules}) collapse into a single callback invocation.
 *
 * The watcher is created with `persistent: false` so it does not prevent the
 * Node.js process from exiting naturally.
 *
 * @param storePath Absolute path to the auto-permit JSON store file to watch.
 * @param callback  Function to call after a debounced file-system event.
 * @param opts      Optional configuration overrides.
 * @returns An {@link AutoPermitWatchHandle} whose `stop()` method closes the watcher.
 */
export function watchAutoPermitStore(
  storePath: string,
  callback: () => void,
  opts: WatchAutoPermitStoreOpts = {},
): AutoPermitWatchHandle {
  const debounceMs = opts.debounceMs ?? 300;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const watcher = chokidar.watch(storePath, { persistent: false });

  const handler = () => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(callback, debounceMs);
  };

  watcher.on('add', handler);
  watcher.on('change', handler);

  return {
    stop(): void {
      void watcher.close();
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
    },
  };
}

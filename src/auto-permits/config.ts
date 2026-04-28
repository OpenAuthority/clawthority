/**
 * Auto-permit store configuration resolver.
 *
 * Determines where auto-permit records are persisted. The storage location
 * can be set once at plugin startup via the `CLAWTHORITY_AUTO_PERMIT_STORE`
 * environment variable; a restart is required to change it.
 *
 * @module
 */

import { Type, type Static } from '@sinclair/typebox';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Default path for the dedicated auto-permit store file.
 *
 * Keeping auto-permits in their own file makes human review straightforward —
 * an operator can inspect, edit, or revoke individual records without touching
 * the hand-authored authorisation rules in `data/rules.json`.
 */
export const DEFAULT_AUTO_PERMIT_STORE_PATH = 'data/auto-permits.json';

/**
 * Path to the main rules file used when the operator opts into single-file
 * mode by pointing `CLAWTHORITY_AUTO_PERMIT_STORE` at this path.
 */
export const RULES_FILE_PATH = 'data/rules.json';

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * TypeBox schema for the auto-permit storage mode.
 *
 * - `'separate'` — auto-permits are written to their own dedicated file
 *   (default: `data/auto-permits.json`).  This keeps auto-permit records
 *   distinct from hand-authored rules and makes human review straightforward.
 * - `'rules'`    — auto-permits are appended to `data/rules.json` alongside
 *   the authorisation rules authored by the operator.  Useful when a single
 *   policy file is preferred for tooling or deployment reasons.
 */
export const AutoPermitStorageModeSchema = Type.Union([
  Type.Literal('separate'),
  Type.Literal('rules'),
]);

export type AutoPermitStorageMode = Static<typeof AutoPermitStorageModeSchema>;

// ── Resolved config ───────────────────────────────────────────────────────────

/**
 * Resolved auto-permit store configuration produced by
 * {@link resolveAutoPermitStoreConfig}.
 */
export interface ResolvedAutoPermitStoreConfig {
  /**
   * Storage mode derived from the resolved path.
   *
   * `'rules'` when the resolved path equals `data/rules.json`;
   * `'separate'` for every other path.
   */
  mode: AutoPermitStorageMode;

  /**
   * Absolute or relative path to the file where auto-permit records are
   * stored.  Defaults to `data/auto-permits.json`.
   */
  path: string;
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Resolves the auto-permit storage location from environment variables.
 *
 * Resolution rules (highest precedence first):
 * 1. `CLAWTHORITY_AUTO_PERMIT_STORE` env var — any non-empty value is used
 *    as the storage path.
 * 2. Built-in default — `data/auto-permits.json` (separate-file mode).
 *
 * The `mode` field of the returned config is set to `'rules'` when the
 * resolved path equals `data/rules.json` (the single-file option), and
 * `'separate'` for every other path (including custom paths).
 *
 * @example
 * ```bash
 * # Default — separate file, easy per-record review
 * # (no env var needed)
 *
 * # Single-file mode — auto-permits appended to data/rules.json
 * CLAWTHORITY_AUTO_PERMIT_STORE=data/rules.json
 *
 * # Custom path
 * CLAWTHORITY_AUTO_PERMIT_STORE=/var/clawthority/auto-permits.json
 * ```
 */
export function resolveAutoPermitStoreConfig(): ResolvedAutoPermitStoreConfig {
  const envPath = process.env.CLAWTHORITY_AUTO_PERMIT_STORE?.trim();
  const path = (envPath !== undefined && envPath.length > 0)
    ? envPath
    : DEFAULT_AUTO_PERMIT_STORE_PATH;
  const mode: AutoPermitStorageMode = path === RULES_FILE_PATH ? 'rules' : 'separate';
  return { mode, path };
}

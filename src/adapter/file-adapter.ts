import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import chokidar from 'chokidar';
import { Value } from '@sinclair/typebox/value';
import { uuidv7 } from '../envelope.js';
import { computeBinding } from '../hitl/approval-manager.js';
import {
  PolicyBundleSchema,
  type PolicyBundle,
  type Capability,
  type IssueCapabilityOpts,
  type WatchHandle,
  type IAuthorityAdapter,
} from './types.js';

/** Configuration for FileAuthorityAdapter. */
export interface FileAuthorityAdapterConfig {
  /** Absolute or relative path to the JSON policy bundle file to watch. */
  bundlePath: string;
  /**
   * Optional path to a proposals directory or file (reserved for future use).
   * Not used by the current implementation.
   */
  proposalPath?: string;
  /**
   * Default capability TTL in seconds applied when `IssueCapabilityOpts.ttl_seconds`
   * is not provided.
   * @default 3600
   */
  capabilityTtlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 3600;
const RELOAD_DEBOUNCE_MS = 300;

/**
 * File-based implementation of IAuthorityAdapter intended for local
 * development and testing.
 *
 * - Capabilities are issued with UUID v7 tokens and SHA-256 payload bindings,
 *   stored in-memory for the lifetime of the adapter instance.
 * - Policy bundles are read from a JSON file; hot-reload is powered by
 *   chokidar with debouncing and version monotonicity enforcement.
 * - Revocations are not supported; watchRevocations() returns an empty stream.
 */
export class FileAuthorityAdapter implements IAuthorityAdapter {
  private readonly capabilities = new Map<string, Capability>();
  private readonly config: FileAuthorityAdapterConfig;

  constructor(config: FileAuthorityAdapterConfig) {
    this.config = config;
  }

  /**
   * Issues a new capability.
   *
   * - `approval_id` is a UUID v7 string.
   * - `binding` is SHA-256(action_class + '|' + target + '|' + payload_hash).
   * - The capability is stored in the in-memory map keyed by `approval_id`.
   */
  async issueCapability(opts: IssueCapabilityOpts): Promise<Capability> {
    const approval_id = uuidv7();
    const binding = computeBinding(opts.action_class, opts.target, opts.payload_hash);
    const ttlMs =
      (opts.ttl_seconds ?? this.config.capabilityTtlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
    const issued_at = Date.now();
    const expires_at = issued_at + ttlMs;

    const capability: Capability = {
      approval_id,
      binding,
      action_class: opts.action_class,
      target: opts.target,
      issued_at,
      expires_at,
      ...(opts.session_id !== undefined ? { session_id: opts.session_id } : {}),
    };

    this.capabilities.set(approval_id, capability);
    return capability;
  }

  /**
   * Reads the policy bundle from disk on startup, validates it against
   * PolicyBundleSchema, and calls `onUpdate` with the initial bundle.
   * Then starts a chokidar watcher that re-reads and re-validates the file
   * on every change. Updates are only applied when the new bundle's `version`
   * is strictly greater than the last accepted version.
   *
   * Errors (IO failures, schema violations, version regressions) are logged
   * to stderr; the previous bundle remains active.
   *
   * @returns A WatchHandle whose `stop()` closes the chokidar watcher.
   */
  async watchPolicyBundle(onUpdate: (bundle: PolicyBundle) => void): Promise<WatchHandle> {
    const { bundlePath } = this.config;
    const name = basename(bundlePath);
    let currentVersion = -1;

    const readBundle = async (): Promise<PolicyBundle | null> => {
      let raw: unknown;
      try {
        const content = await readFile(bundlePath, 'utf-8');
        raw = JSON.parse(content) as unknown;
      } catch (err) {
        console.error(`[file-adapter] failed to read bundle ${name}:`, err);
        return null;
      }

      if (!Value.Check(PolicyBundleSchema, raw)) {
        const errors = [...Value.Errors(PolicyBundleSchema, raw)].map(
          (e) => `  ${e.path}: ${e.message}`,
        );
        console.error(
          `[file-adapter] invalid bundle schema in ${name}:\n${errors.join('\n')}`,
        );
        return null;
      }

      return raw as PolicyBundle;
    };

    // Emit initial bundle on startup
    const initial = await readBundle();
    if (initial !== null) {
      currentVersion = initial.version;
      onUpdate(initial);
      console.log(`[file-adapter] loaded bundle ${name} (version ${currentVersion})`);
    } else {
      console.error(
        `[file-adapter] failed to load initial bundle from ${bundlePath}; ` +
          'watcher will start but initial state is unavailable',
      );
    }

    let stopped = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const reload = async (): Promise<void> => {
      const bundle = await readBundle();
      if (bundle === null) return;

      if (bundle.version <= currentVersion) {
        console.warn(
          `[file-adapter] ignoring bundle ${name}: version ${bundle.version} ` +
            `is not greater than current ${currentVersion}`,
        );
        return;
      }

      currentVersion = bundle.version;
      onUpdate(bundle);
      console.log(`[file-adapter] reloaded bundle ${name} (version ${currentVersion})`);
    };

    const watcher = chokidar.watch(bundlePath, {
      persistent: false,
      ignoreInitial: true,
    });

    watcher.on('change', () => {
      if (stopped) return;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void reload(), RELOAD_DEBOUNCE_MS);
    });

    console.log(`[file-adapter] watching ${name} for bundle changes`);

    return {
      async stop(): Promise<void> {
        if (stopped) return;
        stopped = true;
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        await watcher.close();
        console.log('[file-adapter] watcher stopped');
      },
    };
  }

  /**
   * Returns an empty async iterable. File-based adapters have no revocation
   * stream; remote adapters can override this to yield revoked IDs.
   */
  watchRevocations(): AsyncIterable<string> {
    return (async function* () {
      // No revocations for file-based adapter
    })();
  }
}

import { Type } from '@sinclair/typebox';

/**
 * Minimum JSON schema for a policy bundle file.
 * Only `version` is required; all other fields are left open.
 */
export const PolicyBundleSchema = Type.Object(
  { version: Type.Number({ minimum: 0 }) },
  { additionalProperties: true },
);

/**
 * A policy bundle loaded from a JSON file.
 * `version` must be a non-negative integer and must increase monotonically
 * across hot-reloads; all other fields are adapter-specific.
 */
export interface PolicyBundle extends Record<string, unknown> {
  version: number;
}

/** An issued capability token stored in-memory by the adapter. */
export interface Capability {
  /** UUID v7 token uniquely identifying this capability. */
  approval_id: string;
  /** SHA-256(action_class + '|' + target + '|' + payload_hash) */
  binding: string;
  action_class: string;
  target: string;
  /** Optional session context; absent when not provided. */
  session_id?: string;
  /** Unix epoch milliseconds when the capability was issued. */
  issued_at: number;
  /** Unix epoch milliseconds when the capability expires. */
  expires_at: number;
}

/** Options for issuing a capability. */
export interface IssueCapabilityOpts {
  action_class: string;
  target: string;
  /** SHA-256 hash of the tool call payload used to compute the binding. */
  payload_hash: string;
  /** Optional session identifier to attach to the capability. */
  session_id?: string;
  /** TTL in seconds; overrides the adapter-level default when supplied. */
  ttl_seconds?: number;
}

/** Handle returned by watchPolicyBundle; call stop() to close the watcher. */
export interface WatchHandle {
  stop(): Promise<void>;
}

/** Authority adapter interface for issuing capabilities and watching policies. */
export interface IAuthorityAdapter {
  /**
   * Issues a new capability with a UUID v7 `approval_id` and SHA-256 payload
   * binding. The capability is stored in the adapter's in-memory store and
   * returned to the caller.
   */
  issueCapability(opts: IssueCapabilityOpts): Promise<Capability>;

  /**
   * Begins watching the configured policy bundle file. Calls `onUpdate`
   * immediately with the initial bundle and again whenever a change passes
   * schema validation and version monotonicity checks.
   *
   * @returns A handle whose `stop()` method closes the underlying file watcher.
   */
  watchPolicyBundle(onUpdate: (bundle: PolicyBundle) => void): Promise<WatchHandle>;

  /**
   * Returns an async iterable of revoked capability IDs.
   * Implementations that lack a revocation stream (e.g. file-based) yield
   * nothing.
   */
  watchRevocations(): AsyncIterable<string>;
}

/**
 * Feature flags for Clawthority.
 *
 * Feature flags are read once at module load from environment variables.
 * A plugin restart is required to change them — this is a deliberate
 * constraint to keep runtime behaviour predictable and free of race
 * conditions during hot-reload cycles.
 *
 * @module
 */

/** Resolved feature flags controlling optional Clawthority capabilities. */
export interface FeatureFlags {
  /**
   * When true, the 🔁 "Approve Always" button is shown in Slack approval
   * messages and operators can create session-scoped auto-permits by
   * clicking it.
   *
   * Set `CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1` to disable. Existing
   * session auto-permits created before the flag was set continue to be
   * honoured — only creation of new ones is blocked.
   *
   * Default: `true` (button shown, creation enabled).
   */
  approveAlwaysEnabled: boolean;
}

/**
 * Resolve feature flags from environment variables.
 *
 * Parsing rules:
 * - `CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1` → `approveAlwaysEnabled: false`
 * - unset or any other value               → `approveAlwaysEnabled: true`
 *
 * Exported as a pure function so unit tests can exercise every branch
 * by mutating `process.env.CLAWTHORITY_DISABLE_APPROVE_ALWAYS` in `beforeEach`.
 */
export function resolveFeatureFlags(): FeatureFlags {
  return {
    approveAlwaysEnabled: process.env.CLAWTHORITY_DISABLE_APPROVE_ALWAYS?.trim() !== '1',
  };
}

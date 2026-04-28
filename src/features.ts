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
   * messages and Telegram inline keyboards, and operators can create
   * session-scoped auto-permits by clicking it.
   *
   * Set `CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1` to disable. Existing
   * session auto-permits created before the flag was set continue to be
   * honoured — only creation of new ones is blocked.
   *
   * Default: `true` (button shown, creation enabled).
   */
  approveAlwaysEnabled: boolean;
  /**
   * When true, the "Approve Always" flow skips the pattern confirmation step
   * and immediately saves the derived auto-permit rule without prompting the
   * operator to review it first.
   *
   * Set `CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM=1` to enable.
   *
   * Default: `false` (confirmation prompt shown before saving the rule).
   */
  approveAlwaysAutoConfirm: boolean;
  /**
   * When true, HITL approval messages collapse to the v1.2.x minimal style:
   * raw command + buttons only, no command-explainer effects/warnings, no
   * "Why this is happening" section. Buttons (including 🔁 Approve Always)
   * continue to work — only the rich-body sections are suppressed.
   *
   * This is the §16 rollback escape hatch for situations where the
   * command-explainer produces confusing output and operators need to fall
   * back to inspecting the raw command directly.
   *
   * Set `CLAWTHORITY_HITL_MINIMAL=1` to enable.
   *
   * Default: `false` (rich message bodies rendered).
   */
  hitlMinimal: boolean;
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
    approveAlwaysAutoConfirm: process.env.CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM?.trim() === '1',
    hitlMinimal: process.env.CLAWTHORITY_HITL_MINIMAL?.trim() === '1',
  };
}

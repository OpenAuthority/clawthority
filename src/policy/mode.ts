/**
 * Install-mode resolution for Clawthority.
 *
 * The install mode is the single switch that controls the plugin's policy
 * posture at activation time:
 *
 * - `open`    — implicit permit. The policy engine ships with a minimal
 *               set of critical forbids (shell/code exec, payment,
 *               credential ops, unknown sensitive actions); everything
 *               else is permitted unless the operator adds forbid rules.
 *               Intended as the zero-friction default for new installs.
 *
 * - `closed`  — implicit deny. The policy engine ships with the full
 *               default rule set and denies any tool call that isn't
 *               explicitly permitted. Matches the pre-1.1.0 behaviour.
 *
 * Mode is read once at module load from the `CLAWTHORITY_MODE` environment
 * variable. A plugin restart is required to change it — this is a
 * deliberate constraint to keep the hot-reload path free of race
 * conditions between rule updates and posture flips.
 *
 * @module
 */

/** Valid install modes. */
export type ClawMode = 'open' | 'closed';

/**
 * Resolve the active install mode from the `CLAWTHORITY_MODE` env var.
 *
 * Parsing is case- and whitespace-insensitive:
 * - `"open"`, unset, or empty string → `open`
 * - `"closed"` → `closed`
 * - any other value → logs a warning to stderr and falls back to `open`
 *
 * Exported as a pure function so unit tests can exercise every branch
 * by mutating `process.env.CLAWTHORITY_MODE` in `beforeEach`.
 */
export function resolveMode(): ClawMode {
  const raw = process.env.CLAWTHORITY_MODE?.trim().toLowerCase();
  if (raw === 'closed') return 'closed';
  if (raw === 'open' || raw === undefined || raw === '') return 'open';
  console.warn(
    `[plugin:clawthority] invalid CLAWTHORITY_MODE="${raw}" — falling back to "open"`
  );
  return 'open';
}

/**
 * Map a resolved mode to the Cedar engine's `defaultEffect` — the decision
 * applied when no rule matches a request.
 */
export function modeToDefaultEffect(mode: ClawMode): 'permit' | 'forbid' {
  return mode === 'open' ? 'permit' : 'forbid';
}

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
 * Mode is initially read from the `CLAWTHORITY_MODE` environment variable.
 * Runtime callers can re-resolve from a file or control-plane value and
 * rebuild the policy engine atomically.
 *
 * @module
 */

/** Valid install modes. */
export type ClawMode = 'open' | 'closed';

/**
 * Parse a raw mode value from an environment variable, JSON file, or
 * control-plane update.
 *
 * Parsing is case- and whitespace-insensitive:
 * - `"open"`, unset, or empty string -> `open`
 * - `"closed"` → `closed`
 * - any other value → logs a warning to stderr and falls back to `open`
 */
export function resolveModeValue(rawValue: unknown, source = 'CLAWTHORITY_MODE'): ClawMode {
  const raw = typeof rawValue === 'string'
    ? rawValue.trim().toLowerCase()
    : rawValue === undefined || rawValue === null
      ? undefined
      : String(rawValue).trim().toLowerCase();

  if (raw === 'closed') return 'closed';
  if (raw === 'open' || raw === undefined || raw === '') return 'open';
  console.warn(
    `[plugin:clawthority] invalid ${source}="${raw}" — falling back to "open"`
  );
  return 'open';
}

/**
 * Resolve the active install mode from the `CLAWTHORITY_MODE` env var.
 *
 * Exported as a pure function so unit tests can exercise every branch
 * by mutating `process.env.CLAWTHORITY_MODE` in `beforeEach`.
 */
export function resolveMode(): ClawMode {
  return resolveModeValue(process.env.CLAWTHORITY_MODE, 'CLAWTHORITY_MODE');
}

/**
 * Map a resolved mode to the Cedar engine's `defaultEffect` — the decision
 * applied when no rule matches a request.
 */
export function modeToDefaultEffect(mode: ClawMode): 'permit' | 'forbid' {
  return mode === 'open' ? 'permit' : 'forbid';
}

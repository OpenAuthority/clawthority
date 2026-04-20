import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { HitlPolicyConfigSchema, type HitlPolicyConfig } from './types.js';
import { matchesActionPattern } from './matcher.js';

/** Thrown when a policy file cannot be read or parsed (syntax / IO error). */
export class HitlPolicyParseError extends Error {
  constructor(
    public readonly filePath: string,
    public override readonly cause: unknown,
  ) {
    super(`Failed to parse HITL policy file: ${filePath}`);
    this.name = 'HitlPolicyParseError';
  }
}

/** Thrown when a parsed policy file does not conform to the expected schema. */
export class HitlPolicyValidationError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly errors: string[],
  ) {
    super(
      `Invalid HITL policy configuration in: ${filePath}\n${errors.join('\n')}`,
    );
    this.name = 'HitlPolicyValidationError';
  }
}

/**
 * Deserialises `content` using the appropriate parser based on the file extension.
 * `.yaml` / `.yml` → YAML (via the `yaml` package).
 * Any other extension → JSON.
 */
async function deserialise(filePath: string, content: string): Promise<unknown> {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    const { parse } = await import('yaml');
    return parse(content) as unknown;
  }
  return JSON.parse(content) as unknown;
}

/**
 * Validates a raw (unknown) value against the `HitlPolicyConfig` schema using
 * TypeBox's `Value.Check`.
 *
 * @throws {HitlPolicyValidationError} when validation fails.
 */
export function validateHitlPolicyConfig(
  filePath: string,
  raw: unknown,
): HitlPolicyConfig {
  if (!Value.Check(HitlPolicyConfigSchema, raw)) {
    const errors = [...Value.Errors(HitlPolicyConfigSchema, raw)].map(
      (e) => `  ${e.path}: ${e.message}`,
    );
    throw new HitlPolicyValidationError(filePath, errors);
  }
  return raw;
}

/**
 * Returns the policy names that contain an action pattern matching
 * `unknown_sensitive_action` (directly or via wildcard).
 *
 * Exposed for testing. Production callers should use {@link parseHitlPolicyFile}
 * which logs a warning when any such match is found.
 */
export function findUnknownSensitiveActionMatches(
  config: HitlPolicyConfig,
): string[] {
  const hits: string[] = [];
  for (const policy of config.policies) {
    for (const pattern of policy.actions) {
      if (matchesActionPattern(pattern, 'unknown_sensitive_action')) {
        hits.push(policy.name);
        break;
      }
    }
  }
  return hits;
}

/**
 * Reads, parses, and validates a HITL policy file from disk.
 *
 * Supported formats:
 * - `.yaml` / `.yml` — YAML
 * - `.json` (or any other extension) — JSON
 *
 * @throws {HitlPolicyParseError} on IO or syntax errors.
 * @throws {HitlPolicyValidationError} when the file does not match the schema.
 */
export async function parseHitlPolicyFile(
  filePath: string,
): Promise<HitlPolicyConfig> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new HitlPolicyParseError(filePath, err);
  }

  let raw: unknown;
  try {
    raw = await deserialise(filePath, content);
  } catch (err) {
    throw new HitlPolicyParseError(filePath, err);
  }

  const config = validateHitlPolicyConfig(filePath, raw);

  // ── Footgun check ─────────────────────────────────────────────────────────
  // A HITL policy pattern that matches `unknown_sensitive_action` (directly
  // or via `*`) routes every unrecognised tool through approval. That sounds
  // safe but in practice it locks operators out: the agent's own recovery
  // tools (read/list/etc., anything not registered as an alias in the
  // normalizer) all need approval, so even fixing the policy file requires
  // a human click for every read. This has already produced one production
  // incident; warn loudly so operators catch the misconfiguration at load
  // time rather than after the approval queue piles up.
  const unknownMatches = findUnknownSensitiveActionMatches(config);
  if (unknownMatches.length > 0) {
    const list = unknownMatches.join(', ');
    console.warn(
      `[hitl-policy] ⚠ HITL policy "${list}" matches unknown_sensitive_action. ` +
      `This routes every tool not listed in the normalizer alias registry ` +
      `(src/enforcement/normalize.ts) through human approval, including ` +
      `read-only operations — typically causing an approval-loop lockout. ` +
      `Prefer registering the specific tool name as an alias or matching ` +
      `its real action class (e.g. filesystem.delete) instead.`
    );
  }

  return config;
}

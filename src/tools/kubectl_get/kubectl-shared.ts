/**
 * Shared validators for the kubectl_* typed tools (W5 of v1.3.2).
 *
 * Each kubectl typed tool re-imports the validators here rather than
 * duplicating regex sources. The validators reflect Kubernetes's own
 * naming rules (DNS-1123 labels, DNS-1123 subdomains) and reject shell
 * metacharacters that are not part of those rules.
 *
 * No child_process imports here — actual `spawnSync` calls live in the
 * per-tool implementation files.
 */

// ─── Shell metacharacter denylist ─────────────────────────────────────────────

const SHELL_METACHARACTERS = /[;&|`$(){}\\'"]/;

// ─── DNS naming patterns ──────────────────────────────────────────────────────

/**
 * DNS-1123 label. Used for namespaces, pod names, service names, etc.
 * Lowercase letters, digits, hyphens; cannot start or end with hyphen.
 * Up to 63 characters.
 */
const DNS_1123_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

/**
 * DNS-1123 subdomain. Used for resource names that may contain dots.
 * One or more DNS-1123 labels separated by dots. Up to 253 characters.
 */
const DNS_1123_SUBDOMAIN =
  /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?(\.[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?)*$/;

/**
 * Resource type string. Matches `deployments`, `pods`, `pvc`, the
 * common `kind/name` short form (`pod/foo`), and grouped forms like
 * `deployments.apps`. Lowercase letters, digits, dots, hyphens, slashes.
 */
const RESOURCE_TYPE = /^[a-z][a-z0-9.\-/]*$/;

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Validates a Kubernetes namespace name (DNS-1123 label).
 */
export function validateNamespace(namespace: string): boolean {
  if (typeof namespace !== 'string') return false;
  const trimmed = namespace.trim();
  if (trimmed.length === 0 || trimmed.length > 63) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return DNS_1123_LABEL.test(trimmed);
}

/**
 * Validates a Kubernetes resource name (DNS-1123 subdomain).
 */
export function validateResourceName(name: string): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 253) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return DNS_1123_SUBDOMAIN.test(trimmed);
}

/**
 * Validates a kubectl resource type string (e.g. "pods", "deployments.apps").
 */
export function validateResourceType(resource: string): boolean {
  if (typeof resource !== 'string') return false;
  const trimmed = resource.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return RESOURCE_TYPE.test(trimmed);
}

/**
 * Validates a manifest file path. Same rules as the chmod_path /
 * chown_path validators — non-empty string, no shell metacharacters.
 * The wrapper does not resolve relative paths or apply path-policy
 * checks; that lives at the enforcement layer.
 */
export function validateManifestPath(path: string): boolean {
  if (typeof path !== 'string') return false;
  const trimmed = path.trim();
  if (trimmed.length === 0) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return true;
}

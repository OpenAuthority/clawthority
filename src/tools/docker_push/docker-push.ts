/**
 * docker_push tool implementation.
 *
 * Wraps `docker push <image>` with a typed parameter schema.
 *
 * Action class: cluster.write
 *
 * Image references reuse the same DOCKER_IMAGE_REF regex from the
 * docker_run typed tool, plus a stricter rule for the optional
 * `registry` prefix when supplied separately. The `all_tags` flag
 * passes `--all-tags` to docker push (mutually exclusive with a
 * tagged image ref).
 */

import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DockerPushParams {
  /** Docker image reference (e.g. "myapp:1.0", "registry.example.com/team/app:tag"). */
  image: string;
  /**
   * Optional registry hostname. When supplied, it is prepended to the
   * image reference if the image does not already begin with it. For
   * example: `image: "myapp:tag"` + `registry: "ghcr.io/team"` →
   * pushes `ghcr.io/team/myapp:tag`.
   */
  registry?: string;
  /**
   * When true, pass `--all-tags` to docker push. Cannot be combined
   * with a tagged image reference.
   */
  all_tags?: boolean;
}

export interface DockerPushResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class DockerPushError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid-image-ref'
      | 'invalid-registry'
      | 'all-tags-with-tag',
  ) {
    super(message);
    this.name = 'DockerPushError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const SHELL_METACHARACTERS = /[;&|`$(){}\\'"]/;

/** Same image-ref pattern used by docker_run. */
const DOCKER_IMAGE_REF =
  /^[a-zA-Z0-9][a-zA-Z0-9._\-/:]*(@sha256:[a-fA-F0-9]+)?$/;

/**
 * Registry hostname pattern. Letters, digits, dots, hyphens, optional
 * port (`:5000`), and an optional `/namespace` path. Examples:
 * `ghcr.io`, `registry.example.com:5000`, `ghcr.io/team`.
 */
const DOCKER_REGISTRY = /^[a-zA-Z0-9][a-zA-Z0-9.\-]*(:\d{1,5})?(\/[a-zA-Z0-9._\-/]+)?$/;

export function validateImageRef(ref: string): boolean {
  if (typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (trimmed.length === 0) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return DOCKER_IMAGE_REF.test(trimmed);
}

export function validateRegistry(registry: string): boolean {
  if (typeof registry !== 'string') return false;
  const trimmed = registry.trim();
  if (trimmed.length === 0) return false;
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return DOCKER_REGISTRY.test(trimmed);
}

/** Tells whether an image reference includes an explicit tag. */
function hasExplicitTag(image: string): boolean {
  // Heuristic: a `:` after the last `/` indicates a tag (the colon before
  // the last `/` would be a registry port, which we ignore here).
  const lastSlash = image.lastIndexOf('/');
  const tail = lastSlash >= 0 ? image.slice(lastSlash + 1) : image;
  return tail.includes(':');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function dockerPush(params: DockerPushParams): DockerPushResult {
  const { image, registry, all_tags } = params;

  if (!validateImageRef(image)) {
    throw new DockerPushError(
      `Invalid Docker image reference: "${image}".`,
      'invalid-image-ref',
    );
  }

  if (registry !== undefined && !validateRegistry(registry)) {
    throw new DockerPushError(
      `Invalid Docker registry: "${registry}".`,
      'invalid-registry',
    );
  }

  if (all_tags && hasExplicitTag(image)) {
    throw new DockerPushError(
      `--all-tags cannot be combined with a tagged image reference: "${image}".`,
      'all-tags-with-tag',
    );
  }

  // Prepend the registry only when the image does not already begin with it.
  const effectiveImage =
    registry !== undefined && !image.startsWith(`${registry}/`)
      ? `${registry}/${image}`
      : image;

  const args: string[] = ['push'];
  if (all_tags) args.push('--all-tags');
  args.push(effectiveImage);

  const result = spawnSync('docker', args, {
    encoding: 'utf-8',
    shell: false,
  });

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    exit_code: result.status ?? 1,
  };
}

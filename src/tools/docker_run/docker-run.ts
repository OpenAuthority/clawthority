/**
 * docker_run tool implementation.
 *
 * Runs a Docker container by invoking `docker run [options] <image> [command]`
 * via `spawnSync`. Arguments are passed directly to the child process — no
 * shell interpolation occurs.
 *
 * Supports:
 *   - Named image references with optional tags and digests
 *   - Volume mounts (-v)
 *   - Environment variables (-e)
 *   - Port mappings (-p)
 *   - Network mode (--network)
 *   - Auto-remove on exit (--rm, enabled by default)
 *   - User override (--user)
 *   - Entrypoint override (--entrypoint)
 *   - Platform targeting (--platform)
 *
 * Image references are validated against Docker naming rules before invoking
 * docker. Volume and env specs are validated for shell-safety. Invalid inputs
 * cause a pre-flight DockerRunError to be thrown.
 *
 * Non-zero exit codes from docker are **not** thrown — they are returned in
 * `result.exit_code` so the caller can inspect the container outcome.
 *
 * Action class: code.execute
 */

import { spawnSync } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the docker_run tool. */
export interface DockerRunParams {
  /**
   * Docker image reference to run (e.g. "ubuntu:22.04", "node:20-alpine",
   * "registry.example.com/my/image:tag"). Must be a valid image reference.
   */
  image: string;
  /**
   * Command to run inside the container. When omitted, the image default
   * entrypoint/command is used.
   */
  command?: string[];
  /**
   * Host working directory for the `docker run` command itself.
   * Defaults to the current working directory.
   */
  working_dir?: string;
  /**
   * Volume mount specifications (e.g. ["/host/path:/container/path"]).
   * Each entry is passed as -v to docker run.
   */
  volumes?: string[];
  /**
   * Environment variable assignments (e.g. ["FOO=bar", "DEBUG=1"]).
   * Each entry is passed as -e to docker run.
   */
  env?: string[];
  /**
   * Port mapping specifications (e.g. ["8080:80", "443:443"]).
   * Each entry is passed as -p to docker run.
   */
  ports?: string[];
  /**
   * Network mode for the container (e.g. "bridge", "host", "none").
   * Passed as --network to docker run.
   */
  network?: string;
  /**
   * When true (default), pass --rm to automatically remove the container after it exits.
   */
  rm?: boolean;
  /**
   * Username or UID (optionally with group) to run as inside the container.
   * Passed as --user to docker run.
   */
  user?: string;
  /**
   * Override the image default entrypoint. Passed as --entrypoint to docker run.
   */
  entrypoint?: string;
  /**
   * Target platform for the container (e.g. "linux/amd64", "linux/arm64").
   * Passed as --platform to docker run.
   */
  platform?: string;
}

/** Result returned by the docker_run tool. */
export interface DockerRunResult {
  /** Standard output captured from the container. */
  stdout: string;
  /** Standard error captured from the container. */
  stderr: string;
  /** Container exit code. Non-zero indicates the container exited with an error. */
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `dockerRun` during pre-flight validation.
 *
 * - `invalid-image-ref`   — the image reference fails naming rules.
 * - `invalid-volume-spec` — a volume mount spec is malformed.
 * - `invalid-env-spec`    — an environment variable spec is malformed.
 * - `invalid-port-spec`   — a port mapping spec is malformed.
 */
export class DockerRunError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid-image-ref'
      | 'invalid-volume-spec'
      | 'invalid-env-spec'
      | 'invalid-port-spec',
  ) {
    super(message);
    this.name = 'DockerRunError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Shell metacharacters that must not appear in option values passed to docker.
 * These characters could cause injection if the value were ever shell-expanded.
 * Since we use spawnSync with an array (no shell), the risk is theoretical but
 * we still reject them as a defense-in-depth policy.
 */
const SHELL_METACHARACTERS = /[;&|`$(){}\\'"]/;

/**
 * Docker image reference pattern.
 *
 * Accepts:
 *   - Simple name:          `ubuntu`
 *   - With tag:             `ubuntu:22.04`
 *   - With digest:          `ubuntu@sha256:abc123`
 *   - With registry:        `registry.example.com/my/image:tag`
 *   - With registry+port:   `registry.example.com:5000/my/image:tag`
 *   - Official library:     `library/ubuntu:22.04`
 *
 * The pattern allows letters, digits, hyphens, dots, underscores, slashes,
 * colons, and @. The @ character is restricted to the digest form.
 */
const DOCKER_IMAGE_REF =
  /^[a-zA-Z0-9][a-zA-Z0-9._\-/:]*(@sha256:[a-fA-F0-9]+)?$/;

/**
 * Validates a Docker image reference string.
 *
 * @param ref - The image reference to validate.
 * @returns `true` when the reference is valid, `false` otherwise.
 */
export function validateImageRef(ref: string): boolean {
  if (typeof ref !== 'string' || ref.trim().length === 0) return false;

  const trimmed = ref.trim();

  // Reject shell metacharacters.
  if (SHELL_METACHARACTERS.test(trimmed)) return false;

  return DOCKER_IMAGE_REF.test(trimmed);
}

/**
 * Validates a Docker volume mount specification.
 *
 * Accepts:
 *   - Named volume:        `myvolume:/data`
 *   - Absolute host path:  `/host/path:/container/path`
 *   - With options:        `/host/path:/container/path:ro`
 *
 * @param spec - The volume spec to validate.
 * @returns `true` when the spec is valid, `false` otherwise.
 */
export function validateVolumeSpec(spec: string): boolean {
  if (typeof spec !== 'string' || spec.trim().length === 0) return false;

  const trimmed = spec.trim();

  // Reject shell metacharacters.
  if (SHELL_METACHARACTERS.test(trimmed)) return false;

  // Must contain at least one colon separating host and container paths.
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1 || colonIdx === 0 || colonIdx === trimmed.length - 1) return false;

  return true;
}

/**
 * Validates a Docker environment variable specification.
 *
 * Accepts:
 *   - `KEY=value`  — key/value pair
 *   - `KEY`        — key-only form (inherits from host environment)
 *
 * Rejects:
 *   - Empty strings
 *   - Shell metacharacters in the key
 *
 * @param spec - The env spec to validate.
 * @returns `true` when the spec is valid, `false` otherwise.
 */
export function validateEnvSpec(spec: string): boolean {
  if (typeof spec !== 'string' || spec.trim().length === 0) return false;

  const trimmed = spec.trim();

  // Extract the key portion (before the first `=`, or the whole string if no `=`).
  const eqIdx = trimmed.indexOf('=');
  const key = eqIdx === -1 ? trimmed : trimmed.slice(0, eqIdx);

  // Key must be a valid environment variable name: letters, digits, underscores,
  // starting with a letter or underscore.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return false;

  // Reject shell metacharacters in the value portion.
  if (eqIdx !== -1) {
    const value = trimmed.slice(eqIdx + 1);
    if (SHELL_METACHARACTERS.test(value)) return false;
  }

  return true;
}

/**
 * Validates a Docker port mapping specification.
 *
 * Accepts:
 *   - `hostPort:containerPort`       — e.g. "8080:80"
 *   - `hostIP:hostPort:containerPort` — e.g. "127.0.0.1:8080:80"
 *   - `containerPort`                — e.g. "80" (random host port)
 *   - `hostPort:containerPort/proto` — e.g. "8080:80/tcp"
 *
 * @param spec - The port mapping spec to validate.
 * @returns `true` when the spec is valid, `false` otherwise.
 */
export function validatePortSpec(spec: string): boolean {
  if (typeof spec !== 'string' || spec.trim().length === 0) return false;

  const trimmed = spec.trim();

  // Reject shell metacharacters.
  if (SHELL_METACHARACTERS.test(trimmed)) return false;

  // Allowed characters: digits, dots (for IP), colons, slashes (for proto), letters (for proto).
  if (!/^[0-9a-zA-Z.:/_-]+$/.test(trimmed)) return false;

  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs a Docker container using `docker run`.
 *
 * Pre-flight validation throws `DockerRunError` for:
 * - An image reference that fails Docker naming rules (`invalid-image-ref`)
 * - A volume spec that is malformed or contains shell metacharacters (`invalid-volume-spec`)
 * - An env spec with an invalid variable name or shell metacharacters (`invalid-env-spec`)
 * - A port spec that is malformed or contains shell metacharacters (`invalid-port-spec`)
 *
 * Non-zero exit codes from docker are **not** thrown — they are returned in
 * `result.exit_code` so the caller can inspect the container outcome.
 *
 * By default, `--rm` is passed to clean up the container after it exits.
 * Set `params.rm = false` to disable auto-removal.
 *
 * @param params       Tool parameters (see {@link DockerRunParams}).
 * @param options.cwd  Base working directory. Defaults to `process.cwd()`.
 * @returns            `{ stdout, stderr, exit_code }`.
 *
 * @throws {DockerRunError} code `invalid-image-ref`   — image ref fails validation.
 * @throws {DockerRunError} code `invalid-volume-spec` — a volume spec is malformed.
 * @throws {DockerRunError} code `invalid-env-spec`    — an env spec is malformed.
 * @throws {DockerRunError} code `invalid-port-spec`   — a port spec is malformed.
 */
export function dockerRun(
  params: DockerRunParams,
  options: { cwd?: string } = {},
): DockerRunResult {
  const {
    image,
    command,
    working_dir,
    volumes,
    env,
    ports,
    network,
    rm = true,
    user,
    entrypoint,
    platform,
  } = params;

  // Validate the image reference.
  if (!validateImageRef(image)) {
    throw new DockerRunError(
      `Invalid Docker image reference: "${image}". ` +
        'Image references must be valid Docker names (e.g. "ubuntu:22.04", ' +
        '"registry.example.com/my/image:tag").',
      'invalid-image-ref',
    );
  }

  // Validate volume specs.
  if (Array.isArray(volumes) && volumes.length > 0) {
    for (const vol of volumes) {
      if (!validateVolumeSpec(vol)) {
        throw new DockerRunError(
          `Invalid volume mount specification: "${vol}". ` +
            'Volume specs must be in the form "hostPath:containerPath[:options]".',
          'invalid-volume-spec',
        );
      }
    }
  }

  // Validate env specs.
  if (Array.isArray(env) && env.length > 0) {
    for (const envEntry of env) {
      if (!validateEnvSpec(envEntry)) {
        throw new DockerRunError(
          `Invalid environment variable specification: "${envEntry}". ` +
            'Env specs must be in the form "KEY=value" or "KEY" (valid identifier characters).',
          'invalid-env-spec',
        );
      }
    }
  }

  // Validate port specs.
  if (Array.isArray(ports) && ports.length > 0) {
    for (const port of ports) {
      if (!validatePortSpec(port)) {
        throw new DockerRunError(
          `Invalid port mapping specification: "${port}". ` +
            'Port specs must be in the form "hostPort:containerPort" or "containerPort".',
          'invalid-port-spec',
        );
      }
    }
  }

  // Resolve the effective working directory for the docker command.
  const baseCwd = options.cwd ?? process.cwd();
  const effectiveCwd =
    working_dir !== undefined
      ? isAbsolute(working_dir)
        ? working_dir
        : resolve(baseCwd, working_dir)
      : baseCwd;

  // Build the docker argument list.
  const dockerArgs: string[] = ['run'];

  if (rm) {
    dockerArgs.push('--rm');
  }

  if (platform !== undefined) {
    dockerArgs.push('--platform', platform);
  }

  if (network !== undefined) {
    dockerArgs.push('--network', network);
  }

  if (user !== undefined) {
    dockerArgs.push('--user', user);
  }

  if (entrypoint !== undefined) {
    dockerArgs.push('--entrypoint', entrypoint);
  }

  if (Array.isArray(volumes) && volumes.length > 0) {
    for (const vol of volumes) {
      dockerArgs.push('-v', vol);
    }
  }

  if (Array.isArray(env) && env.length > 0) {
    for (const envEntry of env) {
      dockerArgs.push('-e', envEntry);
    }
  }

  if (Array.isArray(ports) && ports.length > 0) {
    for (const port of ports) {
      dockerArgs.push('-p', port);
    }
  }

  // Image reference — always last before the command.
  dockerArgs.push(image);

  // Optional command inside the container.
  if (Array.isArray(command) && command.length > 0) {
    dockerArgs.push(...command);
  }

  const result = spawnSync('docker', dockerArgs, {
    cwd: effectiveCwd,
    encoding: 'utf-8',
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitCode = result.status ?? 1;

  return { stdout, stderr, exit_code: exitCode };
}

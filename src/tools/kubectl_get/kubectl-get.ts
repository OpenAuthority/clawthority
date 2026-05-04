/**
 * kubectl_get tool implementation.
 *
 * Wraps `kubectl get <resource> [name] [-n namespace] [-o output]`
 * with a typed parameter schema.
 *
 * Action class: cluster.read
 *
 * The only kubectl tool that maps to `cluster.read` — every other
 * kubectl_* typed tool routes to `cluster.write` because they modify
 * cluster state. See [docs/rfc/RFC-003-cluster-manage.md](../../../docs/rfc/RFC-003-cluster-manage.md).
 */

import { spawnSync } from 'node:child_process';
import {
  validateNamespace,
  validateResourceName,
  validateResourceType,
} from './kubectl-shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export const KUBECTL_GET_OUTPUTS = ['yaml', 'json', 'wide', 'name'] as const;
export type KubectlGetOutput = (typeof KUBECTL_GET_OUTPUTS)[number];

export interface KubectlGetParams {
  /** Resource type (e.g. `pods`, `deployments.apps`). */
  resource: string;
  /** Optional resource name. When omitted, lists all resources of `resource` type. */
  name?: string;
  /** Optional namespace. Defaults to the current kubectl context. */
  namespace?: string;
  /** Optional output format. Defaults to kubectl's default (table). */
  output?: KubectlGetOutput;
}

export interface KubectlGetResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class KubectlGetError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid-resource'
      | 'invalid-name'
      | 'invalid-namespace'
      | 'invalid-output',
  ) {
    super(message);
    this.name = 'KubectlGetError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function validateOutput(output: string): output is KubectlGetOutput {
  return (KUBECTL_GET_OUTPUTS as readonly string[]).includes(output);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function kubectlGet(params: KubectlGetParams): KubectlGetResult {
  const { resource, name, namespace, output } = params;

  if (!validateResourceType(resource)) {
    throw new KubectlGetError(
      `Invalid kubectl resource type: "${resource}".`,
      'invalid-resource',
    );
  }

  if (name !== undefined && !validateResourceName(name)) {
    throw new KubectlGetError(
      `Invalid kubectl resource name: "${name}".`,
      'invalid-name',
    );
  }

  if (namespace !== undefined && !validateNamespace(namespace)) {
    throw new KubectlGetError(
      `Invalid kubectl namespace: "${namespace}".`,
      'invalid-namespace',
    );
  }

  if (output !== undefined && !validateOutput(output)) {
    throw new KubectlGetError(
      `Invalid kubectl output format: "${output}". ` +
        `Output must be one of: ${KUBECTL_GET_OUTPUTS.join(', ')}.`,
      'invalid-output',
    );
  }

  const args: string[] = ['get', resource];
  if (name !== undefined) args.push(name);
  if (namespace !== undefined) args.push('-n', namespace);
  if (output !== undefined) args.push('-o', output);

  const result = spawnSync('kubectl', args, {
    encoding: 'utf-8',
    shell: false,
  });

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    exit_code: result.status ?? 1,
  };
}

/**
 * kubectl_delete tool implementation.
 *
 * Wraps `kubectl delete <resource> <name> [-n namespace] [--grace-period=<n>]`
 * with a typed parameter schema.
 *
 * Action class: cluster.write
 *
 * Unlike kubectl_get, the resource name is **required** here — the
 * unrestricted form (`kubectl delete pods --all`) is intentionally not
 * exposed. Operators who need bulk deletion fall back to `unsafe_admin_exec`.
 */

import { spawnSync } from 'node:child_process';
import {
  validateNamespace,
  validateResourceName,
  validateResourceType,
} from '../kubectl_get/kubectl-shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KubectlDeleteParams {
  resource: string;
  name: string;
  namespace?: string;
  /** Optional grace period in seconds. Must be a non-negative integer. */
  grace_period?: number;
}

export interface KubectlDeleteResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class KubectlDeleteError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid-resource'
      | 'invalid-name'
      | 'invalid-namespace'
      | 'invalid-grace-period',
  ) {
    super(message);
    this.name = 'KubectlDeleteError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function kubectlDelete(
  params: KubectlDeleteParams,
): KubectlDeleteResult {
  const { resource, name, namespace, grace_period } = params;

  if (!validateResourceType(resource)) {
    throw new KubectlDeleteError(
      `Invalid kubectl resource type: "${resource}".`,
      'invalid-resource',
    );
  }

  if (!validateResourceName(name)) {
    throw new KubectlDeleteError(
      `Invalid kubectl resource name: "${name}".`,
      'invalid-name',
    );
  }

  if (namespace !== undefined && !validateNamespace(namespace)) {
    throw new KubectlDeleteError(
      `Invalid kubectl namespace: "${namespace}".`,
      'invalid-namespace',
    );
  }

  if (
    grace_period !== undefined &&
    (!Number.isInteger(grace_period) ||
      grace_period < 0 ||
      !Number.isSafeInteger(grace_period))
  ) {
    throw new KubectlDeleteError(
      `Invalid grace period: ${String(grace_period)}. ` +
        'grace_period must be a non-negative safe integer.',
      'invalid-grace-period',
    );
  }

  const args: string[] = ['delete', resource, name];
  if (namespace !== undefined) args.push('-n', namespace);
  if (grace_period !== undefined) {
    args.push(`--grace-period=${grace_period}`);
  }

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

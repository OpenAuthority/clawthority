/**
 * kubectl_rollout tool implementation.
 *
 * Wraps `kubectl rollout <action> <resource>/<name> [-n namespace]`
 * with a typed parameter schema.
 *
 * Action class: cluster.write
 *
 * Three rollout actions are supported: `status` (read-leaning but
 * still binds to cluster.write because rollout history is a write
 * concept), `restart`, and `undo`.
 */

import { spawnSync } from 'node:child_process';
import {
  validateNamespace,
  validateResourceName,
  validateResourceType,
} from '../kubectl_get/kubectl-shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export const ROLLOUT_ACTIONS = ['status', 'restart', 'undo'] as const;
export type RolloutAction = (typeof ROLLOUT_ACTIONS)[number];

export interface KubectlRolloutParams {
  action: RolloutAction;
  resource: string;
  name: string;
  namespace?: string;
}

export interface KubectlRolloutResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class KubectlRolloutError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid-action'
      | 'invalid-resource'
      | 'invalid-name'
      | 'invalid-namespace',
  ) {
    super(message);
    this.name = 'KubectlRolloutError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function validateAction(action: string): action is RolloutAction {
  return (ROLLOUT_ACTIONS as readonly string[]).includes(action);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function kubectlRollout(
  params: KubectlRolloutParams,
): KubectlRolloutResult {
  const { action, resource, name, namespace } = params;

  if (!validateAction(action)) {
    throw new KubectlRolloutError(
      `Invalid kubectl rollout action: "${action}". ` +
        `Action must be one of: ${ROLLOUT_ACTIONS.join(', ')}.`,
      'invalid-action',
    );
  }

  if (!validateResourceType(resource)) {
    throw new KubectlRolloutError(
      `Invalid kubectl resource type: "${resource}".`,
      'invalid-resource',
    );
  }

  if (!validateResourceName(name)) {
    throw new KubectlRolloutError(
      `Invalid kubectl resource name: "${name}".`,
      'invalid-name',
    );
  }

  if (namespace !== undefined && !validateNamespace(namespace)) {
    throw new KubectlRolloutError(
      `Invalid kubectl namespace: "${namespace}".`,
      'invalid-namespace',
    );
  }

  const args: string[] = ['rollout', action, `${resource}/${name}`];
  if (namespace !== undefined) args.push('-n', namespace);

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

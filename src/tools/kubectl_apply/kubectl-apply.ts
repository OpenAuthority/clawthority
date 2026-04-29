/**
 * kubectl_apply tool implementation.
 *
 * Wraps `kubectl apply -f <manifest_path> [-n namespace] [--dry-run]`
 * with a typed parameter schema.
 *
 * Action class: cluster.write
 */

import { spawnSync } from 'node:child_process';
import {
  validateNamespace,
  validateManifestPath,
} from '../kubectl_get/kubectl-shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KubectlApplyParams {
  /** Path to the manifest file (or directory of manifests). */
  manifest_path: string;
  /** Optional namespace. Defaults to the namespace declared in the manifest. */
  namespace?: string;
  /** When true, pass --dry-run=client. */
  dry_run?: boolean;
}

export interface KubectlApplyResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class KubectlApplyError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-manifest-path' | 'invalid-namespace',
  ) {
    super(message);
    this.name = 'KubectlApplyError';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function kubectlApply(params: KubectlApplyParams): KubectlApplyResult {
  const { manifest_path, namespace, dry_run } = params;

  if (!validateManifestPath(manifest_path)) {
    throw new KubectlApplyError(
      `Invalid kubectl apply manifest path: "${manifest_path}".`,
      'invalid-manifest-path',
    );
  }

  if (namespace !== undefined && !validateNamespace(namespace)) {
    throw new KubectlApplyError(
      `Invalid kubectl namespace: "${namespace}".`,
      'invalid-namespace',
    );
  }

  const args: string[] = ['apply', '-f', manifest_path];
  if (namespace !== undefined) args.push('-n', namespace);
  if (dry_run) args.push('--dry-run=client');

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

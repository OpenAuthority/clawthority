/**
 * F-05 manifest for the kubectl_apply tool.
 *
 * Action class: cluster.write
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const kubectlApplyManifest: ToolManifest = {
  name: 'kubectl_apply',
  version: '1.0.0',
  action_class: 'cluster.write',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  target_field: 'manifest_path',
  params: {
    type: 'object',
    properties: {
      manifest_path: {
        type: 'string',
        minLength: 1,
        description: 'Path to a manifest file or directory of manifests.',
      },
      namespace: {
        type: 'string',
        minLength: 1,
        maxLength: 63,
        description:
          'Optional namespace. Defaults to the namespace declared in the manifest.',
      },
      dry_run: {
        type: 'boolean',
        description: 'When true, pass --dry-run=client.',
      },
    },
    required: ['manifest_path'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: { type: 'string', description: 'Standard output from kubectl.' },
      stderr: { type: 'string', description: 'Standard error from kubectl.' },
      exit_code: { type: 'number', description: 'Exit code from kubectl.' },
    },
  },
};

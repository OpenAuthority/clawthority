/**
 * F-05 manifest for the kubectl_get tool.
 *
 * Action class: cluster.read
 *
 * The only kubectl_* typed tool that binds to cluster.read; every
 * other kubectl_* tool binds to cluster.write. See RFC-003.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';
import { KUBECTL_GET_OUTPUTS } from './kubectl-get.js';

export const kubectlGetManifest: ToolManifest = {
  name: 'kubectl_get',
  version: '1.0.0',
  action_class: 'cluster.read',
  risk_tier: 'low',
  default_hitl_mode: 'per_request',
  target_field: 'resource',
  params: {
    type: 'object',
    properties: {
      resource: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[a-z][a-z0-9.\\-/]*$',
        description: 'Kubernetes resource type (e.g. "pods", "deployments.apps").',
      },
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 253,
        description: 'Optional resource name (DNS-1123 subdomain).',
      },
      namespace: {
        type: 'string',
        minLength: 1,
        maxLength: 63,
        description:
          'Optional namespace (DNS-1123 label). Defaults to the current kubectl context.',
      },
      output: {
        type: 'string',
        enum: [...KUBECTL_GET_OUTPUTS],
        description: 'Optional output format passed as -o.',
      },
    },
    required: ['resource'],
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

/**
 * F-05 manifest for the kubectl_delete tool.
 *
 * Action class: cluster.write
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const kubectlDeleteManifest: ToolManifest = {
  name: 'kubectl_delete',
  version: '1.0.0',
  action_class: 'cluster.write',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  target_field: 'name',
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
        description: 'Resource name (DNS-1123 subdomain). Required.',
      },
      namespace: {
        type: 'string',
        minLength: 1,
        maxLength: 63,
        description: 'Optional namespace (DNS-1123 label).',
      },
      grace_period: {
        type: 'integer',
        minimum: 0,
        description: 'Optional grace period in seconds (--grace-period=<n>).',
      },
    },
    required: ['resource', 'name'],
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

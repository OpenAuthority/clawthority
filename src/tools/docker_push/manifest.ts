/**
 * F-05 manifest for the docker_push tool.
 *
 * Action class: cluster.write
 *
 * Pushing an image to a shared registry is a write to shared
 * infrastructure that other workloads pull from — the operator-relevant
 * risk model overlaps with cluster-write. See RFC-003 §Open Questions.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const dockerPushManifest: ToolManifest = {
  name: 'docker_push',
  version: '1.0.0',
  action_class: 'cluster.write',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  target_field: 'image',
  params: {
    type: 'object',
    properties: {
      image: {
        type: 'string',
        minLength: 1,
        description:
          'Docker image reference (e.g. "myapp:1.0", "ghcr.io/team/app:tag").',
      },
      registry: {
        type: 'string',
        minLength: 1,
        description:
          'Optional registry hostname. Prepended to the image when the image ' +
          'does not already begin with it.',
      },
      all_tags: {
        type: 'boolean',
        description:
          'When true, pass --all-tags to docker push. Mutually exclusive with ' +
          'a tagged image reference.',
      },
    },
    required: ['image'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: { type: 'string', description: 'Standard output from docker.' },
      stderr: { type: 'string', description: 'Standard error from docker.' },
      exit_code: { type: 'number', description: 'Exit code from docker.' },
    },
  },
};

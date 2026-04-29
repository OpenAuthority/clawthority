/**
 * F-05 manifest for the chown_path tool.
 *
 * Action class: permissions.modify
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const chownPathManifest: ToolManifest = {
  name: 'chown_path',
  version: '1.0.0',
  action_class: 'permissions.modify',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  target_field: 'path',
  params: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        minLength: 1,
        description:
          'Filesystem path to chown. Passed verbatim to chown via spawnSync.',
      },
      owner: {
        type: 'string',
        minLength: 1,
        description:
          'Owner spec. One of: "user", "user:group", "user:", ":group". ' +
          'Identifiers are POSIX-portable names or numeric uid/gid.',
      },
      recursive: {
        type: 'boolean',
        description: 'When true, pass -R to chown for recursive application.',
      },
    },
    required: ['path', 'owner'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: { type: 'string', description: 'Standard output from chown.' },
      stderr: { type: 'string', description: 'Standard error from chown.' },
      exit_code: { type: 'number', description: 'Exit code from chown.' },
    },
  },
};

/**
 * F-05 manifest for the chmod_path tool.
 *
 * Action class: permissions.modify
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const chmodPathManifest: ToolManifest = {
  name: 'chmod_path',
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
          'Filesystem path to chmod. Passed verbatim to chmod via spawnSync.',
      },
      mode: {
        type: 'string',
        minLength: 1,
        pattern:
          '^[0-7]{3,4}$|^[ugoa]*[+\\-=][rwxXst]+(,[ugoa]*[+\\-=][rwxXst]+)*$',
        description:
          'Mode in numeric (e.g. "755", "0644") or symbolic (e.g. "u+x", ' +
          '"go-w", "a=r,u+x") form.',
      },
      recursive: {
        type: 'boolean',
        description: 'When true, pass -R to chmod for recursive application.',
      },
    },
    required: ['path', 'mode'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: { type: 'string', description: 'Standard output from chmod.' },
      stderr: { type: 'string', description: 'Standard error from chmod.' },
      exit_code: { type: 'number', description: 'Exit code from chmod.' },
    },
  },
};

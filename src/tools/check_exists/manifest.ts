/**
 * F-05 manifest for the check_exists tool.
 *
 * Action class: filesystem.read
 * Checks whether a given path exists in the filesystem, returning a boolean
 * result for both files and directories.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const checkExistsManifest: ToolManifest = {
  name: 'check_exists',
  version: '1.0.0',
  action_class: 'filesystem.read',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to check for existence.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      exists: {
        type: 'boolean',
        description: 'Whether the path exists in the filesystem.',
      },
    },
  },
};

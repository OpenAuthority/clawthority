/**
 * F-05 manifest for the create_directory tool.
 *
 * Action class: filesystem.write
 * Creates a directory at the specified path, including any missing parent
 * directories. Returns gracefully if the directory already exists.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const createDirectoryManifest: ToolManifest = {
  name: 'create_directory',
  version: '1.0.0',
  action_class: 'filesystem.write',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path of the directory to create. Parent directories are created automatically.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path of the created (or already existing) directory.',
      },
    },
  },
};

/**
 * F-05 manifest for the delete_file tool.
 *
 * Action class: filesystem.delete
 * Removes a file or empty directory at the specified path.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const deleteFileManifest: ToolManifest = {
  name: 'delete_file',
  version: '1.0.0',
  action_class: 'filesystem.delete',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path of the file or empty directory to delete.',
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
        description: 'Absolute path of the deleted file or directory.',
      },
    },
  },
};

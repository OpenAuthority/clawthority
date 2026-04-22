/**
 * F-05 manifest for the edit_file tool.
 *
 * Action class: filesystem.write
 * Replaces the first occurrence of old_string with new_string in a file.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const editFileManifest: ToolManifest = {
  name: 'edit_file',
  version: '1.0.0',
  action_class: 'filesystem.write',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to edit.',
      },
      old_string: {
        type: 'string',
        description: 'The string to find and replace in the file.',
      },
      new_string: {
        type: 'string',
        description: 'The string to replace old_string with.',
      },
    },
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path of the modified file.',
      },
    },
  },
};

/**
 * F-05 manifest for the copy_file tool.
 *
 * Action class: filesystem.write
 * Copies a file from a source path to a destination path.
 * The source file remains unchanged after the operation.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const copyFileManifest: ToolManifest = {
  name: 'copy_file',
  version: '1.0.0',
  action_class: 'filesystem.write',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Path of the source file to copy.',
      },
      to: {
        type: 'string',
        description: 'Path of the destination file.',
      },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Absolute path of the source file.',
      },
      to: {
        type: 'string',
        description: 'Absolute path of the destination file.',
      },
    },
  },
};

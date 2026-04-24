/**
 * F-05 manifest for the append_file tool.
 *
 * Action class: filesystem.write
 * Appends content to a file, creating it (and any missing parent directories)
 * if it does not exist.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const appendFileManifest: ToolManifest = {
  name: 'append_file',
  version: '1.0.0',
  action_class: 'filesystem.write',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to append to.',
      },
      content: {
        type: 'string',
        description: 'UTF-8 text content to append to the file.',
      },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path of the file that was appended to.',
      },
    },
  },
};

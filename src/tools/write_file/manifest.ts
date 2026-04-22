/**
 * F-05 manifest for the write_file tool.
 *
 * Action class: filesystem.write
 * Writes content to a file, creating it (and any missing parent directories)
 * if it does not exist, or overwriting it if it does.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const writeFileManifest: ToolManifest = {
  name: 'write_file',
  version: '1.0.0',
  action_class: 'filesystem.write',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to write.',
      },
      content: {
        type: 'string',
        description: 'UTF-8 text content to write to the file.',
      },
    },
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path of the written file.',
      },
    },
  },
};

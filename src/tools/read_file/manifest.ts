/**
 * F-05 manifest for the read_file tool.
 *
 * Action class: filesystem.read
 * Reads the UTF-8 text content of a file and returns it as a string.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const readFileManifest: ToolManifest = {
  name: 'read_file',
  version: '1.0.0',
  action_class: 'filesystem.read',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read.',
      },
    },
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'UTF-8 text content of the file.',
      },
    },
  },
};

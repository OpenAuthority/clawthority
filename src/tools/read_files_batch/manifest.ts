/**
 * F-05 manifest for the read_files_batch tool.
 *
 * Action class: filesystem.read
 * Reads the UTF-8 text content of multiple files in a single concurrent
 * operation and returns a mapping of paths to their content or error status.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const readFilesBatchManifest: ToolManifest = {
  name: 'read_files_batch',
  version: '1.0.0',
  action_class: 'filesystem.read',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of file paths to read.',
      },
    },
    required: ['paths'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      results: {
        type: 'object',
        description:
          'Mapping of each requested path to its read result. Each value is either { status: "ok", content: string } or { status: "error", code: string, message: string }.',
      },
    },
  },
};

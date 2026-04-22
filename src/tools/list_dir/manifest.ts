/**
 * F-05 manifest for the list_dir tool.
 *
 * Action class: filesystem.list
 * Returns an array of file and directory names in a specified path,
 * with optional recursive traversal.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const listDirManifest: ToolManifest = {
  name: 'list_dir',
  version: '1.0.0',
  action_class: 'filesystem.list',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list.',
      },
      recursive: {
        type: 'boolean',
        description: 'When true, recursively list all subdirectories. Defaults to false.',
      },
    },
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Array of file and directory names. In recursive mode, entries are relative paths (e.g. "sub/file.txt").',
      },
    },
  },
};

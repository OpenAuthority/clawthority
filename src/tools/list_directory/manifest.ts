/**
 * F-05 manifest for the list_directory tool.
 *
 * Action class: filesystem.list
 * Lists the immediate contents of a directory with basic file metadata
 * (name, type, size, modified time).
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const listDirectoryManifest: ToolManifest = {
  name: 'list_directory',
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
    },
    required: ['path'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path of the directory that was listed.',
      },
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name of the file or directory entry.',
            },
            type: {
              type: 'string',
              enum: ['file', 'directory'],
              description: 'Whether the entry is a file or a directory.',
            },
            size: {
              type: 'number',
              description: 'Size in bytes as reported by the filesystem.',
            },
            modified: {
              type: 'string',
              description: 'Last modification time as an ISO 8601 string.',
            },
          },
        },
        description: 'Immediate children of the directory with basic metadata.',
      },
    },
  },
};

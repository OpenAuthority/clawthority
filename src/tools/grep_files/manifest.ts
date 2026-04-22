/**
 * F-05 manifest for the grep_files tool.
 *
 * Action class: filesystem.read
 * Searches for a regex pattern across files in a directory tree, returning
 * an array of matches with file paths, line numbers, and matched line content.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const grepFilesManifest: ToolManifest = {
  name: 'grep_files',
  version: '1.0.0',
  action_class: 'filesystem.read',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description:
          'Regular expression pattern to search for in file contents. ' +
          'Supports standard JavaScript regex syntax.',
      },
      path: {
        type: 'string',
        description:
          'Absolute path of the directory to search. Defaults to the current working directory.',
      },
      glob: {
        type: 'string',
        description:
          'Optional glob pattern to filter which files are searched. ' +
          'Supports * (any chars except /), ** (any path depth), ? (single char), ' +
          'and {a,b} alternation. When omitted, all files are searched.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            line: { type: 'number' },
            content: { type: 'string' },
          },
        },
        description:
          'Array of matches. Each entry has file (absolute path), line (1-based), and content (matched line text).',
      },
    },
  },
};

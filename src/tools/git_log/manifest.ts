/**
 * F-05 manifest for the git_log tool.
 *
 * Action class: vcs.read
 * Returns formatted commit history for a git repository.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const gitLogManifest: ToolManifest = {
  name: 'git_log',
  version: '1.0.0',
  action_class: 'vcs.read',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of commits to return.',
      },
      path: {
        type: 'string',
        description: 'Restrict history to commits that touch this file path.',
      },
    },
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      commits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            hash: { type: 'string' },
            message: { type: 'string' },
            author: { type: 'string' },
            date: { type: 'string' },
          },
        },
        description: 'Ordered list of commits (newest first).',
      },
    },
  },
};

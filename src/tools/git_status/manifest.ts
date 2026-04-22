/**
 * F-05 manifest for the git_status tool.
 *
 * Action class: vcs.read
 * Returns current repository status with staged, unstaged, and untracked files.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const gitStatusManifest: ToolManifest = {
  name: 'git_status',
  version: '1.0.0',
  action_class: 'vcs.read',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      staged: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files with changes staged for commit.',
      },
      unstaged: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files with changes in the working tree not yet staged.',
      },
      untracked: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files not tracked by git.',
      },
    },
  },
};

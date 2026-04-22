/**
 * F-05 manifest for the git_diff tool.
 *
 * Action class: vcs.read
 * Returns unified diff output for a git repository.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const gitDiffManifest: ToolManifest = {
  name: 'git_diff',
  version: '1.0.0',
  action_class: 'vcs.read',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Commit ref to diff against. Omit to diff working tree against the index.',
      },
      path: {
        type: 'string',
        description: 'Restrict diff output to this file path.',
      },
    },
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      diff: {
        type: 'string',
        description: 'Unified diff output. Empty string when there are no differences.',
      },
    },
  },
};

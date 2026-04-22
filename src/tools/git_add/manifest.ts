/**
 * F-05 manifest for the git_add tool.
 *
 * Action class: vcs.write
 * Stages specified file paths or glob patterns for commit in a git repository.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const gitAddManifest: ToolManifest = {
  name: 'git_add',
  version: '1.0.0',
  action_class: 'vcs.write',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        minItems: 1,
        description: 'File paths or glob patterns to stage for commit.',
      },
    },
    required: ['paths'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stagedPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'The paths that were passed to git add.',
      },
    },
  },
};

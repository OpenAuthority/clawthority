/**
 * F-05 manifest for the git_checkout tool.
 *
 * Action class: vcs.write
 * Switches the working directory to a specified branch or commit in a git repository.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const gitCheckoutManifest: ToolManifest = {
  name: 'git_checkout',
  version: '1.0.0',
  action_class: 'vcs.write',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'ref',
  params: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        minLength: 1,
        description: 'Branch name or commit hash to check out.',
      },
    },
    required: ['ref'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'The ref that was checked out.',
      },
      message: {
        type: 'string',
        description: 'Human-readable status message from git checkout.',
      },
    },
  },
};

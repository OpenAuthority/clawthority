/**
 * F-05 manifest for the git_commit tool.
 *
 * Action class: vcs.write
 * Creates a commit in the current git repository with optional file path
 * specs, custom author identity, and GPG signing support.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const gitCommitManifest: ToolManifest = {
  name: 'git_commit',
  version: '1.0.0',
  action_class: 'vcs.write',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        minLength: 1,
        description: 'Commit message.',
      },
      files: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        description:
          'Specific files to include in the commit. When omitted, all staged changes are committed.',
      },
      author: {
        type: 'string',
        minLength: 1,
        description:
          'Override the commit author in "Name <email>" format. Passed as --author= to git.',
      },
      sign: {
        type: 'boolean',
        description: 'When true, GPG-sign the commit (-S flag).',
      },
    },
    required: ['message'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      hash: {
        type: 'string',
        description: 'SHA-1 hash of the newly created commit.',
      },
    },
  },
};

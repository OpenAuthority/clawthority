/**
 * F-05 manifest for the pip_list tool.
 *
 * Action class: package.read
 * Lists installed Python packages in the current environment.
 * Low risk — read-only operation that enumerates package metadata
 * without modifying any state.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const pipListManifest: ToolManifest = {
  name: 'pip_list',
  version: '1.0.0',
  action_class: 'package.read',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        description: 'Output format: "columns" (default), "freeze" (requirements.txt style), or "json".',
      },
      working_dir: {
        type: 'string',
        description: 'Directory context for resolving the Python environment. Optional.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      packages: {
        type: 'array',
        description: 'List of installed packages, each with name and version fields.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
          },
        },
      },
    },
  },
};

/**
 * F-05 manifest for the get_env_var tool.
 *
 * Action class: system.read
 * Reads a single environment variable from the process environment.
 * No process control or variable modification is exposed.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const getEnvVarManifest: ToolManifest = {
  name: 'get_env_var',
  version: '1.0.0',
  action_class: 'system.read',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  target_field: 'variable_name',
  params: {
    type: 'object',
    properties: {
      variable_name: {
        type: 'string',
        description:
          'Name of the environment variable to read. Must contain only letters, digits, and underscores, and must start with a letter or underscore.',
      },
    },
    required: ['variable_name'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      variable_name: {
        type: 'string',
        description: 'Name of the environment variable that was queried.',
      },
      found: {
        type: 'boolean',
        description: 'Whether the variable is set in the process environment.',
      },
      value: {
        type: ['string', 'null'],
        description: "The variable's value, or null if not set.",
      },
    },
  },
};

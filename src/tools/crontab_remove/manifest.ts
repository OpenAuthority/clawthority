/**
 * F-05 manifest for the crontab_remove tool.
 *
 * Action class: scheduling.persist
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const crontabRemoveManifest: ToolManifest = {
  name: 'crontab_remove',
  version: '1.0.0',
  action_class: 'scheduling.persist',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      user: {
        type: 'string',
        minLength: 1,
        maxLength: 32,
        pattern: '^[a-z_][a-z0-9_-]*$',
        description:
          'Optional target username. Defaults to the calling user when omitted.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: { type: 'string', description: 'Standard output from crontab.' },
      stderr: { type: 'string', description: 'Standard error from crontab.' },
      exit_code: { type: 'number', description: 'Exit code from crontab.' },
    },
  },
};

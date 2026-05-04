/**
 * F-05 manifest for the crontab_install_from_file tool.
 *
 * Action class: scheduling.persist
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const crontabInstallFromFileManifest: ToolManifest = {
  name: 'crontab_install_from_file',
  version: '1.0.0',
  action_class: 'scheduling.persist',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  target_field: 'file_path',
  params: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        minLength: 1,
        description: 'Path to the crontab file to install.',
      },
      replace_confirm: {
        type: 'boolean',
        const: true,
        description:
          'Mandatory confirmation flag. Must be exactly true. ' +
          'Acknowledges that this REPLACES the user\'s entire crontab.',
      },
      user: {
        type: 'string',
        minLength: 1,
        maxLength: 32,
        pattern: '^[a-z_][a-z0-9_-]*$',
        description: 'Optional target username (-u <user>).',
      },
    },
    required: ['file_path', 'replace_confirm'],
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

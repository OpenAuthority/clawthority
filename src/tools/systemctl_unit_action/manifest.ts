/**
 * F-05 manifest for the systemctl_unit_action tool.
 *
 * Action class: system.service
 * Wraps `systemctl <action> <unit>` with a typed parameter schema so that
 * the agent cannot inject shell metacharacters via a free-form command
 * string. Every invocation is validated against the `SYSTEMCTL_ACTIONS`
 * enum and the systemd unit-name character set before any subprocess runs.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';
import { SYSTEMCTL_ACTIONS } from './systemctl-unit-action.js';

export const systemctlUnitActionManifest: ToolManifest = {
  name: 'systemctl_unit_action',
  version: '1.0.0',
  action_class: 'system.service',
  risk_tier: 'critical',
  default_hitl_mode: 'per_request',
  target_field: 'unit',
  params: {
    type: 'object',
    properties: {
      unit: {
        type: 'string',
        minLength: 1,
        maxLength: 256,
        pattern: '^[a-zA-Z0-9._@-]+$',
        description:
          'Systemd unit name (e.g. "nginx.service", "user@1000.service"). ' +
          'Must contain only letters, digits, and the characters ".", "_", "@", "-".',
      },
      action: {
        type: 'string',
        enum: [...SYSTEMCTL_ACTIONS],
        description:
          'Lifecycle verb to apply to the unit. One of: ' +
          `${SYSTEMCTL_ACTIONS.join(', ')}.`,
      },
    },
    required: ['unit', 'action'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: {
        type: 'string',
        description: 'Standard output captured from systemctl.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from systemctl.',
      },
      exit_code: {
        type: 'number',
        description:
          'systemctl exit code. Some actions (is-active, is-enabled) carry ' +
          'meaningful state in the exit code (0 = active/enabled).',
      },
    },
  },
};

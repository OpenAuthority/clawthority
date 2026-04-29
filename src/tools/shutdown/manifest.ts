/**
 * F-05 manifest for the shutdown tool.
 *
 * Action class: system.service
 * Wraps the `shutdown` binary with a typed mode + time schema. The
 * tight schedule-expression regex rejects shell metacharacters at
 * validation time and limits the schedule surface to three documented
 * forms.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';
import { SHUTDOWN_MODES } from './shutdown.js';

export const shutdownManifest: ToolManifest = {
  name: 'shutdown',
  version: '1.0.0',
  action_class: 'system.service',
  risk_tier: 'critical',
  default_hitl_mode: 'per_request',
  target_field: 'mode',
  params: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: [...SHUTDOWN_MODES],
        description:
          'Shutdown mode. "poweroff" powers off the host, "reboot" reboots, ' +
          '"cancel" cancels a pending shutdown (no time accepted in cancel mode).',
      },
      time: {
        type: 'string',
        pattern: '^now$|^\\+\\d{1,4}$|^([01]?\\d|2[0-3]):[0-5]\\d$',
        description:
          'Schedule expression. One of: "now", "+<minutes>" (e.g. "+5"), ' +
          '"HH:MM" (24-hour absolute). Defaults to "now". ' +
          'Must NOT be supplied when mode is "cancel".',
      },
    },
    required: ['mode'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: {
        type: 'string',
        description: 'Standard output captured from the shutdown binary.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from the shutdown binary.',
      },
      exit_code: {
        type: 'number',
        description: 'Exit code from the shutdown binary.',
      },
    },
  },
};

/**
 * F-05 manifest for the reboot tool.
 *
 * Action class: system.service
 * Triggers an immediate host reboot. The mandatory `confirm` parameter
 * (must be exactly `true`) is a structural barrier against accidental
 * invocation — agents cannot reach the binary without setting it,
 * even after HITL approval.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const rebootManifest: ToolManifest = {
  name: 'reboot',
  version: '1.0.0',
  action_class: 'system.service',
  risk_tier: 'critical',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      confirm: {
        type: 'boolean',
        const: true,
        description:
          'Mandatory confirmation flag. Must be exactly true. ' +
          'Structural barrier against accidental host reboots.',
      },
    },
    required: ['confirm'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: {
        type: 'string',
        description: 'Standard output captured from the reboot binary.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from the reboot binary.',
      },
      exit_code: {
        type: 'number',
        description:
          'Exit code from the reboot binary. May be unobservable in practice — ' +
          'the host is going down.',
      },
    },
  },
};

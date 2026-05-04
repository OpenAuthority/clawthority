/**
 * F-05 manifest for the kill_process tool.
 *
 * Action class: process.signal
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';
import { KILL_SIGNALS } from './kill-process.js';

export const killProcessManifest: ToolManifest = {
  name: 'kill_process',
  version: '1.0.0',
  action_class: 'process.signal',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  target_field: 'pid',
  params: {
    type: 'object',
    properties: {
      pid: {
        type: 'integer',
        minimum: 0,
        description:
          'Target process id. Must be a non-negative integer. Note: pid 1 (init) ' +
          'is structurally accepted; HITL approval is the gate against killing init.',
      },
      signal: {
        type: 'string',
        enum: [...KILL_SIGNALS],
        description:
          'Signal to deliver. Defaults to TERM if omitted. KILL must be explicitly specified.',
      },
    },
    required: ['pid'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: { type: 'string', description: 'Standard output from kill.' },
      stderr: { type: 'string', description: 'Standard error from kill.' },
      exit_code: { type: 'number', description: 'Exit code from kill.' },
    },
  },
};

/**
 * F-05 manifest for the pkill_pattern tool.
 *
 * Action class: process.signal
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';
import { KILL_SIGNALS } from './pkill-pattern.js';

export const pkillPatternManifest: ToolManifest = {
  name: 'pkill_pattern',
  version: '1.0.0',
  action_class: 'process.signal',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  target_field: 'pattern',
  params: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        minLength: 1,
        maxLength: 256,
        pattern: '^[a-zA-Z0-9._\\-/^$+*?()|\\[\\] ]+$',
        description:
          'Process-name pattern. Passed verbatim to pkill. Allowed characters: ' +
          'letters, digits, hyphens, dots, underscores, slashes, spaces, and ' +
          'a curated set of regex metacharacters (^ $ + * ? ( ) | [ ]).',
      },
      signal: {
        type: 'string',
        enum: [...KILL_SIGNALS],
        description: 'Signal to deliver. Defaults to TERM.',
      },
      full_match: {
        type: 'boolean',
        description:
          'When true, pass -f to pkill so the pattern matches against the ' +
          "full command line rather than the process name.",
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: { type: 'string', description: 'Standard output from pkill.' },
      stderr: { type: 'string', description: 'Standard error from pkill.' },
      exit_code: { type: 'number', description: 'Exit code from pkill.' },
    },
  },
};

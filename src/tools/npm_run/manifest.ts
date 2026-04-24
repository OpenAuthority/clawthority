/**
 * F-05 manifest for the npm_run tool.
 *
 * Action class: package.run
 * Executes a script defined in package.json via `npm run <script>`.
 * Medium risk because scripts can execute arbitrary commands and have
 * unrestricted access to the system unless sandboxed.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const npmRunManifest: ToolManifest = {
  name: 'npm_run',
  version: '1.0.0',
  action_class: 'package.run',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'script',
  params: {
    type: 'object',
    properties: {
      script: {
        type: 'string',
        description: 'Name of the npm script to execute (must be defined in package.json "scripts").',
      },
      working_dir: {
        type: 'string',
        description: 'Directory to run the script in. Defaults to the current working directory.',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional arguments to pass after `--` to the script.',
      },
    },
    required: ['script'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: {
        type: 'string',
        description: 'Standard output captured from the script.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from the script.',
      },
      exit_code: {
        type: 'number',
        description: 'Process exit code. Non-zero indicates the script failed.',
      },
    },
  },
};

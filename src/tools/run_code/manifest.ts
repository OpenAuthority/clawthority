/**
 * F-05 manifest for the run_code tool.
 *
 * Action class: code.execute
 * Executes a code snippet in a specified programming language and returns
 * the output. High risk because arbitrary code execution can read the
 * filesystem, make network requests, or modify system state.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const runCodeManifest: ToolManifest = {
  name: 'run_code',
  version: '1.0.0',
  action_class: 'code.execute',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Programming language to execute the code in (e.g. "python", "javascript", "bash").',
      },
      code: {
        type: 'string',
        description: 'Source code to execute.',
      },
      timeout_ms: {
        type: 'number',
        description: 'Maximum execution time in milliseconds. Uses a safe default when omitted.',
      },
    },
    required: ['language', 'code'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: {
        type: 'string',
        description: 'Standard output captured from code execution.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from code execution.',
      },
      exit_code: {
        type: 'number',
        description: 'Process exit code. Non-zero indicates a runtime error.',
      },
    },
  },
};

/**
 * F-05 manifest for the make_run tool.
 *
 * Action class: package.run
 * Executes a Make target defined in a Makefile via `make <target>`.
 * Medium risk because targets can execute arbitrary commands and have
 * unrestricted access to the system unless sandboxed.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const makeRunManifest: ToolManifest = {
  name: 'make_run',
  version: '1.0.0',
  action_class: 'package.run',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'target',
  params: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description:
          'Name of the Make target to execute. Must be defined in the Makefile. ' +
          'Use an empty string or omit to run the default target.',
      },
      working_dir: {
        type: 'string',
        description:
          'Directory to run make in. Defaults to the current working directory. ' +
          'Equivalent to `make -C <working_dir>`.',
      },
      makefile: {
        type: 'string',
        description:
          'Path to the Makefile to use. Defaults to the standard "Makefile" ' +
          'in the working directory. Passed as `-f <makefile>` to make.',
      },
      jobs: {
        type: 'number',
        description:
          'Number of parallel jobs to run (passed as -j<n>). ' +
          'When set to 0, runs with unlimited parallelism (-j).',
        minimum: 0,
      },
      validate_target: {
        type: 'boolean',
        description:
          'When true (default), verify that the target exists in the Makefile ' +
          'before invoking make. Set to false to skip pre-flight validation.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: {
        type: 'string',
        description: 'Standard output captured from make.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from make.',
      },
      exit_code: {
        type: 'number',
        description: 'Process exit code. Non-zero indicates the build failed.',
      },
    },
  },
};

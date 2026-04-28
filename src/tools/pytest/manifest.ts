/**
 * F-05 manifest for the pytest tool.
 *
 * Action class: build.test
 * Runs Python tests via `pytest`. Low risk because pytest only executes
 * test code in the project — it does not install packages or modify
 * production state under normal usage.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const pytestManifest: ToolManifest = {
  name: 'pytest',
  version: '1.0.0',
  action_class: 'build.test',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  target_field: 'test_paths',
  params: {
    type: 'object',
    properties: {
      test_paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Paths to test files or directories to collect and run. ' +
          'When omitted, pytest discovers tests from the current directory.',
      },
      working_dir: {
        type: 'string',
        description: 'Directory to run pytest in. Defaults to the current working directory.',
      },
      markers: {
        type: 'string',
        description:
          'Marker expression for test selection (passed as -m). ' +
          'Example: "unit and not slow".',
      },
      keyword: {
        type: 'string',
        description:
          'Keyword expression for test selection (passed as -k). ' +
          'Example: "test_login or test_logout".',
      },
      verbose: {
        type: 'boolean',
        description: 'When true, pass -v to increase verbosity.',
      },
      collect_only: {
        type: 'boolean',
        description:
          'When true, pass --collect-only to list discovered tests without executing them.',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional arguments to pass verbatim to pytest.',
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
        description: 'Standard output from pytest.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error from pytest.',
      },
      exit_code: {
        type: 'number',
        description:
          'Process exit code. 0 = all tests passed, 1 = test failures, ' +
          '2 = interrupted, 3 = internal error, 4 = usage error, 5 = no tests collected.',
      },
    },
  },
};

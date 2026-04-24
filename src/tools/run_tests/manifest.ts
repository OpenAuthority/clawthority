/**
 * F-05 manifest for the run_tests tool.
 *
 * Action class: build.test
 * Executes the project's test suite using the configured test runner.
 * Low risk — tests are typically read-only and operate in isolated
 * environments. HITL approval is not required by default.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const runTestsManifest: ToolManifest = {
  name: 'run_tests',
  version: '1.0.0',
  action_class: 'build.test',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {
      working_dir: {
        type: 'string',
        description: 'Directory to run tests in. Defaults to the current working directory.',
      },
      pattern: {
        type: 'string',
        description: 'Test file glob pattern or test name filter. Runs the full suite when omitted.',
      },
      runner: {
        type: 'string',
        description: 'Test runner to invoke (e.g. "vitest", "jest", "pytest"). Inferred from package.json when omitted.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      passed: {
        type: 'number',
        description: 'Number of tests that passed.',
      },
      failed: {
        type: 'number',
        description: 'Number of tests that failed.',
      },
      total: {
        type: 'number',
        description: 'Total number of tests executed.',
      },
      stdout: {
        type: 'string',
        description: 'Standard output captured from the test runner.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from the test runner.',
      },
    },
  },
};

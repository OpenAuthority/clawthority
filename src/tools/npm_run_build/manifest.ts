/**
 * F-05 manifest for the npm_run_build tool.
 *
 * Action class: build.compile
 * Compiles project source code by running the npm build script.
 * Medium risk because build scripts can execute arbitrary commands,
 * write output artefacts, and invoke compilers or bundlers.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const npmRunBuildManifest: ToolManifest = {
  name: 'npm_run_build',
  version: '1.0.0',
  action_class: 'build.compile',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      working_dir: {
        type: 'string',
        description: 'Directory to run the build in. Defaults to the current working directory.',
      },
      script: {
        type: 'string',
        description: 'npm script name to use for the build step. Defaults to "build".',
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
        description: 'Standard output captured from the build process.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from the build process.',
      },
      exit_code: {
        type: 'number',
        description: 'Process exit code. Non-zero indicates a build failure.',
      },
    },
  },
};

/**
 * F-05 manifest for the run_linter tool.
 *
 * Action class: build.lint
 * Runs static analysis or a code formatter on source files, reporting
 * style violations and type errors. Low risk — linting is read-only by
 * default; auto-fix mode writes to files but is opt-in.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const runLinterManifest: ToolManifest = {
  name: 'run_linter',
  version: '1.0.0',
  action_class: 'build.lint',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {
      working_dir: {
        type: 'string',
        description: 'Directory to run the linter in. Defaults to the current working directory.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'File or directory paths to lint. Lints the entire project when omitted.',
      },
      fix: {
        type: 'boolean',
        description: 'Auto-fix violations when the linter supports it. Defaults to false.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      violations: {
        type: 'number',
        description: 'Total number of lint violations found.',
      },
      stdout: {
        type: 'string',
        description: 'Standard output captured from the linter.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from the linter.',
      },
    },
  },
};

/**
 * F-05 manifest for the pip_install tool.
 *
 * Action class: package.install
 * Installs Python packages via `pip install`. Supports individual packages with
 * version constraints, extras, and requirements.txt files. Medium risk because
 * package installation introduces third-party code and may run setup scripts.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const pipInstallManifest: ToolManifest = {
  name: 'pip_install',
  version: '1.0.0',
  action_class: 'package.install',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'packages',
  params: {
    type: 'object',
    properties: {
      packages: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Package specifications to install (e.g. ["requests", "django==4.2.0", "flask>=2.0,<3.0", "requests[security]"]). ' +
          'At least one of "packages" or "requirements" must be provided.',
      },
      requirements: {
        type: 'string',
        description:
          'Path to a requirements.txt file. Resolved relative to working_dir when not absolute. ' +
          'Passed as `-r <path>` to pip.',
      },
      working_dir: {
        type: 'string',
        description:
          'Directory to run pip install in. Defaults to the current working directory.',
      },
      upgrade: {
        type: 'boolean',
        description:
          'When true, pass --upgrade to upgrade already-installed packages to the newest available version.',
      },
      user: {
        type: 'boolean',
        description:
          'When true, pass --user to install into the user site-packages directory instead of the system directory.',
      },
      index_url: {
        type: 'string',
        description:
          'Base URL of the Python Package Index. Overrides the default https://pypi.org/simple. ' +
          'Passed as --index-url <url>.',
      },
      extra_index_url: {
        type: 'string',
        description:
          'Extra URL of a package index to search in addition to the primary index. ' +
          'Passed as --extra-index-url <url>.',
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
        description: 'Standard output captured from pip.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from pip.',
      },
      exit_code: {
        type: 'number',
        description: 'Process exit code. Non-zero indicates pip reported an error.',
      },
    },
  },
};

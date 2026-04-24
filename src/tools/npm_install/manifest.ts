/**
 * F-05 manifest for the npm_install tool.
 *
 * Action class: package.install
 * Installs npm packages in a project directory. When no packages are specified
 * all dependencies from package.json are installed. Medium risk because package
 * installation executes lifecycle scripts and introduces third-party code.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const npmInstallManifest: ToolManifest = {
  name: 'npm_install',
  version: '1.0.0',
  action_class: 'package.install',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Package names to install (e.g. ["lodash", "typescript@5"]). Installs from package.json when omitted.',
      },
      working_dir: {
        type: 'string',
        description: 'Directory to run npm install in. Defaults to the current working directory.',
      },
      flags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional npm install flags (e.g. ["--save-dev", "--legacy-peer-deps"]).',
      },
    },
    required: [],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      installed: {
        type: 'boolean',
        description: 'Whether the installation completed without error.',
      },
      stdout: {
        type: 'string',
        description: 'Standard output from npm install.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error from npm install.',
      },
    },
  },
};

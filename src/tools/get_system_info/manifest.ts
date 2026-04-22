/**
 * F-05 manifest for the get_system_info tool.
 *
 * Action class: system.read
 * Returns read-only metadata about the host OS and Node.js runtime.
 * No process control operations are exposed.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const getSystemInfoManifest: ToolManifest = {
  name: 'get_system_info',
  version: '1.0.0',
  action_class: 'system.read',
  risk_tier: 'low',
  default_hitl_mode: 'none',
  params: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: 'Operating system platform identifier (e.g. linux, darwin, win32).',
      },
      arch: {
        type: 'string',
        description: 'CPU architecture (e.g. x64, arm64).',
      },
      os_release: {
        type: 'string',
        description: 'OS release/kernel version string.',
      },
      hostname: {
        type: 'string',
        description: 'Machine hostname.',
      },
      node_version: {
        type: 'string',
        description: 'Node.js runtime version string.',
      },
      total_memory: {
        type: 'number',
        description: 'Total system memory in bytes.',
      },
      free_memory: {
        type: 'number',
        description: 'Free system memory in bytes.',
      },
      uptime: {
        type: 'number',
        description: 'System uptime in seconds.',
      },
    },
  },
};

/**
 * F-05 manifest for the unsafe_admin_exec tool.
 *
 * Action class: shell.exec
 * Executes an arbitrary shell command when explicitly permitted.
 *
 * unsafe_admin: true bypasses the E-03 shell.exec restriction in the manifest
 * validator. The validator emits prominent security warnings on registration.
 * At runtime the tool requires CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC=1 and an
 * explicit permit rule in the policy engine.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const unsafeAdminExecManifest: ToolManifest = {
  name: 'unsafe_admin_exec',
  version: '1.0.0',
  action_class: 'shell.exec',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  unsafe_admin: true,
  target_field: 'command',
  params: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute.',
      },
      justification: {
        type: 'string',
        description:
          'Human-readable reason for this invocation. Must be at least 20 characters. Recorded verbatim in the audit trail.',
      },
      working_dir: {
        type: 'string',
        description: 'Working directory for command execution. Optional.',
      },
    },
    required: ['command', 'justification'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: {
        type: 'string',
        description: 'Standard output captured from the command.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from the command.',
      },
      exit_code: {
        type: 'number',
        description: 'Process exit code. -1 when the process was signalled.',
      },
    },
  },
};

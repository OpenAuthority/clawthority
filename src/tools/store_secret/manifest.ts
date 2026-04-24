/**
 * F-05 manifest for the store_secret tool.
 *
 * Action class: credential.write
 * Saves a secret value to a file-based credential store. The file vault is the
 * only supported provider because env is read-only by nature.
 * Critical risk because writing secrets can overwrite existing credentials,
 * introduce compromised values, or grant unintended access to systems.
 * Every invocation requires HITL approval.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const storeSecretManifest: ToolManifest = {
  name: 'store_secret',
  version: '1.0.0',
  action_class: 'credential.write',
  risk_tier: 'critical',
  default_hitl_mode: 'per_request',
  target_field: 'key',
  params: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Name or identifier of the secret to store.',
      },
      value: {
        type: 'string',
        description: 'Secret value to persist in the credential file.',
      },
      path: {
        type: 'string',
        description:
          'Absolute or relative path to the JSON credential file. The file must contain a flat object mapping string keys to string values. Created if it does not exist.',
      },
    },
    required: ['key', 'value'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stored: {
        type: 'boolean',
        description: 'Whether the secret was successfully stored in the credential file.',
      },
    },
  },
};

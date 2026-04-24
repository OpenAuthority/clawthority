/**
 * F-05 manifest for the write_secret tool.
 *
 * Action class: credential.write
 * Stores or updates a secret value in a secret store.
 * Critical risk because writing secrets can overwrite existing credentials,
 * introduce compromised values, or grant unintended access to systems.
 * Every invocation requires HITL approval.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const writeSecretManifest: ToolManifest = {
  name: 'write_secret',
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
        description: 'Secret value to persist in the store.',
      },
      store: {
        type: 'string',
        description: 'Secret store identifier (e.g. "vault", "aws-secrets-manager"). Uses the default store when omitted.',
      },
    },
    required: ['key', 'value'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      written: {
        type: 'boolean',
        description: 'Whether the secret was successfully written to the store.',
      },
    },
  },
};

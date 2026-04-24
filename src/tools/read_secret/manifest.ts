/**
 * F-05 manifest for the read_secret tool.
 *
 * Action class: credential.read
 * Retrieves a secret or credential value from a secret store by key.
 * High risk because reading secrets exposes sensitive material that
 * could be exfiltrated or misused. Every invocation requires HITL approval.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const readSecretManifest: ToolManifest = {
  name: 'read_secret',
  version: '1.0.0',
  action_class: 'credential.read',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  target_field: 'key',
  params: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Name or identifier of the secret to retrieve.',
      },
      store: {
        type: 'string',
        description: 'Secret store identifier (e.g. "vault", "aws-secrets-manager"). Uses the default store when omitted.',
      },
    },
    required: ['key'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      value: {
        type: 'string',
        description: 'The secret value retrieved from the store.',
      },
    },
  },
};

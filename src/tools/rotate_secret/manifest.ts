/**
 * Manifest for the rotate_secret tool.
 *
 * Action class: credential.rotate
 * Generates a new cryptographically-random value for an existing secret,
 * writes it to the configured store, and returns confirmation.
 * Critical risk because rotation replaces live credentials and may
 * break dependent systems if not coordinated. Every invocation requires
 * HITL approval.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const rotateSecretManifest: ToolManifest = {
  name: 'rotate_secret',
  version: '1.0.0',
  action_class: 'credential.rotate',
  risk_tier: 'critical',
  default_hitl_mode: 'per_request',
  target_field: 'key',
  params: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Name or identifier of the secret to rotate.',
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
      rotated: {
        type: 'boolean',
        description: 'Whether the secret was successfully rotated.',
      },
      key: {
        type: 'string',
        description: 'The key whose value was rotated.',
      },
    },
  },
};

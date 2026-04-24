/**
 * F-05 manifest for the list_secrets tool.
 *
 * Action class: credential.list
 * Enumerates the names of secrets present in a secret store.
 * High risk because key enumeration reveals which secrets exist, enabling
 * targeted credential-access attacks. Every invocation requires HITL approval.
 * Values are never returned — only key names.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const listSecretsManifest: ToolManifest = {
  name: 'list_secrets',
  version: '1.0.0',
  action_class: 'credential.list',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      store: {
        type: 'string',
        description: 'Secret store identifier (e.g. "env"). Uses the default store when omitted.',
      },
    },
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names of secrets present in the store. Values are never returned.',
      },
    },
  },
};

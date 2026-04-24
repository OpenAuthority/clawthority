/**
 * HC-04 manifest for the http_delete tool.
 *
 * Action class: web.post
 *
 * HTTP DELETE modifies remote state and is grouped with other state-mutating
 * HTTP verbs (POST, PUT, PATCH) under the web.post action class.
 * The 'http_delete' alias is registered in @openclaw/action-registry under
 * the web.post entry.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const httpDeleteManifest: ToolManifest = {
  name: 'http_delete',
  version: '1.0.0',
  action_class: 'web.post',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'url',
  params: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL of the resource to delete.',
      },
      headers: {
        type: 'object',
        description: 'Optional HTTP request headers as key-value pairs.',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      status_code: {
        type: 'number',
        description: 'HTTP response status code.',
      },
      body: {
        type: 'string',
        description: 'Response body as a UTF-8 string.',
      },
    },
  },
};

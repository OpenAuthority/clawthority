/**
 * F-05 manifest for the http_patch tool.
 *
 * Action class: web.post
 * Sends an HTTP PATCH request to a URL, applying a partial update to a resource.
 * Maps to web.post (intent_group: web_access) because PATCH modifies
 * remote state similarly to POST and PUT.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const httpPatchManifest: ToolManifest = {
  name: 'http_patch',
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
        description: 'URL to send the PATCH request to.',
      },
      body: {
        type: 'string',
        description: 'Partial update payload to send. Serialise JSON before passing.',
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

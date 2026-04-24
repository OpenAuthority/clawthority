/**
 * F-05 manifest for the http_post tool.
 *
 * Action class: web.post
 * Sends an HTTP POST request to a URL with an optional request body.
 * Classified as web_access intent group because POST requests modify
 * remote resources or trigger side effects on external services.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const httpPostManifest: ToolManifest = {
  name: 'http_post',
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
        description: 'URL to send the POST request to.',
      },
      body: {
        type: 'string',
        description: 'Request body to send. Serialise JSON before passing.',
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
      content_type: {
        type: 'string',
        description: 'Value of the Content-Type response header.',
      },
    },
  },
};

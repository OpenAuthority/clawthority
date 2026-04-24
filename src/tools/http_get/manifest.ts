/**
 * F-05 manifest for the http_get tool.
 *
 * Action class: web.fetch
 * Sends an HTTP GET request to a URL and returns the response.
 * Classified as data_exfiltration intent group because GET requests
 * retrieve data that could be forwarded to external recipients.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const httpGetManifest: ToolManifest = {
  name: 'http_get',
  version: '1.0.0',
  action_class: 'web.fetch',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'url',
  params: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to send the GET request to.',
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

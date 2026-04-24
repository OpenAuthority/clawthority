/**
 * F-05 manifest for the webhook tool.
 *
 * Action class: communication.webhook
 * Posts a JSON payload to a webhook URL via HTTP POST with automatic retry
 * on transient network failures. Provides webhook-specific auditing distinct
 * from generic http_post usage.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const webhookManifest: ToolManifest = {
  name: 'webhook',
  version: '1.0.0',
  action_class: 'communication.webhook',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'url',
  params: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Webhook endpoint URL (http or https).',
      },
      payload: {
        type: 'object',
        description: 'JSON payload to POST to the webhook endpoint.',
        additionalProperties: true,
      },
      headers: {
        type: 'object',
        description: 'Optional HTTP headers to include in the request.',
        additionalProperties: { type: 'string' },
      },
      max_retries: {
        type: 'number',
        description:
          'Maximum number of retry attempts on transient network failures. Defaults to 3. Set to 0 to disable retries.',
      },
    },
    required: ['url', 'payload'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      status_code: {
        type: 'number',
        description: 'HTTP response status code from the webhook endpoint.',
      },
      response_body: {
        type: 'string',
        description: 'Response body returned by the webhook endpoint.',
      },
      content_type: {
        type: 'string',
        description: 'Value of the Content-Type response header, if present.',
      },
      attempts: {
        type: 'number',
        description: 'Total number of attempts made (1 means no retries were needed).',
      },
    },
  },
};

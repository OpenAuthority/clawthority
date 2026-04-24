/**
 * F-05 manifest for the send_webhook tool.
 *
 * Action class: communication.webhook
 * Posts a JSON payload to a webhook URL via HTTP POST. Provides a focused
 * interface for outbound webhook delivery with mandatory payload and optional
 * header customisation.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const sendWebhookManifest: ToolManifest = {
  name: 'send_webhook',
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
    },
  },
};

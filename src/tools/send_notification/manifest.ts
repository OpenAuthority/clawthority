/**
 * Manifest for the send_notification tool.
 *
 * Action class: communication.webhook
 * Sends a notification message to a communication platform via webhook.
 * The platform parameter selects a formatting adapter for the target service.
 * Medium risk as an external communication channel; notifications are
 * irreversible once delivered.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const sendNotificationManifest: ToolManifest = {
  name: 'send_notification',
  version: '1.0.0',
  action_class: 'communication.webhook',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'url',
  params: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description:
          'Target notification platform. Controls webhook payload formatting. Supported: "slack", "discord", "teams", "generic".',
        enum: ['slack', 'discord', 'teams', 'generic'],
      },
      message: {
        type: 'string',
        description: 'Notification message text to deliver.',
      },
      url: {
        type: 'string',
        description: 'Webhook URL for the target platform (http or https).',
      },
    },
    required: ['platform', 'message', 'url'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      delivered: {
        type: 'boolean',
        description: 'Whether the notification was successfully delivered.',
      },
      status_code: {
        type: 'number',
        description: 'HTTP response status code from the webhook endpoint.',
      },
    },
  },
};

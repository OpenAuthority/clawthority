/**
 * F-05 manifest for the send_email tool.
 *
 * Action class: communication.email
 * Sends an email message to one or more recipients.
 * High risk because email is an irreversible external communication channel
 * that can leak sensitive information or be used for social engineering.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const sendEmailManifest: ToolManifest = {
  name: 'send_email',
  version: '1.0.0',
  action_class: 'communication.email',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address. Use a comma-separated list for multiple recipients.',
      },
      subject: {
        type: 'string',
        description: 'Email subject line.',
      },
      body: {
        type: 'string',
        description: 'Email body content (plain text or HTML).',
      },
      from: {
        type: 'string',
        description: 'Sender email address. Uses the configured default when omitted.',
      },
      cc: {
        type: 'string',
        description: 'CC recipient email addresses as a comma-separated list. Optional.',
      },
    },
    required: ['to', 'subject', 'body'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      message_id: {
        type: 'string',
        description: 'Unique message identifier assigned by the mail server.',
      },
      sent: {
        type: 'boolean',
        description: 'Whether the email was accepted for delivery.',
      },
    },
  },
};

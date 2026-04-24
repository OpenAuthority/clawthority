/**
 * Manifest for the post_message tool.
 *
 * Action class: communication.slack
 * Posts a message to a communication platform. Initial version targets Slack
 * via chat.postMessage. The design is extensible to additional platforms via
 * the required 'platform' parameter.
 * Medium risk as an external communication channel; all messages are
 * irreversible and visible to channel members.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const postMessageManifest: ToolManifest = {
  name: 'post_message',
  version: '1.0.0',
  action_class: 'communication.slack',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: 'Target communication platform. Currently only "slack" is supported.',
        enum: ['slack'],
      },
      message: {
        type: 'string',
        description: 'Message text to post. Supports platform-native formatting.',
      },
      channel: {
        type: 'string',
        description: 'Channel or recipient (e.g. "#general" or Slack channel ID "C01234ABCDE").',
      },
      thread_ts: {
        type: 'string',
        description: 'Timestamp of the parent message to reply in a thread. Optional.',
      },
    },
    required: ['platform', 'message', 'channel'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      message_id: {
        type: 'string',
        description: 'Unique message identifier returned by the platform (Slack message timestamp).',
      },
      posted: {
        type: 'boolean',
        description: 'Whether the message was successfully posted.',
      },
    },
  },
};

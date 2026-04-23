/**
 * F-05 manifest for the send_slack tool.
 *
 * Action class: communication.slack
 * Posts a message to a Slack channel or thread.
 * Medium risk as an external communication channel; all messages are
 * irreversible and visible to channel members.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const sendSlackManifest: ToolManifest = {
  name: 'send_slack',
  version: '1.0.0',
  action_class: 'communication.slack',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  params: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Slack channel ID (e.g. "C01234ABCDE") or name (e.g. "#general").',
      },
      text: {
        type: 'string',
        description: 'Message text to post. Supports Slack mrkdwn formatting.',
      },
      thread_ts: {
        type: 'string',
        description: 'Timestamp of the parent message to reply in a thread. Optional.',
      },
      username: {
        type: 'string',
        description: 'Bot display name override shown in the channel. Optional.',
      },
    },
    required: ['channel', 'text'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      ts: {
        type: 'string',
        description: 'Timestamp of the posted message, used as a unique message identifier.',
      },
      channel: {
        type: 'string',
        description: 'Channel ID where the message was posted.',
      },
    },
  },
};

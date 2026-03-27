import { Type, type Static } from '@sinclair/typebox';

/** Which action to take when the approval timeout elapses without a response. */
export const HitlFallbackSchema = Type.Union([
  Type.Literal('deny'),
  Type.Literal('auto-approve'),
]);

/** Configuration for where and how to request human approval. */
export const HitlApprovalConfigSchema = Type.Object({
  /** The channel to route approval requests to (e.g. "slack", "email", "console"). */
  channel: Type.String({ minLength: 1 }),
  /** Seconds to wait for a human response before applying the fallback action. */
  timeout: Type.Number({ minimum: 1 }),
  /** What to do when timeout elapses without approval. */
  fallback: HitlFallbackSchema,
});

/**
 * A single HITL policy entry: matches a set of action patterns and routes
 * matching actions to a human approver via the given approval config.
 */
export const HitlPolicySchema = Type.Object({
  /** Human-readable name for this policy. */
  name: Type.String({ minLength: 1 }),
  /** Optional description for documentation purposes. */
  description: Type.Optional(Type.String()),
  /**
   * Action patterns that require human approval.
   *
   * Patterns use dot-notation segments, with `*` as a per-segment wildcard:
   *   - `"email.delete"` – exact match
   *   - `"email.*"`      – any action in the email namespace
   *   - `"*.delete"`     – delete action in any namespace
   *   - `"*"`            – matches every action
   */
  actions: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  /** Approval routing and timeout configuration. */
  approval: HitlApprovalConfigSchema,
  /** Optional tags for filtering or categorisation. */
  tags: Type.Optional(Type.Array(Type.String())),
});

/** Telegram bot configuration for HITL approval requests. */
export const TelegramConfigSchema = Type.Object({
  /** Telegram Bot API token. Overridden by TELEGRAM_BOT_TOKEN env var. */
  botToken: Type.Optional(Type.String()),
  /** Telegram chat ID to send approval requests to. Overridden by TELEGRAM_CHAT_ID env var. */
  chatId: Type.Optional(Type.String()),
});

/** Slack bot configuration for HITL approval requests with interactive buttons. */
export const SlackConfigSchema = Type.Object({
  /** Slack Bot User OAuth Token (xoxb-...). Overridden by SLACK_BOT_TOKEN env var. */
  botToken: Type.Optional(Type.String()),
  /** Slack channel ID to post approval messages to. Overridden by SLACK_CHANNEL_ID env var. */
  channelId: Type.Optional(Type.String()),
  /** Slack Signing Secret for verifying interaction webhooks. Overridden by SLACK_SIGNING_SECRET env var. */
  signingSecret: Type.Optional(Type.String()),
  /** Port for the interaction webhook server. Overridden by SLACK_INTERACTION_PORT env var. Default: 3201. */
  interactionPort: Type.Optional(Type.Number({ minimum: 1 })),
});

/** Top-level HITL policy configuration file schema. */
export const HitlPolicyConfigSchema = Type.Object({
  /** Schema version. Must be "1". */
  version: Type.String({ minLength: 1 }),
  /** Ordered list of HITL policies. First match wins. */
  policies: Type.Array(HitlPolicySchema, { minItems: 1 }),
  /** Optional Telegram configuration for policies that use channel: "telegram". */
  telegram: Type.Optional(TelegramConfigSchema),
  /** Optional Slack configuration for policies that use channel: "slack". */
  slack: Type.Optional(SlackConfigSchema),
});

export type HitlFallback = Static<typeof HitlFallbackSchema>;
export type HitlApprovalConfig = Static<typeof HitlApprovalConfigSchema>;
export type HitlPolicy = Static<typeof HitlPolicySchema>;
export type HitlPolicyConfig = Static<typeof HitlPolicyConfigSchema>;
export type TelegramConfig = Static<typeof TelegramConfigSchema>;
export type SlackConfig = Static<typeof SlackConfigSchema>;

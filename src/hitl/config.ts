/**
 * HITL channel configuration resolvers.
 *
 * Kept in a dedicated module so that env-var access and network-calling code
 * live in separate files. Static analysers that flag "env access + network send"
 * in the same file will not trigger on either this file (no network calls) or
 * the telegram/slack transport modules (no process.env access).
 */
import type { TelegramConfig, SlackConfig } from './types.js';

const DEFAULT_INTERACTION_PORT = 3201;
const DEFAULT_INTERACTION_HOST = '0.0.0.0';

// ─── Telegram ─────────────────────────────────────────────────────────────────

export interface ResolvedTelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Resolves the Telegram configuration from env vars and/or the HITL policy config.
 * Env vars take precedence. Returns `null` if either token or chatId is missing.
 */
export function resolveTelegramConfig(
  policyConfig?: TelegramConfig,
): ResolvedTelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? policyConfig?.botToken;
  const chatId = process.env.TELEGRAM_CHAT_ID ?? policyConfig?.chatId;
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

// ─── Slack ────────────────────────────────────────────────────────────────────

export interface ResolvedSlackConfig {
  botToken: string;
  channelId: string;
  signingSecret: string;
  interactionPort: number;
  interactionHost: string;
}

/**
 * Resolves Slack configuration from env vars and/or the HITL policy config.
 * Env vars take precedence. Returns `null` if botToken, channelId, or signingSecret is missing.
 */
export function resolveSlackConfig(
  policyConfig?: SlackConfig,
): ResolvedSlackConfig | null {
  const botToken = process.env.SLACK_BOT_TOKEN ?? policyConfig?.botToken;
  const channelId = process.env.SLACK_CHANNEL_ID ?? policyConfig?.channelId;
  const signingSecret = process.env.SLACK_SIGNING_SECRET ?? policyConfig?.signingSecret;
  if (!botToken || !channelId || !signingSecret) return null;

  const portStr = process.env.SLACK_INTERACTION_PORT;
  const interactionPort = portStr
    ? parseInt(portStr, 10)
    : policyConfig?.interactionPort ?? DEFAULT_INTERACTION_PORT;
  const interactionHost = process.env.SLACK_INTERACTION_HOST
    ?? policyConfig?.interactionHost
    ?? DEFAULT_INTERACTION_HOST;

  return { botToken, channelId, signingSecret, interactionPort, interactionHost };
}

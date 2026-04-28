// ─── Schema + Types ───────────────────────────────────────────────────────────
export {
  HitlFallbackSchema,
  HitlApprovalConfigSchema,
  HitlPolicySchema,
  HitlPolicyConfigSchema,
  TelegramConfigSchema,
  SlackConfigSchema,
} from './types.js';
export type {
  HitlFallback,
  HitlApprovalConfig,
  HitlPolicy,
  HitlPolicyConfig,
  TelegramConfig,
  SlackConfig,
} from './types.js';

// ─── Pattern matching ─────────────────────────────────────────────────────────
export { matchesActionPattern, checkAction } from './matcher.js';
export type { HitlCheckResult } from './matcher.js';

// ─── File parsing + validation ────────────────────────────────────────────────
export {
  parseHitlPolicyFile,
  validateHitlPolicyConfig,
  HitlPolicyParseError,
  HitlPolicyValidationError,
} from './parser.js';

// ─── Hot-reload watcher ───────────────────────────────────────────────────────
export { startHitlPolicyWatcher } from './watcher.js';
export type { HitlWatcherHandle } from './watcher.js';

// ─── Approval manager ────────────────────────────────────────────────────────
export { ApprovalManager, uuidv7, computeBinding, generateToken } from './approval-manager.js';
export type { HitlDecision, CreateApprovalOpts, ApprovalRequestHandle } from './approval-manager.js';

// ─── Telegram adapter ────────────────────────────────────────────────────────
export { TelegramListener, sendApprovalRequest, sendConfirmation, editMessageDecision, sendApproveAlwaysConfirmation, resolveTelegramConfig } from './telegram.js';
export type { ResolvedTelegramConfig, SendApprovalOpts, SendApprovalResult, SendApproveAlwaysConfirmationOpts, TelegramCommand, TelegramOperatorInfo } from './telegram.js';

// ─── Slack adapter ──────────────────────────────────────────────────────────
export { SlackInteractionServer, sendSlackApprovalRequest, sendSlackConfirmation, resolveSlackConfig, verifySlackSignature } from './slack.js';
export type { ResolvedSlackConfig, SlackSendApprovalOpts, SlackSendApprovalResult, SlackActionCommand } from './slack.js';

// ─── Console adapter ─────────────────────────────────────────────────────────
export { sendConsoleApprovalRequest } from './console.js';
export type { ConsoleSendApprovalResult, ConsoleIo } from './console.js';

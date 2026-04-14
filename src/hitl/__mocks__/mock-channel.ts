import type { ApprovalManager } from '../approval-manager.js';

export interface ApprovalRequest {
  approval_id: string;
  action_class: string;
  target: string;
}

/**
 * Mock HITL channel for integration tests.
 *
 * Simulates a Telegram/Slack channel interaction without real transport.
 * Captures approval requests sent via sendApprovalRequest() and exposes
 * approve()/reject() to resolve them through the wrapped ApprovalManager.
 */
export class MockHitlChannel {
  private readonly _messages: ApprovalRequest[] = [];
  private readonly manager: ApprovalManager;

  constructor(manager: ApprovalManager) {
    this.manager = manager;
  }

  /**
   * Simulates the channel receiving an approval request.
   * Stores the message for later assertion via messages / pendingRequest.
   */
  sendApprovalRequest(req: ApprovalRequest): void {
    this._messages.push({ ...req });
  }

  /** All approval requests received so far, in order. */
  get messages(): readonly ApprovalRequest[] {
    return this._messages;
  }

  /** The most recent approval request received, or null if none. */
  get pendingRequest(): ApprovalRequest | null {
    return this._messages.at(-1) ?? null;
  }

  /**
   * Resolves the most recent pending approval as 'approved' via ApprovalManager.
   * Returns true if the resolution succeeded, false if no pending request exists
   * or the token is unknown/already consumed.
   */
  approve(): boolean {
    const req = this.pendingRequest;
    if (!req) return false;
    return this.manager.resolveApproval(req.approval_id, 'approved');
  }

  /**
   * Resolves the most recent pending approval as 'denied' via ApprovalManager.
   * Returns true if the resolution succeeded, false if no pending request exists
   * or the token is unknown/already consumed.
   */
  reject(): boolean {
    const req = this.pendingRequest;
    if (!req) return false;
    return this.manager.resolveApproval(req.approval_id, 'denied');
  }
}

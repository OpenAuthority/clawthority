/**
 * Cedar entity hydration from RuleContext.
 *
 * Converts a `RuleContext` into a Cedar-compatible entity store for use with
 * the `@cedar-policy/cedar-wasm` `isAuthorized()` call. Each entity follows
 * the Cedar entity JSON format: `{ uid, attrs, parents }`.
 *
 * Entity mapping (T5 attribute design):
 *   RuleContext.agentId    → Agent entity uid + "agentId" String attribute
 *   RuleContext.channel    → Agent "channel" String attribute
 *   RuleContext.verified   → Agent "verified" Bool attribute (omitted when undefined)
 *   RuleContext.userId     → Agent "userId" String attribute (omitted when undefined)
 *   RuleContext.sessionId  → Agent "sessionId" String attribute (omitted when undefined)
 */

import type { RuleContext } from './types.js';

// ---------------------------------------------------------------------------
// Cedar entity JSON types (Cedar WASM entity store format)
// ---------------------------------------------------------------------------

/** A Cedar scalar value as used in the entity JSON format. */
export type CedarValue =
  | { String: string }
  | { Long: number }
  | { Bool: boolean }
  | { Set: CedarValue[] }
  | { Record: Record<string, CedarValue> }
  | { Entity: CedarEntityUid };

/** Unique identifier for a Cedar entity. */
export interface CedarEntityUid {
  type: string;
  id: string;
}

/** A single Cedar entity as expected by the entity store. */
export interface CedarEntity {
  uid: CedarEntityUid;
  attrs: Record<string, CedarValue>;
  parents: CedarEntityUid[];
}

// ---------------------------------------------------------------------------
// Entity builder
// ---------------------------------------------------------------------------

/**
 * Converts a `RuleContext` into a Cedar entity store array.
 *
 * Produces a single `Agent` entity whose uid is `{ type: "Agent", id: agentId }`.
 * Optional fields (`verified`, `userId`, `sessionId`) are included only when
 * they are not `undefined`. Null-safe: treats `undefined` and `null` the same way.
 *
 * @param context  The rule evaluation context from the enforcement pipeline.
 * @returns        An array of `CedarEntity` objects ready for the WASM entity store.
 */
export function buildEntities(context: RuleContext): CedarEntity[] {
  const attrs: Record<string, CedarValue> = {
    agentId: { String: context.agentId },
    channel: { String: context.channel },
  };

  if (context.verified !== undefined && context.verified !== null) {
    attrs['verified'] = { Bool: context.verified };
  }

  if (context.userId !== undefined && context.userId !== null) {
    attrs['userId'] = { String: context.userId };
  }

  if (context.sessionId !== undefined && context.sessionId !== null) {
    attrs['sessionId'] = { String: context.sessionId };
  }

  const principal: CedarEntity = {
    uid: { type: 'Agent', id: context.agentId },
    attrs,
    parents: [],
  };

  return [principal];
}

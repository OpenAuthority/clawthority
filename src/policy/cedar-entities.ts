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

/**
 * A Cedar scalar value as used in the Cedar WASM entity store.
 *
 * Cedar WASM v4.x accepts plain JavaScript primitives for scalar attributes:
 *   - String  → plain `string`
 *   - Boolean → plain `boolean`
 *   - Number  → plain `number`
 *   - Entity  → `{ __entity: { type, id } }`
 *   - Extension → `{ __extn: { fn, arg } }`
 */
export type CedarValue = string | boolean | number | null | CedarValue[] | { __entity: CedarEntityUid } | { [key: string]: CedarValue };

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
 * Produces a single `Agent` entity whose uid is `{ type: "OpenAuthority::Agent", id: agentId }`.
 * Optional fields (`verified`, `userId`, `sessionId`) are included only when
 * they are not `undefined`. Null-safe: treats `undefined` and `null` the same way.
 *
 * @param context  The rule evaluation context from the enforcement pipeline.
 * @returns        An array of `CedarEntity` objects ready for the WASM entity store.
 */
export function buildEntities(context: RuleContext): CedarEntity[] {
  const attrs: Record<string, CedarValue> = {
    agentId: context.agentId,
    channel: context.channel,
  };

  if (context.verified !== undefined && context.verified !== null) {
    attrs['verified'] = context.verified;
  }

  if (context.userId !== undefined && context.userId !== null) {
    attrs['userId'] = context.userId;
  }

  if (context.sessionId !== undefined && context.sessionId !== null) {
    attrs['sessionId'] = context.sessionId;
  }

  const principal: CedarEntity = {
    uid: { type: 'OpenAuthority::Agent', id: context.agentId },
    attrs,
    parents: [],
  };

  return [principal];
}

/**
 * Builds a Cedar `Resource` entity for the entity store, carrying the
 * `actionClass` attribute so that Cedar policies can match on it.
 *
 * The returned entity has uid `{ type: 'OpenAuthority::Resource', id: '<resourceType>:<resourceName>' }`
 * and a single `actionClass` String attribute.
 *
 * @param resourceType  Cedar resource type token (e.g. `'file'`, `'tool'`).
 * @param resourceName  Specific resource being accessed (e.g. `'read_file'`).
 * @param actionClass   Semantic action class string (e.g. `'filesystem.read'`).
 * @returns             A {@link CedarEntity} ready for the WASM entity store.
 */
export function buildResourceEntity(
  resourceType: string,
  resourceName: string,
  actionClass: string,
): CedarEntity {
  return {
    uid: { type: 'OpenAuthority::Resource', id: `${resourceType}:${resourceName}` },
    attrs: {
      actionClass,
    },
    parents: [],
  };
}

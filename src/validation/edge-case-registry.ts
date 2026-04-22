/**
 * Edge case handler registry for command validation.
 *
 * Provides a centralized registry (`EdgeCaseRegistry`) that catalogs and
 * dispatches handlers for command validation edge cases. Uses the strategy
 * pattern: each `EdgeCaseHandler` encapsulates the logic for a specific
 * `EdgeCaseType` and is resolved at dispatch time.
 *
 * Supported edge case types:
 *  - `compound-operation`  Multiple commands chained with &&, ||, or ;
 *  - `shell-pipeline`      Commands composed via | operator
 *  - `one-off-operation`   Single commands with special edge case properties
 */

// ─── Edge case types ──────────────────────────────────────────────────────────

/** Discriminated union of recognised command validation edge case categories. */
export type EdgeCaseType =
  | 'compound-operation'
  | 'shell-pipeline'
  | 'one-off-operation';

// ─── Context & result ─────────────────────────────────────────────────────────

/**
 * Context supplied to an `EdgeCaseHandler` at dispatch time.
 *
 * `type` must match the `edgeCaseType` of the handler that will receive it.
 * `command` is the raw command string being validated.
 * `metadata` carries optional caller-defined key/value pairs.
 */
export interface EdgeCaseContext {
  /** The edge case category of the command. */
  readonly type: EdgeCaseType;
  /** Raw command string under validation. */
  readonly command: string;
  /** Optional caller-supplied metadata for handler use. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Decision outcome produced by an `EdgeCaseHandler`.
 *
 * - `permit`  The command may proceed.
 * - `forbid`  The command must be blocked.
 * - `defer`   No decision; fall through to the next pipeline stage.
 */
export type EdgeCaseDecision = 'permit' | 'forbid' | 'defer';

/**
 * Result returned by a dispatched `EdgeCaseHandler`.
 *
 * When `handled` is `false` the registry produced this result itself because
 * no handler was registered for the requested `EdgeCaseType`.
 */
export interface EdgeCaseResult {
  /** Whether a registered handler processed the request. */
  readonly handled: boolean;
  /** The handler's decision (or `defer` when unhandled). */
  readonly decision: EdgeCaseDecision;
  /** Human-readable explanation of the decision. */
  readonly reason: string;
  /** Optional result metadata produced by the handler. */
  readonly metadata?: Record<string, unknown>;
}

// ─── Handler interface ────────────────────────────────────────────────────────

/**
 * Async function that evaluates an edge case context and returns a result.
 *
 * Implementations must be free of side effects that affect external state
 * beyond what is documented in their own contracts. They may be async.
 */
export type EdgeCaseHandlerFn = (
  context: EdgeCaseContext,
) => Promise<EdgeCaseResult>;

/**
 * Strategy interface for edge case processors.
 *
 * Each handler declares the single `EdgeCaseType` it handles via
 * `edgeCaseType`. The registry uses this value as the lookup key and will
 * replace any previously registered handler for the same type.
 *
 * @example
 * ```ts
 * const myHandler: EdgeCaseHandler = {
 *   edgeCaseType: 'shell-pipeline',
 *   handle: async (ctx) => ({
 *     handled: true,
 *     decision: 'defer',
 *     reason: 'pipeline inspection not yet implemented',
 *   }),
 * };
 * ```
 */
export interface EdgeCaseHandler {
  /** The edge case category this handler is responsible for. */
  readonly edgeCaseType: EdgeCaseType;
  /** Evaluate the context and return a result. */
  readonly handle: EdgeCaseHandlerFn;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Centralized registry that maps `EdgeCaseType` values to `EdgeCaseHandler`
 * strategies and dispatches requests to the appropriate handler.
 *
 * The registry is intentionally stateful and injectable: construct a fresh
 * instance per test suite to guarantee isolation.
 *
 * @example
 * ```ts
 * const registry = new EdgeCaseRegistry();
 * registry.register(myCompoundOpHandler);
 * const result = await registry.dispatch({
 *   type: 'compound-operation',
 *   command: 'npm install && npm run build',
 * });
 * ```
 */
export class EdgeCaseRegistry {
  private readonly handlers = new Map<EdgeCaseType, EdgeCaseHandler>();

  /**
   * Register a handler for its declared `EdgeCaseType`.
   *
   * If a handler for the same type was previously registered it is silently
   * replaced by the new one.
   */
  register(handler: EdgeCaseHandler): void {
    this.handlers.set(handler.edgeCaseType, handler);
  }

  /**
   * Dispatch a context to its registered handler asynchronously.
   *
   * When no handler is registered for `context.type` the registry returns a
   * default result with `handled: false` and `decision: 'defer'` rather than
   * throwing, so callers can always trust the return type.
   */
  async dispatch(context: EdgeCaseContext): Promise<EdgeCaseResult> {
    const handler = this.handlers.get(context.type);
    if (handler === undefined) {
      return {
        handled: false,
        decision: 'defer',
        reason: `No handler registered for edge case type: ${context.type}`,
      };
    }
    return handler.handle(context);
  }

  /**
   * Return `true` if a handler is registered for the given `EdgeCaseType`.
   */
  has(type: EdgeCaseType): boolean {
    return this.handlers.has(type);
  }

  /**
   * Remove the handler for the given `EdgeCaseType`.
   *
   * @returns `true` if a handler was removed, `false` if none was registered.
   */
  unregister(type: EdgeCaseType): boolean {
    return this.handlers.delete(type);
  }

  /**
   * Return the list of `EdgeCaseType` values that currently have registered
   * handlers. Order is insertion order.
   */
  registeredTypes(): EdgeCaseType[] {
    return Array.from(this.handlers.keys());
  }
}

// ─── Default instance ─────────────────────────────────────────────────────────

/**
 * Shared `EdgeCaseRegistry` instance for production use.
 *
 * Tests should construct their own `new EdgeCaseRegistry()` instance rather
 * than importing this export, to avoid cross-test state leakage.
 */
export const defaultEdgeCaseRegistry = new EdgeCaseRegistry();

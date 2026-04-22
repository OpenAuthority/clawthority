/**
 * Compound operation sequencer (F-06 pattern).
 *
 * Decomposes compound operation strings (e.g. "git_clone → npm_install → run_tests")
 * into a validated sequence of fine-grained tool calls, verifying each step against
 * the @openclaw/action-registry action taxonomy.
 *
 * Supported separator notation:
 *   →  / ->  Arrow notation (logical sequence)
 *   &&        AND operator (conditional sequence)
 *   ;         Semicolon operator (unconditional sequence)
 *
 * Constraints:
 *   - Each step must resolve to a registered tool alias in the taxonomy.
 *   - shell.exec class tools (exec wrappers: bash, shell_exec, cmd, …) are
 *     forbidden. Compound operations must use fine-grained tool calls only.
 *     No 'do everything' tools are permitted.
 *
 * Implements EdgeCaseHandler for integration with EdgeCaseRegistry.
 *
 * This handler performs planning only — tool execution is out of scope.
 *
 * @see F-06 pattern documentation
 * @see T89
 */

import { REGISTRY, ActionClass } from '@openclaw/action-registry';
import type { ActionRegistryEntry, RiskLevel, HitlModeNorm } from '@openclaw/action-registry';
import type { EdgeCaseHandler, EdgeCaseContext, EdgeCaseResult } from './edge-case-registry.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Regex that splits a compound operation string on any supported separator.
 * Captures: → (Unicode arrow), -> (ASCII arrow), && (AND), ; (semicolon).
 * Leading and trailing whitespace around the separator is consumed.
 */
const SEPARATOR_RE = /\s*(?:→|->|&&|;)\s*/;

/**
 * Exec wrapper tool names that are forbidden in compound operations.
 * These tools resolve to shell.exec and violate the fine-grained tool constraint.
 * Stored lowercase; matching is case-insensitive.
 */
const EXEC_WRAPPER_NAMES: ReadonlySet<string> = new Set([
  'bash',
  'shell_exec',
  'run_command',
  'execute_command',
  'run_terminal_cmd',
  'terminal_exec',
  'cmd',
  'exec',
  'sh',
  'zsh',
]);

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single fine-grained tool call within an operation plan.
 *
 * `stepIndex` is 0-based and reflects the step's original position in the
 * compound operation string (including positions occupied by invalid steps).
 * `toolName` is the raw string as supplied by the caller. `actionClass`,
 * `risk`, and `hitlMode` are resolved from the @openclaw/action-registry.
 */
export interface OperationStep {
  /** 0-based position of this step in the compound operation sequence. */
  readonly stepIndex: number;
  /** Raw tool name as supplied in the compound operation string. */
  readonly toolName: string;
  /** Resolved action class from the @openclaw/action-registry taxonomy. */
  readonly actionClass: string;
  /** Default risk level of the resolved action class. */
  readonly risk: RiskLevel;
  /** Default HITL mode of the resolved action class. */
  readonly hitlMode: HitlModeNorm;
}

/**
 * Structured plan produced by `CompoundOperationHandler.plan()`.
 *
 * When `valid` is `false`, `errors` lists all reasons why planning failed.
 * `steps` contains only successfully resolved steps; partial plans surface
 * all errors at once rather than failing fast on the first invalid step.
 */
export interface OperationPlan {
  /** Original compound operation string passed to `plan()`. */
  readonly input: string;
  /** Ordered sequence of validated fine-grained tool calls. */
  readonly steps: readonly OperationStep[];
  /** `true` when all steps resolved successfully and there are no errors. */
  readonly valid: boolean;
  /** Ordered list of validation error messages. Empty when `valid` is `true`. */
  readonly errors: readonly string[];
}

// ─── CompoundOperationHandler ─────────────────────────────────────────────────

/**
 * Sequences compound operations into validated fine-grained tool calls.
 *
 * Implements {@link EdgeCaseHandler} for integration with {@link EdgeCaseRegistry}.
 *
 * @example
 * ```ts
 * const handler = new CompoundOperationHandler();
 * const plan = handler.plan('git_clone → npm_install → run_tests');
 * // plan.valid === true
 * // plan.steps[0].actionClass === 'vcs.remote'
 * // plan.steps[1].actionClass === 'package.install'
 * // plan.steps[2].actionClass === 'build.test'
 * ```
 */
export class CompoundOperationHandler implements EdgeCaseHandler {
  readonly edgeCaseType = 'compound-operation' as const;

  private readonly aliasIndex: ReadonlyMap<string, ActionRegistryEntry>;

  constructor() {
    const idx = new Map<string, ActionRegistryEntry>();
    for (const entry of REGISTRY) {
      for (const alias of entry.aliases) {
        idx.set(alias, entry);
      }
    }
    this.aliasIndex = idx;
  }

  /**
   * Parses a compound operation string and generates a validated sequence of
   * fine-grained tool calls.
   *
   * Steps are split on `→`, `->`, `&&`, or `;`. Each step is resolved against
   * the registry alias index. Steps that resolve to `shell.exec` or that match
   * exec wrapper tool names are rejected (no 'do everything' tools allowed).
   *
   * All steps are evaluated; errors accumulate rather than failing fast.
   *
   * @param input  Compound operation string (e.g. "git_clone → npm_install → run_tests").
   * @returns      Structured operation plan with resolved steps and any errors.
   */
  plan(input: string): OperationPlan {
    const trimmed = input.trim();

    if (trimmed === '') {
      return {
        input,
        steps: [],
        valid: false,
        errors: ['Input compound operation string must not be empty.'],
      };
    }

    const rawSteps = trimmed.split(SEPARATOR_RE);
    const steps: OperationStep[] = [];
    const errors: string[] = [];

    for (let i = 0; i < rawSteps.length; i++) {
      const toolName = rawSteps[i].trim();

      if (toolName === '') {
        errors.push(`Step ${i + 1}: empty step name is not allowed.`);
        continue;
      }

      const lowerName = toolName.toLowerCase();

      // Reject exec wrapper tool names — forbidden "do everything" tools
      if (EXEC_WRAPPER_NAMES.has(lowerName)) {
        errors.push(
          `Step ${i + 1}: "${toolName}" is a forbidden exec wrapper tool. ` +
            `Compound operations must decompose into fine-grained tool calls only.`,
        );
        continue;
      }

      const entry = this.aliasIndex.get(lowerName);

      if (entry === undefined) {
        errors.push(
          `Step ${i + 1}: "${toolName}" is not a registered tool alias in the action taxonomy.`,
        );
        continue;
      }

      // Belt-and-suspenders: reject any alias that resolves to shell.exec
      if (entry.action_class === ActionClass.ShellExec) {
        errors.push(
          `Step ${i + 1}: "${toolName}" resolves to shell.exec, which is not permitted ` +
            `in compound operations. Use a fine-grained registered tool instead.`,
        );
        continue;
      }

      steps.push({
        stepIndex: i,
        toolName,
        actionClass: entry.action_class,
        risk: entry.default_risk,
        hitlMode: entry.default_hitl_mode,
      });
    }

    return {
      input,
      steps,
      valid: errors.length === 0 && steps.length > 0,
      errors,
    };
  }

  /**
   * Handles a compound-operation edge case context.
   *
   * Delegates to `plan()` and returns a permit decision if all steps validate,
   * or a forbid decision with the first validation error if any step fails.
   * The full {@link OperationPlan} is attached to the result metadata.
   *
   * @param context  Edge case context carrying the compound operation command string.
   * @returns        Edge case result with decision and attached operation plan.
   */
  async handle(context: EdgeCaseContext): Promise<EdgeCaseResult> {
    const operationPlan = this.plan(context.command);

    if (!operationPlan.valid) {
      return {
        handled: true,
        decision: 'forbid',
        reason:
          operationPlan.errors[0] ??
          'Compound operation failed taxonomy validation.',
        metadata: { plan: operationPlan },
      };
    }

    return {
      handled: true,
      decision: 'permit',
      reason: `Compound operation decomposed into ${operationPlan.steps.length} fine-grained step(s).`,
      metadata: { plan: operationPlan },
    };
  }
}

/**
 * Auto-permits subsystem.
 *
 * @module
 */

export {
  DerivationMethodSchema,
  DerivePatternOptsSchema,
  DerivedPatternSchema,
  PatternDerivationError,
  derivePattern,
  validatePattern,
  isDerivedPattern,
} from './pattern-derivation.js';

export type {
  DerivationMethod,
  DerivePatternOpts,
  DerivedPattern,
  PatternValidationResult,
} from './pattern-derivation.js';

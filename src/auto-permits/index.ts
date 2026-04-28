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

export {
  AutoPermitStorageModeSchema,
  DEFAULT_AUTO_PERMIT_STORE_PATH,
  RULES_FILE_PATH,
  resolveAutoPermitStoreConfig,
} from './config.js';

export type {
  AutoPermitStorageMode,
  ResolvedAutoPermitStoreConfig,
} from './config.js';

export {
  compilePatternRegex,
  FileAutoPermitChecker,
} from './matcher.js';

export type {
  AutoPermitRuleChecker,
} from './matcher.js';

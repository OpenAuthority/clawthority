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

export {
  loadAutoPermitRulesFromFile,
  saveAutoPermitRules,
  watchAutoPermitStore,
} from './store.js';

export type {
  LoadResult,
  AutoPermitWatchHandle,
  WatchAutoPermitStoreOpts,
} from './store.js';

export {
  AutoPermitLoadError,
  AutoPermitFileSchema,
  validateAutoPermitContent,
} from './validation.js';

export type {
  AutoPermitFile,
  AutoPermitEntryError,
  AutoPermitFileValidationResult,
} from './validation.js';

export {
  measurePermitEval,
  estimatePermitMemoryBytes,
  logPermitMemoryUsage,
  SLOW_EVAL_THRESHOLD_MS,
  LARGE_PERMIT_SET_THRESHOLD,
  MEMORY_WARN_THRESHOLD_BYTES,
} from './perf-monitor.js';

export type { AutoPermitPerfMetrics } from './perf-monitor.js';

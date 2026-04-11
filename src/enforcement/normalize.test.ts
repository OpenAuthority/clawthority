import { describe, it } from 'vitest';
import {
  normalize_action,
  getRegistryEntry,
  normalizeActionClass,
  sortedJsonStringify,
} from './normalize.js';
import type { ActionRegistryEntry, NormalizedAction, RiskLevel, HitlModeNorm } from './normalize.js';

describe('getRegistryEntry', () => {
  it.todo('returns the correct entry for a known tool name');
  it.todo('matches aliases case-insensitively (READ_FILE → filesystem.read)');
  it.todo('returns unknown_sensitive_action entry for an unrecognised tool');
  it.todo('returns unknown_sensitive_action entry for an empty string');
});

describe('normalizeActionClass', () => {
  it.todo('returns canonical action class string for a known tool');
  it.todo('returns unknown_sensitive_action for an unrecognised tool');
});

describe('normalize_action', () => {
  it.todo('extracts target from path param');
  it.todo('extracts target from file param');
  it.todo('extracts target from url param');
  it.todo('extracts target from destination param');
  it.todo('extracts target from to param');
  it.todo('extracts target from recipient param');
  it.todo('extracts target from email param');
  it.todo('reclassifies filesystem.write with http:// target to web.post');
  it.todo('reclassifies filesystem.write with https:// target to web.post');
  it.todo('does not reclassify filesystem.write with a plain file path');
  it.todo('raises risk to critical when a param value contains shell metacharacters');
  it.todo('raises risk to critical for semicolon in param');
  it.todo('raises risk to critical for pipe character in param');
  it.todo('raises risk to critical for backtick in param');
  it.todo('raises risk to critical for $() in param');
  it.todo('unknown tools map to unknown_sensitive_action with critical risk');
  it.todo('returns empty string as target when no target param is present');
  it.todo('defaults params to empty object when omitted');
});

describe('sortedJsonStringify', () => {
  it.todo('serialises a flat object with keys sorted');
  it.todo('serialises a nested object with all levels sorted');
  it.todo('serialises arrays preserving element order');
  it.todo('serialises primitives (string, number, boolean, null)');
  it.todo('produces the same output regardless of key insertion order');
});

void normalize_action;
void getRegistryEntry;
void normalizeActionClass;
void sortedJsonStringify;
void ({} as ActionRegistryEntry);
void ({} as NormalizedAction);
void ({} as RiskLevel);
void ({} as HitlModeNorm);

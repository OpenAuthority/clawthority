/**
 * Skill activation validator tests.
 *
 * Verifies that `FIRST_PARTY_MANIFESTS` is correctly populated and that
 * `validateSkillManifestsForActivation` correctly validates all first-party
 * manifests, throws on failure, and demotes failures to warnings when
 * `allowUnsafeLegacy` is true.
 *
 * Test IDs:
 *   TC-SAV-01: FIRST_PARTY_MANIFESTS is a non-empty ordered registry
 *   TC-SAV-02: validateSkillManifestsForActivation passes for all valid first-party manifests
 *   TC-SAV-03: validateSkillManifestsForActivation throws when a manifest fails and allowUnsafeLegacy is false
 *   TC-SAV-04: validateSkillManifestsForActivation warns instead of throwing when allowUnsafeLegacy is true
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  FIRST_PARTY_MANIFESTS,
  validateSkillManifestsForActivation,
} from './skill-activation-validator.js';
import type { ToolManifest } from './skill-manifest-validator.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── TC-SAV-01: FIRST_PARTY_MANIFESTS registry ────────────────────────────────

describe('TC-SAV-01: FIRST_PARTY_MANIFESTS is a non-empty ordered registry', () => {
  it('exports a non-empty readonly array', () => {
    expect(Array.isArray(FIRST_PARTY_MANIFESTS)).toBe(true);
    expect(FIRST_PARTY_MANIFESTS.length).toBeGreaterThan(0);
  });

  it('contains known first-party tool names', () => {
    const names = FIRST_PARTY_MANIFESTS.map((m) => m.name);
    expect(names).toContain('git_add');
    expect(names).toContain('git_log');
    expect(names).toContain('git_diff');
    expect(names).toContain('git_status');
    expect(names).toContain('git_merge');
    expect(names).toContain('edit_file');
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('list_dir');
  });

  it('each entry has the required ToolManifest fields', () => {
    for (const manifest of FIRST_PARTY_MANIFESTS) {
      expect(typeof manifest.name).toBe('string');
      expect(typeof manifest.version).toBe('string');
      expect(typeof manifest.action_class).toBe('string');
      expect(typeof manifest.risk_tier).toBe('string');
      expect(typeof manifest.default_hitl_mode).toBe('string');
    }
  });
});

// ─── TC-SAV-02: validateSkillManifestsForActivation passes for valid manifests ─

describe('TC-SAV-02: validateSkillManifestsForActivation passes for all valid first-party manifests', () => {
  it('does not throw when all manifests are valid', () => {
    expect(() => validateSkillManifestsForActivation(false)).not.toThrow();
  });

  it('does not emit any console.warn when all manifests are valid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    validateSkillManifestsForActivation(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ─── TC-SAV-03: throws on failure when allowUnsafeLegacy is false ─────────────

describe('TC-SAV-03: validateSkillManifestsForActivation throws when a manifest fails and allowUnsafeLegacy is false', () => {
  const invalidManifest: ToolManifest = {
    name: 'broken-tool',
    version: '1.0.0',
    action_class: 'custom.unregistered.class',
    risk_tier: 'low',
    default_hitl_mode: 'none',
    params: { type: 'object', properties: {}, additionalProperties: false },
    result: { type: 'object', properties: {} },
  };

  it('throws an Error listing the failing manifest', () => {
    expect(() => validateSkillManifestsForActivation(false, [invalidManifest])).toThrow(
      /Skill manifest validation failed/,
    );
  });

  it('error message includes the manifest name', () => {
    let caught: Error | undefined;
    try {
      validateSkillManifestsForActivation(false, [invalidManifest]);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('"broken-tool"');
  });

  it('error message includes all failing manifests when multiple fail', () => {
    const anotherInvalid: ToolManifest = {
      ...invalidManifest,
      name: 'other-broken-tool',
    };
    let caught: Error | undefined;
    try {
      validateSkillManifestsForActivation(false, [invalidManifest, anotherInvalid]);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught!.message).toContain('"broken-tool"');
    expect(caught!.message).toContain('"other-broken-tool"');
  });

  it('does not throw when the manifest list is empty', () => {
    expect(() => validateSkillManifestsForActivation(false, [])).not.toThrow();
  });
});

// ─── TC-SAV-04: warns instead of throwing when allowUnsafeLegacy is true ──────

describe('TC-SAV-04: validateSkillManifestsForActivation warns instead of throwing when allowUnsafeLegacy is true', () => {
  const invalidManifest: ToolManifest = {
    name: 'legacy-broken-tool',
    version: '1.0.0',
    action_class: 'custom.unregistered.class',
    risk_tier: 'low',
    default_hitl_mode: 'none',
    params: { type: 'object', properties: {}, additionalProperties: false },
    result: { type: 'object', properties: {} },
  };

  it('does not throw when allowUnsafeLegacy is true', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => validateSkillManifestsForActivation(true, [invalidManifest])).not.toThrow();
  });

  it('emits console.warn for each failing manifest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    validateSkillManifestsForActivation(true, [invalidManifest]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('legacy-broken-tool');
  });

  it('warning message contains [OpenAuthority] prefix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    validateSkillManifestsForActivation(true, [invalidManifest]);
    expect(warn.mock.calls[0]![0]).toContain('[OpenAuthority]');
  });

  it('reads OPENAUTHORITY_ALLOW_UNSAFE_LEGACY env var as default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const originalVal = process.env['OPENAUTHORITY_ALLOW_UNSAFE_LEGACY'];
    process.env['OPENAUTHORITY_ALLOW_UNSAFE_LEGACY'] = '1';
    try {
      // With env var set, should not throw even with invalid manifests
      expect(() => validateSkillManifestsForActivation(undefined, [invalidManifest])).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      if (originalVal === undefined) {
        delete process.env['OPENAUTHORITY_ALLOW_UNSAFE_LEGACY'];
      } else {
        process.env['OPENAUTHORITY_ALLOW_UNSAFE_LEGACY'] = originalVal;
      }
    }
  });
});

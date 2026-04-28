import { describe, it, expect, afterEach } from 'vitest';
import { resolveFeatureFlags } from './features.js';

describe('resolveFeatureFlags', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ── approveAlwaysEnabled ─────────────────────────────────────────────────

  it('approveAlwaysEnabled is true by default', () => {
    delete process.env.CLAWTHORITY_DISABLE_APPROVE_ALWAYS;
    expect(resolveFeatureFlags().approveAlwaysEnabled).toBe(true);
  });

  it('approveAlwaysEnabled is false when CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1', () => {
    process.env.CLAWTHORITY_DISABLE_APPROVE_ALWAYS = '1';
    expect(resolveFeatureFlags().approveAlwaysEnabled).toBe(false);
  });

  it('approveAlwaysEnabled is true when CLAWTHORITY_DISABLE_APPROVE_ALWAYS is not "1"', () => {
    process.env.CLAWTHORITY_DISABLE_APPROVE_ALWAYS = '0';
    expect(resolveFeatureFlags().approveAlwaysEnabled).toBe(true);
  });

  // ── approveAlwaysAutoConfirm ─────────────────────────────────────────────

  it('approveAlwaysAutoConfirm is false by default', () => {
    delete process.env.CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM;
    expect(resolveFeatureFlags().approveAlwaysAutoConfirm).toBe(false);
  });

  it('approveAlwaysAutoConfirm is true when CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM=1', () => {
    process.env.CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM = '1';
    expect(resolveFeatureFlags().approveAlwaysAutoConfirm).toBe(true);
  });

  it('approveAlwaysAutoConfirm is false when CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM is not "1"', () => {
    process.env.CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM = '0';
    expect(resolveFeatureFlags().approveAlwaysAutoConfirm).toBe(false);
  });

  it('trims whitespace when parsing CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM', () => {
    process.env.CLAWTHORITY_APPROVE_ALWAYS_AUTO_CONFIRM = ' 1 ';
    expect(resolveFeatureFlags().approveAlwaysAutoConfirm).toBe(true);
  });

  // ── hitlMinimal ──────────────────────────────────────────────────────────

  it('hitlMinimal is false by default', () => {
    delete process.env.CLAWTHORITY_HITL_MINIMAL;
    expect(resolveFeatureFlags().hitlMinimal).toBe(false);
  });

  it('hitlMinimal is true when CLAWTHORITY_HITL_MINIMAL=1', () => {
    process.env.CLAWTHORITY_HITL_MINIMAL = '1';
    expect(resolveFeatureFlags().hitlMinimal).toBe(true);
  });

  it('hitlMinimal is false when CLAWTHORITY_HITL_MINIMAL is not "1"', () => {
    process.env.CLAWTHORITY_HITL_MINIMAL = '0';
    expect(resolveFeatureFlags().hitlMinimal).toBe(false);
  });

  it('trims whitespace when parsing CLAWTHORITY_HITL_MINIMAL', () => {
    process.env.CLAWTHORITY_HITL_MINIMAL = ' 1 ';
    expect(resolveFeatureFlags().hitlMinimal).toBe(true);
  });
});

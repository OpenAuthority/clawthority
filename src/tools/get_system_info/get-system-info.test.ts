/**
 * Unit tests for the get_system_info tool.
 *
 * Test IDs:
 *   TC-GSI-01: Successful system info retrieval
 *   TC-GSI-02: Result shape validation
 *   TC-GSI-03: No process control side-effects
 */

import { describe, it, expect } from 'vitest';
import { getSystemInfo } from './get-system-info.js';

// ─── TC-GSI-01: Successful system info retrieval ──────────────────────────────

describe('TC-GSI-01: successful system info retrieval', () => {
  it('returns a result without throwing', () => {
    expect(() => getSystemInfo()).not.toThrow();
  });

  it('returns a result when called with no arguments', () => {
    const result = getSystemInfo();
    expect(result).toBeDefined();
  });

  it('returns a result when called with an empty params object', () => {
    const result = getSystemInfo({});
    expect(result).toBeDefined();
  });

  it('platform is a non-empty string', () => {
    const result = getSystemInfo();
    expect(typeof result.platform).toBe('string');
    expect(result.platform.length).toBeGreaterThan(0);
  });

  it('arch is a non-empty string', () => {
    const result = getSystemInfo();
    expect(typeof result.arch).toBe('string');
    expect(result.arch.length).toBeGreaterThan(0);
  });

  it('hostname is a non-empty string', () => {
    const result = getSystemInfo();
    expect(typeof result.hostname).toBe('string');
    expect(result.hostname.length).toBeGreaterThan(0);
  });

  it('node_version starts with v', () => {
    const result = getSystemInfo();
    expect(result.node_version).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('total_memory is a positive number', () => {
    const result = getSystemInfo();
    expect(typeof result.total_memory).toBe('number');
    expect(result.total_memory).toBeGreaterThan(0);
  });

  it('free_memory is a non-negative number not exceeding total_memory', () => {
    const result = getSystemInfo();
    expect(typeof result.free_memory).toBe('number');
    expect(result.free_memory).toBeGreaterThanOrEqual(0);
    expect(result.free_memory).toBeLessThanOrEqual(result.total_memory);
  });

  it('uptime is a positive number', () => {
    const result = getSystemInfo();
    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThan(0);
  });
});

// ─── TC-GSI-02: Result shape validation ───────────────────────────────────────

describe('TC-GSI-02: result shape validation', () => {
  it('result has exactly the expected keys', () => {
    const result = getSystemInfo();
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(
      ['arch', 'free_memory', 'hostname', 'node_version', 'os_release', 'platform', 'total_memory', 'uptime'],
    );
  });

  it('os_release is a string', () => {
    const result = getSystemInfo();
    expect(typeof result.os_release).toBe('string');
  });

  it('result is a plain object', () => {
    const result = getSystemInfo();
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
  });
});

// ─── TC-GSI-03: No process control side-effects ───────────────────────────────

describe('TC-GSI-03: no process control side-effects', () => {
  it('does not modify process.env', () => {
    const envBefore = { ...process.env };
    getSystemInfo();
    expect(process.env).toEqual(envBefore);
  });

  it('returns consistent platform across multiple calls', () => {
    const a = getSystemInfo();
    const b = getSystemInfo();
    expect(a.platform).toBe(b.platform);
    expect(a.arch).toBe(b.arch);
    expect(a.node_version).toBe(b.node_version);
    expect(a.total_memory).toBe(b.total_memory);
  });
});

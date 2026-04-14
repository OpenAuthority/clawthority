import { describe, it, expect, beforeEach } from 'vitest';
import { CoverageMap } from './coverage.js';
import type { CoverageCell, CoverageEntry, CoverageState } from './coverage.js';

describe('CoverageMap', () => {
  let map: CoverageMap;

  beforeEach(() => {
    map = new CoverageMap();
  });

  describe('record', () => {
    it('records a permit hit for a resource/name pair', () => {
      map.record('tool', 'read_file', 'permit');
      expect(map.get('tool', 'read_file')?.state).toBe('permit');
    });

    it('records a forbid hit for a resource/name pair', () => {
      map.record('tool', 'delete_file', 'forbid');
      expect(map.get('tool', 'delete_file')?.state).toBe('forbid');
    });

    it('records a rate-limited hit for a resource/name pair', () => {
      map.record('tool', 'api_call', 'rate-limited');
      expect(map.get('tool', 'api_call')?.state).toBe('rate-limited');
    });

    it('increments hitCount on repeated calls for the same pair', () => {
      map.record('tool', 'read_file', 'permit');
      map.record('tool', 'read_file', 'permit');
      map.record('tool', 'read_file', 'forbid');
      expect(map.get('tool', 'read_file')?.hitCount).toBe(3);
    });

    it('sets lastHitAt as a valid ISO 8601 timestamp', () => {
      const before = Date.now();
      map.record('tool', 'read_file', 'permit');
      const after = Date.now();
      const cell = map.get('tool', 'read_file');
      expect(cell?.lastHitAt).toBeDefined();
      const ts = Date.parse(cell!.lastHitAt!);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('stores rateLimit from the matched rule on the cell', () => {
      const rule = {
        effect: 'permit' as const,
        resource: 'tool' as const,
        match: 'api',
        rateLimit: { maxCalls: 10, windowSeconds: 60 },
      };
      map.record('tool', 'api', 'permit', rule);
      expect(map.get('tool', 'api')?.rateLimit).toEqual({ maxCalls: 10, windowSeconds: 60 });
    });

    it('retains existing rateLimit when no matchedRule is provided', () => {
      const rule = {
        effect: 'permit' as const,
        resource: 'tool' as const,
        match: 'api',
        rateLimit: { maxCalls: 5, windowSeconds: 30 },
      };
      map.record('tool', 'api', 'permit', rule);
      map.record('tool', 'api', 'rate-limited'); // no matchedRule
      expect(map.get('tool', 'api')?.rateLimit).toEqual({ maxCalls: 5, windowSeconds: 30 });
    });

    it('overwrites state on each call (last write wins)', () => {
      map.record('tool', 'read_file', 'permit');
      map.record('tool', 'read_file', 'forbid');
      expect(map.get('tool', 'read_file')?.state).toBe('forbid');
    });
  });

  describe('get', () => {
    it('returns undefined for a resource/name pair that has never been recorded', () => {
      expect(map.get('tool', 'unknown_tool')).toBeUndefined();
    });

    it('returns the current CoverageCell after a record call', () => {
      map.record('command', 'ls', 'permit');
      const cell = map.get('command', 'ls');
      expect(cell).toBeDefined();
      expect(cell?.state).toBe('permit');
      expect(cell?.hitCount).toBe(1);
    });
  });

  describe('entries', () => {
    it('returns an empty array for a fresh CoverageMap', () => {
      expect(map.entries()).toEqual([]);
    });

    it('returns one entry per unique resource/name pair', () => {
      map.record('tool', 'read_file', 'permit');
      map.record('tool', 'write_file', 'forbid');
      map.record('command', 'ls', 'permit');
      expect(map.entries()).toHaveLength(3);
    });

    it('round-trips resource and name correctly through the internal key', () => {
      map.record('tool', 'read_file', 'permit');
      const [entry] = map.entries();
      expect(entry.resource).toBe('tool');
      expect(entry.name).toBe('read_file');
    });

    it('handles resource names that contain colons without corruption', () => {
      map.record('tool', 'user:read', 'permit');
      const [entry] = map.entries();
      expect(entry.resource).toBe('tool');
      expect(entry.name).toBe('user:read');
    });
  });

  describe('reset', () => {
    it('clears all recorded cells', () => {
      map.record('tool', 'read_file', 'permit');
      map.record('command', 'ls', 'forbid');
      map.reset();
      expect(map.entries()).toHaveLength(0);
    });

    it('entries() returns an empty array after reset', () => {
      map.record('tool', 'read_file', 'permit');
      map.reset();
      expect(map.entries()).toEqual([]);
    });

    it('get() returns undefined for previously recorded pairs after reset', () => {
      map.record('tool', 'read_file', 'permit');
      map.reset();
      expect(map.get('tool', 'read_file')).toBeUndefined();
    });
  });
});

void ({} as CoverageMap);
void ({} as CoverageCell);
void ({} as CoverageEntry);
void ({} as CoverageState);

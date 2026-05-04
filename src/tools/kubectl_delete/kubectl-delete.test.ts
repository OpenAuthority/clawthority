/**
 * Unit tests for the kubectl_delete tool.
 *
 * Test IDs:
 *   TC-KDL-01: kubectlDelete — pre-flight rejects bad inputs
 *   TC-KDL-02: kubectlDelete — pre-flight rejects bad grace_period
 *   TC-KDL-03: manifest      — F-05 manifest is well-formed
 */

import { describe, it, expect } from 'vitest';
import { kubectlDelete, KubectlDeleteError } from './kubectl-delete.js';
import { kubectlDeleteManifest } from './manifest.js';

// ─── TC-KDL-01: pre-flight rejects bad inputs ────────────────────────────────

describe('TC-KDL-01: kubectlDelete — pre-flight rejects bad inputs', () => {
  it('throws invalid-resource for shell injection in resource', () => {
    let err: KubectlDeleteError | undefined;
    try {
      kubectlDelete({ resource: 'pods; rm', name: 'foo' });
    } catch (e) {
      err = e as KubectlDeleteError;
    }
    expect(err!.code).toBe('invalid-resource');
  });

  it('throws invalid-name for shell injection in name', () => {
    let err: KubectlDeleteError | undefined;
    try {
      kubectlDelete({ resource: 'pods', name: 'foo; rm' });
    } catch (e) {
      err = e as KubectlDeleteError;
    }
    expect(err!.code).toBe('invalid-name');
  });

  it('throws invalid-name when name is omitted (required field)', () => {
    let err: KubectlDeleteError | undefined;
    try {
      kubectlDelete({ resource: 'pods' } as never);
    } catch (e) {
      err = e as KubectlDeleteError;
    }
    expect(err!.code).toBe('invalid-name');
  });

  it('throws invalid-namespace for malformed namespace', () => {
    let err: KubectlDeleteError | undefined;
    try {
      kubectlDelete({ resource: 'pods', name: 'foo', namespace: 'BAD NS' });
    } catch (e) {
      err = e as KubectlDeleteError;
    }
    expect(err!.code).toBe('invalid-namespace');
  });
});

// ─── TC-KDL-02: pre-flight rejects bad grace_period ──────────────────────────

describe('TC-KDL-02: kubectlDelete — pre-flight rejects bad grace_period', () => {
  it('throws invalid-grace-period for a fractional value', () => {
    let err: KubectlDeleteError | undefined;
    try {
      kubectlDelete({ resource: 'pods', name: 'foo', grace_period: 1.5 });
    } catch (e) {
      err = e as KubectlDeleteError;
    }
    expect(err!.code).toBe('invalid-grace-period');
  });

  it('throws invalid-grace-period for a negative value', () => {
    let err: KubectlDeleteError | undefined;
    try {
      kubectlDelete({ resource: 'pods', name: 'foo', grace_period: -1 });
    } catch (e) {
      err = e as KubectlDeleteError;
    }
    expect(err!.code).toBe('invalid-grace-period');
  });
});

// ─── TC-KDL-03: manifest sanity ──────────────────────────────────────────────

describe('TC-KDL-03: manifest is a well-formed F-05 manifest', () => {
  it('declares the cluster.write action class', () => {
    expect(kubectlDeleteManifest.action_class).toBe('cluster.write');
  });

  it('declares risk_tier high', () => {
    expect(kubectlDeleteManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(kubectlDeleteManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares name as the target_field', () => {
    expect(kubectlDeleteManifest.target_field).toBe('name');
  });

  it('marks resource and name as required (no bulk delete)', () => {
    expect(kubectlDeleteManifest.params['required']).toEqual([
      'resource',
      'name',
    ]);
  });

  it('forbids additional properties on the params schema', () => {
    expect(kubectlDeleteManifest.params['additionalProperties']).toBe(false);
  });
});

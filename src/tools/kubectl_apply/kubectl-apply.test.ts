/**
 * Unit tests for the kubectl_apply tool.
 *
 * Test IDs:
 *   TC-KAP-01: kubectlApply — pre-flight rejects bad manifest paths
 *   TC-KAP-02: kubectlApply — pre-flight rejects bad namespaces
 *   TC-KAP-03: manifest     — F-05 manifest is well-formed
 */

import { describe, it, expect } from 'vitest';
import { kubectlApply, KubectlApplyError } from './kubectl-apply.js';
import { kubectlApplyManifest } from './manifest.js';

// ─── TC-KAP-01: pre-flight rejects bad manifest paths ────────────────────────

describe('TC-KAP-01: kubectlApply — pre-flight rejects bad manifest paths', () => {
  it('throws invalid-manifest-path for empty path', () => {
    let err: KubectlApplyError | undefined;
    try {
      kubectlApply({ manifest_path: '' });
    } catch (e) {
      err = e as KubectlApplyError;
    }
    expect(err).toBeInstanceOf(KubectlApplyError);
    expect(err!.code).toBe('invalid-manifest-path');
  });

  it('throws invalid-manifest-path for shell injection', () => {
    let err: KubectlApplyError | undefined;
    try {
      kubectlApply({ manifest_path: '/tmp/x; rm -rf /' });
    } catch (e) {
      err = e as KubectlApplyError;
    }
    expect(err!.code).toBe('invalid-manifest-path');
  });
});

// ─── TC-KAP-02: pre-flight rejects bad namespaces ────────────────────────────

describe('TC-KAP-02: kubectlApply — pre-flight rejects bad namespaces', () => {
  it('throws invalid-namespace for shell injection', () => {
    let err: KubectlApplyError | undefined;
    try {
      kubectlApply({ manifest_path: '/tmp/x.yaml', namespace: 'foo; rm' });
    } catch (e) {
      err = e as KubectlApplyError;
    }
    expect(err).toBeInstanceOf(KubectlApplyError);
    expect(err!.code).toBe('invalid-namespace');
  });

  it('manifest path validation runs before namespace validation', () => {
    let err: KubectlApplyError | undefined;
    try {
      kubectlApply({ manifest_path: '`bad`', namespace: 'bad ns' });
    } catch (e) {
      err = e as KubectlApplyError;
    }
    expect(err!.code).toBe('invalid-manifest-path');
  });
});

// ─── TC-KAP-03: manifest sanity ──────────────────────────────────────────────

describe('TC-KAP-03: manifest is a well-formed F-05 manifest', () => {
  it('declares the cluster.write action class', () => {
    expect(kubectlApplyManifest.action_class).toBe('cluster.write');
  });

  it('declares risk_tier high', () => {
    expect(kubectlApplyManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(kubectlApplyManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares manifest_path as the target_field', () => {
    expect(kubectlApplyManifest.target_field).toBe('manifest_path');
  });

  it('marks manifest_path as required', () => {
    expect(kubectlApplyManifest.params['required']).toEqual(['manifest_path']);
  });

  it('forbids additional properties on the params schema', () => {
    expect(kubectlApplyManifest.params['additionalProperties']).toBe(false);
  });
});

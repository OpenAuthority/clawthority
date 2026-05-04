/**
 * Unit tests for the kubectl_get tool + the kubectl-shared validators.
 *
 * Test IDs:
 *   TC-KGT-01: validateResourceType  — resource-type validation
 *   TC-KGT-02: validateResourceName  — resource-name validation
 *   TC-KGT-03: validateNamespace     — namespace validation
 *   TC-KGT-04: kubectlGet            — pre-flight rejects bad inputs
 *   TC-KGT-05: manifest              — F-05 manifest is well-formed
 */

import { describe, it, expect } from 'vitest';
import {
  validateNamespace,
  validateResourceName,
  validateResourceType,
} from './kubectl-shared.js';
import { kubectlGet, KubectlGetError } from './kubectl-get.js';
import { kubectlGetManifest } from './manifest.js';

// ─── TC-KGT-01: validateResourceType ─────────────────────────────────────────

describe('TC-KGT-01: validateResourceType — resource-type validation', () => {
  it('accepts a bare type "pods"', () => {
    expect(validateResourceType('pods')).toBe(true);
  });

  it('accepts a grouped type "deployments.apps"', () => {
    expect(validateResourceType('deployments.apps')).toBe(true);
  });

  it('accepts a kind/name short form "pod/foo"', () => {
    expect(validateResourceType('pod/foo')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateResourceType('')).toBe(false);
  });

  it('rejects shell injection', () => {
    expect(validateResourceType('pods; rm -rf /')).toBe(false);
  });

  it('rejects uppercase (k8s type names are lowercase)', () => {
    expect(validateResourceType('Pods')).toBe(false);
  });
});

// ─── TC-KGT-02: validateResourceName ─────────────────────────────────────────

describe('TC-KGT-02: validateResourceName — resource-name validation', () => {
  it('accepts a simple name', () => {
    expect(validateResourceName('my-app')).toBe(true);
  });

  it('accepts a name with dots (DNS-1123 subdomain)', () => {
    expect(validateResourceName('my-app.namespace.svc')).toBe(true);
  });

  it('accepts a single character name', () => {
    expect(validateResourceName('a')).toBe(true);
  });

  it('rejects a name with uppercase', () => {
    expect(validateResourceName('MyApp')).toBe(false);
  });

  it('rejects a name starting with hyphen', () => {
    expect(validateResourceName('-foo')).toBe(false);
  });

  it('rejects a name ending with hyphen', () => {
    expect(validateResourceName('foo-')).toBe(false);
  });

  it('rejects shell injection', () => {
    expect(validateResourceName('foo; rm -rf /')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(validateResourceName('../etc/passwd')).toBe(false);
  });

  it('rejects a name longer than 253 chars', () => {
    expect(validateResourceName('a'.repeat(254))).toBe(false);
  });
});

// ─── TC-KGT-03: validateNamespace ────────────────────────────────────────────

describe('TC-KGT-03: validateNamespace — namespace validation', () => {
  it('accepts "default"', () => {
    expect(validateNamespace('default')).toBe(true);
  });

  it('accepts "kube-system"', () => {
    expect(validateNamespace('kube-system')).toBe(true);
  });

  it('rejects a namespace with dots (must be a label, not subdomain)', () => {
    expect(validateNamespace('foo.bar')).toBe(false);
  });

  it('rejects a namespace longer than 63 chars', () => {
    expect(validateNamespace('a'.repeat(64))).toBe(false);
  });

  it('rejects shell injection', () => {
    expect(validateNamespace('default; rm -rf /')).toBe(false);
  });
});

// ─── TC-KGT-04: pre-flight rejects bad inputs ────────────────────────────────

describe('TC-KGT-04: kubectlGet — pre-flight rejects bad inputs', () => {
  it('throws invalid-resource for a malformed resource', () => {
    let err: KubectlGetError | undefined;
    try {
      kubectlGet({ resource: 'pods; rm -rf /' });
    } catch (e) {
      err = e as KubectlGetError;
    }
    expect(err).toBeInstanceOf(KubectlGetError);
    expect(err!.code).toBe('invalid-resource');
  });

  it('throws invalid-name for a malformed name', () => {
    let err: KubectlGetError | undefined;
    try {
      kubectlGet({ resource: 'pods', name: '../etc/passwd' });
    } catch (e) {
      err = e as KubectlGetError;
    }
    expect(err!.code).toBe('invalid-name');
  });

  it('throws invalid-namespace for a malformed namespace', () => {
    let err: KubectlGetError | undefined;
    try {
      kubectlGet({ resource: 'pods', namespace: 'kube; rm' });
    } catch (e) {
      err = e as KubectlGetError;
    }
    expect(err!.code).toBe('invalid-namespace');
  });

  it('throws invalid-output for an unknown format', () => {
    let err: KubectlGetError | undefined;
    try {
      kubectlGet({ resource: 'pods', output: 'protobuf' as never });
    } catch (e) {
      err = e as KubectlGetError;
    }
    expect(err!.code).toBe('invalid-output');
  });
});

// ─── TC-KGT-05: manifest sanity ──────────────────────────────────────────────

describe('TC-KGT-05: manifest is a well-formed F-05 manifest', () => {
  it('declares the cluster.read action class', () => {
    expect(kubectlGetManifest.action_class).toBe('cluster.read');
  });

  it('declares risk_tier low (cluster.read default)', () => {
    expect(kubectlGetManifest.risk_tier).toBe('low');
  });

  it('declares per_request HITL', () => {
    expect(kubectlGetManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares resource as the target_field', () => {
    expect(kubectlGetManifest.target_field).toBe('resource');
  });

  it('marks resource as required (everything else optional)', () => {
    expect(kubectlGetManifest.params['required']).toEqual(['resource']);
  });

  it('forbids additional properties on the params schema', () => {
    expect(kubectlGetManifest.params['additionalProperties']).toBe(false);
  });
});

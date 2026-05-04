/**
 * Unit tests for the kubectl_rollout tool.
 *
 * Test IDs:
 *   TC-KRO-01: kubectlRollout — pre-flight rejects bad action
 *   TC-KRO-02: kubectlRollout — pre-flight rejects bad resource/name
 *   TC-KRO-03: manifest       — F-05 manifest is well-formed
 */

import { describe, it, expect } from 'vitest';
import {
  kubectlRollout,
  KubectlRolloutError,
  ROLLOUT_ACTIONS,
} from './kubectl-rollout.js';
import { kubectlRolloutManifest } from './manifest.js';

// ─── TC-KRO-01: rejects bad action ───────────────────────────────────────────

describe('TC-KRO-01: kubectlRollout — pre-flight rejects bad action', () => {
  it('throws invalid-action for unknown action', () => {
    let err: KubectlRolloutError | undefined;
    try {
      kubectlRollout({
        action: 'pause' as never,
        resource: 'deployment',
        name: 'web',
      });
    } catch (e) {
      err = e as KubectlRolloutError;
    }
    expect(err).toBeInstanceOf(KubectlRolloutError);
    expect(err!.code).toBe('invalid-action');
  });

  it.each(ROLLOUT_ACTIONS)(
    'accepts the rollout action "%s" through validation',
    (action) => {
      // Validation passes — kubectl invocation may succeed or fail depending
      // on environment, but the typed-tool's pre-flight should not throw.
      let validationError: KubectlRolloutError | undefined;
      try {
        kubectlRollout({ action, resource: 'deployment', name: 'web' });
      } catch (e) {
        if (e instanceof KubectlRolloutError) validationError = e;
      }
      expect(validationError).toBeUndefined();
    },
  );
});

// ─── TC-KRO-02: rejects bad resource/name ────────────────────────────────────

describe('TC-KRO-02: kubectlRollout — pre-flight rejects bad resource/name', () => {
  it('throws invalid-resource for shell injection in resource', () => {
    let err: KubectlRolloutError | undefined;
    try {
      kubectlRollout({
        action: 'status',
        resource: 'deploy; rm -rf /',
        name: 'web',
      });
    } catch (e) {
      err = e as KubectlRolloutError;
    }
    expect(err!.code).toBe('invalid-resource');
  });

  it('throws invalid-name for shell injection in name', () => {
    let err: KubectlRolloutError | undefined;
    try {
      kubectlRollout({
        action: 'restart',
        resource: 'deployment',
        name: 'web; rm',
      });
    } catch (e) {
      err = e as KubectlRolloutError;
    }
    expect(err!.code).toBe('invalid-name');
  });

  it('action validation runs before resource/name validation', () => {
    let err: KubectlRolloutError | undefined;
    try {
      kubectlRollout({
        action: 'BOGUS' as never,
        resource: 'bad; res',
        name: 'bad; name',
      });
    } catch (e) {
      err = e as KubectlRolloutError;
    }
    expect(err!.code).toBe('invalid-action');
  });
});

// ─── TC-KRO-03: manifest sanity ──────────────────────────────────────────────

describe('TC-KRO-03: manifest is a well-formed F-05 manifest', () => {
  it('declares the cluster.write action class', () => {
    expect(kubectlRolloutManifest.action_class).toBe('cluster.write');
  });

  it('declares risk_tier high', () => {
    expect(kubectlRolloutManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(kubectlRolloutManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares name as the target_field', () => {
    expect(kubectlRolloutManifest.target_field).toBe('name');
  });

  it('marks action, resource, name as required', () => {
    expect(kubectlRolloutManifest.params['required']).toEqual([
      'action',
      'resource',
      'name',
    ]);
  });

  it('forbids additional properties on the params schema', () => {
    expect(kubectlRolloutManifest.params['additionalProperties']).toBe(false);
  });
});

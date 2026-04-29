/**
 * Unit tests for the docker_push tool.
 *
 * Test IDs:
 *   TC-DPS-01: validateImageRef — image-ref validation
 *   TC-DPS-02: validateRegistry — registry-hostname validation
 *   TC-DPS-03: dockerPush       — pre-flight rejects bad inputs
 *   TC-DPS-04: dockerPush       — --all-tags with a tagged ref is rejected
 *   TC-DPS-05: manifest         — F-05 manifest is well-formed
 */

import { describe, it, expect } from 'vitest';
import {
  validateImageRef,
  validateRegistry,
  dockerPush,
  DockerPushError,
} from './docker-push.js';
import { dockerPushManifest } from './manifest.js';

// ─── TC-DPS-01: validateImageRef ─────────────────────────────────────────────

describe('TC-DPS-01: validateImageRef — image-ref validation', () => {
  it('accepts a bare image name', () => {
    expect(validateImageRef('myapp')).toBe(true);
  });

  it('accepts an image with a tag', () => {
    expect(validateImageRef('myapp:1.0')).toBe(true);
  });

  it('accepts a registry-prefixed image', () => {
    expect(validateImageRef('ghcr.io/team/app:tag')).toBe(true);
  });

  it('accepts an image with sha256 digest', () => {
    expect(
      validateImageRef(
        'myapp@sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      ),
    ).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateImageRef('')).toBe(false);
  });

  it('rejects shell injection', () => {
    expect(validateImageRef('myapp; rm -rf /')).toBe(false);
  });
});

// ─── TC-DPS-02: validateRegistry ─────────────────────────────────────────────

describe('TC-DPS-02: validateRegistry — registry-hostname validation', () => {
  it('accepts a simple registry hostname', () => {
    expect(validateRegistry('ghcr.io')).toBe(true);
  });

  it('accepts a registry with port', () => {
    expect(validateRegistry('registry.example.com:5000')).toBe(true);
  });

  it('accepts a registry with namespace', () => {
    expect(validateRegistry('ghcr.io/team')).toBe(true);
  });

  it('rejects shell injection', () => {
    expect(validateRegistry('ghcr.io; rm')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validateRegistry('')).toBe(false);
  });
});

// ─── TC-DPS-03: pre-flight rejects bad inputs ────────────────────────────────

describe('TC-DPS-03: dockerPush — pre-flight rejects bad inputs', () => {
  it('throws invalid-image-ref for empty image', () => {
    let err: DockerPushError | undefined;
    try {
      dockerPush({ image: '' });
    } catch (e) {
      err = e as DockerPushError;
    }
    expect(err!.code).toBe('invalid-image-ref');
  });

  it('throws invalid-image-ref for shell injection in image', () => {
    let err: DockerPushError | undefined;
    try {
      dockerPush({ image: 'myapp; rm -rf /' });
    } catch (e) {
      err = e as DockerPushError;
    }
    expect(err!.code).toBe('invalid-image-ref');
  });

  it('throws invalid-registry for shell injection in registry', () => {
    let err: DockerPushError | undefined;
    try {
      dockerPush({ image: 'myapp', registry: 'ghcr.io; rm' });
    } catch (e) {
      err = e as DockerPushError;
    }
    expect(err!.code).toBe('invalid-registry');
  });
});

// ─── TC-DPS-04: --all-tags with tagged ref is rejected ───────────────────────

describe('TC-DPS-04: dockerPush — --all-tags with a tagged ref is rejected', () => {
  it('throws all-tags-with-tag when image has an explicit tag and all_tags=true', () => {
    let err: DockerPushError | undefined;
    try {
      dockerPush({ image: 'myapp:1.0', all_tags: true });
    } catch (e) {
      err = e as DockerPushError;
    }
    expect(err).toBeInstanceOf(DockerPushError);
    expect(err!.code).toBe('all-tags-with-tag');
  });

  it('does not throw all-tags-with-tag when image is untagged and all_tags=true', () => {
    // Validation passes; the actual push may fail (no docker / no registry),
    // but the typed-tool's pre-flight should not throw.
    let validationError: DockerPushError | undefined;
    try {
      dockerPush({ image: 'myapp', all_tags: true });
    } catch (e) {
      if (e instanceof DockerPushError) validationError = e;
    }
    expect(validationError).toBeUndefined();
  });
});

// ─── TC-DPS-05: manifest sanity ──────────────────────────────────────────────

describe('TC-DPS-05: manifest is a well-formed F-05 manifest', () => {
  it('declares the cluster.write action class', () => {
    expect(dockerPushManifest.action_class).toBe('cluster.write');
  });

  it('declares risk_tier high', () => {
    expect(dockerPushManifest.risk_tier).toBe('high');
  });

  it('declares per_request HITL', () => {
    expect(dockerPushManifest.default_hitl_mode).toBe('per_request');
  });

  it('declares image as the target_field', () => {
    expect(dockerPushManifest.target_field).toBe('image');
  });

  it('marks image as required', () => {
    expect(dockerPushManifest.params['required']).toEqual(['image']);
  });

  it('forbids additional properties on the params schema', () => {
    expect(dockerPushManifest.params['additionalProperties']).toBe(false);
  });
});

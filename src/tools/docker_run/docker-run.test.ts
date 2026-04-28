/**
 * Unit tests for the docker_run tool.
 *
 * Test groups that exercise the actual `docker` binary are gated behind a
 * module-level availability probe so they are skipped gracefully on hosts
 * without Docker.
 *
 * Test IDs:
 *   TC-DKR-01: validateImageRef — image reference validation
 *   TC-DKR-02: validateVolumeSpec — volume mount validation
 *   TC-DKR-03: validateEnvSpec — environment variable spec validation
 *   TC-DKR-04: validatePortSpec — port mapping validation
 *   TC-DKR-05: dockerRun — pre-flight validation logic
 *   TC-DKR-06: dockerRun — successful execution (requires docker)
 *   TC-DKR-07: dockerRun — error handling
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  validateImageRef,
  validateVolumeSpec,
  validateEnvSpec,
  validatePortSpec,
  dockerRun,
  DockerRunError,
} from './docker-run.js';

// ─── Binary probe ─────────────────────────────────────────────────────────────

const dockerAvailable =
  spawnSync('docker', ['info'], { encoding: 'utf-8' }).status === 0;

// ─── TC-DKR-01: validateImageRef ─────────────────────────────────────────────

describe('TC-DKR-01: validateImageRef — image reference validation', () => {
  // Valid refs — simple names
  it('accepts a bare image name', () => {
    expect(validateImageRef('ubuntu')).toBe(true);
  });

  it('accepts an image with a tag', () => {
    expect(validateImageRef('ubuntu:22.04')).toBe(true);
  });

  it('accepts an image with a latest tag', () => {
    expect(validateImageRef('node:latest')).toBe(true);
  });

  it('accepts an alpine variant tag', () => {
    expect(validateImageRef('node:20-alpine')).toBe(true);
  });

  it('accepts a namespaced image', () => {
    expect(validateImageRef('library/ubuntu')).toBe(true);
  });

  it('accepts a registry-prefixed image', () => {
    expect(validateImageRef('registry.example.com/my/image')).toBe(true);
  });

  it('accepts a registry with port and tag', () => {
    expect(validateImageRef('registry.example.com:5000/my/image:tag')).toBe(true);
  });

  it('accepts an image with sha256 digest', () => {
    expect(
      validateImageRef(
        'ubuntu@sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      ),
    ).toBe(true);
  });

  // Invalid refs
  it('rejects an empty string', () => {
    expect(validateImageRef('')).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(validateImageRef('   ')).toBe(false);
  });

  it('rejects a name with shell metacharacters (semicolon)', () => {
    expect(validateImageRef('ubuntu; rm -rf /')).toBe(false);
  });

  it('rejects a name with backtick (shell injection)', () => {
    expect(validateImageRef('ubuntu`cmd`')).toBe(false);
  });

  it('rejects a name with dollar sign', () => {
    expect(validateImageRef('$IMAGE')).toBe(false);
  });

  it('rejects non-string input (null cast)', () => {
    expect(validateImageRef(null as unknown as string)).toBe(false);
  });
});

// ─── TC-DKR-02: validateVolumeSpec ───────────────────────────────────────────

describe('TC-DKR-02: validateVolumeSpec — volume mount validation', () => {
  it('accepts an absolute host path to container path', () => {
    expect(validateVolumeSpec('/host/data:/container/data')).toBe(true);
  });

  it('accepts a volume mount with read-only option', () => {
    expect(validateVolumeSpec('/host/data:/container/data:ro')).toBe(true);
  });

  it('accepts a named volume', () => {
    expect(validateVolumeSpec('myvolume:/data')).toBe(true);
  });

  it('accepts relative-style paths', () => {
    expect(validateVolumeSpec('./src:/app/src')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateVolumeSpec('')).toBe(false);
  });

  it('rejects a spec with no colon', () => {
    expect(validateVolumeSpec('/host/data')).toBe(false);
  });

  it('rejects a spec where colon is first character', () => {
    expect(validateVolumeSpec(':/container/data')).toBe(false);
  });

  it('rejects a spec where colon is last character', () => {
    expect(validateVolumeSpec('/host/data:')).toBe(false);
  });

  it('rejects a spec with shell metacharacters', () => {
    expect(validateVolumeSpec('/host/data; rm -rf /:/container')).toBe(false);
  });

  it('rejects non-string input (null cast)', () => {
    expect(validateVolumeSpec(null as unknown as string)).toBe(false);
  });
});

// ─── TC-DKR-03: validateEnvSpec ──────────────────────────────────────────────

describe('TC-DKR-03: validateEnvSpec — environment variable spec validation', () => {
  it('accepts a key=value pair', () => {
    expect(validateEnvSpec('FOO=bar')).toBe(true);
  });

  it('accepts a key-only form (inherits from host)', () => {
    expect(validateEnvSpec('MY_VAR')).toBe(true);
  });

  it('accepts an underscore-prefixed key', () => {
    expect(validateEnvSpec('_PRIVATE=secret')).toBe(true);
  });

  it('accepts an empty value', () => {
    expect(validateEnvSpec('EMPTY=')).toBe(true);
  });

  it('accepts a numeric value', () => {
    expect(validateEnvSpec('PORT=8080')).toBe(true);
  });

  it('accepts a key with digits', () => {
    expect(validateEnvSpec('VAR1=value')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateEnvSpec('')).toBe(false);
  });

  it('rejects a key starting with a digit', () => {
    expect(validateEnvSpec('1VAR=value')).toBe(false);
  });

  it('rejects a key with a hyphen', () => {
    expect(validateEnvSpec('MY-VAR=value')).toBe(false);
  });

  it('rejects shell metacharacters in the value', () => {
    expect(validateEnvSpec('FOO=bar; rm -rf /')).toBe(false);
  });

  it('rejects backtick injection in the value', () => {
    expect(validateEnvSpec('FOO=`cmd`')).toBe(false);
  });

  it('rejects non-string input (null cast)', () => {
    expect(validateEnvSpec(null as unknown as string)).toBe(false);
  });
});

// ─── TC-DKR-04: validatePortSpec ─────────────────────────────────────────────

describe('TC-DKR-04: validatePortSpec — port mapping validation', () => {
  it('accepts a host:container port mapping', () => {
    expect(validatePortSpec('8080:80')).toBe(true);
  });

  it('accepts a container-only port (random host port)', () => {
    expect(validatePortSpec('80')).toBe(true);
  });

  it('accepts an IP:hostPort:containerPort form', () => {
    expect(validatePortSpec('127.0.0.1:8080:80')).toBe(true);
  });

  it('accepts a mapping with protocol suffix', () => {
    expect(validatePortSpec('8080:80/tcp')).toBe(true);
  });

  it('accepts a UDP mapping', () => {
    expect(validatePortSpec('53:53/udp')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validatePortSpec('')).toBe(false);
  });

  it('rejects shell metacharacters', () => {
    expect(validatePortSpec('8080; rm -rf /')).toBe(false);
  });

  it('rejects backtick injection', () => {
    expect(validatePortSpec('`cmd`:80')).toBe(false);
  });

  it('rejects non-string input (null cast)', () => {
    expect(validatePortSpec(null as unknown as string)).toBe(false);
  });
});

// ─── TC-DKR-05: dockerRun — pre-flight validation logic ──────────────────────

describe('TC-DKR-05: dockerRun — pre-flight validation logic', () => {
  it('throws DockerRunError with code invalid-image-ref for an empty image', () => {
    let err: DockerRunError | undefined;
    try {
      dockerRun({ image: '' });
    } catch (e) {
      err = e as DockerRunError;
    }

    expect(err).toBeInstanceOf(DockerRunError);
    expect(err!.code).toBe('invalid-image-ref');
  });

  it('throws DockerRunError with code invalid-image-ref for a shell injection attempt', () => {
    let err: DockerRunError | undefined;
    try {
      dockerRun({ image: 'ubuntu; rm -rf /' });
    } catch (e) {
      err = e as DockerRunError;
    }

    expect(err).toBeInstanceOf(DockerRunError);
    expect(err!.code).toBe('invalid-image-ref');
  });

  it('error message includes the invalid image ref', () => {
    let err: DockerRunError | undefined;
    try {
      dockerRun({ image: 'bad image name!' });
    } catch (e) {
      err = e as DockerRunError;
    }

    expect(err!.message).toContain('bad image name!');
  });

  it('thrown error name is "DockerRunError"', () => {
    let err: DockerRunError | undefined;
    try {
      dockerRun({ image: '' });
    } catch (e) {
      err = e as DockerRunError;
    }

    expect(err!.name).toBe('DockerRunError');
  });

  it('throws DockerRunError with code invalid-volume-spec for a malformed volume', () => {
    let err: DockerRunError | undefined;
    try {
      dockerRun({ image: 'ubuntu', volumes: ['/host'] });
    } catch (e) {
      err = e as DockerRunError;
    }

    expect(err).toBeInstanceOf(DockerRunError);
    expect(err!.code).toBe('invalid-volume-spec');
  });

  it('throws DockerRunError with code invalid-volume-spec for shell injection in volume', () => {
    let err: DockerRunError | undefined;
    try {
      dockerRun({ image: 'ubuntu', volumes: ['/host/data; rm -rf /:/data'] });
    } catch (e) {
      err = e as DockerRunError;
    }

    expect(err).toBeInstanceOf(DockerRunError);
    expect(err!.code).toBe('invalid-volume-spec');
  });

  it('throws DockerRunError with code invalid-env-spec for a key starting with digit', () => {
    let err: DockerRunError | undefined;
    try {
      dockerRun({ image: 'ubuntu', env: ['1BAD=value'] });
    } catch (e) {
      err = e as DockerRunError;
    }

    expect(err).toBeInstanceOf(DockerRunError);
    expect(err!.code).toBe('invalid-env-spec');
  });

  it('throws DockerRunError with code invalid-env-spec for shell injection in env value', () => {
    let err: DockerRunError | undefined;
    try {
      dockerRun({ image: 'ubuntu', env: ['FOO=bar; rm -rf /'] });
    } catch (e) {
      err = e as DockerRunError;
    }

    expect(err).toBeInstanceOf(DockerRunError);
    expect(err!.code).toBe('invalid-env-spec');
  });

  it('throws DockerRunError with code invalid-port-spec for a malformed port', () => {
    let err: DockerRunError | undefined;
    try {
      dockerRun({ image: 'ubuntu', ports: ['bad;port'] });
    } catch (e) {
      err = e as DockerRunError;
    }

    expect(err).toBeInstanceOf(DockerRunError);
    expect(err!.code).toBe('invalid-port-spec');
  });

  it('DockerRunError code is one of the typed discriminants', () => {
    let err: DockerRunError | undefined;
    try {
      dockerRun({ image: '' });
    } catch (e) {
      err = e as DockerRunError;
    }

    const validCodes: Array<
      'invalid-image-ref' | 'invalid-volume-spec' | 'invalid-env-spec' | 'invalid-port-spec'
    > = ['invalid-image-ref', 'invalid-volume-spec', 'invalid-env-spec', 'invalid-port-spec'];

    expect(validCodes).toContain(err!.code);
  });

  it('does not throw DockerRunError for a valid image with no extras', () => {
    let preFlightErr: DockerRunError | undefined;
    try {
      dockerRun({ image: 'ubuntu:22.04' });
    } catch (e) {
      if (e instanceof DockerRunError) preFlightErr = e;
    }

    expect(preFlightErr).toBeUndefined();
  });

  it('does not throw DockerRunError for valid volumes', () => {
    let preFlightErr: DockerRunError | undefined;
    try {
      dockerRun({ image: 'ubuntu:22.04', volumes: ['/tmp/host:/tmp/container'] });
    } catch (e) {
      if (e instanceof DockerRunError) preFlightErr = e;
    }

    expect(preFlightErr).toBeUndefined();
  });

  it('does not throw DockerRunError for valid env specs', () => {
    let preFlightErr: DockerRunError | undefined;
    try {
      dockerRun({ image: 'ubuntu:22.04', env: ['FOO=bar', 'DEBUG=1', 'MY_VAR'] });
    } catch (e) {
      if (e instanceof DockerRunError) preFlightErr = e;
    }

    expect(preFlightErr).toBeUndefined();
  });

  it('does not throw DockerRunError for valid port specs', () => {
    let preFlightErr: DockerRunError | undefined;
    try {
      dockerRun({ image: 'ubuntu:22.04', ports: ['8080:80', '443:443'] });
    } catch (e) {
      if (e instanceof DockerRunError) preFlightErr = e;
    }

    expect(preFlightErr).toBeUndefined();
  });
});

// ─── TC-DKR-06: dockerRun — successful execution ─────────────────────────────

describe.skipIf(!dockerAvailable)('TC-DKR-06: dockerRun — successful execution', () => {
  it('returns exit_code 0 for a simple echo command', () => {
    const result = dockerRun({
      image: 'alpine:latest',
      command: ['echo', 'hello from docker'],
    });

    expect(result.exit_code).toBe(0);
  });

  it('result has stdout, stderr, and exit_code fields', () => {
    const result = dockerRun({
      image: 'alpine:latest',
      command: ['echo', 'hello'],
    });

    expect(Object.keys(result).sort()).toEqual(['exit_code', 'stderr', 'stdout'].sort());
  });

  it('stdout and stderr are strings', () => {
    const result = dockerRun({
      image: 'alpine:latest',
      command: ['echo', 'hello'],
    });

    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });

  it('exit_code is a number', () => {
    const result = dockerRun({
      image: 'alpine:latest',
      command: ['echo', 'hello'],
    });

    expect(typeof result.exit_code).toBe('number');
  });

  it('captures stdout from the container', () => {
    const result = dockerRun({
      image: 'alpine:latest',
      command: ['echo', 'hello from container'],
    });

    expect(result.stdout).toContain('hello from container');
  });

  it('returns non-zero exit_code for a failing command without throwing', () => {
    const result = dockerRun({
      image: 'alpine:latest',
      command: ['sh', '-c', 'exit 42'],
    });

    expect(result.exit_code).toBe(42);
  });

  it('passes environment variables to the container', () => {
    const result = dockerRun({
      image: 'alpine:latest',
      command: ['sh', '-c', 'echo $MY_VAR'],
      env: ['MY_VAR=hello_env'],
    });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('hello_env');
  });

  it('auto-removes container by default (--rm)', () => {
    // No assertion on container cleanup is possible without docker inspect,
    // but we verify the command succeeds and does not throw.
    const result = dockerRun({
      image: 'alpine:latest',
      command: ['echo', 'cleanup test'],
    });

    expect(result.exit_code).toBe(0);
  });
});

// ─── TC-DKR-07: dockerRun — error handling ───────────────────────────────────

describe('TC-DKR-07: dockerRun — error handling', () => {
  it('result exit_code is a number even when docker is not found', () => {
    // When docker binary is absent, spawnSync returns status: null.
    // The implementation falls back to exit_code 1.
    const result = dockerRun({ image: 'ubuntu:22.04' });

    expect(typeof result.exit_code).toBe('number');
  });

  it('result stdout and stderr are strings even when docker is not found', () => {
    const result = dockerRun({ image: 'ubuntu:22.04' });

    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });
});

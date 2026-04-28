/**
 * F-05 manifest for the docker_run tool.
 *
 * Action class: code.execute
 * Runs a Docker container from a specified image. High risk because containers
 * can execute arbitrary code with access to host resources including volumes,
 * network, and environment variables.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const dockerRunManifest: ToolManifest = {
  name: 'docker_run',
  version: '1.0.0',
  action_class: 'code.execute',
  risk_tier: 'high',
  default_hitl_mode: 'per_request',
  target_field: 'image',
  params: {
    type: 'object',
    properties: {
      image: {
        type: 'string',
        description:
          'Docker image reference to run (e.g. "ubuntu:22.04", "node:20-alpine", ' +
          '"registry.example.com/my/image:tag"). Must be a valid image reference.',
      },
      command: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Command to run inside the container. When omitted, the image default ' +
          'entrypoint/command is used.',
      },
      working_dir: {
        type: 'string',
        description: 'Host working directory for the docker command. Defaults to the current directory.',
      },
      volumes: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Volume mount specifications (e.g. ["/host/path:/container/path", "/data:/data:ro"]). ' +
          'Each entry is passed as -v to docker run.',
      },
      env: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Environment variable assignments (e.g. ["FOO=bar", "DEBUG=1"]). ' +
          'Each entry is passed as -e to docker run.',
      },
      ports: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Port mapping specifications (e.g. ["8080:80", "443:443"]). ' +
          'Each entry is passed as -p to docker run.',
      },
      network: {
        type: 'string',
        description:
          'Network mode for the container (e.g. "bridge", "host", "none", "container:<name>"). ' +
          'Passed as --network to docker run.',
      },
      rm: {
        type: 'boolean',
        description:
          'When true (default), pass --rm to automatically remove the container after it exits.',
      },
      user: {
        type: 'string',
        description:
          'Username or UID (optionally with group: "user:group") to run as inside the container. ' +
          'Passed as --user to docker run.',
      },
      entrypoint: {
        type: 'string',
        description:
          'Override the image default entrypoint. Passed as --entrypoint to docker run.',
      },
      platform: {
        type: 'string',
        description:
          'Target platform for the container (e.g. "linux/amd64", "linux/arm64"). ' +
          'Passed as --platform to docker run.',
      },
    },
    required: ['image'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      stdout: {
        type: 'string',
        description: 'Standard output captured from the container.',
      },
      stderr: {
        type: 'string',
        description: 'Standard error captured from the container.',
      },
      exit_code: {
        type: 'number',
        description: 'Container exit code. Non-zero indicates the container exited with an error.',
      },
    },
  },
};

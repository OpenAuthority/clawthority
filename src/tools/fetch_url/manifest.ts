/**
 * F-05 manifest for the fetch_url tool.
 *
 * Action class: web.fetch
 * Fetches a URL and returns the raw response body along with metadata
 * such as HTTP status code, final URL (after redirects), and Content-Type.
 * An optional allowed_domains list enables Cedar-style domain allowlist
 * validation at the tool level.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const fetchUrlManifest: ToolManifest = {
  name: 'fetch_url',
  version: '1.0.0',
  action_class: 'web.fetch',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'url',
  params: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch (http or https).',
      },
      headers: {
        type: 'object',
        description: 'Optional HTTP request headers.',
        additionalProperties: { type: 'string' },
      },
      allowed_domains: {
        type: 'array',
        description:
          'Optional domain allowlist. When provided, the request hostname must match one of the listed domains exactly or as a subdomain.',
        items: { type: 'string' },
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      status_code: {
        type: 'number',
        description: 'HTTP response status code.',
      },
      body: {
        type: 'string',
        description: 'Raw response body text.',
      },
      content_type: {
        type: 'string',
        description: 'Value of the Content-Type response header, if present.',
      },
      final_url: {
        type: 'string',
        description: 'Final URL after redirects.',
      },
      content_length: {
        type: 'number',
        description: 'Content-Length in bytes, if the header was present.',
      },
    },
  },
};

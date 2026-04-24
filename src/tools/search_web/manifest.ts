/**
 * F-05 manifest for the search_web tool.
 *
 * Action class: web.search
 * Performs a web search via a configured provider (Google or Bing) and returns
 * ranked results with titles, URLs, and snippets.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const searchWebManifest: ToolManifest = {
  name: 'search_web',
  version: '1.0.0',
  action_class: 'web.search',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'query',
  params: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query string to submit to the search provider.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return. Defaults to 10.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  result: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        description: 'Ranked list of search results.',
        items: {
          type: 'object',
          properties: {
            rank: { type: 'number', description: '1-based rank position.' },
            title: { type: 'string', description: 'Page title.' },
            url: { type: 'string', description: 'URL of the result.' },
            snippet: { type: 'string', description: 'Short text excerpt from the page.' },
          },
        },
      },
      query: {
        type: 'string',
        description: 'The search query that was submitted.',
      },
      provider: {
        type: 'string',
        description: 'Search provider used (google or bing).',
      },
    },
  },
};

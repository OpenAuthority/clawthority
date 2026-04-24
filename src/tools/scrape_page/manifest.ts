/**
 * F-05 manifest for the scrape_page tool.
 *
 * Action class: browser.scrape
 * Fetches a URL and extracts structured data from the HTML response using
 * static cheerio parsing (no JavaScript execution). Returns the page title,
 * body text, and optionally elements matched by CSS selectors.
 * An optional allowed_domains list enables Cedar-style domain allowlist
 * validation at the tool level.
 */

import type { ToolManifest } from '../../validation/skill-manifest-validator.js';

export const scrapePageManifest: ToolManifest = {
  name: 'scrape_page',
  version: '1.0.0',
  action_class: 'browser.scrape',
  risk_tier: 'medium',
  default_hitl_mode: 'per_request',
  target_field: 'url',
  params: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to scrape (http or https).',
      },
      selectors: {
        type: 'array',
        description:
          'Optional CSS selectors to extract content from the page. Each selector returns the count and text of matched elements.',
        items: { type: 'string' },
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
      url: {
        type: 'string',
        description: 'Final URL after redirects.',
      },
      title: {
        type: 'string',
        description: 'Page title from the <title> tag, or an empty string if not found.',
      },
      text: {
        type: 'string',
        description: 'Trimmed plain text of the entire page body.',
      },
      elements: {
        type: 'array',
        description: 'Selector results, one entry per requested CSS selector.',
        items: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector that was evaluated.' },
            count: { type: 'number', description: 'Number of elements matched.' },
            texts: {
              type: 'array',
              description: 'Trimmed text content of each matched element.',
              items: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

import { describe, it, expect } from 'vitest';
import {
  normalize_action,
  getRegistryEntry,
  normalizeActionClass,
  sortedJsonStringify,
} from './normalize.js';
import type { ActionRegistryEntry, NormalizedAction, RiskLevel, HitlModeNorm } from './normalize.js';

// ---------------------------------------------------------------------------
// getRegistryEntry
// ---------------------------------------------------------------------------

describe('getRegistryEntry', () => {
  it('returns the correct entry for a known tool name', () => {
    const entry = getRegistryEntry('read_file');
    expect(entry.action_class).toBe('filesystem.read');
    expect(entry.default_risk).toBe('low');
    expect(entry.default_hitl_mode).toBe('none');
  });

  it('matches aliases case-insensitively (READ_FILE → filesystem.read)', () => {
    expect(getRegistryEntry('READ_FILE').action_class).toBe('filesystem.read');
    expect(getRegistryEntry('Write_File').action_class).toBe('filesystem.write');
    expect(getRegistryEntry('BASH').action_class).toBe('shell.exec');
  });

  it('returns unknown_sensitive_action entry for an unrecognised tool', () => {
    const entry = getRegistryEntry('totally_unknown_tool_xyz');
    expect(entry.action_class).toBe('unknown_sensitive_action');
    expect(entry.default_risk).toBe('critical');
    expect(entry.default_hitl_mode).toBe('per_request');
  });

  it('returns unknown_sensitive_action entry for an empty string', () => {
    const entry = getRegistryEntry('');
    expect(entry.action_class).toBe('unknown_sensitive_action');
  });
});

// ---------------------------------------------------------------------------
// normalizeActionClass
// ---------------------------------------------------------------------------

describe('normalizeActionClass', () => {
  it('returns canonical action class string for a known tool', () => {
    expect(normalizeActionClass('write_file')).toBe('filesystem.write');
    expect(normalizeActionClass('bash')).toBe('shell.exec');
    expect(normalizeActionClass('pay')).toBe('payment.initiate');
  });

  it('returns unknown_sensitive_action for an unrecognised tool', () => {
    expect(normalizeActionClass('no_such_tool')).toBe('unknown_sensitive_action');
  });
});

// ---------------------------------------------------------------------------
// All 17 action classes resolve from at least one alias
// ---------------------------------------------------------------------------

describe('registry coverage — each action class resolves from at least one alias', () => {
  const cases: Array<[string, string]> = [
    ['read_file',        'filesystem.read'],
    ['write_file',       'filesystem.write'],
    ['delete_file',      'filesystem.delete'],
    ['list_files',       'filesystem.list'],
    ['fetch',            'web.fetch'],
    ['http_post',        'web.post'],
    ['bash',             'shell.exec'],
    ['send_email',       'communication.email'],
    ['send_slack',       'communication.slack'],
    ['call_webhook',     'communication.webhook'],
    ['memory_get',       'memory.read'],
    ['memory_set',       'memory.write'],
    ['read_secret',      'credential.read'],
    ['write_secret',     'credential.write'],
    ['run_code',         'code.execute'],
    ['pay',              'payment.initiate'],
  ];

  for (const [alias, expectedClass] of cases) {
    it(`"${alias}" → ${expectedClass}`, () => {
      expect(normalizeActionClass(alias)).toBe(expectedClass);
    });
  }

  it('unknown tool resolves to unknown_sensitive_action', () => {
    expect(normalizeActionClass('__not_a_real_tool__')).toBe('unknown_sensitive_action');
  });
});

// ---------------------------------------------------------------------------
// normalize_action — target extraction
// ---------------------------------------------------------------------------

describe('normalize_action — target extraction', () => {
  it('extracts target from path param', () => {
    const result = normalize_action('read_file', { path: '/home/user/file.txt' });
    expect(result.target).toBe('/home/user/file.txt');
  });

  it('extracts target from file param when path is absent', () => {
    const result = normalize_action('read_file', { file: '/etc/hosts' });
    expect(result.target).toBe('/etc/hosts');
  });

  it('prefers path over file when both are present', () => {
    const result = normalize_action('read_file', { path: '/preferred', file: '/fallback' });
    expect(result.target).toBe('/preferred');
  });

  it('extracts target from url param', () => {
    const result = normalize_action('fetch', { url: 'https://example.com' });
    expect(result.target).toBe('https://example.com');
  });

  it('extracts target from destination param', () => {
    const result = normalize_action('write_file', { destination: '/output/data.json' });
    expect(result.target).toBe('/output/data.json');
  });

  it('extracts target from to param', () => {
    const result = normalize_action('send_email', { to: 'alice@example.com' });
    expect(result.target).toBe('alice@example.com');
  });

  it('extracts target from recipient param', () => {
    const result = normalize_action('send_email', { recipient: 'bob@example.com' });
    expect(result.target).toBe('bob@example.com');
  });

  it('extracts target from email param', () => {
    const result = normalize_action('send_email', { email: 'carol@example.com' });
    expect(result.target).toBe('carol@example.com');
  });

  it('returns empty string as target when no target param is present', () => {
    const result = normalize_action('read_file', { content: 'hello' });
    expect(result.target).toBe('');
  });

  it('ignores non-string target param values', () => {
    const result = normalize_action('read_file', { path: 42 as unknown as string });
    expect(result.target).toBe('');
  });

  it('ignores empty-string target param values and continues to next key', () => {
    const result = normalize_action('read_file', { path: '', file: '/etc/hosts' });
    expect(result.target).toBe('/etc/hosts');
  });
});

// ---------------------------------------------------------------------------
// normalize_action — reclassification rule 1 (filesystem.write + URL → web.post)
// ---------------------------------------------------------------------------

describe('normalize_action — reclassification: filesystem.write with URL target', () => {
  it('reclassifies filesystem.write with http:// target to web.post', () => {
    const result = normalize_action('write_file', { url: 'http://api.example.com/upload' });
    expect(result.action_class).toBe('web.post');
    expect(result.risk).toBe('medium');
  });

  it('reclassifies filesystem.write with https:// target to web.post', () => {
    const result = normalize_action('write_file', { url: 'https://api.example.com/upload' });
    expect(result.action_class).toBe('web.post');
    expect(result.risk).toBe('medium');
  });

  it('reclassifies when path param holds a URL', () => {
    const result = normalize_action('edit_file', { path: 'https://remote.host/resource' });
    expect(result.action_class).toBe('web.post');
  });

  it('does not reclassify filesystem.write with a plain file path', () => {
    const result = normalize_action('write_file', { path: '/home/user/output.txt' });
    expect(result.action_class).toBe('filesystem.write');
    expect(result.risk).toBe('medium');
  });

  it('does not reclassify other action classes that happen to have a URL target', () => {
    const result = normalize_action('fetch', { url: 'https://example.com' });
    expect(result.action_class).toBe('web.fetch');
  });

  it('preserves hitl_mode from web.post entry after reclassification', () => {
    const result = normalize_action('write_file', { url: 'https://example.com/endpoint' });
    expect(result.hitl_mode).toBe('per_request');
  });
});

// ---------------------------------------------------------------------------
// normalize_action — reclassification rule 2 (shell metacharacters → critical risk)
// ---------------------------------------------------------------------------

describe('normalize_action — shell metacharacter detection', () => {
  it('raises risk to critical for semicolon in param', () => {
    const result = normalize_action('read_file', { path: '/etc/passwd; cat /etc/shadow' });
    expect(result.risk).toBe('critical');
  });

  it('raises risk to critical for pipe character in param', () => {
    const result = normalize_action('bash', { command: 'ls | grep secret' });
    expect(result.risk).toBe('critical');
  });

  it('raises risk to critical for && in param', () => {
    const result = normalize_action('read_file', { path: '/tmp/x && rm -rf /' });
    expect(result.risk).toBe('critical');
  });

  it('raises risk to critical for backtick in param', () => {
    const result = normalize_action('read_file', { path: '/tmp/`id`' });
    expect(result.risk).toBe('critical');
  });

  it('raises risk to critical for $() in param', () => {
    const result = normalize_action('read_file', { path: '/tmp/$(id)' });
    expect(result.risk).toBe('critical');
  });

  it('raises risk to critical for > (redirect) in param', () => {
    const result = normalize_action('bash', { command: 'echo hello > /etc/crontab' });
    expect(result.risk).toBe('critical');
  });

  it('raises risk to critical for < in param', () => {
    const result = normalize_action('bash', { command: 'cat < /etc/passwd' });
    expect(result.risk).toBe('critical');
  });

  it('does not raise risk for safe param values', () => {
    const result = normalize_action('read_file', { path: '/home/user/document.txt' });
    expect(result.risk).toBe('low');
  });

  it('only checks string param values, ignores non-strings', () => {
    const result = normalize_action('read_file', { path: '/safe/path', count: 42 });
    expect(result.risk).toBe('low');
  });

  it('raises risk even when the metachar is in a non-target param', () => {
    const result = normalize_action('read_file', { path: '/safe/path', extra: 'a;b' });
    expect(result.risk).toBe('critical');
  });

  it('shell metachar rule applies on top of URL reclassification', () => {
    const result = normalize_action('write_file', {
      url: 'https://example.com/upload',
      body: 'x; rm -rf /',
    });
    expect(result.action_class).toBe('web.post');
    expect(result.risk).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// normalize_action — unknown tools
// ---------------------------------------------------------------------------

describe('normalize_action — unknown tools', () => {
  it('unknown tools map to unknown_sensitive_action with critical risk', () => {
    const result = normalize_action('some_unknown_tool_xyz');
    expect(result.action_class).toBe('unknown_sensitive_action');
    expect(result.risk).toBe('critical');
    expect(result.hitl_mode).toBe('per_request');
  });

  it('defaults params to empty object when omitted', () => {
    const result = normalize_action('read_file');
    expect(result.action_class).toBe('filesystem.read');
    expect(result.target).toBe('');
  });
});

// ---------------------------------------------------------------------------
// sortedJsonStringify
// ---------------------------------------------------------------------------

describe('sortedJsonStringify', () => {
  it('serialises a flat object with keys sorted alphabetically', () => {
    const result = sortedJsonStringify({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('serialises a nested object with all levels sorted', () => {
    const result = sortedJsonStringify({ b: { z: 1, a: 2 }, a: { y: 9, x: 0 } });
    expect(result).toBe('{"a":{"x":0,"y":9},"b":{"a":2,"z":1}}');
  });

  it('serialises arrays preserving element order', () => {
    const result = sortedJsonStringify([3, 1, 2]);
    expect(result).toBe('[3,1,2]');
  });

  it('serialises arrays of objects with sorted keys per element', () => {
    const result = sortedJsonStringify([{ b: 2, a: 1 }, { d: 4, c: 3 }]);
    expect(result).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });

  it('serialises primitives — string', () => {
    expect(sortedJsonStringify('hello')).toBe('"hello"');
  });

  it('serialises primitives — number', () => {
    expect(sortedJsonStringify(42)).toBe('42');
  });

  it('serialises primitives — boolean', () => {
    expect(sortedJsonStringify(true)).toBe('true');
    expect(sortedJsonStringify(false)).toBe('false');
  });

  it('serialises null', () => {
    expect(sortedJsonStringify(null)).toBe('null');
  });

  it('produces the same output regardless of key insertion order', () => {
    const a = sortedJsonStringify({ z: 1, a: 2 });
    const b = sortedJsonStringify({ a: 2, z: 1 });
    expect(a).toBe(b);
  });

  it('handles empty object', () => {
    expect(sortedJsonStringify({})).toBe('{}');
  });

  it('handles empty array', () => {
    expect(sortedJsonStringify([])).toBe('[]');
  });
});

// Satisfy TypeScript — type-only imports used in stub file
void ({} as ActionRegistryEntry);
void ({} as NormalizedAction);
void ({} as RiskLevel);
void ({} as HitlModeNorm);

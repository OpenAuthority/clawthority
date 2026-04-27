import { describe, it, expect } from 'vitest';
import {
  normalize_action,
  getRegistryEntry,
  normalizeActionClass,
  sanitizeCommandPrefix,
  sortedJsonStringify,
} from './normalize.js';
import type { ActionRegistryEntry, NormalizedAction, RiskLevel, HitlModeNorm, IntentGroup } from './normalize.js';

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
// All 31 action classes resolve from at least one alias
// ---------------------------------------------------------------------------

describe('registry coverage — each action class resolves from at least one alias', () => {
  const cases: Array<[string, string]> = [
    ['read_file',        'filesystem.read'],
    ['write_file',       'filesystem.write'],
    ['delete_file',      'filesystem.delete'],
    ['list_files',       'filesystem.list'],
    ['web_search',       'web.search'],
    ['fetch',            'web.fetch'],
    ['http_post',        'web.post'],
    ['scrape_page',      'browser.scrape'],
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
    ['get_system_info',  'system.read'],
    ['git_log',          'vcs.read'],
    ['git_add',          'vcs.write'],
    ['git_clone',        'vcs.remote'],
    ['install_package',  'package.install'],
    ['npm_run_script',   'package.run'],
    ['pip_list',         'package.read'],
    ['run_compiler',     'build.compile'],
    ['run_tests',        'build.test'],
    ['run_linter',       'build.lint'],
    ['archive_create',   'archive.create'],
    ['archive_extract',  'archive.extract'],
    ['archive_list',     'archive.read'],
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
// package action classes — aliases, risk, HITL, target extraction
// ---------------------------------------------------------------------------

describe('package.install aliases', () => {
  it('npm_install → package.install with medium risk and per_request HITL', () => {
    const result = normalize_action('npm_install', { package_name: 'lodash' });
    expect(result.action_class).toBe('package.install');
    expect(result.risk).toBe('medium');
    expect(result.hitl_mode).toBe('per_request');
  });

  it('pip_install → package.install', () => {
    const result = normalize_action('pip_install', { package_name: 'requests' });
    expect(result.action_class).toBe('package.install');
  });

  it('extracts package_name as target', () => {
    const result = normalize_action('npm_install', { package_name: 'express' });
    expect(result.target).toBe('express');
  });

  it('falls back to package param when package_name is absent', () => {
    const result = normalize_action('pip_install', { package: 'numpy' });
    expect(result.target).toBe('numpy');
  });
});

describe('package.run aliases', () => {
  it('npm_run_script → package.run with medium risk and per_request HITL', () => {
    const result = normalize_action('npm_run_script', { script: 'build' });
    expect(result.action_class).toBe('package.run');
    expect(result.risk).toBe('medium');
    expect(result.hitl_mode).toBe('per_request');
  });

  it('npm_run → package.run', () => {
    const result = normalize_action('npm_run', { script: 'test' });
    expect(result.action_class).toBe('package.run');
  });

  it('yarn_run → package.run', () => {
    const result = normalize_action('yarn_run', { script: 'lint' });
    expect(result.action_class).toBe('package.run');
  });

  it('pnpm_run → package.run', () => {
    const result = normalize_action('pnpm_run', { script: 'dev' });
    expect(result.action_class).toBe('package.run');
  });

  it('run_script → package.run', () => {
    const result = normalize_action('run_script', { script: 'deploy' });
    expect(result.action_class).toBe('package.run');
  });

  it('extracts script param as target', () => {
    const result = normalize_action('npm_run_script', { script: 'build' });
    expect(result.target).toBe('build');
  });

  it('falls back to script_name param when script is absent', () => {
    const result = normalize_action('npm_run_script', { script_name: 'start' });
    expect(result.target).toBe('start');
  });

  it('falls back to name param when script and script_name are absent', () => {
    const result = normalize_action('npm_run_script', { name: 'watch' });
    expect(result.target).toBe('watch');
  });
});

describe('package.read aliases', () => {
  it('pip_list → package.read with low risk and no HITL', () => {
    const result = normalize_action('pip_list', {});
    expect(result.action_class).toBe('package.read');
    expect(result.risk).toBe('low');
    expect(result.hitl_mode).toBe('none');
  });

  it('pip_freeze → package.read', () => {
    const result = normalize_action('pip_freeze', {});
    expect(result.action_class).toBe('package.read');
  });

  it('npm_list → package.read', () => {
    const result = normalize_action('npm_list', {});
    expect(result.action_class).toBe('package.read');
  });

  it('list_packages → package.read', () => {
    const result = normalize_action('list_packages', {});
    expect(result.action_class).toBe('package.read');
  });

  it('extracts package_name as target when provided', () => {
    const result = normalize_action('pip_list', { package_name: 'django' });
    expect(result.target).toBe('django');
  });

  it('returns empty target when no package filter is specified', () => {
    const result = normalize_action('pip_list', {});
    expect(result.target).toBe('');
  });
});

// ---------------------------------------------------------------------------
// system.read action class — aliases, risk, HITL, target extraction
// ---------------------------------------------------------------------------

describe('system.read aliases and defaults', () => {
  it('get_system_info → system.read with low risk and no HITL', () => {
    const result = normalize_action('get_system_info', {});
    expect(result.action_class).toBe('system.read');
    expect(result.risk).toBe('low');
    expect(result.hitl_mode).toBe('none');
  });

  it('get_env_var → system.read with low risk and no HITL', () => {
    const result = normalize_action('get_env_var', { variable_name: 'HOME' });
    expect(result.action_class).toBe('system.read');
    expect(result.risk).toBe('low');
    expect(result.hitl_mode).toBe('none');
  });

  it('system_info → system.read', () => {
    const result = normalize_action('system_info', {});
    expect(result.action_class).toBe('system.read');
  });

  it('get_env → system.read', () => {
    const result = normalize_action('get_env', { variable_name: 'PATH' });
    expect(result.action_class).toBe('system.read');
  });

  it('read_env → system.read', () => {
    const result = normalize_action('read_env', { variable_name: 'USER' });
    expect(result.action_class).toBe('system.read');
  });

  it('uname → system.read', () => {
    const result = normalize_action('uname', {});
    expect(result.action_class).toBe('system.read');
  });

  it('GET_SYSTEM_INFO (uppercase) → system.read via case-insensitive alias lookup', () => {
    const result = normalize_action('GET_SYSTEM_INFO', {});
    expect(result.action_class).toBe('system.read');
  });

  it('no intent_group on system.read', () => {
    const result = normalize_action('get_system_info', {});
    expect(result.intent_group).toBeUndefined();
  });
});

describe('system.read target extraction', () => {
  it('extracts variable_name as target for get_env_var', () => {
    const result = normalize_action('get_env_var', { variable_name: 'HOME' });
    expect(result.target).toBe('HOME');
  });

  it('extracts name as target when variable_name is absent', () => {
    const result = normalize_action('get_env_var', { name: 'PATH' });
    expect(result.target).toBe('PATH');
  });

  it('extracts key as target when variable_name and name are absent', () => {
    const result = normalize_action('get_env_var', { key: 'USER' });
    expect(result.target).toBe('USER');
  });

  it('returns empty target for get_system_info (no params)', () => {
    const result = normalize_action('get_system_info', {});
    expect(result.target).toBe('');
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
// normalize_action — `browser` alias (OpenClaw tool)
// ---------------------------------------------------------------------------

describe('normalize_action — `browser` alias', () => {
  it('bare "browser" normalizes to web.fetch', () => {
    const result = normalize_action('browser', { url: 'https://example.com' });
    expect(result.action_class).toBe('web.fetch');
    expect(result.intent_group).toBe('data_exfiltration');
  });

  it('extracts the URL as target', () => {
    const result = normalize_action('browser', { url: 'https://example.com/page' });
    expect(result.target).toBe('https://example.com/page');
  });
});

// ---------------------------------------------------------------------------
// normalize_action — bare-verb aliases (read/write/edit/list)
// ---------------------------------------------------------------------------

describe('normalize_action — bare-verb aliases', () => {
  it('bare "read" normalizes to filesystem.read', () => {
    const result = normalize_action('read', { path: '/tmp/x.txt' });
    expect(result.action_class).toBe('filesystem.read');
    expect(result.risk).toBe('low');
  });

  it('bare "write" normalizes to filesystem.write', () => {
    const result = normalize_action('write', { path: '/tmp/x.txt', content: 'y' });
    expect(result.action_class).toBe('filesystem.write');
  });

  it('bare "edit" normalizes to filesystem.write', () => {
    const result = normalize_action('edit', { path: '/tmp/x.txt' });
    expect(result.action_class).toBe('filesystem.write');
  });

  it('bare "list" normalizes to filesystem.list', () => {
    const result = normalize_action('list', { path: '/tmp/' });
    expect(result.action_class).toBe('filesystem.list');
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

// ---------------------------------------------------------------------------
// intent_group — registry entries and normalize_action propagation
// ---------------------------------------------------------------------------

describe('intent_group — registry entry tags', () => {
  it('filesystem.delete has intent_group destructive_fs', () => {
    expect(getRegistryEntry('delete_file').intent_group).toBe('destructive_fs');
  });

  it('communication.email has intent_group external_send', () => {
    expect(getRegistryEntry('send_email').intent_group).toBe('external_send');
  });

  it('communication.slack has intent_group external_send', () => {
    expect(getRegistryEntry('send_slack').intent_group).toBe('external_send');
  });

  it('credential.read has intent_group credential_access', () => {
    expect(getRegistryEntry('read_secret').intent_group).toBe('credential_access');
  });

  it('credential.write has intent_group credential_access', () => {
    expect(getRegistryEntry('write_secret').intent_group).toBe('credential_access');
  });

  it('payment.initiate has intent_group payment', () => {
    expect(getRegistryEntry('pay').intent_group).toBe('payment');
  });

  it('filesystem.read has no intent_group', () => {
    expect(getRegistryEntry('read_file').intent_group).toBeUndefined();
  });

  it('shell.exec has no intent_group', () => {
    expect(getRegistryEntry('bash').intent_group).toBeUndefined();
  });

  it('web.fetch has intent_group data_exfiltration', () => {
    expect(getRegistryEntry('fetch').intent_group).toBe('data_exfiltration');
  });

  it('web.post has intent_group web_access', () => {
    expect(getRegistryEntry('http_post').intent_group).toBe('web_access');
  });

  it('web.search has no intent_group', () => {
    expect(getRegistryEntry('web_search').intent_group).toBeUndefined();
  });

  it('browser.scrape has no intent_group', () => {
    expect(getRegistryEntry('scrape_page').intent_group).toBeUndefined();
  });
});

describe('intent_group — normalize_action propagation', () => {
  it('normalize_action includes intent_group for filesystem.delete', () => {
    const result = normalize_action('delete_file', { path: '/tmp/test.txt' });
    expect(result.intent_group).toBe('destructive_fs');
  });

  it('normalize_action includes intent_group for communication.email', () => {
    const result = normalize_action('send_email', { to: 'user@example.com' });
    expect(result.intent_group).toBe('external_send');
  });

  it('normalize_action includes intent_group for communication.slack', () => {
    const result = normalize_action('send_slack', { channel: '#general' });
    expect(result.intent_group).toBe('external_send');
  });

  it('normalize_action includes intent_group for credential.read', () => {
    const result = normalize_action('read_secret', { path: 'my-secret' });
    expect(result.intent_group).toBe('credential_access');
  });

  it('normalize_action includes intent_group for credential.write', () => {
    const result = normalize_action('write_secret', { path: 'new-secret' });
    expect(result.intent_group).toBe('credential_access');
  });

  it('normalize_action includes intent_group for payment.initiate', () => {
    const result = normalize_action('pay', { amount: '100' });
    expect(result.intent_group).toBe('payment');
  });

  it('normalize_action omits intent_group for actions without a group', () => {
    const result = normalize_action('read_file', { path: '/etc/hosts' });
    expect(result.intent_group).toBeUndefined();
  });

  it('normalize_action omits intent_group for unknown tools', () => {
    const result = normalize_action('some_unknown_tool');
    expect(result.intent_group).toBeUndefined();
  });

  it('normalize_action includes intent_group data_exfiltration for web.fetch', () => {
    const result = normalize_action('fetch', { url: 'https://example.com' });
    expect(result.intent_group).toBe('data_exfiltration');
  });

  it('normalize_action includes intent_group web_access for web.post', () => {
    const result = normalize_action('http_post', { url: 'https://api.example.com' });
    expect(result.intent_group).toBe('web_access');
  });

  it('all web.fetch aliases propagate the data_exfiltration intent_group', () => {
    const webFetchAliases = ['fetch', 'http_get', 'web_fetch', 'get_url', 'fetch_url', 'http_request', 'curl', 'wget', 'download_url', 'http_head', 'head_url', 'http_options'];
    for (const alias of webFetchAliases) {
      expect(normalize_action(alias).intent_group).toBe('data_exfiltration');
    }
    const webPostAliases = ['http_post', 'post_url', 'web_post', 'post_request', 'submit_form', 'http_put', 'put_url', 'web_put', 'put_request', 'http_patch', 'patch_url', 'web_patch', 'patch_request'];
    for (const alias of webPostAliases) {
      expect(normalize_action(alias).intent_group).toBe('web_access');
    }
  });
});

// ---------------------------------------------------------------------------
// filesystem.delete — expanded alias coverage (T14)
// ---------------------------------------------------------------------------

describe('filesystem.delete — new aliases resolve to filesystem.delete with destructive_fs', () => {
  const NEW_ALIASES = [
    'rm',
    'rm_rf',
    'unlink',
    'delete',
    'remove',
    'move_to_trash',
    'trash',
    'shred',
    'rmdir',
    'format',
    'empty_trash',
    'purge',
  ] as const;

  for (const alias of NEW_ALIASES) {
    it(`"${alias}" resolves to filesystem.delete`, () => {
      expect(normalizeActionClass(alias)).toBe('filesystem.delete');
    });

    it(`"${alias}" has intent_group destructive_fs`, () => {
      expect(getRegistryEntry(alias).intent_group).toBe('destructive_fs');
    });

    it(`normalize_action("${alias}") propagates intent_group destructive_fs`, () => {
      const result = normalize_action(alias, { path: '/tmp/target' });
      expect(result.action_class).toBe('filesystem.delete');
      expect(result.intent_group).toBe('destructive_fs');
    });
  }

  it('all new aliases are case-insensitive', () => {
    expect(normalizeActionClass('RM')).toBe('filesystem.delete');
    expect(normalizeActionClass('Trash')).toBe('filesystem.delete');
    expect(normalizeActionClass('SHRED')).toBe('filesystem.delete');
    expect(normalizeActionClass('PURGE')).toBe('filesystem.delete');
    expect(normalizeActionClass('FORMAT')).toBe('filesystem.delete');
  });

  it('all new aliases have high default_risk', () => {
    for (const alias of NEW_ALIASES) {
      expect(getRegistryEntry(alias).default_risk).toBe('high');
    }
  });

  it('all new aliases have per_request default_hitl_mode', () => {
    for (const alias of NEW_ALIASES) {
      expect(getRegistryEntry(alias).default_hitl_mode).toBe('per_request');
    }
  });
});

// ---------------------------------------------------------------------------
// web.search — alias coverage (TC-WS)
// ---------------------------------------------------------------------------

describe('web.search — aliases resolve to web.search with medium risk and per_request HITL', () => {
  const WEB_SEARCH_ALIASES = [
    'web_search',
    'google_search',
    'bing_search',
    'duckduckgo_search',
    'ddg_search',
    'search_web',
    'web_research',
    'news_search',
  ] as const;

  for (const alias of WEB_SEARCH_ALIASES) {
    it(`TC-WS: "${alias}" resolves to web.search`, () => {
      expect(normalizeActionClass(alias)).toBe('web.search');
    });

    it(`TC-WS: "${alias}" has default_risk medium`, () => {
      expect(getRegistryEntry(alias).default_risk).toBe('medium');
    });

    it(`TC-WS: "${alias}" has default_hitl_mode per_request`, () => {
      expect(getRegistryEntry(alias).default_hitl_mode).toBe('per_request');
    });

    it(`TC-WS: normalize_action("${alias}") returns correct action_class and risk`, () => {
      const result = normalize_action(alias);
      expect(result.action_class).toBe('web.search');
      expect(result.risk).toBe('medium');
      expect(result.hitl_mode).toBe('per_request');
    });
  }
});

// ---------------------------------------------------------------------------
// web.fetch — new alias coverage + updated properties (TC-WF)
// ---------------------------------------------------------------------------

describe('web.fetch — new aliases and updated risk/hitl/intent_group', () => {
  const NEW_WEB_FETCH_ALIASES = ['curl', 'wget', 'download_url'] as const;

  for (const alias of NEW_WEB_FETCH_ALIASES) {
    it(`TC-WF: "${alias}" resolves to web.fetch`, () => {
      expect(normalizeActionClass(alias)).toBe('web.fetch');
    });

    it(`TC-WF: "${alias}" has intent_group data_exfiltration`, () => {
      expect(getRegistryEntry(alias).intent_group).toBe('data_exfiltration');
    });

    it(`TC-WF: normalize_action("${alias}") has action_class, risk, hitl_mode, intent_group`, () => {
      const result = normalize_action(alias);
      expect(result.action_class).toBe('web.fetch');
      expect(result.risk).toBe('medium');
      expect(result.hitl_mode).toBe('per_request');
      expect(result.intent_group).toBe('data_exfiltration');
    });
  }

  it('web.fetch default_risk is medium', () => {
    expect(getRegistryEntry('fetch').default_risk).toBe('medium');
  });

  it('web.fetch default_hitl_mode is per_request', () => {
    expect(getRegistryEntry('fetch').default_hitl_mode).toBe('per_request');
  });
});

// ---------------------------------------------------------------------------
// web.post — PUT and PATCH HTTP method variants (TC-WP)
// ---------------------------------------------------------------------------

describe('web.post — HTTP PUT and PATCH method aliases resolve to web.post', () => {
  const HTTP_WRITE_ALIASES = [
    'http_put',
    'put_url',
    'web_put',
    'put_request',
    'http_patch',
    'patch_url',
    'web_patch',
    'patch_request',
  ] as const;

  for (const alias of HTTP_WRITE_ALIASES) {
    it(`TC-WP: "${alias}" resolves to web.post`, () => {
      expect(normalizeActionClass(alias)).toBe('web.post');
    });

    it(`TC-WP: "${alias}" has intent_group web_access`, () => {
      expect(getRegistryEntry(alias).intent_group).toBe('web_access');
    });

    it(`TC-WP: normalize_action("${alias}") returns correct action_class, risk, hitl_mode`, () => {
      const result = normalize_action(alias);
      expect(result.action_class).toBe('web.post');
      expect(result.risk).toBe('medium');
      expect(result.hitl_mode).toBe('per_request');
      expect(result.intent_group).toBe('web_access');
    });
  }

  it('HTTP PUT/PATCH aliases are case-insensitive', () => {
    expect(normalizeActionClass('HTTP_PUT')).toBe('web.post');
    expect(normalizeActionClass('Http_Patch')).toBe('web.post');
    expect(normalizeActionClass('PUT_URL')).toBe('web.post');
    expect(normalizeActionClass('PATCH_REQUEST')).toBe('web.post');
  });
});

// ---------------------------------------------------------------------------
// web.fetch — HEAD and OPTIONS HTTP method variants (TC-WFH)
// ---------------------------------------------------------------------------

describe('web.fetch — HTTP HEAD and OPTIONS method aliases resolve to web.fetch', () => {
  const HTTP_READ_ALIASES = [
    'http_head',
    'head_url',
    'http_options',
  ] as const;

  for (const alias of HTTP_READ_ALIASES) {
    it(`TC-WFH: "${alias}" resolves to web.fetch`, () => {
      expect(normalizeActionClass(alias)).toBe('web.fetch');
    });

    it(`TC-WFH: "${alias}" has intent_group data_exfiltration`, () => {
      expect(getRegistryEntry(alias).intent_group).toBe('data_exfiltration');
    });

    it(`TC-WFH: normalize_action("${alias}") returns correct action_class, risk, hitl_mode`, () => {
      const result = normalize_action(alias);
      expect(result.action_class).toBe('web.fetch');
      expect(result.risk).toBe('medium');
      expect(result.hitl_mode).toBe('per_request');
      expect(result.intent_group).toBe('data_exfiltration');
    });
  }
});

// ---------------------------------------------------------------------------
// browser.scrape — alias coverage (TC-BS)
// ---------------------------------------------------------------------------

describe('browser.scrape — aliases resolve to browser.scrape with medium risk and per_request HITL', () => {
  const BROWSER_SCRAPE_ALIASES = ['scrape_page', 'extract_page', 'read_url'] as const;

  for (const alias of BROWSER_SCRAPE_ALIASES) {
    it(`TC-BS: "${alias}" resolves to browser.scrape`, () => {
      expect(normalizeActionClass(alias)).toBe('browser.scrape');
    });

    it(`TC-BS: "${alias}" has default_risk medium`, () => {
      expect(getRegistryEntry(alias).default_risk).toBe('medium');
    });

    it(`TC-BS: "${alias}" has default_hitl_mode per_request`, () => {
      expect(getRegistryEntry(alias).default_hitl_mode).toBe('per_request');
    });

    it(`TC-BS: normalize_action("${alias}") returns correct action_class and risk`, () => {
      const result = normalize_action(alias);
      expect(result.action_class).toBe('browser.scrape');
      expect(result.risk).toBe('medium');
      expect(result.hitl_mode).toBe('per_request');
    });
  }
});

// ---------------------------------------------------------------------------
// normalize_action — per-action-class typed target extraction
// ---------------------------------------------------------------------------

describe('normalize_action — per-action-class typed target extraction: filesystem ops', () => {
  it('TC-TEX-01: extracts file_path for filesystem.read', () => {
    const result = normalize_action('read_file', { file_path: '/home/user/notes.txt' });
    expect(result.target).toBe('/home/user/notes.txt');
  });

  it('TC-TEX-02: file_path takes priority over path for filesystem.read', () => {
    const result = normalize_action('read_file', { file_path: '/preferred', path: '/fallback' });
    expect(result.target).toBe('/preferred');
  });

  it('TC-TEX-03: falls back to path when file_path is absent for filesystem.read', () => {
    const result = normalize_action('read_file', { path: '/etc/hosts' });
    expect(result.target).toBe('/etc/hosts');
  });

  it('TC-TEX-04: extracts file_path for filesystem.write (write_file)', () => {
    const result = normalize_action('write_file', { file_path: '/tmp/output.txt' });
    expect(result.target).toBe('/tmp/output.txt');
  });

  it('TC-TEX-05: extracts file_path for filesystem.write (edit_file)', () => {
    const result = normalize_action('edit_file', { file_path: '/src/main.ts' });
    expect(result.target).toBe('/src/main.ts');
  });

  it('TC-TEX-06: filesystem.write still accepts destination as fallback', () => {
    const result = normalize_action('write_file', { destination: '/output/data.json' });
    expect(result.target).toBe('/output/data.json');
  });

  it('TC-TEX-07: extracts file_path for filesystem.list (list_dir)', () => {
    const result = normalize_action('list_dir', { file_path: '/project/src' });
    expect(result.target).toBe('/project/src');
  });

  it('TC-TEX-08: extracts file_path for filesystem.delete', () => {
    const result = normalize_action('delete_file', { file_path: '/tmp/old.log' });
    expect(result.target).toBe('/tmp/old.log');
  });

  it('TC-TEX-09: file_path is ignored when empty, falls back to path', () => {
    const result = normalize_action('read_file', { file_path: '', path: '/etc/hosts' });
    expect(result.target).toBe('/etc/hosts');
  });
});

describe('normalize_action — per-action-class typed target extraction: vcs.remote', () => {
  it('TC-TEX-10: extracts repo_url for git_clone', () => {
    const result = normalize_action('git_clone', { repo_url: 'https://github.com/org/repo.git' });
    expect(result.target).toBe('https://github.com/org/repo.git');
    expect(result.action_class).toBe('vcs.remote');
  });

  it('TC-TEX-11: extracts repo_url for git_push', () => {
    const result = normalize_action('git_push', { repo_url: 'git@github.com:org/repo.git' });
    expect(result.target).toBe('git@github.com:org/repo.git');
  });

  it('TC-TEX-12: extracts repo_url for git_pull', () => {
    const result = normalize_action('git_pull', { repo_url: 'https://github.com/org/repo.git' });
    expect(result.target).toBe('https://github.com/org/repo.git');
  });

  it('TC-TEX-13: falls back to url when repo_url is absent', () => {
    const result = normalize_action('git_clone', { url: 'https://github.com/org/repo.git' });
    expect(result.target).toBe('https://github.com/org/repo.git');
  });

  it('TC-TEX-14: repo_url takes priority over url for vcs.remote', () => {
    const result = normalize_action('git_clone', {
      repo_url: 'https://github.com/org/repo.git',
      url: 'https://other.example.com',
    });
    expect(result.target).toBe('https://github.com/org/repo.git');
  });

  it('TC-TEX-15: vcs.remote has medium risk and per_request HITL', () => {
    const result = normalize_action('git_clone', { repo_url: 'https://github.com/org/repo.git' });
    expect(result.risk).toBe('medium');
    expect(result.hitl_mode).toBe('per_request');
  });

  it('TC-TEX-16: returns empty target when no recognised key is present', () => {
    const result = normalize_action('git_clone', { branch: 'main' });
    expect(result.target).toBe('');
  });

  it('falls back to remote_url when repo_url and url are absent', () => {
    const result = normalize_action('git_push', { remote_url: 'git@github.com:org/repo.git' });
    expect(result.target).toBe('git@github.com:org/repo.git');
  });

  it('falls back to remote when repo_url, url, and remote_url are absent', () => {
    const result = normalize_action('git_fetch', { remote: 'origin' });
    expect(result.target).toBe('origin');
  });
});

describe('normalize_action — per-action-class typed target extraction: package.install', () => {
  it('TC-TEX-17: extracts package_name for install_package', () => {
    const result = normalize_action('install_package', { package_name: 'lodash' });
    expect(result.target).toBe('lodash');
    expect(result.action_class).toBe('package.install');
  });

  it('TC-TEX-18: extracts package_name for npm_install', () => {
    const result = normalize_action('npm_install', { package_name: 'react@18' });
    expect(result.target).toBe('react@18');
  });

  it('TC-TEX-19: extracts package_name for pip_install', () => {
    const result = normalize_action('pip_install', { package_name: 'requests' });
    expect(result.target).toBe('requests');
  });

  it('TC-TEX-20: package_name takes priority over package for package.install', () => {
    const result = normalize_action('npm_install', {
      package_name: 'preferred-pkg',
      package: 'fallback-pkg',
    });
    expect(result.target).toBe('preferred-pkg');
  });

  it('TC-TEX-21: falls back to package when package_name is absent', () => {
    const result = normalize_action('npm_install', { package: 'express' });
    expect(result.target).toBe('express');
  });

  it('TC-TEX-22: falls back to name when package_name and package are absent', () => {
    const result = normalize_action('npm_install', { name: 'chalk' });
    expect(result.target).toBe('chalk');
  });

  it('TC-TEX-23: package.install has medium risk and per_request HITL', () => {
    const result = normalize_action('install_package', { package_name: 'lodash' });
    expect(result.risk).toBe('medium');
    expect(result.hitl_mode).toBe('per_request');
  });

  it('TC-TEX-24: returns empty target when no recognised key is present', () => {
    const result = normalize_action('npm_install', { version: '18' });
    expect(result.target).toBe('');
  });
});

describe('normalize_action — per-action-class typed target extraction: vcs.read', () => {
  it('TC-TEX-25: extracts path for git_diff', () => {
    const result = normalize_action('git_diff', { path: 'src/index.ts' });
    expect(result.target).toBe('src/index.ts');
    expect(result.action_class).toBe('vcs.read');
  });

  it('TC-TEX-26: extracts file_path for git_log when path is absent', () => {
    const result = normalize_action('git_log', { file_path: 'src/utils.ts' });
    expect(result.target).toBe('src/utils.ts');
  });

  it('TC-TEX-27: path takes priority over file_path for vcs.read', () => {
    const result = normalize_action('git_diff', { path: 'preferred.ts', file_path: 'fallback.ts' });
    expect(result.target).toBe('preferred.ts');
  });

  it('TC-TEX-28: extracts branch when path and file_path are absent', () => {
    const result = normalize_action('git_log', { branch: 'main' });
    expect(result.target).toBe('main');
  });

  it('TC-TEX-29: vcs.read has low risk and none HITL', () => {
    const result = normalize_action('git_status', {});
    expect(result.risk).toBe('low');
    expect(result.hitl_mode).toBe('none');
  });

  it('TC-TEX-30: returns empty target when no recognised key is present for vcs.read', () => {
    const result = normalize_action('git_status', { verbose: 'true' });
    expect(result.target).toBe('');
  });
});

describe('normalize_action — per-action-class typed target extraction: vcs.write', () => {
  it('TC-TEX-31: extracts path for git_add', () => {
    const result = normalize_action('git_add', { path: 'src/feature.ts' });
    expect(result.target).toBe('src/feature.ts');
    expect(result.action_class).toBe('vcs.write');
  });

  it('TC-TEX-32: extracts file_path for git_add when path is absent', () => {
    const result = normalize_action('git_add', { file_path: 'src/index.ts' });
    expect(result.target).toBe('src/index.ts');
  });

  it('TC-TEX-33: falls back to working_dir for git_commit', () => {
    const result = normalize_action('git_commit', { working_dir: '/workspace/project' });
    expect(result.target).toBe('/workspace/project');
  });

  it('TC-TEX-34: vcs.write has medium risk and per_request HITL', () => {
    const result = normalize_action('git_commit', {});
    expect(result.risk).toBe('medium');
    expect(result.hitl_mode).toBe('per_request');
  });

  it('TC-TEX-35: returns empty target when no recognised key is present for vcs.write', () => {
    const result = normalize_action('git_commit', { message: 'fix: bug' });
    expect(result.target).toBe('');
  });
});

describe('vcs.remote — alias coverage', () => {
  const VCS_REMOTE_ALIASES = [
    'git_clone', 'git-clone', 'git.clone', 'clone_repo',
    'git_push', 'git-push', 'git.push', 'push_commits',
    'git_pull', 'git-pull', 'git.pull', 'pull_changes',
    'git_fetch', 'git-fetch', 'git.fetch', 'fetch_remote',
  ] as const;

  for (const alias of VCS_REMOTE_ALIASES) {
    it(`"${alias}" resolves to vcs.remote`, () => {
      expect(normalizeActionClass(alias)).toBe('vcs.remote');
    });
  }

  it('vcs.remote has medium risk and per_request HITL', () => {
    const entry = getRegistryEntry('git_push');
    expect(entry.default_risk).toBe('medium');
    expect(entry.default_hitl_mode).toBe('per_request');
  });
});

describe('vcs.read — alias coverage', () => {
  const VCS_READ_ALIASES = [
    'git_status', 'git-status', 'git.status', 'show_status',
    'git_log', 'git-log', 'git.log', 'log_commits', 'view_history',
    'git_diff', 'git-diff', 'git.diff', 'view_diff', 'show_diff',
  ] as const;

  for (const alias of VCS_READ_ALIASES) {
    it(`"${alias}" resolves to vcs.read`, () => {
      expect(normalizeActionClass(alias)).toBe('vcs.read');
    });
  }

  it('vcs.read has low risk and none HITL', () => {
    const entry = getRegistryEntry('git_status');
    expect(entry.default_risk).toBe('low');
    expect(entry.default_hitl_mode).toBe('none');
  });
});

describe('vcs.write — alias coverage', () => {
  const VCS_WRITE_ALIASES = [
    'git_commit', 'git-commit', 'git.commit', 'commit_changes',
    'git_add', 'git-add', 'git.add', 'stage_file', 'stage_files',
  ] as const;

  for (const alias of VCS_WRITE_ALIASES) {
    it(`"${alias}" resolves to vcs.write`, () => {
      expect(normalizeActionClass(alias)).toBe('vcs.write');
    });
  }

  it('vcs.write has medium risk and per_request HITL', () => {
    const entry = getRegistryEntry('git_commit');
    expect(entry.default_risk).toBe('medium');
    expect(entry.default_hitl_mode).toBe('per_request');
  });
});

describe('package.install — alias coverage', () => {
  const PKG_INSTALL_ALIASES = [
    'install_package', 'npm_install', 'pip_install', 'pip3_install',
    'yarn_add', 'apt_install', 'brew_install', 'add_package',
  ] as const;

  for (const alias of PKG_INSTALL_ALIASES) {
    it(`"${alias}" resolves to package.install`, () => {
      expect(normalizeActionClass(alias)).toBe('package.install');
    });
  }
});

describe('build.compile — alias coverage', () => {
  const BUILD_COMPILE_ALIASES = [
    'run_compiler', 'compile', 'build', 'npm_run_build', 'make',
    'tsc', 'javac', 'gcc', 'cargo_build', 'go_build', 'mvn_compile', 'gradle_build',
  ] as const;

  for (const alias of BUILD_COMPILE_ALIASES) {
    it(`"${alias}" resolves to build.compile`, () => {
      expect(normalizeActionClass(alias)).toBe('build.compile');
    });
  }

  it('build.compile has medium risk and per_request HITL', () => {
    const entry = getRegistryEntry('run_compiler');
    expect(entry.default_risk).toBe('medium');
    expect(entry.default_hitl_mode).toBe('per_request');
  });
});

describe('build.test — alias coverage', () => {
  const BUILD_TEST_ALIASES = [
    'run_tests', 'run_test', 'npm_test', 'npm_run_test', 'yarn_test',
    'pytest', 'jest', 'vitest', 'mocha', 'go_test', 'cargo_test', 'mvn_test', 'gradle_test',
  ] as const;

  for (const alias of BUILD_TEST_ALIASES) {
    it(`"${alias}" resolves to build.test`, () => {
      expect(normalizeActionClass(alias)).toBe('build.test');
    });
  }

  it('build.test has low risk and none HITL', () => {
    const entry = getRegistryEntry('run_tests');
    expect(entry.default_risk).toBe('low');
    expect(entry.default_hitl_mode).toBe('none');
  });
});

describe('build.lint — alias coverage', () => {
  const BUILD_LINT_ALIASES = [
    'run_linter', 'run_formatter', 'run_typecheck',
    'eslint', 'prettier', 'pylint', 'flake8', 'mypy',
    'cargo_clippy', 'golangci_lint', 'rubocop',
  ] as const;

  for (const alias of BUILD_LINT_ALIASES) {
    it(`"${alias}" resolves to build.lint`, () => {
      expect(normalizeActionClass(alias)).toBe('build.lint');
    });
  }

  it('build.lint has low risk and none HITL', () => {
    const entry = getRegistryEntry('run_linter');
    expect(entry.default_risk).toBe('low');
    expect(entry.default_hitl_mode).toBe('none');
  });
});

describe('build action classes — target extraction', () => {
  it('build.compile extracts target from target param', () => {
    const result = normalize_action('run_compiler', { target: 'dist/index.js' });
    expect(result.target).toBe('dist/index.js');
  });

  it('build.compile falls back to path when target is absent', () => {
    const result = normalize_action('run_compiler', { path: '/workspace/project' });
    expect(result.target).toBe('/workspace/project');
  });

  it('build.compile falls back to file_path when target and path are absent', () => {
    const result = normalize_action('run_compiler', { file_path: '/src/main.ts' });
    expect(result.target).toBe('/src/main.ts');
  });

  it('build.compile returns empty string when no target params provided', () => {
    const result = normalize_action('run_compiler', {});
    expect(result.target).toBe('');
  });

  it('build.test extracts target from target param', () => {
    const result = normalize_action('run_tests', { target: 'src/auth' });
    expect(result.target).toBe('src/auth');
  });

  it('build.test falls back to path when target is absent', () => {
    const result = normalize_action('run_tests', { path: '/workspace' });
    expect(result.target).toBe('/workspace');
  });

  it('build.lint extracts target from target param', () => {
    const result = normalize_action('run_linter', { target: 'src/' });
    expect(result.target).toBe('src/');
  });

  it('build.lint falls back to path when target is absent', () => {
    const result = normalize_action('run_linter', { path: '/workspace/project' });
    expect(result.target).toBe('/workspace/project');
  });

  it('build.lint falls back to file_path when target and path are absent', () => {
    const result = normalize_action('run_formatter', { file_path: '/src/utils.ts' });
    expect(result.target).toBe('/src/utils.ts');
  });
});

// ---------------------------------------------------------------------------
// archive.create — aliases, risk, HITL, target extraction
// ---------------------------------------------------------------------------

describe('archive.create aliases', () => {
  it('archive_create → archive.create with medium risk and per_request HITL', () => {
    const result = normalize_action('archive_create', { output_path: '/tmp/out.tar.gz' });
    expect(result.action_class).toBe('archive.create');
    expect(result.risk).toBe('medium');
    expect(result.hitl_mode).toBe('per_request');
  });

  it('tar_create → archive.create', () => {
    const result = normalize_action('tar_create', { output_path: '/tmp/backup.tar.gz' });
    expect(result.action_class).toBe('archive.create');
  });

  it('zip_create → archive.create', () => {
    const result = normalize_action('zip_create', { output_path: '/tmp/files.zip' });
    expect(result.action_class).toBe('archive.create');
  });

  it('compress → archive.create', () => {
    expect(normalize_action('compress', {}).action_class).toBe('archive.create');
  });

  it('extracts output_path as target', () => {
    const result = normalize_action('archive_create', { output_path: '/tmp/out.tar.gz' });
    expect(result.target).toBe('/tmp/out.tar.gz');
  });

  it('falls back to destination when output_path is absent', () => {
    const result = normalize_action('archive_create', { destination: '/tmp/archive.zip' });
    expect(result.target).toBe('/tmp/archive.zip');
  });

  it('falls back to path when output_path and destination are absent', () => {
    const result = normalize_action('archive_create', { path: '/tmp/files.tar' });
    expect(result.target).toBe('/tmp/files.tar');
  });
});

// ---------------------------------------------------------------------------
// archive.extract — aliases, risk, HITL, target extraction
// ---------------------------------------------------------------------------

describe('archive.extract aliases', () => {
  it('archive_extract → archive.extract with medium risk and per_request HITL', () => {
    const result = normalize_action('archive_extract', { archive_path: '/tmp/files.tar.gz' });
    expect(result.action_class).toBe('archive.extract');
    expect(result.risk).toBe('medium');
    expect(result.hitl_mode).toBe('per_request');
  });

  it('unzip → archive.extract', () => {
    const result = normalize_action('unzip', { archive_path: '/tmp/files.zip' });
    expect(result.action_class).toBe('archive.extract');
  });

  it('tar_extract → archive.extract', () => {
    expect(normalize_action('tar_extract', {}).action_class).toBe('archive.extract');
  });

  it('decompress → archive.extract', () => {
    expect(normalize_action('decompress', {}).action_class).toBe('archive.extract');
  });

  it('extract_archive → archive.extract', () => {
    expect(normalize_action('extract_archive', {}).action_class).toBe('archive.extract');
  });

  it('extracts destination as target', () => {
    const result = normalize_action('archive_extract', { destination: '/tmp/out/' });
    expect(result.target).toBe('/tmp/out/');
  });

  it('falls back to archive_path when destination is absent', () => {
    const result = normalize_action('unzip', { archive_path: '/tmp/files.zip' });
    expect(result.target).toBe('/tmp/files.zip');
  });

  it('has higher risk than archive.read', () => {
    const extract = normalize_action('archive_extract', {});
    const read = normalize_action('archive_list', {});
    const riskOrder: string[] = ['low', 'medium', 'high', 'critical'];
    expect(riskOrder.indexOf(extract.risk)).toBeGreaterThan(riskOrder.indexOf(read.risk));
  });
});

// ---------------------------------------------------------------------------
// archive.read — aliases, risk, HITL, target extraction
// ---------------------------------------------------------------------------

describe('archive.read aliases', () => {
  it('archive_list → archive.read with low risk and none HITL', () => {
    const result = normalize_action('archive_list', { archive_path: '/tmp/files.tar.gz' });
    expect(result.action_class).toBe('archive.read');
    expect(result.risk).toBe('low');
    expect(result.hitl_mode).toBe('none');
  });

  it('archive_read → archive.read', () => {
    expect(normalize_action('archive_read', {}).action_class).toBe('archive.read');
  });

  it('list_archive → archive.read', () => {
    expect(normalize_action('list_archive', {}).action_class).toBe('archive.read');
  });

  it('tar_list → archive.read', () => {
    expect(normalize_action('tar_list', {}).action_class).toBe('archive.read');
  });

  it('zip_list → archive.read', () => {
    expect(normalize_action('zip_list', {}).action_class).toBe('archive.read');
  });

  it('inspect_archive → archive.read', () => {
    expect(normalize_action('inspect_archive', {}).action_class).toBe('archive.read');
  });

  it('extracts archive_path as target', () => {
    const result = normalize_action('archive_list', { archive_path: '/tmp/files.tar.gz' });
    expect(result.target).toBe('/tmp/files.tar.gz');
  });

  it('falls back to path when archive_path is absent', () => {
    const result = normalize_action('tar_list', { path: '/backup/data.tar' });
    expect(result.target).toBe('/backup/data.tar');
  });

  it('falls back to file_path when archive_path and path are absent', () => {
    const result = normalize_action('zip_list', { file_path: '/tmp/archive.zip' });
    expect(result.target).toBe('/tmp/archive.zip');
  });
});

// ---------------------------------------------------------------------------
// sanitizeCommandPrefix
// ---------------------------------------------------------------------------

describe('sanitizeCommandPrefix', () => {
  it('truncates a plain command to 40 chars', () => {
    const cmd = 'rm -rf /very/long/path/that/exceeds/forty/characters/total';
    expect(sanitizeCommandPrefix(cmd)).toHaveLength(40);
    expect(sanitizeCommandPrefix(cmd)).toBe(cmd.slice(0, 40));
  });

  it('preserves short commands unchanged', () => {
    expect(sanitizeCommandPrefix('ls -la')).toBe('ls -la');
  });

  it('redacts $VAR for AWS credential-named vars', () => {
    const result = sanitizeCommandPrefix('echo $AWS_SECRET_ACCESS_KEY');
    expect(result).not.toContain('AWS_SECRET_ACCESS_KEY');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts ${VAR} for GITHUB credential-named vars', () => {
    const result = sanitizeCommandPrefix('echo ${GITHUB_TOKEN}');
    expect(result).not.toContain('GITHUB_TOKEN');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts generic *_TOKEN env vars', () => {
    const result = sanitizeCommandPrefix('echo $MY_APP_TOKEN');
    expect(result).not.toContain('MY_APP_TOKEN');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts key=value inline credential assignments', () => {
    const result = sanitizeCommandPrefix('curl -H "token=supersecret123" https://x');
    expect(result).not.toContain('supersecret123');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts Bearer <token>', () => {
    // Use a short enough command so [REDACTED] fits within the 40-char limit
    const result = sanitizeCommandPrefix('Bearer eyJhbGciOiJSUzI1Ni');
    expect(result).not.toContain('eyJhbGciOiJSUzI1Ni');
    expect(result).toContain('[REDACTED]');
  });

  it('does not redact safe env vars like $HOME or $PATH', () => {
    expect(sanitizeCommandPrefix('cd $HOME')).toBe('cd $HOME');
    expect(sanitizeCommandPrefix('echo $PATH')).toBe('echo $PATH');
  });

  it('returns at most 40 characters after sanitization', () => {
    // A long command with a credential — after redaction the result must still be ≤40 chars
    const result = sanitizeCommandPrefix('export GITHUB_TOKEN=ghp_abcdefghijklmnop && curl https://api.github.com');
    expect(result.length).toBeLessThanOrEqual(40);
  });
});


// Satisfy TypeScript — type-only imports used in stub file
void ({} as ActionRegistryEntry);
void ({} as NormalizedAction);
void ({} as RiskLevel);
void ({} as HitlModeNorm);
void ({} as IntentGroup);

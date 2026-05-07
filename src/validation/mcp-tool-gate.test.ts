/**
 * MCP tool registry gate tests.
 *
 * Verifies that `MCPToolGate` correctly enforces E-03 (exec wrapper blocking)
 * and E-07 (unregistered tool rejection), applies the operator allowlist, and
 * audit-logs all gate decisions.
 *
 * Test IDs:
 *   TC-MTG-01: Registered non-exec tools are permitted
 *   TC-MTG-02: Unregistered tools are forbidden by default (E-07)
 *   TC-MTG-03: Operator allowlist permits unregistered tools
 *   TC-MTG-04: Exec wrapper tools are forbidden (E-03)
 *   TC-MTG-05: Audit logging records all gate decisions
 *   TC-MTG-06: Gate operates without a logger (no error)
 *   TC-MTG-07: Tool name lookup is case-insensitive
 *   TC-MTG-08: Allowlist matching is case-insensitive
 *   TC-MTG-09: Exec wrapper is blocked even when added to the allowlist
 *   TC-MTG-10: Audit log entries contain all required fields
 *   TC-MTG-11: Verified field is conditionally included in audit log
 */

import { describe, it, expect, vi } from 'vitest';
import {
  MCPToolGate,
  type MCPToolGateDecision,
  type GateContext,
} from './mcp-tool-gate.js';
import { REGISTRY, ActionClass } from '@openclaw/action-registry';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function ctx(overrides?: Partial<GateContext>): GateContext {
  return {
    agentId: 'test-agent',
    channel: 'test-channel',
    ...overrides,
  };
}

function makeMockLogger() {
  const log = vi.fn().mockResolvedValue(undefined);
  return { log };
}

// ─── TC-MTG-01: Registered non-exec tools are permitted ───────────────────────

describe('TC-MTG-01: registered non-exec tools are permitted', () => {
  const gate = new MCPToolGate();

  it('permits "read_file" (filesystem.read)', async () => {
    const d = await gate.evaluate('read_file', ctx());
    expect(d.effect).toBe('permit');
    expect(d.actionClass).toBe('filesystem.read');
    expect(d.risk).toBe('low');
    expect(d.hitlMode).toBe('none');
    expect(d.reason).toBe('registered_tool');
    expect(d.registered).toBe(true);
    expect(d.allowlisted).toBe(false);
  });

  it('permits "write_file" (filesystem.write)', async () => {
    const d = await gate.evaluate('write_file', ctx());
    expect(d.effect).toBe('permit');
    expect(d.actionClass).toBe('filesystem.write');
    expect(d.risk).toBe('medium');
    expect(d.hitlMode).toBe('per_request');
    expect(d.reason).toBe('registered_tool');
  });

  it('permits "list_dir" (filesystem.list)', async () => {
    const d = await gate.evaluate('list_dir', ctx());
    expect(d.effect).toBe('permit');
    expect(d.actionClass).toBe('filesystem.list');
    expect(d.registered).toBe(true);
  });

  it('permits "delete_file" (filesystem.delete)', async () => {
    const d = await gate.evaluate('delete_file', ctx());
    expect(d.effect).toBe('permit');
    expect(d.actionClass).toBe('filesystem.delete');
    expect(d.registered).toBe(true);
  });

  it('permits all registered aliases that are not shell.exec', async () => {
    for (const entry of REGISTRY) {
      if (entry.action_class === ActionClass.ShellExec) continue;
      if (entry.action_class === ActionClass.UnknownSensitiveAction) continue;
      for (const alias of entry.aliases) {
        const d = await gate.evaluate(alias, ctx());
        expect(d.effect, `Expected permit for alias "${alias}" (${entry.action_class})`).toBe('permit');
        expect(d.actionClass).toBe(entry.action_class);
        expect(d.registered).toBe(true);
      }
    }
  });
});

// ─── TC-MTG-02: Unregistered tools are forbidden by default (E-07) ────────────

describe('TC-MTG-02: unregistered tools are forbidden by default (E-07)', () => {
  const gate = new MCPToolGate();

  it('forbids a made-up tool name', async () => {
    const d = await gate.evaluate('my_unknown_mcp_tool', ctx());
    expect(d.effect).toBe('forbid');
    expect(d.actionClass).toBe(ActionClass.UnknownSensitiveAction);
    expect(d.risk).toBe('critical');
    expect(d.hitlMode).toBe('per_request');
    expect(d.reason).toBe('unregistered_tool');
    expect(d.registered).toBe(false);
    expect(d.allowlisted).toBe(false);
  });

  it('forbids "exec" as a registered exec wrapper alias', async () => {
    const d = await gate.evaluate('exec', ctx());
    expect(d.effect).toBe('forbid');
    expect(d.actionClass).toBe(ActionClass.ShellExec);
    expect(d.reason).toBe('exec_wrapper_blocked');
    expect(d.registered).toBe(true);
  });

  it('forbids "sh" (not a registered alias in the registry)', async () => {
    const d = await gate.evaluate('sh', ctx());
    expect(d.effect).toBe('forbid');
    expect(d.reason).toBe('unregistered_tool');
  });

  it('forbids an empty string', async () => {
    const d = await gate.evaluate('', ctx());
    expect(d.effect).toBe('forbid');
    expect(d.reason).toBe('unregistered_tool');
  });

  it('unregistered tool resolves to unknown_sensitive_action with critical risk', async () => {
    const d = await gate.evaluate('totally_unknown_tool_xyz', ctx());
    expect(d.actionClass).toBe('unknown_sensitive_action');
    expect(d.risk).toBe('critical');
    expect(d.hitlMode).toBe('per_request');
  });
});

// ─── TC-MTG-03: Operator allowlist permits unregistered tools ─────────────────

describe('TC-MTG-03: operator allowlist permits unregistered tools', () => {
  const gate = new MCPToolGate({ allowlist: ['my_custom_mcp_tool', 'vendor_analytics'] });

  it('permits an allowlisted unregistered tool', async () => {
    const d = await gate.evaluate('my_custom_mcp_tool', ctx());
    expect(d.effect).toBe('permit');
    expect(d.actionClass).toBe(ActionClass.UnknownSensitiveAction);
    expect(d.risk).toBe('critical');
    expect(d.hitlMode).toBe('per_request');
    expect(d.reason).toBe('operator_allowlisted');
    expect(d.registered).toBe(false);
    expect(d.allowlisted).toBe(true);
  });

  it('permits a second allowlisted tool', async () => {
    const d = await gate.evaluate('vendor_analytics', ctx());
    expect(d.effect).toBe('permit');
    expect(d.reason).toBe('operator_allowlisted');
    expect(d.allowlisted).toBe(true);
  });

  it('still forbids tools not on the allowlist', async () => {
    const d = await gate.evaluate('not_on_allowlist', ctx());
    expect(d.effect).toBe('forbid');
    expect(d.reason).toBe('unregistered_tool');
    expect(d.allowlisted).toBe(false);
  });

  it('accepts a ReadonlySet as the allowlist', async () => {
    const setGate = new MCPToolGate({ allowlist: new Set(['set_based_tool']) });
    const d = await setGate.evaluate('set_based_tool', ctx());
    expect(d.effect).toBe('permit');
    expect(d.reason).toBe('operator_allowlisted');
  });

  it('allowlisted tools resolve to unknown_sensitive_action (not their own class)', async () => {
    const d = await gate.evaluate('my_custom_mcp_tool', ctx());
    expect(d.actionClass).toBe('unknown_sensitive_action');
  });
});

// ─── TC-MTG-04: Exec wrapper tools are forbidden (E-03) ───────────────────────

describe('TC-MTG-04: exec wrapper tools resolve to shell.exec and are forbidden (E-03)', () => {
  const gate = new MCPToolGate();

  const execWrapperAliases = [
    'bash',
    'exec',
    'shell_exec',
    'run_command',
    'execute_command',
    'run_terminal_cmd',
    'terminal_exec',
    'cmd',
  ];

  for (const alias of execWrapperAliases) {
    it(`forbids registered exec alias "${alias}"`, async () => {
      const d = await gate.evaluate(alias, ctx());
      expect(d.effect).toBe('forbid');
      expect(d.actionClass).toBe(ActionClass.ShellExec);
      expect(d.reason).toBe('exec_wrapper_blocked');
      expect(d.registered).toBe(true);
      expect(d.allowlisted).toBe(false);
    });
  }

  it('exec_wrapper_blocked carries shell.exec risk level (high)', async () => {
    const d = await gate.evaluate('bash', ctx());
    expect(d.risk).toBe('high');
    expect(d.hitlMode).toBe('per_request');
  });
});

// ─── TC-MTG-05: Audit logging records all gate decisions ──────────────────────

describe('TC-MTG-05: audit logging records all gate decisions', () => {
  it('logs a permit decision for a registered tool', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ logger });
    await gate.evaluate('read_file', ctx({ agentId: 'agent-42', channel: 'prod' }));
    expect(logger.log).toHaveBeenCalledOnce();
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['effect']).toBe('permit');
    expect(entry['reason']).toBe('registered_tool');
  });

  it('logs a forbid decision for an unregistered tool', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ logger });
    await gate.evaluate('unknown_tool', ctx());
    expect(logger.log).toHaveBeenCalledOnce();
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['effect']).toBe('forbid');
    expect(entry['reason']).toBe('unregistered_tool');
  });

  it('logs a forbid decision for an exec wrapper (E-03)', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ logger });
    await gate.evaluate('bash', ctx());
    expect(logger.log).toHaveBeenCalledOnce();
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['effect']).toBe('forbid');
    expect(entry['reason']).toBe('exec_wrapper_blocked');
  });

  it('logs a permit decision for an allowlisted unregistered tool', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ allowlist: ['custom_tool'], logger });
    await gate.evaluate('custom_tool', ctx());
    expect(logger.log).toHaveBeenCalledOnce();
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['effect']).toBe('permit');
    expect(entry['reason']).toBe('operator_allowlisted');
  });

  it('logs once per evaluate call', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ logger });
    await gate.evaluate('read_file', ctx());
    await gate.evaluate('unknown_tool', ctx());
    expect(logger.log).toHaveBeenCalledTimes(2);
  });
});

// ─── TC-MTG-06: Gate operates without a logger (no error) ─────────────────────

describe('TC-MTG-06: gate operates without a logger', () => {
  it('does not throw when no logger is supplied', async () => {
    const gate = new MCPToolGate();
    await expect(gate.evaluate('read_file', ctx())).resolves.toBeDefined();
  });

  it('still returns a valid decision without a logger', async () => {
    const gate = new MCPToolGate();
    const d = await gate.evaluate('unknown_tool', ctx());
    expect(d.effect).toBe('forbid');
    expect(d.reason).toBe('unregistered_tool');
  });

  it('empty options object does not throw', () => {
    expect(() => new MCPToolGate({})).not.toThrow();
  });

  it('no arguments constructor does not throw', () => {
    expect(() => new MCPToolGate()).not.toThrow();
  });
});

// ─── TC-MTG-07: Tool name lookup is case-insensitive ──────────────────────────

describe('TC-MTG-07: tool name lookup is case-insensitive', () => {
  const gate = new MCPToolGate();

  it('uppercased registered alias is permitted', async () => {
    const d = await gate.evaluate('READ_FILE', ctx());
    expect(d.effect).toBe('permit');
    expect(d.actionClass).toBe('filesystem.read');
  });

  it('mixed-case registered alias is permitted', async () => {
    const d = await gate.evaluate('Read_File', ctx());
    expect(d.effect).toBe('permit');
    expect(d.actionClass).toBe('filesystem.read');
  });

  it('uppercased exec wrapper is blocked (E-03)', async () => {
    const d = await gate.evaluate('BASH', ctx());
    expect(d.effect).toBe('forbid');
    expect(d.reason).toBe('exec_wrapper_blocked');
  });

  it('mixed-case exec wrapper is blocked (E-03)', async () => {
    const d = await gate.evaluate('Shell_Exec', ctx());
    expect(d.effect).toBe('forbid');
    expect(d.reason).toBe('exec_wrapper_blocked');
  });
});

// ─── TC-MTG-08: Allowlist matching is case-insensitive ────────────────────────

describe('TC-MTG-08: allowlist matching is case-insensitive', () => {
  it('uppercase allowlist entry matches lowercase evaluate input', async () => {
    const gate = new MCPToolGate({ allowlist: ['MyCustomTool'] });
    const d = await gate.evaluate('mycustomtool', ctx());
    expect(d.effect).toBe('permit');
    expect(d.reason).toBe('operator_allowlisted');
  });

  it('lowercase allowlist entry matches uppercase evaluate input', async () => {
    const gate = new MCPToolGate({ allowlist: ['mycustomtool'] });
    const d = await gate.evaluate('MYCUSTOMTOOL', ctx());
    expect(d.effect).toBe('permit');
    expect(d.reason).toBe('operator_allowlisted');
  });

  it('mixed-case allowlist entry matches mixed-case evaluate input', async () => {
    const gate = new MCPToolGate({ allowlist: ['VendorTool'] });
    const d = await gate.evaluate('vendortool', ctx());
    expect(d.effect).toBe('permit');
    expect(d.reason).toBe('operator_allowlisted');
  });
});

// ─── TC-MTG-09: Exec wrapper is blocked even when added to the allowlist ───────

describe('TC-MTG-09: exec wrapper is blocked even when added to the allowlist', () => {
  it('bash on the allowlist is still forbidden (E-03 fires before allowlist)', async () => {
    const gate = new MCPToolGate({ allowlist: ['bash'] });
    const d = await gate.evaluate('bash', ctx());
    // bash is a registered alias for shell.exec, so E-03 fires first
    expect(d.effect).toBe('forbid');
    expect(d.reason).toBe('exec_wrapper_blocked');
    expect(d.allowlisted).toBe(false);
  });

  it('run_command on the allowlist is still forbidden (E-03)', async () => {
    const gate = new MCPToolGate({ allowlist: ['run_command'] });
    const d = await gate.evaluate('run_command', ctx());
    expect(d.effect).toBe('forbid');
    expect(d.reason).toBe('exec_wrapper_blocked');
  });
});

// ─── TC-MTG-10: Audit log entries contain all required fields ─────────────────

describe('TC-MTG-10: audit log entries contain all required fields', () => {
  it('permit entry contains all required PolicyDecisionEntry fields', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ logger });
    await gate.evaluate('read_file', ctx({ agentId: 'agent-99', channel: 'mcp' }));
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['ts']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry['type']).toBe('policy');
    expect(entry['effect']).toBe('permit');
    expect(entry['resource']).toBe('tool');
    expect(entry['match']).toBe('read_file');
    expect(entry['reason']).toBe('registered_tool');
    expect(entry['agentId']).toBe('agent-99');
    expect(entry['channel']).toBe('mcp');
    expect(entry['toolName']).toBe('read_file');
    expect(entry['actionClass']).toBe('filesystem.read');
    expect(entry['stage']).toBe('stage1-trust');
  });

  it('forbid entry for unregistered tool contains correct fields', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ logger });
    await gate.evaluate('evil_tool', ctx({ agentId: 'agent-1', channel: 'default' }));
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['effect']).toBe('forbid');
    expect(entry['actionClass']).toBe('unknown_sensitive_action');
    expect(entry['reason']).toBe('unregistered_tool');
    expect(entry['toolName']).toBe('evil_tool');
    expect(entry['match']).toBe('evil_tool');
  });

  it('exec wrapper block entry contains shell.exec as actionClass', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ logger });
    await gate.evaluate('bash', ctx());
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['effect']).toBe('forbid');
    expect(entry['actionClass']).toBe('shell.exec');
    expect(entry['reason']).toBe('exec_wrapper_blocked');
  });

  it('allowlisted tool entry contains unknown_sensitive_action as actionClass', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ allowlist: ['vendor_tool'], logger });
    await gate.evaluate('vendor_tool', ctx());
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['effect']).toBe('permit');
    expect(entry['actionClass']).toBe('unknown_sensitive_action');
    expect(entry['reason']).toBe('operator_allowlisted');
  });
});

// ─── TC-MTG-11: Verified field is conditionally included in audit log ─────────

describe('TC-MTG-11: verified field is conditionally included in audit log', () => {
  it('verified is included when provided in context', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ logger });
    await gate.evaluate('read_file', ctx({ verified: true }));
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['verified']).toBe(true);
  });

  it('verified: false is included when explicitly false', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ logger });
    await gate.evaluate('read_file', ctx({ verified: false }));
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['verified']).toBe(false);
  });

  it('verified is absent from audit log when not provided', async () => {
    const logger = makeMockLogger();
    const gate = new MCPToolGate({ logger });
    await gate.evaluate('read_file', ctx());
    const entry = logger.log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(entry, 'verified')).toBe(false);
  });
});

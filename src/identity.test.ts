import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentIdentityRegistry,
  defaultAgentIdentityRegistry,
} from './identity.js';

describe('AgentIdentityRegistry', () => {
  let registry: AgentIdentityRegistry;

  beforeEach(() => {
    registry = new AgentIdentityRegistry();
  });

  describe('verify', () => {
    it('returns verified:true when registry is empty (backwards compat)', () => {
      const result = registry.verify('any-agent', 'any-channel');
      expect(result.verified).toBe(true);
    });

    it('returns verified:false when agent is not registered', () => {
      registry.register({ agentId: 'admin-1', allowedChannels: ['admin', 'default'] });
      const result = registry.verify('unknown-agent', 'default');
      expect(result.verified).toBe(false);
    });

    it('returns verified:true when agent is registered and channel matches', () => {
      registry.register({ agentId: 'admin-1', allowedChannels: ['admin', 'default'] });
      const result = registry.verify('admin-1', 'admin');
      expect(result.verified).toBe(true);
      expect(result.registeredAgent).toBeDefined();
      expect(result.registeredAgent!.agentId).toBe('admin-1');
    });

    it('returns verified:false when agent is registered but channel is not allowed', () => {
      registry.register({ agentId: 'admin-1', allowedChannels: ['admin'] });
      const result = registry.verify('admin-1', 'default');
      expect(result.verified).toBe(false);
      expect(result.registeredAgent).toBeUndefined();
    });

    it('returns verified:false for spoofed agentId prefix', () => {
      registry.register({ agentId: 'admin-1', allowedChannels: ['admin', 'default'] });
      const result = registry.verify('admin-evil', 'admin');
      expect(result.verified).toBe(false);
    });

    it('returns verified:false for spoofed channelId', () => {
      registry.register({ agentId: 'agent-1', allowedChannels: ['default'] });
      const result = registry.verify('agent-1', 'admin');
      expect(result.verified).toBe(false);
    });

    it('carries the registered role through the result', () => {
      registry.register({ agentId: 'support-bot', allowedChannels: ['support'], role: 'support' });
      const result = registry.verify('support-bot', 'support');
      expect(result.registeredAgent?.role).toBe('support');
    });
  });

  describe('buildRuleContext', () => {
    it('sets verified:true when identity is verified', () => {
      registry.register({ agentId: 'admin-1', allowedChannels: ['admin', 'default'] });
      const ctx = registry.buildRuleContext('admin-1', 'admin');
      expect(ctx.verified).toBe(true);
      expect(ctx.agentId).toBe('admin-1');
      expect(ctx.channel).toBe('admin');
    });

    it('sets verified:false when identity is not verified', () => {
      registry.register({ agentId: 'admin-1', allowedChannels: ['admin'] });
      const ctx = registry.buildRuleContext('admin-1', 'default');
      expect(ctx.verified).toBe(false);
    });

    it('sets verified:true when registry is empty', () => {
      const ctx = registry.buildRuleContext('any-agent', 'default');
      expect(ctx.verified).toBe(true);
    });

    it('passes through extras', () => {
      registry.register({ agentId: 'agent-1', allowedChannels: ['default'] });
      const ctx = registry.buildRuleContext('agent-1', 'default', {
        userId: 'user-123',
        sessionId: 'session-abc',
        metadata: { foo: 'bar' },
      });
      expect(ctx.verified).toBe(true);
      expect(ctx.userId).toBe('user-123');
      expect(ctx.sessionId).toBe('session-abc');
      expect(ctx.metadata).toEqual({ foo: 'bar' });
    });
  });

  describe('register / unregister / list', () => {
    it('rejects registration with an empty agentId', () => {
      expect(() => registry.register({ agentId: '', allowedChannels: ['c'] })).toThrow();
    });

    it('rejects registration with an empty allowedChannels list', () => {
      expect(() => registry.register({ agentId: 'a', allowedChannels: [] })).toThrow();
    });

    it('registerMany adds every agent', () => {
      registry.registerMany([
        { agentId: 'a', allowedChannels: ['default'] },
        { agentId: 'b', allowedChannels: ['admin'] },
      ]);
      expect(registry.size).toBe(2);
    });

    it('re-registering the same agentId replaces the entry', () => {
      registry.register({ agentId: 'a', allowedChannels: ['default'] });
      registry.register({ agentId: 'a', allowedChannels: ['admin'] });
      expect(registry.verify('a', 'default').verified).toBe(false);
      expect(registry.verify('a', 'admin').verified).toBe(true);
    });

    it('unregister removes the entry and returns true', () => {
      registry.register({ agentId: 'a', allowedChannels: ['default'] });
      expect(registry.unregister('a')).toBe(true);
      expect(registry.unregister('a')).toBe(false);
      expect(registry.size).toBe(0);
    });

    it('get returns the registered agent or undefined', () => {
      registry.register({ agentId: 'a', allowedChannels: ['default'], role: 'support' });
      expect(registry.get('a')?.role).toBe('support');
      expect(registry.get('missing')).toBeUndefined();
    });

    it('list returns a snapshot of every registered agent', () => {
      registry.register({ agentId: 'a', allowedChannels: ['default'] });
      registry.register({ agentId: 'b', allowedChannels: ['admin'] });
      const entries = registry.list();
      expect(entries.map((e) => e.agentId).sort()).toEqual(['a', 'b']);
    });

    it('clear empties the registry', () => {
      registry.register({ agentId: 'a', allowedChannels: ['default'] });
      registry.clear();
      expect(registry.size).toBe(0);
    });
  });

  describe('spoofing scenarios (V-03)', () => {
    beforeEach(() => {
      registry.register({ agentId: 'support-bot', allowedChannels: ['support'], role: 'support' });
    });

    it('blocks an attacker claiming "admin-evil" on the admin channel', () => {
      const result = registry.verify('admin-evil', 'admin');
      expect(result.verified).toBe(false);
    });

    it('blocks moving a legitimate agent onto a channel it is not allowed on', () => {
      const result = registry.verify('support-bot', 'admin');
      expect(result.verified).toBe(false);
    });

    it('allows the legitimate agent on its registered channel', () => {
      const result = registry.verify('support-bot', 'support');
      expect(result.verified).toBe(true);
    });
  });

  describe('defaultAgentIdentityRegistry', () => {
    it('exports a shared singleton', () => {
      expect(defaultAgentIdentityRegistry).toBeInstanceOf(AgentIdentityRegistry);
    });
  });
});

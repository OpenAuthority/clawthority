/**
 * Demo application for RuleDeleteModal and BatchApprovalPanel.
 *
 * Shows a simple rule list where each rule has a Delete button that opens
 * the RuleDeleteModal with sample audit hits. Demonstrates all field types:
 * action-class rule, intent-group rule, resource rule, and a rule with
 * target_match and target_in.
 *
 * Also demonstrates the BatchApprovalPanel for bulk HITL approval decisions.
 */

import { useCallback, useState } from 'react';
import { BatchApprovalPanel } from './components/BatchApprovalPanel.js';
import { LegacyRulesWidget } from './components/LegacyRulesWidget.js';
import { RuleDeleteModal } from './components/RuleDeleteModal.js';
import { UnclassifiedToolWidget } from './components/UnclassifiedToolWidget.js';
import { UnsafeLegacyToolsWidget } from './components/UnsafeLegacyToolsWidget.js';
import type { AuditHit, BatchAuditEntry, BatchingConfig, LegacyRulesWidgetData, PendingApprovalItem, Rule, UnclassifiedWidgetData, UnsafeLegacyToolsData } from './types.js';

// ─── Demo data ────────────────────────────────────────────────────────────────

interface DemoRule {
  id: string;
  rule: Rule;
  auditHits: AuditHit[];
}

const DEMO_RULES: DemoRule[] = [
  {
    id: 'rule-1',
    rule: {
      effect: 'forbid',
      action_class: 'filesystem.delete',
      reason: 'Block all file deletion operations',
      tags: ['filesystem', 'security'],
      priority: 90,
    },
    auditHits: [
      { timestamp: '2024-03-15T14:23:01Z', action: 'rm_rf', effect: 'forbid', agentId: 'agent-1' },
      { timestamp: '2024-03-15T09:10:00Z', action: 'delete', effect: 'forbid' },
      {
        timestamp: '2024-03-14T22:05:33Z',
        action: 'filesystem.delete',
        effect: 'forbid',
        agentId: 'agent-2',
      },
    ],
  },
  {
    id: 'rule-2',
    rule: {
      effect: 'forbid',
      intent_group: 'data_exfiltration',
      reason: 'Prevent data exfiltration attempts',
      tags: ['data', 'exfiltration', 'high-risk'],
    },
    auditHits: [
      {
        timestamp: '2024-03-13T11:00:00Z',
        action: 'send_email',
        effect: 'forbid',
        agentId: 'agent-3',
      },
    ],
  },
  {
    id: 'rule-3',
    rule: {
      effect: 'permit',
      resource: 'file',
      match: '/tmp/*',
      target_match: '*.log',
    },
    auditHits: [],
  },
  {
    id: 'rule-4',
    rule: {
      effect: 'forbid',
      resource: 'external',
      target_in: ['evil.example.com', 'badactor.io'],
      reason: 'Block known malicious domains',
      tags: ['network', 'blocklist'],
    },
    auditHits: [
      {
        timestamp: '2024-03-15T08:45:12Z',
        action: 'http_request',
        effect: 'forbid',
        agentId: 'agent-1',
      },
    ],
  },
];

// ─── Rule row component ───────────────────────────────────────────────────────

interface RuleRowProps {
  demoRule: DemoRule;
  onDeleteClick: (id: string) => void;
}

function RuleRow({ demoRule, onDeleteClick }: RuleRowProps) {
  const { rule, auditHits } = demoRule;

  const primaryField = (() => {
    if (rule.action_class !== undefined) return `action_class: ${rule.action_class}`;
    if (rule.intent_group !== undefined) return `intent_group: ${rule.intent_group}`;
    if (rule.resource !== undefined) {
      const suffix = rule.match !== undefined ? ` / ${rule.match}` : '';
      return `resource: ${rule.resource}${suffix}`;
    }
    return 'unconditional';
  })();

  return (
    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
      <td style={{ padding: '0.75rem 1rem' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '0.15em 0.5em',
            borderRadius: '3px',
            fontSize: '0.75rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            background: rule.effect === 'forbid' ? '#fee2e2' : '#d1fae5',
            color: rule.effect === 'forbid' ? '#b91c1c' : '#065f46',
          }}
        >
          {rule.effect}
        </span>
      </td>
      <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.875rem' }}>
        {primaryField}
      </td>
      <td style={{ padding: '0.75rem 1rem', color: '#6b7280', fontSize: '0.8125rem' }}>
        {rule.reason ?? '—'}
      </td>
      <td style={{ padding: '0.75rem 1rem', color: '#6b7280', fontSize: '0.8125rem' }}>
        {auditHits.length > 0 ? `${auditHits.length} recent` : 'No recent hits'}
      </td>
      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
        <button
          onClick={() => onDeleteClick(demoRule.id)}
          style={{
            padding: '0.35rem 0.75rem',
            background: '#fee2e2',
            color: '#b91c1c',
            border: '1px solid #fca5a5',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '0.8125rem',
            fontWeight: 500,
          }}
          type="button"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

// ─── Demo data: batch approvals ───────────────────────────────────────────────

const now = Date.now();

const DEMO_PENDING_ITEMS: PendingApprovalItem[] = [
  {
    token: 'tok-001',
    toolName: 'bash',
    agentId: 'agent-alpha',
    channelId: 'telegram',
    policyName: 'require-hitl-fs-delete',
    fallback: 'deny',
    createdAt: now - 30_000,
    timeoutMs: 120_000,
    action_class: 'filesystem.delete',
    target: '/var/data/report-2024.csv',
    summary: 'Delete quarterly report CSV',
  },
  {
    token: 'tok-002',
    toolName: 'bash',
    agentId: 'agent-beta',
    channelId: 'slack',
    policyName: 'require-hitl-fs-delete',
    fallback: 'deny',
    createdAt: now - 15_000,
    timeoutMs: 120_000,
    action_class: 'filesystem.delete',
    target: '/var/data/backup-2024-q3.tar.gz',
    summary: 'Remove Q3 backup archive',
  },
  {
    token: 'tok-003',
    toolName: 'send_email',
    agentId: 'agent-alpha',
    channelId: 'telegram',
    policyName: 'require-hitl-email',
    fallback: 'deny',
    createdAt: now - 60_000,
    timeoutMs: 300_000,
    action_class: 'email.send',
    target: 'cto@example.com',
    summary: 'Send incident report to CTO',
    session_id: 'sess-abc123',
  },
  {
    token: 'tok-004',
    toolName: 'http_request',
    agentId: 'agent-gamma',
    channelId: 'telegram',
    policyName: 'require-hitl-external',
    fallback: 'auto-approve',
    createdAt: now - 5_000,
    timeoutMs: 60_000,
    action_class: 'web.request',
    target: 'https://api.payments.example.com/charge',
    summary: 'POST payment charge request',
  },
  {
    token: 'tok-005',
    toolName: 'bash',
    agentId: 'agent-beta',
    channelId: 'slack',
    policyName: 'require-hitl-fs-delete',
    fallback: 'deny',
    createdAt: now - 90_000,
    timeoutMs: 120_000,
    action_class: 'filesystem.delete',
    target: '/tmp/scratch-files/*',
    summary: 'Clean up scratch directory',
    session_id: 'sess-def456',
  },
];

const DEFAULT_BATCHING_CONFIG: BatchingConfig = {
  groupBy: 'action_class',
  autoGroupThreshold: 2,
  sessionScope: null,
  maxBatchSize: 0,
};

// ─── Demo data: unclassified tool widget ──────────────────────────────────────

/** Generates N days of demo data going back from today. */
function buildDemoUnclassifiedData(): UnclassifiedWidgetData {
  const today = new Date();
  const days = 30;
  const tools = ['custom_scraper', 'shell_exec', 'fetch_url', 'run_code', 'unknown_op'];

  // Simulate daily counts per tool (seeded, not truly random for determinism)
  const seriesMap = new Map<string, number>();
  const toolSeriesMap = new Map<string, Map<string, number>>();

  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(today.getTime() - d * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    let dayTotal = 0;

    for (const tool of tools) {
      // Deterministic pseudo-count based on tool index and day offset
      const toolIdx = tools.indexOf(tool);
      const count =
        d % 3 === 0 ? toolIdx + 1 : d % 5 === 0 ? toolIdx * 2 : toolIdx > 2 ? 1 : 0;
      if (count === 0) continue;

      dayTotal += count;
      seriesMap.set(date, (seriesMap.get(date) ?? 0) + count);

      const tMap = toolSeriesMap.get(tool) ?? new Map<string, number>();
      tMap.set(date, (tMap.get(date) ?? 0) + count);
      toolSeriesMap.set(tool, tMap);
    }
    if (dayTotal === 0) {
      // Ensure at least some data points have zero gaps (skip empty dates)
    }
  }

  const series = [...seriesMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const breakdown = [...toolSeriesMap.entries()]
    .map(([toolName, tMap]) => ({
      toolName,
      count: [...tMap.values()].reduce((a, b) => a + b, 0),
      series: [...tMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
    }))
    .sort((a, b) => b.count - a.count);

  const totalCount = breakdown.reduce((acc, b) => acc + b.count, 0);
  const from = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const to = today.toISOString().slice(0, 10);

  return { series, breakdown, totalCount, dateRange: { from, to } };
}

const DEMO_UNCLASSIFIED_DATA: UnclassifiedWidgetData = buildDemoUnclassifiedData();

// ─── Demo data: legacy rules widget ───────────────────────────────────────────

/** Generates 30 days of demo Rules 4–8 data with 5 trailing zero days. */
function buildDemoLegacyRulesData(): LegacyRulesWidgetData {
  const today = new Date();
  const days = 30;
  const rules = [4, 5, 6, 7, 8];
  // Last 5 days intentionally have 0 hits to demonstrate consecutive-zero tracking
  const trailingZeroDays = 5;

  const seriesMap = new Map<string, number>();
  const ruleSeriesMap = new Map<number, Map<string, number>>();

  for (let d = days - 1; d >= trailingZeroDays; d--) {
    const date = new Date(today.getTime() - d * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    for (const rule of rules) {
      const ruleOffset = rule - 4;
      const count =
        d % 7 === 0 ? ruleOffset + 2 : d % 3 === 0 ? ruleOffset + 1 : ruleOffset > 1 ? 1 : 0;
      if (count === 0) continue;

      seriesMap.set(date, (seriesMap.get(date) ?? 0) + count);

      const rMap = ruleSeriesMap.get(rule) ?? new Map<string, number>();
      rMap.set(date, (rMap.get(date) ?? 0) + count);
      ruleSeriesMap.set(rule, rMap);
    }
  }

  const series = [...seriesMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const byRule = rules
    .filter((rule) => ruleSeriesMap.has(rule))
    .map((rule) => {
      const rMap = ruleSeriesMap.get(rule)!;
      return {
        rule,
        count: [...rMap.values()].reduce((a, b) => a + b, 0),
        series: [...rMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({ date, count })),
      };
    })
    .sort((a, b) => b.count - a.count);

  const totalCount = byRule.reduce((acc, b) => acc + b.count, 0);
  const from = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const to = today.toISOString().slice(0, 10);

  return { series, byRule, totalCount, dateRange: { from, to }, consecutiveZeroDays: trailingZeroDays };
}

const DEMO_LEGACY_RULES_DATA: LegacyRulesWidgetData = buildDemoLegacyRulesData();

// ─── Demo data: unsafe legacy tools widget ────────────────────────────────────

const today = new Date();
const isoToday = today.toISOString().slice(0, 10);

function offsetDate(days: number): string {
  const d = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const DEMO_UNSAFE_LEGACY_TOOLS_DATA: UnsafeLegacyToolsData = {
  tools: [
    {
      skillName: 'deploy_infra',
      actionClass: 'shell.exec',
      deadline: offsetDate(-14),
      reason: 'Terraform wrapper pending action-class migration',
      daysRemaining: -14,
      status: 'overdue',
      manifestPath: 'skills/deploy_infra/SKILL.md',
    },
    {
      skillName: 'run_migrations',
      actionClass: 'shell.exec',
      deadline: isoToday,
      reason: null,
      daysRemaining: 0,
      status: 'urgent',
      manifestPath: 'skills/run_migrations/SKILL.md',
    },
    {
      skillName: 'build_docker',
      actionClass: 'shell.exec',
      deadline: offsetDate(12),
      reason: 'Docker CLI integration in progress (E-06)',
      daysRemaining: 12,
      status: 'urgent',
      manifestPath: 'skills/build_docker/SKILL.md',
    },
    {
      skillName: 'sync_s3',
      actionClass: 'shell.exec',
      deadline: offsetDate(25),
      reason: 'Awaiting storage.upload action class in action-registry',
      daysRemaining: 25,
      status: 'urgent',
      manifestPath: 'skills/sync_s3/SKILL.md',
    },
    {
      skillName: 'lint_codebase',
      actionClass: 'shell.exec',
      deadline: offsetDate(60),
      reason: 'Low-risk read-only lint runner; deadline extended by operator',
      daysRemaining: 60,
      status: 'ok',
      manifestPath: 'skills/lint_codebase/SKILL.md',
    },
    {
      skillName: 'legacy_report',
      actionClass: 'shell.exec',
      deadline: null,
      reason: null,
      daysRemaining: null,
      status: 'no-deadline',
      manifestPath: 'skills/legacy_report/SKILL.md',
    },
  ],
  totalCount: 6,
  overdueCount: 1,
  urgentCount: 3,
};

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules] = useState<DemoRule[]>(DEMO_RULES);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [pendingItems, setPendingItems] = useState<PendingApprovalItem[]>(DEMO_PENDING_ITEMS);
  const [batchConfig, setBatchConfig] = useState<BatchingConfig>(DEFAULT_BATCHING_CONFIG);
  const [auditLog, setAuditLog] = useState<BatchAuditEntry[]>([]);

  const [unclassifiedData, setUnclassifiedData] = useState<UnclassifiedWidgetData>(DEMO_UNCLASSIFIED_DATA);
  const [legacyRulesData, setLegacyRulesData] = useState<LegacyRulesWidgetData>(DEMO_LEGACY_RULES_DATA);
  const [unsafeLegacyData] = useState<UnsafeLegacyToolsData>(DEMO_UNSAFE_LEGACY_TOOLS_DATA);

  const pendingRule = rules.find((r) => r.id === pendingDeleteId) ?? null;

  function handleDeleteClick(id: string) {
    setPendingDeleteId(id);
  }

  function handleConfirm() {
    if (pendingDeleteId !== null) {
      setRules((prev) => prev.filter((r) => r.id !== pendingDeleteId));
      setPendingDeleteId(null);
    }
  }

  function handleCancel() {
    setPendingDeleteId(null);
  }

  const handleApprove = useCallback(
    (tokens: string[]) => {
      const resolved = pendingItems.filter((i) => tokens.includes(i.token));
      if (resolved.length === 0) return;

      // Group by the configured dimension for the audit entry
      const byKey = new Map<string, string[]>();
      for (const item of resolved) {
        let key: string;
        switch (batchConfig.groupBy) {
          case 'action_class':
            key = item.action_class || '(no action class)';
            break;
          case 'agent_id':
            key = item.agentId;
            break;
          case 'policy_name':
            key = item.policyName;
            break;
        }
        const g = byKey.get(key);
        if (g !== undefined) {
          g.push(item.token);
        } else {
          byKey.set(key, [item.token]);
        }
      }

      const newEntries: BatchAuditEntry[] = [...byKey.entries()].map(([groupKey, tkns]) => ({
        timestamp: new Date().toISOString(),
        decision: 'approved',
        count: tkns.length,
        groupKey,
        tokens: tkns,
      }));

      setPendingItems((prev) => prev.filter((i) => !tokens.includes(i.token)));
      setAuditLog((prev) => [...prev, ...newEntries]);
    },
    [pendingItems, batchConfig.groupBy],
  );

  const handleDeny = useCallback(
    (tokens: string[]) => {
      const resolved = pendingItems.filter((i) => tokens.includes(i.token));
      if (resolved.length === 0) return;

      const byKey = new Map<string, string[]>();
      for (const item of resolved) {
        let key: string;
        switch (batchConfig.groupBy) {
          case 'action_class':
            key = item.action_class || '(no action class)';
            break;
          case 'agent_id':
            key = item.agentId;
            break;
          case 'policy_name':
            key = item.policyName;
            break;
        }
        const g = byKey.get(key);
        if (g !== undefined) {
          g.push(item.token);
        } else {
          byKey.set(key, [item.token]);
        }
      }

      const newEntries: BatchAuditEntry[] = [...byKey.entries()].map(([groupKey, tkns]) => ({
        timestamp: new Date().toISOString(),
        decision: 'denied',
        count: tkns.length,
        groupKey,
        tokens: tkns,
      }));

      setPendingItems((prev) => prev.filter((i) => !tokens.includes(i.token)));
      setAuditLog((prev) => [...prev, ...newEntries]);
    },
    [pendingItems, batchConfig.groupBy],
  );

  // In a real integration these handlers would fetch from /api/audit/unclassified.
  // The demo re-filters the static dataset client-side.
  const handleUnclassifiedFilterChange = useCallback((from: string, to: string) => {
    const filtered = {
      ...DEMO_UNCLASSIFIED_DATA,
      series: DEMO_UNCLASSIFIED_DATA.series.filter((p) => p.date >= from && p.date <= to),
      breakdown: DEMO_UNCLASSIFIED_DATA.breakdown.map((b) => ({
        ...b,
        series: b.series.filter((p) => p.date >= from && p.date <= to),
        count: b.series.filter((p) => p.date >= from && p.date <= to).reduce((acc, p) => acc + p.count, 0),
      })).filter((b) => b.count > 0),
      totalCount: DEMO_UNCLASSIFIED_DATA.series
        .filter((p) => p.date >= from && p.date <= to)
        .reduce((acc, p) => acc + p.count, 0),
      dateRange: { from, to },
    };
    setUnclassifiedData(filtered);
  }, []);

  const handleUnclassifiedExport = useCallback(
    (_from: string, _to: string, _toolName?: string) => {
      // In a real integration: window.location.href = `/api/audit/unclassified?from=${_from}&to=${_to}${_toolName ? `&toolName=${encodeURIComponent(_toolName)}` : ''}&export=csv`
      alert('Export: in a live deployment this downloads unclassified-tools.csv from the audit API.');
    },
    [],
  );

  const handleLegacyRulesFilterChange = useCallback((from: string, to: string) => {
    const filtered: LegacyRulesWidgetData = {
      ...DEMO_LEGACY_RULES_DATA,
      series: DEMO_LEGACY_RULES_DATA.series.filter((p) => p.date >= from && p.date <= to),
      byRule: DEMO_LEGACY_RULES_DATA.byRule
        .map((b) => ({
          ...b,
          series: b.series.filter((p) => p.date >= from && p.date <= to),
          count: b.series
            .filter((p) => p.date >= from && p.date <= to)
            .reduce((acc, p) => acc + p.count, 0),
        }))
        .filter((b) => b.count > 0),
      totalCount: DEMO_LEGACY_RULES_DATA.series
        .filter((p) => p.date >= from && p.date <= to)
        .reduce((acc, p) => acc + p.count, 0),
      dateRange: { from, to },
      consecutiveZeroDays: DEMO_LEGACY_RULES_DATA.consecutiveZeroDays,
    };
    setLegacyRulesData(filtered);
  }, []);

  const handleLegacyRulesExport = useCallback(
    (_from: string, _to: string, _rule?: number) => {
      // In a real integration: window.location.href = `/api/audit/legacy-rules?from=${_from}&to=${_to}${_rule !== undefined ? `&rule=${_rule}` : ''}&export=csv`
      alert('Export: in a live deployment this downloads legacy-rules.csv from the audit API.');
    },
    [],
  );

  return (
    <div style={{ padding: '2rem', maxWidth: '960px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.25rem' }}>
        Clawthority — Policy Rules
      </h1>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Click Delete on any rule to see the deletion confirmation modal.
      </p>

      {rules.length === 0 ? (
        <p style={{ color: '#6b7280', fontStyle: 'italic' }}>All rules have been deleted.</p>
      ) : (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['Effect', 'Criteria', 'Reason', 'Activity', ''].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '0.625rem 1rem',
                      textAlign: h === '' ? 'right' : 'left',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: '#6b7280',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((dr) => (
                <RuleRow key={dr.id} demoRule={dr} onDeleteClick={handleDeleteClick} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingRule !== null && (
        <RuleDeleteModal
          rule={pendingRule.rule}
          auditHits={pendingRule.auditHits}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {/* ── Batch Approval Panel ──────────────────────────────────────────── */}
      <div style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
          Batch Approval Panel
        </h2>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Bulk approve or deny pending HITL requests to reduce operator fatigue.
        </p>

        {/* Config controls */}
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            fontSize: '0.8125rem',
            color: '#374151',
            alignItems: 'center',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            Group by:
            <select
              value={batchConfig.groupBy}
              onChange={(e) =>
                setBatchConfig((c) => ({
                  ...c,
                  groupBy: e.target.value as BatchingConfig['groupBy'],
                }))
              }
              style={{
                padding: '0.25rem 0.5rem',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '0.8125rem',
                background: '#fff',
              }}
            >
              <option value="action_class">Action class</option>
              <option value="agent_id">Agent ID</option>
              <option value="policy_name">Policy name</option>
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            Session scope:
            <select
              value={batchConfig.sessionScope ?? ''}
              onChange={(e) =>
                setBatchConfig((c) => ({
                  ...c,
                  sessionScope: e.target.value === '' ? null : e.target.value,
                }))
              }
              style={{
                padding: '0.25rem 0.5rem',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '0.8125rem',
                background: '#fff',
              }}
            >
              <option value="">All sessions</option>
              <option value="sess-abc123">sess-abc123</option>
              <option value="sess-def456">sess-def456</option>
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            Bulk-action threshold:
            <input
              type="number"
              min={1}
              max={20}
              value={batchConfig.autoGroupThreshold}
              onChange={(e) =>
                setBatchConfig((c) => ({
                  ...c,
                  autoGroupThreshold: Math.max(1, Number(e.target.value)),
                }))
              }
              style={{
                width: '4rem',
                padding: '0.25rem 0.5rem',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '0.8125rem',
                background: '#fff',
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => {
              setPendingItems(DEMO_PENDING_ITEMS.map((i) => ({ ...i, createdAt: Date.now() - (Date.now() - i.createdAt) })));
              setAuditLog([]);
            }}
            style={{
              padding: '0.3rem 0.75rem',
              background: '#e5e7eb',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.8125rem',
            }}
          >
            Reset demo
          </button>
        </div>

        <BatchApprovalPanel
          items={pendingItems}
          config={batchConfig}
          auditLog={auditLog}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      </div>

      {/* ── Unclassified Tool Count Widget ────────────────────────────────── */}
      <div style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
          Unclassified Tool Count
        </h2>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Tools that could not be mapped to a known action class. Click a tool row to drill down.
        </p>
        <UnclassifiedToolWidget
          data={unclassifiedData}
          onFilterChange={handleUnclassifiedFilterChange}
          onExport={handleUnclassifiedExport}
        />
      </div>

      {/* ── Legacy Rules 4–8 Usage Widget ─────────────────────────────────── */}
      <div style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
          Legacy Rules 4–8 Usage
        </h2>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Command-regex reclassification hits for deprecated rules. Track progress toward the
          retirement exit criterion: 0 hits for 30 consecutive days.
        </p>
        <LegacyRulesWidget
          data={legacyRulesData}
          onFilterChange={handleLegacyRulesFilterChange}
          onExport={handleLegacyRulesExport}
        />
      </div>

      {/* ── Unsafe Legacy Tools Widget ─────────────────────────────────────── */}
      <div style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
          Unsafe Legacy Tools
        </h2>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Skills with an <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>unsafe_legacy</code> exemption.
          Track deadlines and remediate overdue or urgent entries.
        </p>
        <UnsafeLegacyToolsWidget data={unsafeLegacyData} />
      </div>
    </div>
  );
}

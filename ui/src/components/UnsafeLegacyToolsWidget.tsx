/**
 * UnsafeLegacyToolsWidget
 *
 * Dashboard widget listing all skills with a truthy unsafe_legacy field in their
 * SKILL.md manifest. Shows deadline dates, days remaining, and urgency status.
 *
 * Data is passed in via props (fetched by the parent from
 * GET /api/skills/unsafe-legacy). Rows are pre-sorted by deadline proximity.
 *
 * Color coding:
 *   red   — overdue (deadline has passed)
 *   amber — urgent (fewer than 30 days remaining)
 *   green — ok (30+ days remaining)
 *   grey  — no-deadline (no parseable deadline set)
 */

import type { UnsafeLegacyTool, UnsafeLegacyToolsData, UnsafeLegacyStatus } from '../types.js';
import './UnsafeLegacyToolsWidget.css';

// ─── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<UnsafeLegacyStatus, string> = {
  overdue: 'Overdue',
  urgent: 'Urgent',
  ok: 'OK',
  'no-deadline': 'No deadline',
};

const STATUS_COLOR: Record<UnsafeLegacyStatus, { bg: string; text: string; border: string }> = {
  overdue:       { bg: '#fee2e2', text: '#b91c1c', border: '#fca5a5' },
  urgent:        { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  ok:            { bg: '#f0fdf4', text: '#14532d', border: '#86efac' },
  'no-deadline': { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' },
};

function formatDaysRemaining(daysRemaining: number | null, status: UnsafeLegacyStatus): string {
  if (daysRemaining === null || status === 'no-deadline') return '—';
  if (daysRemaining === 0) return 'Today';
  if (daysRemaining < 0) return `${Math.abs(daysRemaining)}d overdue`;
  return `${daysRemaining}d`;
}

// ─── Tool row ──────────────────────────────────────────────────────────────────

interface ToolRowProps {
  tool: UnsafeLegacyTool;
}

function ToolRow({ tool }: ToolRowProps) {
  const statusColors = STATUS_COLOR[tool.status];
  const daysLabel = formatDaysRemaining(tool.daysRemaining, tool.status);
  const isDaysUrgent = tool.status === 'overdue' || tool.status === 'urgent';

  return (
    <tr className="ult-table__row">
      {/* Skill name + manifest link */}
      <td className="ult-table__cell">
        <span className="ult-tool-name">{tool.skillName || '(unnamed)'}</span>
        <span
          className="ult-manifest-path"
          title={tool.manifestPath}
          aria-label={`Manifest: ${tool.manifestPath}`}
        >
          {tool.manifestPath}
        </span>
      </td>

      {/* Action class */}
      <td className="ult-table__cell ult-table__cell--mono">
        {tool.actionClass || '—'}
      </td>

      {/* Deadline */}
      <td className="ult-table__cell ult-table__cell--mono">
        {tool.deadline ?? '—'}
      </td>

      {/* Days remaining */}
      <td className={`ult-table__cell ult-table__cell--days${isDaysUrgent ? ' ult-table__cell--days-urgent' : ''}`}>
        {daysLabel}
      </td>

      {/* Status badge */}
      <td className="ult-table__cell ult-table__cell--status">
        <span
          className="ult-status-badge"
          style={{
            background: statusColors.bg,
            color: statusColors.text,
            borderColor: statusColors.border,
          }}
          aria-label={`Status: ${STATUS_LABEL[tool.status]}`}
        >
          {STATUS_LABEL[tool.status]}
        </span>
      </td>
    </tr>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

interface SummaryBarProps {
  totalCount: number;
  overdueCount: number;
  urgentCount: number;
}

function SummaryBar({ totalCount, overdueCount, urgentCount }: SummaryBarProps) {
  return (
    <div className="ult-summary" role="status" aria-label="Unsafe legacy tools summary">
      <span className="ult-summary__item">
        <strong>{totalCount}</strong> tool{totalCount !== 1 ? 's' : ''} total
      </span>
      {overdueCount > 0 && (
        <span
          className="ult-summary__badge ult-summary__badge--overdue"
          aria-label={`${overdueCount} overdue`}
        >
          {overdueCount} overdue
        </span>
      )}
      {urgentCount > 0 && (
        <span
          className="ult-summary__badge ult-summary__badge--urgent"
          aria-label={`${urgentCount} urgent`}
        >
          {urgentCount} urgent (&lt;30 days)
        </span>
      )}
    </div>
  );
}

// ─── Main widget ───────────────────────────────────────────────────────────────

export interface UnsafeLegacyToolsWidgetProps {
  /** Data from GET /api/skills/unsafe-legacy. */
  data: UnsafeLegacyToolsData;
  /** Called when the user requests a data refresh. */
  onRefresh?: () => void;
}

export function UnsafeLegacyToolsWidget({ data, onRefresh }: UnsafeLegacyToolsWidgetProps) {
  return (
    <section className="ult-root" aria-label="Unsafe legacy tools widget">
      {/* Header */}
      <div className="ult-header">
        <div className="ult-header__title-group">
          <h3 className="ult-header__title">Unsafe Legacy Tools</h3>
          <span className="ult-header__subtitle">
            Skills with <code className="ult-header__code">unsafe_legacy</code> exemptions — sorted by deadline proximity
          </span>
        </div>
        {onRefresh !== undefined && (
          <div className="ult-header__actions">
            <button
              type="button"
              className="ult-btn-refresh"
              onClick={onRefresh}
              aria-label="Refresh data from coverage map"
            >
              ↺ Refresh
            </button>
          </div>
        )}
      </div>

      {/* Summary counts */}
      <SummaryBar
        totalCount={data.totalCount}
        overdueCount={data.overdueCount}
        urgentCount={data.urgentCount}
      />

      {/* Tool table */}
      {data.tools.length === 0 ? (
        <div className="ult-empty" role="status">
          No skills with <code>unsafe_legacy</code> found.
        </div>
      ) : (
        <div className="ult-table-wrap">
          <table className="ult-table" aria-label="Unsafe legacy tools list">
            <thead>
              <tr className="ult-table__head-row">
                <th className="ult-table__head-cell">Skill / Manifest</th>
                <th className="ult-table__head-cell">Action class</th>
                <th className="ult-table__head-cell">Deadline</th>
                <th className="ult-table__head-cell">Days remaining</th>
                <th className="ult-table__head-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.tools.map((tool) => (
                <ToolRow key={tool.manifestPath} tool={tool} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

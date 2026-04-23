/**
 * LegacyRulesWidget
 *
 * Dashboard widget showing Rules 4–8 command-regex reclassification hit counts
 * over time with drill-down by rule number, date range filtering, exit-criterion
 * tracking, and CSV export.
 *
 * Data is passed in via props (fetched by the parent from
 * GET /api/audit/legacy-rules). Filtering by date range triggers onFilterChange
 * so the parent can refetch from the server.
 *
 * Exit criterion: 0 hits across all rules for 30 consecutive days. When met,
 * a green banner is displayed. Progress toward the criterion is shown otherwise.
 */

import { useCallback, useMemo, useState } from 'react';
import type { LegacyRulesDataPoint, LegacyRuleBreakdown, LegacyRulesWidgetData } from '../types.js';
import './LegacyRulesWidget.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const EXIT_CRITERION_DAYS = 30;

/** Human-readable label and colour for each rule. */
const RULE_META: Record<number, { label: string; color: string }> = {
  4: { label: 'Rule 4 — shell → filesystem.delete',  color: '#ef4444' },
  5: { label: 'Rule 5 — credential path detection',  color: '#f59e0b' },
  6: { label: 'Rule 6 — credential-emitting CLI',    color: '#eab308' },
  7: { label: 'Rule 7 — data exfiltration upload',   color: '#f97316' },
  8: { label: 'Rule 8 — env-var credential exfil',   color: '#d97706' },
};

function ruleColor(rule: number): string {
  return RULE_META[rule]?.color ?? '#6366f1';
}

function ruleShortLabel(rule: number): string {
  return `Rule ${rule}`;
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

const CHART_WIDTH = 600;
const CHART_HEIGHT = 200;
const MARGIN = { top: 14, right: 16, bottom: 52, left: 44 };
const INNER_W = CHART_WIDTH - MARGIN.left - MARGIN.right;
const INNER_H = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
const BAR_COLOR_DEFAULT = '#6366f1';
const BAR_COLOR_ACTIVE = '#4f46e5';
const GRID_COUNT = 4;

interface BarChartProps {
  series: LegacyRulesDataPoint[];
  activeRule: number | null;
  ariaLabel?: string;
}

function BarChart({ series, activeRule, ariaLabel }: BarChartProps) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const maxCount = useMemo(
    () => Math.max(1, ...series.map((p) => p.count)),
    [series],
  );

  const barWidth = series.length > 0 ? Math.max(4, INNER_W / series.length - 3) : 0;
  const step = series.length > 0 ? INNER_W / series.length : 0;

  const gridValues = useMemo(() => {
    const s = maxCount / GRID_COUNT;
    return Array.from({ length: GRID_COUNT + 1 }, (_, i) => Math.round(i * s));
  }, [maxCount]);

  if (series.length === 0) {
    return (
      <div className="lrw-chart-area--empty" role="img" aria-label="No data">
        No data for the selected range
      </div>
    );
  }

  const barFill = activeRule !== null ? ruleColor(activeRule) : BAR_COLOR_DEFAULT;
  const labelInterval = Math.max(1, Math.ceil(series.length / 8));

  return (
    <div className="lrw-chart-area">
      <svg
        className="lrw-chart-svg"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        width="100%"
        role="img"
        aria-label={ariaLabel ?? 'Legacy rules hit counts time series'}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Grid lines + Y labels */}
          {gridValues.map((val) => {
            const y = INNER_H - (val / maxCount) * INNER_H;
            return (
              <g key={val}>
                <line x1={0} y1={y} x2={INNER_W} y2={y} stroke="#e5e7eb" strokeWidth={1} />
                <text
                  x={-6}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="#9ca3af"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* X axis line */}
          <line x1={0} y1={INNER_H} x2={INNER_W} y2={INNER_H} stroke="#d1d5db" strokeWidth={1} />

          {/* Bars */}
          {series.map((point, i) => {
            const barH = Math.max(2, (point.count / maxCount) * INNER_H);
            const x = i * step + (step - barWidth) / 2;
            const y = INNER_H - barH;
            const isHovered = hoveredDate === point.date;
            const fill = isHovered ? BAR_COLOR_ACTIVE : barFill;

            return (
              <g key={point.date}>
                <rect
                  className="lrw-bar"
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barH}
                  fill={fill}
                  rx={2}
                  aria-label={`${point.date}: ${point.count} hit${point.count !== 1 ? 's' : ''}`}
                  onMouseEnter={() => setHoveredDate(point.date)}
                  onMouseLeave={() => setHoveredDate(null)}
                />

                {/* Hover tooltip */}
                {isHovered && (
                  <g>
                    <rect
                      x={Math.min(x + barWidth / 2 - 38, INNER_W - 80)}
                      y={y - 28}
                      width={80}
                      height={22}
                      rx={4}
                      fill="#1f2937"
                      opacity={0.9}
                    />
                    <text
                      x={Math.min(x + barWidth / 2 + 2, INNER_W - 40)}
                      y={y - 13}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#f9fafb"
                    >
                      {point.date}: {point.count}
                    </text>
                  </g>
                )}

                {/* X axis label (decimated) */}
                {i % labelInterval === 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={INNER_H + 14}
                    textAnchor="end"
                    fontSize={9}
                    fill="#9ca3af"
                    transform={`rotate(-40, ${x + barWidth / 2}, ${INNER_H + 14})`}
                  >
                    {point.date.slice(5)} {/* MM-DD */}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// ─── Exit criterion indicator ─────────────────────────────────────────────────

interface ExitCriterionBannerProps {
  consecutiveZeroDays: number;
}

function ExitCriterionBanner({ consecutiveZeroDays }: ExitCriterionBannerProps) {
  const met = consecutiveZeroDays >= EXIT_CRITERION_DAYS;
  const pct = Math.min(100, Math.round((consecutiveZeroDays / EXIT_CRITERION_DAYS) * 100));

  return (
    <div
      className={`lrw-exit-criterion${met ? ' lrw-exit-criterion--met' : ''}`}
      role="status"
      aria-label={
        met
          ? 'Exit criterion met'
          : `Exit criterion progress: ${consecutiveZeroDays} of ${EXIT_CRITERION_DAYS} consecutive zero days`
      }
    >
      <div className="lrw-exit-criterion__label">
        {met ? (
          <strong>Exit criterion met</strong>
        ) : (
          <>
            <strong>Exit criterion:</strong>{' '}
            {consecutiveZeroDays === 0
              ? 'hits recorded within the date range'
              : `${consecutiveZeroDays} / ${EXIT_CRITERION_DAYS} consecutive days with 0 hits`}
          </>
        )}
        {met && (
          <span className="lrw-exit-criterion__badge">
            0 hits for {consecutiveZeroDays}+ consecutive days — rules eligible for retirement
          </span>
        )}
      </div>
      {!met && (
        <div className="lrw-exit-criterion__track" aria-hidden="true">
          <div className="lrw-exit-criterion__fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

// ─── Breakdown panel ──────────────────────────────────────────────────────────

interface BreakdownPanelProps {
  byRule: LegacyRuleBreakdown[];
  totalCount: number;
  activeRule: number | null;
  onRuleClick: (rule: number) => void;
}

function BreakdownPanel({ byRule, totalCount, activeRule, onRuleClick }: BreakdownPanelProps) {
  if (byRule.length === 0) {
    return null;
  }

  const maxCount = byRule[0]?.count ?? 1;

  return (
    <div className="lrw-breakdown" role="region" aria-label="Rule breakdown">
      <div className="lrw-breakdown__header">Rule breakdown</div>
      <table className="lrw-breakdown__table">
        <tbody>
          {byRule.map((row) => {
            const pct = totalCount > 0 ? Math.round((row.count / totalCount) * 100) : 0;
            const barPct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
            const isActive = activeRule === row.rule;
            const meta = RULE_META[row.rule];

            return (
              <tr
                key={row.rule}
                className={`lrw-breakdown__row${isActive ? ' lrw-breakdown__row--active' : ''}`}
                onClick={() => onRuleClick(row.rule)}
                aria-pressed={isActive}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRuleClick(row.rule);
                  }
                }}
                aria-label={`${ruleShortLabel(row.rule)}: ${row.count} hits (${pct}%)`}
              >
                <td className="lrw-breakdown__cell">
                  <span
                    className="lrw-breakdown__rule-badge"
                    style={{ background: ruleColor(row.rule) }}
                  >
                    {ruleShortLabel(row.rule)}
                  </span>
                </td>
                <td className="lrw-breakdown__cell lrw-breakdown__desc-cell">
                  <span className="lrw-breakdown__rule-desc">{meta?.label ?? `Rule ${row.rule}`}</span>
                </td>
                <td className="lrw-breakdown__cell lrw-breakdown__bar-cell">
                  <div className="lrw-breakdown__bar-track" aria-hidden="true">
                    <div
                      className="lrw-breakdown__bar-fill"
                      style={{ width: `${barPct}%`, background: ruleColor(row.rule) }}
                    />
                  </div>
                </td>
                <td className="lrw-breakdown__cell lrw-breakdown__count-cell">
                  {row.count}
                  <span className="lrw-breakdown__pct">{pct}%</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────

export interface LegacyRulesWidgetProps {
  /** Data to display. Refetched by parent when onFilterChange fires. */
  data: LegacyRulesWidgetData;
  /** Called when the user applies a new date range. Parent should refetch data. */
  onFilterChange: (from: string, to: string) => void;
  /**
   * Called when the user clicks Export.
   * Should trigger download of the CSV from GET /api/audit/legacy-rules?export=csv.
   */
  onExport: (from: string, to: string, rule?: number) => void;
}

export function LegacyRulesWidget({ data, onFilterChange, onExport }: LegacyRulesWidgetProps) {
  const [activeRule, setActiveRule] = useState<number | null>(null);
  const [filterFrom, setFilterFrom] = useState(data.dateRange.from);
  const [filterTo, setFilterTo] = useState(data.dateRange.to);

  const visibleSeries = useMemo<LegacyRulesDataPoint[]>(() => {
    if (activeRule === null) return data.series;
    const ruleRow = data.byRule.find((b) => b.rule === activeRule);
    return ruleRow?.series ?? [];
  }, [activeRule, data.series, data.byRule]);

  const handleRuleClick = useCallback((rule: number) => {
    setActiveRule((prev) => (prev === rule ? null : rule));
  }, []);

  const handleApplyFilter = useCallback(() => {
    onFilterChange(filterFrom, filterTo);
    setActiveRule(null);
  }, [filterFrom, filterTo, onFilterChange]);

  const handleResetFilter = useCallback(() => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setFilterFrom(from);
    setFilterTo(to);
    onFilterChange(from, to);
    setActiveRule(null);
  }, [onFilterChange]);

  const handleExport = useCallback(() => {
    onExport(filterFrom, filterTo, activeRule ?? undefined);
  }, [filterFrom, filterTo, activeRule, onExport]);

  const subtitle = `${data.totalCount} total · ${data.dateRange.from} to ${data.dateRange.to}`;

  return (
    <section className="lrw-root" aria-label="Legacy rules (4–8) usage widget">
      {/* Header */}
      <div className="lrw-header">
        <div className="lrw-header__title-group">
          <h3 className="lrw-header__title">Legacy Rules 4–8 Usage</h3>
          <span className="lrw-header__subtitle">{subtitle}</span>
        </div>
        <div className="lrw-header__actions">
          <button
            type="button"
            className="lrw-btn-export"
            onClick={handleExport}
            aria-label="Export as CSV"
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* Exit criterion banner */}
      <ExitCriterionBanner consecutiveZeroDays={data.consecutiveZeroDays} />

      {/* Filter bar */}
      <div className="lrw-filter-bar" role="search" aria-label="Date range filter">
        <label className="lrw-filter-bar__label">
          From
          <input
            type="date"
            className="lrw-filter-bar__input"
            value={filterFrom}
            max={filterTo}
            onChange={(e) => setFilterFrom(e.target.value)}
            aria-label="From date"
          />
        </label>
        <label className="lrw-filter-bar__label">
          to
          <input
            type="date"
            className="lrw-filter-bar__input"
            value={filterTo}
            min={filterFrom}
            onChange={(e) => setFilterTo(e.target.value)}
            aria-label="To date"
          />
        </label>
        <button type="button" className="lrw-btn-apply" onClick={handleApplyFilter}>
          Apply
        </button>
        <button
          type="button"
          className="lrw-filter-bar__reset"
          onClick={handleResetFilter}
          aria-label="Reset to last 30 days"
        >
          Reset
        </button>
      </div>

      {/* Drill-down indicator */}
      {activeRule !== null && (
        <div className="lrw-drill-indicator" role="status" aria-live="polite">
          <span>
            Showing: <strong>{ruleShortLabel(activeRule)}</strong>
          </span>
          <button
            type="button"
            className="lrw-drill-indicator__clear"
            onClick={() => setActiveRule(null)}
            aria-label="Clear rule filter"
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* Chart */}
      <BarChart
        series={visibleSeries}
        activeRule={activeRule}
        ariaLabel={
          activeRule !== null
            ? `${ruleShortLabel(activeRule)} hit counts time series`
            : 'Rules 4–8 aggregate hit counts time series'
        }
      />

      {/* Rule breakdown */}
      <BreakdownPanel
        byRule={data.byRule}
        totalCount={data.totalCount}
        activeRule={activeRule}
        onRuleClick={handleRuleClick}
      />
    </section>
  );
}

/**
 * UnclassifiedToolWidget
 *
 * Dashboard widget showing unclassified tool call counts over time with
 * drill-down by tool name, date range filtering, and CSV export.
 *
 * Data is passed in via props (fetched by the parent from
 * GET /api/audit/unclassified). Filtering by date range triggers
 * onFilterChange so the parent can refetch from the server.
 */

import { useCallback, useMemo, useState } from 'react';
import type { UnclassifiedDataPoint, UnclassifiedToolBreakdown, UnclassifiedWidgetData } from '../types.js';
import './UnclassifiedToolWidget.css';

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
  series: UnclassifiedDataPoint[];
  activeTool: string | null;
  onBarClick?: (date: string) => void;
}

function BarChart({ series, activeTool, onBarClick }: BarChartProps) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const maxCount = useMemo(
    () => Math.max(1, ...series.map((p) => p.count)),
    [series],
  );

  const barWidth = series.length > 0 ? Math.max(4, INNER_W / series.length - 3) : 0;
  const step = series.length > 0 ? INNER_W / series.length : 0;

  // Y-axis grid values
  const gridValues = useMemo(() => {
    const step = maxCount / GRID_COUNT;
    return Array.from({ length: GRID_COUNT + 1 }, (_, i) => Math.round(i * step));
  }, [maxCount]);

  if (series.length === 0) {
    return (
      <div className="utw-chart-area--empty" role="img" aria-label="No data">
        No data for the selected range
      </div>
    );
  }

  // Label decimation: show at most ~8 x-axis labels
  const labelInterval = Math.max(1, Math.ceil(series.length / 8));

  return (
    <div className="utw-chart-area">
      <svg
        className="utw-chart-svg"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`Unclassified tool calls time series${activeTool ? ` for ${activeTool}` : ''}`}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Grid lines + Y labels */}
          {gridValues.map((val) => {
            const y = INNER_H - (val / maxCount) * INNER_H;
            return (
              <g key={val}>
                <line
                  x1={0}
                  y1={y}
                  x2={INNER_W}
                  y2={y}
                  stroke="#e5e7eb"
                  strokeWidth={1}
                />
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
          <line
            x1={0}
            y1={INNER_H}
            x2={INNER_W}
            y2={INNER_H}
            stroke="#d1d5db"
            strokeWidth={1}
          />

          {/* Bars */}
          {series.map((point, i) => {
            const barH = Math.max(2, (point.count / maxCount) * INNER_H);
            const x = i * step + (step - barWidth) / 2;
            const y = INNER_H - barH;
            const isHovered = hoveredDate === point.date;
            const fill = isHovered ? BAR_COLOR_ACTIVE : BAR_COLOR_DEFAULT;

            return (
              <g key={point.date}>
                <rect
                  className="utw-bar"
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barH}
                  fill={fill}
                  rx={2}
                  aria-label={`${point.date}: ${point.count} call${point.count !== 1 ? 's' : ''}`}
                  onMouseEnter={() => setHoveredDate(point.date)}
                  onMouseLeave={() => setHoveredDate(null)}
                  onClick={() => onBarClick?.(point.date)}
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

// ─── Breakdown panel ──────────────────────────────────────────────────────────

interface BreakdownPanelProps {
  breakdown: UnclassifiedToolBreakdown[];
  totalCount: number;
  activeTool: string | null;
  onToolClick: (toolName: string) => void;
}

function BreakdownPanel({ breakdown, totalCount, activeTool, onToolClick }: BreakdownPanelProps) {
  if (breakdown.length === 0) {
    return null;
  }

  const maxCount = breakdown[0]?.count ?? 1;

  return (
    <div className="utw-breakdown" role="region" aria-label="Tool breakdown">
      <div className="utw-breakdown__header">Tool breakdown</div>
      <table className="utw-breakdown__table">
        <tbody>
          {breakdown.map((row) => {
            const pct = totalCount > 0 ? Math.round((row.count / totalCount) * 100) : 0;
            const barPct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
            const isActive = activeTool === row.toolName;

            return (
              <tr
                key={row.toolName}
                className={`utw-breakdown__row${isActive ? ' utw-breakdown__row--active' : ''}`}
                onClick={() => onToolClick(row.toolName)}
                aria-pressed={isActive}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToolClick(row.toolName);
                  }
                }}
                aria-label={`${row.toolName}: ${row.count} calls (${pct}%)`}
              >
                <td className="utw-breakdown__cell">
                  <span className="utw-breakdown__tool-name">{row.toolName}</span>
                </td>
                <td className="utw-breakdown__cell utw-breakdown__bar-cell">
                  <div className="utw-breakdown__bar-track" aria-hidden="true">
                    <div
                      className="utw-breakdown__bar-fill"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </td>
                <td className="utw-breakdown__cell utw-breakdown__count-cell">
                  {row.count}
                  <span className="utw-breakdown__pct">{pct}%</span>
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

export interface UnclassifiedToolWidgetProps {
  /** Data to display. Refetched by parent when onFilterChange fires. */
  data: UnclassifiedWidgetData;
  /** Called when the user applies a new date range. Parent should refetch data. */
  onFilterChange: (from: string, to: string) => void;
  /**
   * Called when the user clicks Export.
   * Should trigger download of the CSV from GET /api/audit/unclassified?export=csv.
   */
  onExport: (from: string, to: string, toolName?: string) => void;
}

export function UnclassifiedToolWidget({
  data,
  onFilterChange,
  onExport,
}: UnclassifiedToolWidgetProps) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [filterFrom, setFilterFrom] = useState(data.dateRange.from);
  const [filterTo, setFilterTo] = useState(data.dateRange.to);

  // Derived series: if a tool is active, show that tool's series; else show totals
  const visibleSeries = useMemo<UnclassifiedDataPoint[]>(() => {
    if (activeTool === null) return data.series;
    const toolRow = data.breakdown.find((b) => b.toolName === activeTool);
    return toolRow?.series ?? [];
  }, [activeTool, data.series, data.breakdown]);

  const handleToolClick = useCallback((toolName: string) => {
    setActiveTool((prev) => (prev === toolName ? null : toolName));
  }, []);

  const handleApplyFilter = useCallback(() => {
    onFilterChange(filterFrom, filterTo);
    setActiveTool(null);
  }, [filterFrom, filterTo, onFilterChange]);

  const handleResetFilter = useCallback(() => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setFilterFrom(from);
    setFilterTo(to);
    onFilterChange(from, to);
    setActiveTool(null);
  }, [onFilterChange]);

  const handleExport = useCallback(() => {
    onExport(filterFrom, filterTo, activeTool ?? undefined);
  }, [filterFrom, filterTo, activeTool, onExport]);

  const subtitle = `${data.totalCount} total · ${data.dateRange.from} to ${data.dateRange.to}`;

  return (
    <section className="utw-root" aria-label="Unclassified tool calls widget">
      {/* Header */}
      <div className="utw-header">
        <div className="utw-header__title-group">
          <h3 className="utw-header__title">Unclassified Tool Calls</h3>
          <span className="utw-header__subtitle">{subtitle}</span>
        </div>
        <div className="utw-header__actions">
          <button
            type="button"
            className="utw-btn-export"
            onClick={handleExport}
            aria-label="Export as CSV"
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="utw-filter-bar" role="search" aria-label="Date range filter">
        <label className="utw-filter-bar__label">
          From
          <input
            type="date"
            className="utw-filter-bar__input"
            value={filterFrom}
            max={filterTo}
            onChange={(e) => setFilterFrom(e.target.value)}
            aria-label="From date"
          />
        </label>
        <label className="utw-filter-bar__label">
          to
          <input
            type="date"
            className="utw-filter-bar__input"
            value={filterTo}
            min={filterFrom}
            onChange={(e) => setFilterTo(e.target.value)}
            aria-label="To date"
          />
        </label>
        <button
          type="button"
          className="utw-btn-apply"
          onClick={handleApplyFilter}
        >
          Apply
        </button>
        <button
          type="button"
          className="utw-filter-bar__reset"
          onClick={handleResetFilter}
          aria-label="Reset to last 30 days"
        >
          Reset
        </button>
      </div>

      {/* Drill-down indicator */}
      {activeTool !== null && (
        <div className="utw-drill-indicator" role="status" aria-live="polite">
          <span>Showing: <strong>{activeTool}</strong></span>
          <button
            type="button"
            className="utw-drill-indicator__clear"
            onClick={() => setActiveTool(null)}
            aria-label="Clear tool filter"
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* Chart */}
      <BarChart series={visibleSeries} activeTool={activeTool} />

      {/* Breakdown */}
      <BreakdownPanel
        breakdown={data.breakdown}
        totalCount={data.totalCount}
        activeTool={activeTool}
        onToolClick={handleToolClick}
      />
    </section>
  );
}

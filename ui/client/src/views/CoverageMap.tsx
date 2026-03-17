import { useState, useEffect, useRef } from "react";
import "./CoverageMap.css";

// Client-side mirrored types
type Effect = "permit" | "forbid";
type Resource = "tool" | "command" | "channel" | "prompt";

interface RateLimit {
  maxCalls: number;
  windowSeconds: number;
}

interface Rule {
  id: string;
  effect: Effect;
  resource: Resource;
  match: string;
  condition?: string;
  reason?: string;
  tags?: string[];
  rateLimit?: RateLimit;
}

// A cell value in the coverage grid
type CellValue = "permit" | "forbid" | "none";

interface CellInfo {
  value: CellValue;
  rules: Rule[];
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  agent: string;
  tool: string;
  cell: CellInfo;
}

const RESOURCE_LABELS: Record<Resource, string> = {
  tool: "Tool",
  command: "Command",
  channel: "Channel",
  prompt: "Prompt",
};

// Derive agents from rules that have agent-specific conditions.
// Returns an empty array when no agent-specific rules exist.
function extractAgentsFromRules(rules: Rule[]): string[] {
  const found = new Set<string>();
  for (const rule of rules) {
    if (rule.condition) {
      // Match patterns like context.agentId === 'agent-xxx' or agentId.includes('agent-xxx')
      const matches = rule.condition.matchAll(/agentId\s*===?\s*['"]([^'"]+)['"]/g);
      for (const m of matches) {
        found.add(m[1]);
      }
    }
  }
  return Array.from(found).sort();
}

function buildCoverageMatrix(
  agents: string[],
  tools: string[],
  rules: Rule[],
  resourceFilter: Resource
): Map<string, CellInfo> {
  const matrix = new Map<string, CellInfo>();

  for (const agent of agents) {
    for (const tool of tools) {
      const key = `${agent}::${tool}`;
      const matchingRules = rules.filter(
        (r) =>
          r.resource === resourceFilter &&
          (r.match === tool || r.match === "*" || matchesPattern(r.match, tool))
      );
      let value: CellValue = "none";
      if (matchingRules.some((r) => r.effect === "forbid")) {
        value = "forbid";
      } else if (matchingRules.some((r) => r.effect === "permit")) {
        value = "permit";
      }
      matrix.set(key, { value, rules: matchingRules });
    }
  }

  return matrix;
}

function matchesPattern(pattern: string, value: string): boolean {
  if (!pattern.includes("*") && !pattern.startsWith("/")) {
    return pattern === value;
  }
  try {
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      const lastSlash = pattern.lastIndexOf("/");
      const flags = pattern.slice(lastSlash + 1);
      const body = pattern.slice(1, lastSlash);
      return new RegExp(body, flags).test(value);
    }
    // Glob-style wildcard
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(value);
  } catch {
    return pattern === value;
  }
}

function cellLabel(value: CellValue): string {
  if (value === "permit") return "Permitted";
  if (value === "forbid") return "Forbidden";
  return "No rule (implicit deny)";
}

function exportCSV(agents: string[], tools: string[], matrix: Map<string, CellInfo>): void {
  const header = ["Agent", ...tools].join(",");
  const rows = agents.map((agent) => {
    const cells = tools.map((tool) => {
      const key = `${agent}::${tool}`;
      const cell = matrix.get(key);
      return cell?.value ?? "none";
    });
    return [agent, ...cells].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "coverage-report.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function CoverageMap() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resourceFilter, setResourceFilter] = useState<Resource>("tool");
  const [agentFilter, setAgentFilter] = useState("");
  const [toolFilter, setToolFilter] = useState("");
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/rules")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Rule[]>;
      })
      .then((data) => {
        setRules(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Close tooltip on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setTooltip(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const agents = extractAgentsFromRules(rules);
  const allTools = Array.from(
    new Set(rules.filter((r) => r.resource === resourceFilter).map((r) => r.match))
  ).sort();

  const filteredAgents = agentFilter
    ? agents.filter((a) => a.toLowerCase().includes(agentFilter.toLowerCase()))
    : agents;

  const filteredTools = toolFilter
    ? allTools.filter((t) => t.toLowerCase().includes(toolFilter.toLowerCase()))
    : allTools;

  const matrix = buildCoverageMatrix(filteredAgents, filteredTools, rules, resourceFilter);

  // Summary stats
  const totalCells = filteredAgents.length * filteredTools.length;
  const permitCount = [...matrix.values()].filter((c) => c.value === "permit").length;
  const forbidCount = [...matrix.values()].filter((c) => c.value === "forbid").length;
  const noneCount = totalCells - permitCount - forbidCount;

  function handleCellEnter(
    e: React.MouseEvent<HTMLTableCellElement>,
    agent: string,
    tool: string,
    cell: CellInfo
  ) {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      visible: true,
      x: rect.left + rect.width / 2,
      y: rect.bottom + window.scrollY + 6,
      agent,
      tool,
      cell,
    });
  }

  function handleCellLeave() {
    setTooltip(null);
  }

  if (loading) {
    return <div className="coverage-state coverage-state--loading">Loading coverage data…</div>;
  }

  if (error) {
    return <div className="coverage-state coverage-state--error">Error: {error}</div>;
  }

  if (allTools.length === 0) {
    return (
      <div className="coverage-state coverage-state--empty">
        No {RESOURCE_LABELS[resourceFilter].toLowerCase()} rules found.
      </div>
    );
  }

  return (
    <div className="coverage-map">
      {/* Controls */}
      <div className="coverage-controls">
        <div className="coverage-filters">
          <select
            className="filter-select"
            value={resourceFilter}
            onChange={(e) => {
              setResourceFilter(e.target.value as Resource);
              setToolFilter("");
            }}
            aria-label="Resource type"
          >
            <option value="tool">Tool</option>
            <option value="command">Command</option>
            <option value="channel">Channel</option>
            <option value="prompt">Prompt</option>
          </select>

          <input
            className="filter-input"
            type="text"
            placeholder="Filter agents…"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            aria-label="Filter agents"
          />

          <input
            className="filter-input"
            type="text"
            placeholder={`Filter ${RESOURCE_LABELS[resourceFilter].toLowerCase()}s…`}
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
            aria-label={`Filter ${RESOURCE_LABELS[resourceFilter].toLowerCase()}s`}
          />
        </div>

        <button
          className="coverage-export-btn"
          onClick={() => exportCSV(filteredAgents, filteredTools, matrix)}
          aria-label="Export coverage report as CSV"
        >
          Export CSV
        </button>
      </div>

      {/* Summary stats */}
      <div className="coverage-summary">
        <span className="coverage-summary-stat coverage-summary-stat--permit">
          <span className="coverage-summary-dot" />
          {permitCount} permitted
        </span>
        <span className="coverage-summary-stat coverage-summary-stat--forbid">
          <span className="coverage-summary-dot" />
          {forbidCount} forbidden
        </span>
        <span className="coverage-summary-stat coverage-summary-stat--none">
          <span className="coverage-summary-dot" />
          {noneCount} no rule
        </span>
        <span className="coverage-summary-total">
          {filteredAgents.length} agent{filteredAgents.length !== 1 ? "s" : ""} ×{" "}
          {filteredTools.length} {RESOURCE_LABELS[resourceFilter].toLowerCase()}
          {filteredTools.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Grid */}
      {filteredAgents.length === 0 || filteredTools.length === 0 ? (
        <div className="coverage-state coverage-state--empty">
          No results match the current filters.
        </div>
      ) : (
        <div className="coverage-grid-wrapper">
          <table className="coverage-grid" aria-label="Coverage map">
            <thead>
              <tr>
                <th className="coverage-corner" scope="col">
                  Agent ↓ / {RESOURCE_LABELS[resourceFilter]} →
                </th>
                {filteredTools.map((tool) => (
                  <th key={tool} scope="col" className="coverage-col-header" title={tool}>
                    <code className="coverage-header-code">{tool}</code>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAgents.map((agent) => (
                <tr key={agent}>
                  <th scope="row" className="coverage-row-header" title={agent}>
                    <code className="coverage-header-code">{agent}</code>
                  </th>
                  {filteredTools.map((tool) => {
                    const key = `${agent}::${tool}`;
                    const cell = matrix.get(key) ?? { value: "none" as CellValue, rules: [] };
                    return (
                      <td
                        key={tool}
                        className={`coverage-cell coverage-cell--${cell.value}`}
                        onMouseEnter={(e) => handleCellEnter(e, agent, tool, cell)}
                        onMouseLeave={handleCellLeave}
                        aria-label={`${agent} / ${tool}: ${cellLabel(cell.value)}`}
                        tabIndex={0}
                      >
                        <span className="coverage-cell-icon" aria-hidden="true">
                          {cell.value === "permit" ? "✓" : cell.value === "forbid" ? "✕" : "–"}
                        </span>
                        {cell.rules.some((r) => r.rateLimit) && (
                          <span className="coverage-cell-rl-badge" aria-hidden="true" title="Rate limited">⏱</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="coverage-legend">
        <span className="coverage-legend-title">Legend:</span>
        <span className="coverage-legend-item">
          <span className="coverage-legend-swatch coverage-legend-swatch--permit" aria-hidden="true">✓</span>
          Permit
        </span>
        <span className="coverage-legend-item">
          <span className="coverage-legend-swatch coverage-legend-swatch--forbid" aria-hidden="true">✕</span>
          Forbid
        </span>
        <span className="coverage-legend-item">
          <span className="coverage-legend-swatch coverage-legend-swatch--none" aria-hidden="true">–</span>
          No rule (implicit deny)
        </span>
        <span className="coverage-legend-item">
          <span className="coverage-legend-swatch coverage-legend-swatch--none" aria-hidden="true">⏱</span>
          Rate limited
        </span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          ref={tooltipRef}
          className="coverage-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
        >
          <div className="coverage-tooltip-header">
            <code className="coverage-tooltip-agent">{tooltip.agent}</code>
            <span className="coverage-tooltip-sep">→</span>
            <code className="coverage-tooltip-tool">{tooltip.tool}</code>
          </div>
          <div className={`coverage-tooltip-effect coverage-tooltip-effect--${tooltip.cell.value}`}>
            {cellLabel(tooltip.cell.value)}
          </div>
          {tooltip.cell.rules.length > 0 && (
            <div className="coverage-tooltip-rules">
              {tooltip.cell.rules.map((rule) => (
                <div key={rule.id} className="coverage-tooltip-rule">
                  <span className={`effect-badge effect-badge--${rule.effect}`}>{rule.effect}</span>
                  {rule.reason && (
                    <span className="coverage-tooltip-reason">{rule.reason}</span>
                  )}
                  {rule.rateLimit && (
                    <span className="coverage-tooltip-rate-limit">
                      ⏱ {rule.rateLimit.maxCalls} calls / {rule.rateLimit.windowSeconds}s
                    </span>
                  )}
                  {rule.tags && rule.tags.length > 0 && (
                    <div className="coverage-tooltip-tags">
                      {rule.tags.map((tag) => (
                        <span key={tag} className="tag-chip">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {tooltip.cell.rules.length === 0 && (
            <p className="coverage-tooltip-no-rule">No matching rule — request will be denied.</p>
          )}
        </div>
      )}
    </div>
  );
}

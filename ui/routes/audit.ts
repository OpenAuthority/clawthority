/**
 * Express router for the audit dashboard API.
 *
 * Mount at /api/audit on an Express application using createAuditRouter:
 *
 *   import express from 'express';
 *   import { createAuditRouter } from './ui/routes/audit.js';
 *
 *   const app = express();
 *   app.use('/api/audit', createAuditRouter('/path/to/audit.jsonl'));
 *
 * Endpoints:
 *   GET /unclassified
 *     Returns time-series + per-tool breakdown for normalizer-unclassified entries.
 *
 *     Query parameters:
 *       from      ISO date string (default: 30 days ago)
 *       to        ISO date string (default: now)
 *       toolName  Filter results to a single tool name
 *       export    Pass 'csv' to download raw entries as a CSV file
 */

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Router, Request, Response } from 'express';

// ─── Domain types ─────────────────────────────────────────────────────────────

interface UnclassifiedEntry {
  ts: string;
  type: 'normalizer-unclassified';
  toolName: string;
  agentId: string;
  channel: string;
}

export interface UnclassifiedDataPoint {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  count: number;
}

export interface UnclassifiedToolBreakdown {
  toolName: string;
  count: number;
  /** Per-date breakdown for this tool. */
  series: UnclassifiedDataPoint[];
}

/** Response body for GET /unclassified. */
export interface UnclassifiedWidgetData {
  series: UnclassifiedDataPoint[];
  breakdown: UnclassifiedToolBreakdown[];
  totalCount: number;
  dateRange: { from: string; to: string };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function readUnclassifiedEntries(
  logFile: string,
  from: Date,
  to: Date,
  toolFilter: string | undefined,
): Promise<UnclassifiedEntry[]> {
  if (!existsSync(logFile)) return [];

  const entries: UnclassifiedEntry[] = [];

  const rl = createInterface({
    input: createReadStream(logFile, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as { type?: unknown }).type !== 'normalizer-unclassified'
      ) {
        continue;
      }
      const entry = parsed as UnclassifiedEntry;
      const ts = new Date(entry.ts);
      if (ts < from || ts > to) continue;
      if (toolFilter !== undefined && entry.toolName !== toolFilter) continue;
      entries.push(entry);
    } catch {
      // skip malformed JSONL lines
    }
  }

  return entries;
}

function aggregateByDate(entries: UnclassifiedEntry[]): UnclassifiedDataPoint[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const date = entry.ts.slice(0, 10); // YYYY-MM-DD
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

function aggregateByTool(entries: UnclassifiedEntry[]): UnclassifiedToolBreakdown[] {
  const toolMap = new Map<string, UnclassifiedEntry[]>();
  for (const entry of entries) {
    const list = toolMap.get(entry.toolName) ?? [];
    list.push(entry);
    toolMap.set(entry.toolName, list);
  }
  return [...toolMap.entries()]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([toolName, toolEntries]) => ({
      toolName,
      count: toolEntries.length,
      series: aggregateByDate(toolEntries),
    }));
}

function entriesToCsv(entries: UnclassifiedEntry[]): string {
  const header = 'timestamp,toolName,agentId,channel';
  const rows = entries.map(
    (e) =>
      [e.ts, JSON.stringify(e.toolName), JSON.stringify(e.agentId), JSON.stringify(e.channel)].join(
        ',',
      ),
  );
  return [header, ...rows].join('\n');
}

// ─── Router factory ────────────────────────────────────────────────────────────

/**
 * Creates an Express Router with audit dashboard endpoints.
 *
 * @param logFile  Absolute path to the JSONL audit log file produced by
 *                 {@link JsonlAuditLogger}. The file need not exist yet;
 *                 requests will return empty results until it does.
 */
export function createAuditRouter(logFile: string): Router {
  // Express is a peer dependency of the dashboard server, not of the plugin.
  // Dynamic import avoids bundling Express into the plugin dist artefacts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Router: ExpressRouter } = require('express') as typeof import('express');
  const router = ExpressRouter();

  router.get('/unclassified', (req: Request, res: Response): void => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const fromParam = req.query['from'];
    const toParam = req.query['to'];
    const toolFilter =
      typeof req.query['toolName'] === 'string' && req.query['toolName']
        ? req.query['toolName']
        : undefined;
    const exportMode = req.query['export'];

    const from =
      typeof fromParam === 'string' && fromParam ? new Date(fromParam) : thirtyDaysAgo;
    const to = typeof toParam === 'string' && toParam ? new Date(toParam) : now;

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.status(400).json({ error: 'Invalid date range' });
      return;
    }

    readUnclassifiedEntries(logFile, from, to, toolFilter)
      .then((entries) => {
        if (exportMode === 'csv') {
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader(
            'Content-Disposition',
            'attachment; filename="unclassified-tools.csv"',
          );
          res.send(entriesToCsv(entries));
          return;
        }

        const body: UnclassifiedWidgetData = {
          series: aggregateByDate(entries),
          breakdown: aggregateByTool(entries),
          totalCount: entries.length,
          dateRange: {
            from: from.toISOString().slice(0, 10),
            to: to.toISOString().slice(0, 10),
          },
        };
        res.json(body);
      })
      .catch((err: unknown) => {
        console.error('[audit-route] failed to read audit log:', err);
        res.status(500).json({ error: 'Failed to read audit log' });
      });
  });

  return router;
}

/**
 * Express router for the skills API.
 *
 * Mount at /api/skills on an Express application using createSkillsRouter:
 *
 *   import express from 'express';
 *   import { createSkillsRouter } from './ui/routes/skills.js';
 *
 *   const app = express();
 *   app.use('/api/skills', createSkillsRouter('/path/to/examples/skills'));
 *
 * Endpoints:
 *   GET /unsafe-legacy
 *     Returns all skills with a truthy unsafe_legacy field in their SKILL.md
 *     manifest, sorted by deadline proximity (overdue first, then urgent).
 *
 *     Query parameters:
 *       (none)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Router, Request, Response } from 'express';

// ─── Domain types ──────────────────────────────────────────────────────────────

/** Urgency classification derived from days remaining until the deadline. */
export type UnsafeLegacyStatus = 'overdue' | 'urgent' | 'ok' | 'no-deadline';

/** A single skill carrying an unsafe_legacy exemption. */
export interface UnsafeLegacyTool {
  /** Skill name from the SKILL.md `name` field. */
  skillName: string;
  /** Action class from the `action_class` field (typically `shell.exec`). */
  actionClass: string;
  /** ISO date string (YYYY-MM-DD) of the exemption deadline, or null if absent. */
  deadline: string | null;
  /** Human-readable justification from `unsafe_legacy.reason`, or null. */
  reason: string | null;
  /**
   * Calendar days remaining until the deadline (negative when overdue).
   * Null when no valid deadline is present.
   */
  daysRemaining: number | null;
  /** Urgency status derived from daysRemaining. */
  status: UnsafeLegacyStatus;
  /** Relative path to the skill's SKILL.md manifest (e.g. `skills/foo/SKILL.md`). */
  manifestPath: string;
}

/** Response body for GET /unsafe-legacy. */
export interface UnsafeLegacyToolsData {
  /** All skills with a truthy unsafe_legacy field, sorted by deadline proximity. */
  tools: UnsafeLegacyTool[];
  totalCount: number;
  /** Number of tools whose deadline has already passed. */
  overdueCount: number;
  /** Number of tools with fewer than 30 days remaining on their deadline. */
  urgentCount: number;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function extractFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return null;
  try {
    const parsed = parseYaml(match[1]);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the deadline string from an `unsafe_legacy` field value.
 * Supports string form (`"2026-12-31"`) and object form (`{ deadline: "2026-12-31" }`).
 */
function extractDeadline(unsafeLegacy: unknown): string | null {
  if (typeof unsafeLegacy === 'string') return unsafeLegacy;
  if (typeof unsafeLegacy === 'object' && unsafeLegacy !== null) {
    const obj = unsafeLegacy as Record<string, unknown>;
    if (typeof obj['deadline'] === 'string') return obj['deadline'];
  }
  return null;
}

/** Extracts the optional reason string from an object-form `unsafe_legacy`. */
function extractReason(unsafeLegacy: unknown): string | null {
  if (typeof unsafeLegacy === 'object' && unsafeLegacy !== null) {
    const obj = unsafeLegacy as Record<string, unknown>;
    if (typeof obj['reason'] === 'string') return obj['reason'];
  }
  return null;
}

/**
 * Computes whole calendar days remaining until deadline (negative = overdue).
 * Returns null when the deadline string is not a valid date.
 */
function computeDaysRemaining(deadline: string): number | null {
  const deadlineDate = new Date(deadline);
  if (isNaN(deadlineDate.getTime())) return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  deadlineDate.setUTCHours(0, 0, 0, 0);
  return Math.round((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function computeStatus(daysRemaining: number | null): UnsafeLegacyStatus {
  if (daysRemaining === null) return 'no-deadline';
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining < 30) return 'urgent';
  return 'ok';
}

function findSkillManifests(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  const manifests: string[] = [];
  for (const entry of readdirSync(skillsDir)) {
    const skillDir = join(skillsDir, entry);
    try {
      if (!statSync(skillDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const manifestPath = join(skillDir, 'SKILL.md');
    if (existsSync(manifestPath)) manifests.push(manifestPath);
  }
  return manifests;
}

const STATUS_ORDER: Record<UnsafeLegacyStatus, number> = {
  overdue: 0,
  urgent: 1,
  'no-deadline': 2,
  ok: 3,
};

function scanUnsafeLegacySkills(skillsDir: string): UnsafeLegacyTool[] {
  const manifestPaths = findSkillManifests(skillsDir);
  const tools: UnsafeLegacyTool[] = [];

  for (const absPath of manifestPaths) {
    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    const frontmatter = extractFrontmatter(content);
    if (frontmatter === null) continue;

    const unsafeLegacy = frontmatter['unsafe_legacy'];
    // Include only skills where unsafe_legacy is truthy (non-null, non-false, non-"")
    if (!unsafeLegacy) continue;

    const skillName =
      typeof frontmatter['name'] === 'string' ? frontmatter['name'] : '';
    const actionClass =
      typeof frontmatter['action_class'] === 'string' ? frontmatter['action_class'] : '';
    const deadline = extractDeadline(unsafeLegacy);
    const reason = extractReason(unsafeLegacy);
    const daysRemaining = deadline !== null ? computeDaysRemaining(deadline) : null;
    const status = computeStatus(daysRemaining);

    // Express path relative to the skillsDir parent (e.g. skills/foo/SKILL.md)
    const skillsDirParent = skillsDir.slice(0, skillsDir.lastIndexOf('/'));
    const manifestPath = absPath.slice(skillsDirParent.length + 1);

    tools.push({ skillName, actionClass, deadline, reason, daysRemaining, status, manifestPath });
  }

  // Sort: overdue (most overdue first) → urgent (nearest deadline first)
  //       → no-deadline (alphabetical) → ok (nearest deadline first)
  tools.sort((a, b) => {
    const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (orderDiff !== 0) return orderDiff;
    if (a.daysRemaining !== null && b.daysRemaining !== null) {
      return a.daysRemaining - b.daysRemaining;
    }
    return a.skillName.localeCompare(b.skillName);
  });

  return tools;
}

// ─── Router factory ────────────────────────────────────────────────────────────

/**
 * Creates an Express Router with skills API endpoints.
 *
 * @param skillsDir  Absolute path to the directory containing first-party skill
 *                   subdirectories (each with a SKILL.md manifest). The directory
 *                   need not exist; requests return empty results until it does.
 */
export function createSkillsRouter(skillsDir: string): Router {
  // Express is a peer dependency of the dashboard server.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Router: ExpressRouter } = require('express') as typeof import('express');
  const router = ExpressRouter();

  router.get('/unsafe-legacy', (_req: Request, res: Response): void => {
    try {
      const tools = scanUnsafeLegacySkills(skillsDir);
      const body: UnsafeLegacyToolsData = {
        tools,
        totalCount: tools.length,
        overdueCount: tools.filter((t) => t.status === 'overdue').length,
        urgentCount: tools.filter((t) => t.status === 'urgent').length,
      };
      res.json(body);
    } catch (err: unknown) {
      console.error('[skills-route] failed to scan skill manifests:', err);
      res.status(500).json({ error: 'Failed to scan skill manifests' });
    }
  });

  return router;
}

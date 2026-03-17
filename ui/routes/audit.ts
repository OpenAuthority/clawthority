import { Router, Request, Response } from "express";
import fs from "fs";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEntry {
  timestamp: string;
  policyId: string;
  policyName: string;
  agentId?: string;
  resourceType?: string;
  action?: string;
  effect: string;
  matchedRuleId?: string;
  reason?: string;
  context?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Read config once at module load to avoid process.env access near network calls
const config = Object.freeze({
  auditLogFile:
    process.env.AUDIT_LOG_FILE ??
    path.join(__dirname, "../../data/audit.jsonl"),
});

const AUDIT_LOG_FILE = config.auditLogFile;

const MAX_IN_MEMORY = 1000;

/** Ring buffer for entries received via POST (live feed / not-yet-persisted). */
const auditLog: AuditEntry[] = [];

/** Active SSE response objects. */
const auditClients = new Set<Response>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function broadcastAuditEntry(entry: AuditEntry): void {
  for (const client of auditClients) {
    client.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
}

interface Filters {
  startDate?: string;
  endDate?: string;
  agentId?: string;
  resourceType?: string;
}

function matchesFilters(entry: AuditEntry, f: Filters): boolean {
  if (f.startDate && entry.timestamp < f.startDate) return false;
  if (f.endDate && entry.timestamp > f.endDate) return false;
  if (f.agentId && entry.agentId !== f.agentId) return false;
  if (f.resourceType && entry.resourceType !== f.resourceType) return false;
  return true;
}

/**
 * Stream-reads the JSONL audit log file and returns entries matching the
 * given filters. Uses readline to avoid loading the entire file into memory.
 */
async function readFileEntries(filters: Filters): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];

  if (!fs.existsSync(AUDIT_LOG_FILE)) return entries;

  const rl = readline.createInterface({
    input: fs.createReadStream(AUDIT_LOG_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as AuditEntry;
      if (matchesFilters(entry, filters)) entries.push(entry);
    } catch {
      // Skip malformed JSONL lines
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const auditRouter = Router();

/**
 * GET /api/audit
 *
 * Returns paginated audit log entries.
 *
 * Query params:
 *   page         — 1-based page number (default: 1)
 *   pageSize     — rows per page, max 100 (default: 10)
 *   startDate    — ISO 8601 lower bound for timestamp (inclusive)
 *   endDate      — ISO 8601 upper bound for timestamp (inclusive)
 *   agentId      — filter by exact agentId
 *   resourceType — filter by exact resourceType
 */
auditRouter.get("/", async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(String(req.query.pageSize ?? "10"), 10) || 10)
  );
  const filters: Filters = {
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
    agentId: req.query.agentId as string | undefined,
    resourceType: req.query.resourceType as string | undefined,
  };

  // JSONL file is the primary source for historical entries.
  let fileEntries: AuditEntry[] = [];
  try {
    fileEntries = await readFileEntries(filters);
  } catch (err) {
    console.error("[audit] file read error:", err);
  }

  // In-memory entries supplement the file for entries not yet persisted.
  const memEntries = auditLog.filter((e) => matchesFilters(e, filters));

  const combined = [...fileEntries, ...memEntries].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  );

  const total = combined.length;
  const start = (page - 1) * pageSize;

  res.json({
    entries: combined.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
});

/**
 * GET /api/audit/stream
 *
 * Server-Sent Events endpoint. Emits live audit entries as they arrive.
 * Each event is a JSON-encoded AuditEntry: `data: {...}\n\n`
 */
auditRouter.get("/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  auditClients.add(res);

  req.on("close", () => {
    auditClients.delete(res);
  });
});

/**
 * POST /api/audit
 *
 * Accepts an AuditEntry from the policy engine and broadcasts it to all
 * connected SSE clients. Decouples the policy engine from direct imports.
 *
 * Body: AuditEntry JSON
 */
auditRouter.post("/", (req: Request, res: Response) => {
  const entry = req.body as AuditEntry;

  if (!entry?.timestamp || !entry.effect) {
    res
      .status(400)
      .json({ error: "Invalid audit entry: missing timestamp or effect" });
    return;
  }

  auditLog.push(entry);
  if (auditLog.length > MAX_IN_MEMORY) auditLog.shift();
  broadcastAuditEntry(entry);

  res.status(201).json({ ok: true });
});

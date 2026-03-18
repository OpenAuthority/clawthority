import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve data path relative to the plugin root (one level above ui/).
// process.cwd() is expected to be the ui/ directory at startup, so go up one
// level to reach the plugin root where data/rules.json lives.
const PLUGIN_ROOT = path.resolve(process.cwd(), "..");

// Read config once at module load to avoid process.env access near network calls
const config = Object.freeze({
  rulesFile:
    process.env.RULES_FILE ?? path.join(PLUGIN_ROOT, "data", "rules.json"),
});

const RULES_FILE = config.rulesFile;

// ─── Types ────────────────────────────────────────────────────────────────────

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
  /** Stored as a serialised string, never a RegExp object */
  match: string;
  /** Serialised function body string, not a Function object */
  condition?: string;
  reason?: string;
  tags?: string[];
  rateLimit?: RateLimit;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadRules(): Rule[] {
  try {
    const raw = fs.readFileSync(RULES_FILE, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Rule[]) : [];
  } catch {
    return [];
  }
}

function saveRules(rules: Rule[]): void {
  const dir = path.dirname(RULES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), "utf-8");
}

// ─── Validation ───────────────────────────────────────────────────────────────

const VALID_EFFECTS: Effect[] = ["permit", "forbid"];
const VALID_RESOURCES: Resource[] = ["tool", "command", "channel", "prompt"];

interface FieldError {
  field: string;
  message: string;
}

function validateRuleBody(body: unknown): { errors: FieldError[]; data?: Omit<Rule, "id"> } {
  if (typeof body !== "object" || body === null) {
    return { errors: [{ field: "body", message: "Request body must be a JSON object." }] };
  }

  const b = body as Record<string, unknown>;
  const errors: FieldError[] = [];

  if (!b.effect || !VALID_EFFECTS.includes(b.effect as Effect)) {
    errors.push({ field: "effect", message: `Must be one of: ${VALID_EFFECTS.join(", ")}.` });
  }

  if (!b.resource || !VALID_RESOURCES.includes(b.resource as Resource)) {
    errors.push({ field: "resource", message: `Must be one of: ${VALID_RESOURCES.join(", ")}.` });
  }

  if (!b.match || typeof b.match !== "string" || b.match.trim() === "") {
    errors.push({ field: "match", message: "Required, must be a non-empty string." });
  }

  if (b.condition !== undefined && typeof b.condition !== "string") {
    errors.push({ field: "condition", message: "Must be a string (serialised function body)." });
  }

  if (b.reason !== undefined && typeof b.reason !== "string") {
    errors.push({ field: "reason", message: "Must be a string." });
  }

  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || !(b.tags as unknown[]).every((t) => typeof t === "string")) {
      errors.push({ field: "tags", message: "Must be an array of strings." });
    }
  }

  if (b.rateLimit !== undefined) {
    if (typeof b.rateLimit !== "object" || b.rateLimit === null) {
      errors.push({ field: "rateLimit", message: "Must be an object." });
    } else {
      const rl = b.rateLimit as Record<string, unknown>;
      if (!Number.isInteger(rl.maxCalls) || (rl.maxCalls as number) <= 0) {
        errors.push({ field: "rateLimit.maxCalls", message: "Must be a positive integer." });
      }
      if (!Number.isInteger(rl.windowSeconds) || (rl.windowSeconds as number) <= 0) {
        errors.push({ field: "rateLimit.windowSeconds", message: "Must be a positive integer." });
      }
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  const data: Omit<Rule, "id"> = {
    effect: b.effect as Effect,
    resource: b.resource as Resource,
    match: (b.match as string).trim(),
  };

  if (b.condition && (b.condition as string).trim()) {
    data.condition = (b.condition as string).trim();
  }
  if (b.reason && (b.reason as string).trim()) {
    data.reason = (b.reason as string).trim();
  }
  if (Array.isArray(b.tags) && (b.tags as string[]).length > 0) {
    data.tags = b.tags as string[];
  }
  if (b.rateLimit) {
    data.rateLimit = b.rateLimit as RateLimit;
  }

  return { errors: [], data };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const rulesRouter = Router();

/** GET /api/rules — list all rules with optional query filtering */
rulesRouter.get("/", (req: Request, res: Response) => {
  let rules = loadRules();

  const { effect, resource, tags } = req.query;

  if (typeof effect === "string" && effect) {
    rules = rules.filter((r) => r.effect === effect);
  }
  if (typeof resource === "string" && resource) {
    rules = rules.filter((r) => r.resource === resource);
  }
  if (typeof tags === "string" && tags) {
    const tagFilter = tags.toLowerCase();
    rules = rules.filter((r) =>
      r.tags?.some((t) => t.toLowerCase().includes(tagFilter))
    );
  }

  res.json(rules);
});

/** POST /api/rules — create a new rule */
rulesRouter.post("/", (req: Request, res: Response) => {
  const { errors, data } = validateRuleBody(req.body);

  if (errors.length > 0) {
    res.status(400).json({ errors });
    return;
  }

  const rules = loadRules();
  const newRule: Rule = { id: crypto.randomUUID(), ...data! };
  rules.push(newRule);
  saveRules(rules);

  res.status(201).json(newRule);
});

/** PUT /api/rules/:id — replace an existing rule */
rulesRouter.put("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const rules = loadRules();
  const idx = rules.findIndex((r) => r.id === id);

  if (idx === -1) {
    res.status(404).json({ error: `Rule '${id}' not found.` });
    return;
  }

  const { errors, data } = validateRuleBody(req.body);

  if (errors.length > 0) {
    res.status(400).json({ errors });
    return;
  }

  const updated: Rule = { id, ...data! };
  rules[idx] = updated;
  saveRules(rules);

  res.json(updated);
});

/** DELETE /api/rules/:id — remove a rule */
rulesRouter.delete("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const rules = loadRules();
  const idx = rules.findIndex((r) => r.id === id);

  if (idx === -1) {
    res.status(404).json({ error: `Rule '${id}' not found.` });
    return;
  }

  rules.splice(idx, 1);
  saveRules(rules);

  res.status(204).end();
});

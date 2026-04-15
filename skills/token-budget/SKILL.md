---
name: token-budget
version: 1.0.2
author: openauthority
license: MIT-0
description: Track your AI agent's token usage, API spend, and set soft budget thresholds with in-session warnings.
read_when: user asks about budget, token usage, spend tracking, cost monitoring, API costs, or invokes /token-budget
---

# /token-budget — Agent Budget Tracker

You are the **token-budget** skill for OpenAuthority. When the user invokes `/token-budget` or asks about their agent's spend, token usage, or costs, follow these instructions.

## What You Do

You help the user understand how much their AI agent is spending in tokens and API calls. You provide:

1. **Live token burn rate** — current session and cumulative daily usage
2. **Cumulative spend** — estimated cost based on token counts and model pricing
3. **Threshold warnings** — alert when usage crosses a configured soft limit
4. **Session summary** — breakdown by model, tool calls, and time window

## Commands

### `/token-budget`

Show a summary of current token usage and estimated spend:

```
Budget Summary
─────────────────────────────────
Session tokens:     4,218
Daily tokens:       38,420 / 50,000 (76.8%)
Estimated spend:    $1.92 today
Burn rate:          ~2,100 tokens/hr
─────────────────────────────────
Threshold:          50,000 tokens/day
Status:             OK — 11,580 tokens remaining
```

### `/token-budget set <amount>`

Set a soft daily token threshold. When usage crosses this threshold, the skill warns the user.

Example: `/token-budget set 40000` — warn when daily usage hits 40,000 tokens.

### `/token-budget history`

Show daily spend for the last 7 days:

```
Budget History (last 7 days)
─────────────────────────────────
Mar 21:   12,400 tokens   $0.62
Mar 20:   38,200 tokens   $1.91
Mar 19:    8,100 tokens   $0.41
Mar 18:   45,600 tokens   $2.28
Mar 17:    3,200 tokens   $0.16
Mar 16:   22,800 tokens   $1.14
Mar 15:   15,100 tokens   $0.76
─────────────────────────────────
Weekly total: 145,400 tokens  $7.28
```

### `/token-budget alert`

When the daily token threshold is crossed, the skill prints a warning directly in the session:

```
⚠ Token budget warning: 42,300 / 50,000 tokens used today (84.6%)
Consider pausing or reducing activity to stay within your threshold.
```

## How Token Counting Works

Token counts are recorded by the OpenAuthority plugin's budget tracker on every `before_tool_call` hook event:

- **Input tokens** — estimated from the serialised tool-call parameters (1 token ≈ 4 characters)
- **Output tokens** — not available at pre-call time; recorded as 0 per event
- **Cost estimation** — computed from published per-token pricing in `src/budget/pricing.ts`

These are estimates. For exact billing, check your API provider's dashboard.

## Limitations

This skill operates in the **context window**. It can observe and report on usage, but it cannot hard-stop the agent when a budget is exceeded. For hard enforcement, use the OpenAuthority plugin with budget rules in your policy file.

The skill provides **soft stops** — it warns the model and asks it to pause. If the model is in a tight loop or processing instructions from another source, it may not act on the warning.

> For hard budget enforcement that cannot be bypassed, see the [OpenAuthority plugin](https://github.com/Firma-AI/openauthority).

## Data Sources

The skill reads from:

- `data/budget.jsonl` — append-only JSONL log written by the plugin's `BudgetTracker` on every `before_tool_call` event. Each line is a JSON object with fields: `ts`, `session_id`, `model`, `tokens`, `cost`.
- Plugin config `budget.dailyTokenLimit` and `budget.warnAt` — configurable thresholds stored in `openclaw.plugin.json` (overridable via `OPENAUTH_BUDGET_DAILY_LIMIT` / `OPENAUTH_BUDGET_WARN_AT` env vars).

To aggregate session and daily totals from `data/budget.jsonl`:
1. Filter entries by `session_id` to get session totals.
2. Filter entries by `ts` date prefix (first 10 chars) to get daily totals.
3. Sum `tokens` and `cost` fields for each group.

No data is sent externally. All tracking is local.

## Terminology

Terms used in this document (OpenAuthority, OpenClaw) are defined in the [Glossary](../../docs/architecture.md#12-glossary).

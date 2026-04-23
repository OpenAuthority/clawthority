# Coverage Review Runbook

> **What this document is for.** Step-by-step instructions for running a quarterly coverage review: checking unsafe-legacy tool deadlines, unclassified-tool drift, and outstanding RFC progress, then publishing the status report.
>
> **Cadence:** Once per quarter, targeting the second or third week of the quarter start month (January, April, July, October).
>
> **Output:** A published status report at `docs/coverage-reviews/YYYY-Q{N}.md`.

---

## Overview

The quarterly coverage review monitors three signals that indicate taxonomy health:

| Signal | Dashboard / Source | What It Detects |
|--------|-------------------|-----------------|
| Unsafe-legacy tool deadlines | `GET /api/skills/unsafe-legacy` | Skills with `unsafe_legacy` exemptions approaching or past their retirement deadline |
| Unclassified-tool audit drift | `GET /api/audit/unclassified` | Tool calls falling through to `unknown_sensitive_action` — indicates missing registry aliases or new unregistered tools |
| Outstanding RFC progress | `docs/rfc/README.md` + `RFCProcessor` | RFCs past their 14-day SLA or stuck in `in_review` without a resolution |

All three signals feed into a single status report that is committed to `docs/coverage-reviews/`.

---

## Schedule

| Quarter | Review Window | Report Filename |
|---------|--------------|-----------------|
| Q1 | January 8 – January 21 | `YYYY-Q1.md` |
| Q2 | April 8 – April 21 | `YYYY-Q2.md` |
| Q3 | July 8 – July 21 | `YYYY-Q3.md` |
| Q4 | October 8 – October 21 | `YYYY-Q4.md` |

**Owner:** Assign one primary reviewer and one backup each quarter. Rotate annually. Record the assignment in the status report header.

**Calendar:** Add a recurring calendar event titled "Clawthority: Quarterly Coverage Review" on the first Tuesday of each quarter start month. Set a reminder 5 business days before the review window opens.

---

## Pre-Review Checklist

Run these steps before writing the status report.

### Step 1 — Unsafe-Legacy Dashboard (E-06)

> **Goal:** Identify skills with `unsafe_legacy` exemptions that are overdue or approaching deadline, and confirm retirement is tracked.

1. Start the dashboard server if it is not already running:
   ```bash
   npm run dev
   ```
2. Open the Unsafe Legacy Tools widget or query the API directly:
   ```bash
   curl http://localhost:3000/api/skills/unsafe-legacy | jq .
   ```
3. For each skill returned, record:
   - Skill name and `unsafe_legacy` exemption reason
   - Retirement deadline (`deadline` field)
   - Current status: `overdue` | `urgent` | `ok` | `no-deadline`
4. For any skill with status `overdue`:
   - Verify a retirement issue or PR exists. If not, open one immediately.
   - Record the blocker (if any) in the status report.
5. For any skill with status `urgent` (deadline within 30 days):
   - Confirm an assignee owns the retirement work.
   - Escalate to the maintainer if unassigned.

**Output:** Table of skills, statuses, and deadlines in §3 of the status report.

---

### Step 2 — Unclassified-Tool Drift (E-07)

> **Goal:** Detect new tool names falling through to `unknown_sensitive_action` over the past quarter. Rising counts signal missing aliases or newly deployed tools that have not been registered.

1. Query the audit endpoint for unclassified tool counts:
   ```bash
   curl "http://localhost:3000/api/audit/unclassified?days=90" | jq .
   ```
2. Review the time-series breakdown:
   - Check overall 90-day count vs. the count from the prior quarter's report.
   - Identify which tool names appear most frequently in the breakdown.
3. For each top-offending tool name:
   - Determine whether it should be a registered alias for an existing action class.
   - If yes: open a PR to add the alias to `src/enforcement/normalize.ts` and update `docs/action-registry.md`.
   - If the tool represents a genuinely new action class: file an RFC (see `docs/rfc/README.md` for the submission process).
   - If the tool is noise (one-off, test call, retired): document the rationale in the status report.
4. Record the 90-day total, top tool names, and disposition of each in §4 of the status report.

**Output:** Unclassified-tool summary table in §4 of the status report.

---

### Step 3 — Outstanding RFC Review (E-08)

> **Goal:** Ensure no RFCs are stuck past their 14-day SLA and that approved RFCs have progressed to implementation.

1. Open `docs/rfc/README.md` and review the RFC Index table.
2. For each RFC in a non-terminal state (`open` or `in_review`):
   - Calculate days since filing.
   - Flag any RFC past its SLA deadline (14 calendar days from filing).
   - Verify a reviewer is assigned.
3. For each `approved` RFC:
   - Confirm an implementation PR exists or is in progress.
   - If not started, escalate to the assignee and record the blocker.
4. Optionally run the automated RFC processor to get a structured view:
   ```typescript
   import { RFCProcessor } from './src/validation/rfc-processor.ts';
   const processor = new RFCProcessor('docs/rfc');
   const all = await processor.listAll();
   const overdue = all.filter(r => r.slaDaysRemaining < 0);
   ```
5. Record RFC counts by state and flag any blockers in §5 of the status report.

**Output:** RFC status table in §5 of the status report.

---

## Writing the Status Report

Create a new file at `docs/coverage-reviews/YYYY-Q{N}.md` using the template below. Fill in every section before committing.

### Report Template

```markdown
# Coverage Review — YYYY Q{N}

**Period:** {Quarter start date} – {Review date}
**Primary reviewer:** @{handle}
**Backup reviewer:** @{handle}
**Published:** YYYY-MM-DD

---

## 1. Executive Summary

<!-- 3–5 sentences. Overall health of the taxonomy coverage. Call out any critical issues (overdue skills, SLA-breached RFCs, sharp drift spikes). -->

---

## 2. Action Items

<!-- Bulleted list of concrete follow-ups from this review. Owner and due date for each. -->

- [ ] {Action} — @{owner} by {date}

---

## 3. Unsafe-Legacy Tool Deadlines (E-06)

**Dashboard source:** `GET /api/skills/unsafe-legacy`

| Skill | Exemption Reason | Deadline | Status | Notes |
|-------|-----------------|----------|--------|-------|
| {skill} | {reason} | {date} | `{status}` | {notes} |

**Summary:** {N} skills tracked. {N} overdue, {N} urgent, {N} ok, {N} no-deadline.

---

## 4. Unclassified-Tool Drift (E-07)

**Audit source:** `GET /api/audit/unclassified?days=90`

**90-day total:** {N} calls to `unknown_sensitive_action`
**Prior quarter total:** {N} (delta: {+/-N})

| Tool Name | Call Count | Disposition |
|-----------|-----------|-------------|
| {tool} | {N} | {alias added / RFC filed / noise — rationale} |

---

## 5. Outstanding RFC Status (E-08)

**Source:** `docs/rfc/README.md`

| RFC | Title | Status | Filed | SLA Deadline | Days Over SLA | Blocker |
|-----|-------|--------|-------|-------------|--------------|---------|
| {RFC-NNN} | {title} | `{status}` | {date} | {date} | {N} | {blocker or "none"} |

**Summary:** {N} open, {N} in_review, {N} approved (awaiting implementation), {N} implemented this quarter.

---

## 6. Ownership & Next Review

**Next review:** {YYYY-Q{N+1}} — target window {date range}
**Next primary reviewer:** @{handle}
**Next backup reviewer:** @{handle}
```

---

## Commit and Publish

Once the report is written:

1. Stage and commit the report file only:
   ```bash
   git add docs/coverage-reviews/YYYY-Q{N}.md
   git commit -m "docs(coverage-review): publish YYYY-Q{N} status report"
   ```
2. If any alias PRs or RFC filings arose from the review, track them in the action items section of the report before committing.
3. Post a link to the committed report in the governance track issue or team channel.

---

## Related Documents

- `docs/rfc/README.md` — RFC index, lifecycle, and submission process
- `docs/action-registry.md` — Alias tables and reclassification rules
- `docs/action-taxonomy.md` — Frozen v1 action taxonomy
- `ui/routes/skills.ts` — Unsafe-legacy API implementation
- `ui/routes/audit.ts` — Unclassified-tool audit API implementation
- `src/validation/rfc-processor.ts` — Automated RFC lifecycle (G-01)

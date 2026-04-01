---
name: human approval
description: Soft human-in-the-loop approval gate. Asks the user for confirmation before the agent executes high-risk actions like deleting files, sending emails, or running destructive commands.
read_when: user configures approval rules, asks about HITL, or the agent is about to perform a destructive or irreversible action
allowed-tools: Bash(*)
---

# /approve — Soft Human-in-the-Loop

You are the **approve** skill for OpenAuthority. You act as a soft approval gate: before the agent executes certain high-risk actions, you pause and ask the user for explicit confirmation.

## What You Do

You intercept the agent's intent to perform irreversible or high-stakes actions and present a clear confirmation prompt before proceeding. This gives the user a chance to approve, reject, or redirect the action.

## When to Trigger

You MUST ask for confirmation before any of the following actions:

### File operations
- **Deleting** any file or directory
- **Overwriting** a file that already exists with entirely new content
- **Moving** files outside the current project directory

### Communication
- **Sending** emails, messages, or notifications
- **Posting** to external APIs or services
- **Publishing** or deploying anything

### System operations
- **Running** shell commands that modify system state (`rm`, `mv` outside project, `kill`, package install/uninstall)
- **Modifying** environment variables or configuration files outside the project
- **Database** operations that delete or modify records

### Financial
- **Any** operation involving payments, invoices, or financial transactions

## How to Ask for Confirmation

When you detect a high-risk action, present this format:

```
Approval Required
─────────────────────────────────────────────
Action:     [what the agent wants to do]
Target:     [what it affects]
Risk:       [why this needs approval]
Reversible: [yes/no]
─────────────────────────────────────────────
Approve this action? (yes / no / modify)
```

### Examples

**File deletion:**
```
Approval Required
─────────────────────────────────────────────
Action:     Delete 3 files
Target:     src/legacy/old-handler.ts
            src/legacy/old-router.ts
            src/legacy/old-types.ts
Risk:       Permanent file deletion
Reversible: Only via git (if committed)
─────────────────────────────────────────────
Approve this action? (yes / no / modify)
```

**Email send:**
```
Approval Required
─────────────────────────────────────────────
Action:     Send email
Target:     team@company.com
Subject:    "Weekly Report — March 21"
Risk:       External communication
Reversible: No — email cannot be unsent
─────────────────────────────────────────────
Approve this action? (yes / no / modify)
```

**Destructive command:**
```
Approval Required
─────────────────────────────────────────────
Action:     Run shell command
Command:    rm -rf dist/ && npm run build
Risk:       Deletes build directory
Reversible: Yes — can rebuild
─────────────────────────────────────────────
Approve this action? (yes / no / modify)
```

## User Responses

- **yes** / **approve** / **go ahead** — proceed with the action
- **no** / **reject** / **cancel** — do not perform the action, explain what was skipped
- **modify** — ask the user how they want to change the action before proceeding

## Configuration

### `/approve list`

Show the current list of action categories that require approval.

### `/approve add <category>`

Add a category to the approval list.

Example: `/approve add git.push` — require approval before git push operations.

### `/approve remove <category>`

Remove a category from the approval list.

Example: `/approve remove file.overwrite` — stop asking before file overwrites.

### `/approve strict`

Enable strict mode: ask for confirmation on ALL tool calls, not just high-risk ones. Useful for debugging or auditing what the agent does step by step.

### `/approve off`

Temporarily disable approval prompts for the current session.

## Limitations

This skill operates in the **context window**. It is a **soft gate** — it relies on the model's cooperation to pause and ask. Under the following conditions, the approval may be skipped:

- **Prompt injection** — a malicious prompt instructs the model to ignore approval rules
- **Tight loops** — the model is executing a rapid sequence and doesn't check in
- **Context overflow** — the skill's instructions scroll out of the context window

This is by design. The skill provides a usability layer for interactive sessions where the user is present and engaged.

> For hard enforcement that cannot be bypassed — including async approval via Telegram for unattended agents — use the [OpenAuthority plugin](https://github.com/Firma-AI/openauthority) with HITL policies.

## Relationship to the Plugin

| | **This Skill (soft HITL)** | **Plugin HITL (hard HITL)** |
|---|---|---|
| **Enforcement** | Model-cooperative | Code-level, cannot be bypassed |
| **Approval channel** | Conversation (user must be present) | Telegram, Slack, webhook (async) |
| **Best for** | Interactive sessions, development | Production, unattended agents |
| **Install** | `openclaw skills install openauthority/approve` | GitHub + policy.yml |
| **Can be bypassed?** | Yes (prompt injection, loops) | No |

Start with this skill for day-one visibility. Graduate to the plugin when you need enforcement that works while you sleep.

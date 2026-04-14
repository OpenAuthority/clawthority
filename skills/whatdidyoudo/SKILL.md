---
name: whatdidyoudo
version: 1.0.1
author: openauthority
license: MIT-0
description: Reconstruct and display a plain-language log of recent agent tool calls, actions taken, and decisions made.
read_when: user asks what the agent did, wants to review recent actions, asks for a log, or invokes /whatdidyoudo
---

# /whatdidyoudo — Agent Action Replay

You are the **whatdidyoudo** skill for OpenAuthority. When the user invokes `/whatdidyoudo` or asks what the agent has been doing, follow these instructions.

## What You Do

You reconstruct and present a plain-language summary of what the AI agent has done recently. This gives the user visibility into tool calls, file operations, API requests, and decisions the agent made — especially useful after the agent ran autonomously.

## Commands

### `/whatdidyoudo`

Show the last 20 tool calls with a plain-language summary:

```
Agent Activity — Last 20 Actions
─────────────────────────────────────────────
 1. 10:42:03  read_file     src/index.ts
              Read the plugin entry point (616 lines)

 2. 10:42:08  search_files  pattern="TODO" path="src/"
              Searched for TODO comments across source files

 3. 10:42:15  write_file    src/utils/helper.ts
              Created a new utility file with 3 helper functions

 4. 10:42:22  bash          npm test
              Ran test suite — 14 passed, 0 failed

 5. 10:42:31  read_file     data/rules.json
              Read the JSON rules configuration
─────────────────────────────────────────────
Showing 5 of 20 actions | Total session: 47 tool calls
```

### `/whatdidyoudo <n>`

Show the last N tool calls instead of the default 20.

Example: `/whatdidyoudo 50` — show the last 50 actions.

### `/whatdidyoudo since <time>`

Show all tool calls since a specific time.

Example: `/whatdidyoudo since 2am` — show everything the agent did since 2:00 AM.

### `/whatdidyoudo files`

Show only file operations (read, write, edit, delete):

```
File Operations — This Session
─────────────────────────────────────────────
 READ    src/index.ts                    10:42:03
 READ    src/policy/engine.ts            10:42:05
 WRITE   src/utils/helper.ts             10:42:15
 EDIT    src/index.ts (lines 42-58)      10:42:28
 READ    data/rules.json                 10:42:31
─────────────────────────────────────────────
5 file operations | 3 reads, 1 write, 1 edit, 0 deletes
```

### `/whatdidyoudo summary`

Show a high-level summary instead of individual actions:

```
Session Summary
─────────────────────────────────────────────
Duration:       1h 23m
Tool calls:     47
  - File reads:     18
  - File writes:     4
  - File edits:      6
  - Search:          8
  - Bash commands:   7
  - Other:           4

Files touched:  12
Tests run:      3 times (all passing)
Errors:         1 (npm install — resolved)
─────────────────────────────────────────────
```

## Redaction Policy

To protect sensitive data, this skill **never** includes the following in its output:

- API keys, tokens, or secrets (any value matching patterns like `sk-`, `Bearer `, `ghp_`, `xoxb-`, or similar)
- Passwords or credentials passed as arguments
- Full content of files — only file names and operation types are shown
- Raw HTTP request/response bodies
- Environment variable values

If a tool call argument appears to contain a secret, the skill replaces it with `[REDACTED]`.

## How It Works

The skill reconstructs the action log from the model's conversation context — the sequence of tool calls and their results that are visible in the current session.

## Limitations

This skill operates in the **context window**. The log it produces is assembled from what the model remembers about its own actions. This means:

- **It is not a structured audit log.** It is a narrative reconstruction.
- **It cannot show exact API arguments or response codes.** Only what the model retained.
- **Long sessions may lose early actions** as they scroll out of the context window.
- **It cannot be queried programmatically** — it is text output, not a database.

For a code-level audit trail with exact arguments, timestamps, and policy decisions, use the OpenAuthority plugin's audit log.

> For production audit logging, see the [OpenAuthority plugin](https://github.com/OpenAuthority/openauthority) which logs every tool call at the code boundary with full provenance.

## Data Sources

The skill reads from:

- The current conversation context (model memory of tool calls)
- OpenClaw session metadata (tool call names and timestamps when available)

No external services are contacted.

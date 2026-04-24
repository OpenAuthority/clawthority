---
name: git_log
version: 1.0.0
author: clawthority
license: MIT-0
description: Returns formatted commit history for a git repository, with optional limit and path filters.
read_when: user asks to view commit history, show git log, list commits, or see what changed in a file
action_class: vcs.read
---

# /git_log — View Commit History

You are the **git_log** tool for Clawthority. You return commit history from a git repository by running `git log`.

## What You Do

You query the git commit history and return an ordered list of commit objects (newest first). Each commit includes its full hash, subject-line message, author name, and ISO-8601 date.

## When to Trigger

Invoke this tool when the user or agent wants to:

- View recent commits (`show me the last 10 commits`)
- Inspect the history of a specific file (`what changed in src/index.ts?`)
- List all commits in a repository
- Retrieve commit hashes for reference in other operations

## Parameters

| Name    | Type     | Required | Description                                                       |
|---------|----------|----------|-------------------------------------------------------------------|
| `limit` | `number` | No       | Maximum number of commits to return. Omit for all commits.        |
| `path`  | `string` | No       | Restrict history to commits that touch this file or directory.    |

## Result

| Name      | Type            | Description                              |
|-----------|-----------------|------------------------------------------|
| `commits` | `CommitInfo[]`  | Ordered list of commits (newest first).  |

### CommitInfo fields

| Field     | Type     | Description                        |
|-----------|----------|------------------------------------|
| `hash`    | `string` | Full 40-character commit hash.     |
| `message` | `string` | Subject line of the commit message.|
| `author`  | `string` | Commit author name.                |
| `date`    | `string` | ISO-8601 author date.              |

## Example Usage

```json
{
  "tool": "git_log",
  "params": {}
}
```

```json
{
  "tool": "git_log",
  "params": {
    "limit": 10
  }
}
```

```json
{
  "tool": "git_log",
  "params": {
    "limit": 5,
    "path": "src/index.ts"
  }
}
```

## Error Handling

| Error Code  | Cause                                                              |
|-------------|--------------------------------------------------------------------|
| `git-error` | `git log` exited with a non-zero status (e.g. not a git repo).    |

## Out of Scope

- Full commit message bodies (only subject line is returned)
- Merge commit details or diff stats
- Branch or tag filtering
- Complex `--grep` or author filtering

## Action Class

This tool is classified as `vcs.read` — a low-risk read-only operation that does not modify the git index or working tree. It is not subject to HITL gating.

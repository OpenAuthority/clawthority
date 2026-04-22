---
name: git_diff
version: 1.0.0
author: clawthority
license: MIT-0
description: Returns unified diff output for a git repository, with optional ref and path filters.
read_when: user asks to view a diff, show changes, compare commits, see what changed in a file, or inspect unstaged modifications
action_class: vcs.read
---

# /git_diff — View Diff Output

You are the **git_diff** tool for Clawthority. You return unified diff output from a git repository by running `git diff`.

## What You Do

You query the git diff and return a unified diff string. When no `ref` is provided, you show unstaged changes (working tree vs index). When a `ref` is provided, you compare the working tree against that commit. The output is filtered by `path` when specified.

## When to Trigger

Invoke this tool when the user or agent wants to:

- View unstaged changes in the working tree (`show me what I changed`)
- Compare the current state against a specific commit (`what changed since abc1234?`)
- Inspect changes to a specific file (`show me the diff for src/index.ts`)
- Review changes before staging or committing

## Parameters

| Name   | Type     | Required | Description                                                                 |
|--------|----------|----------|-----------------------------------------------------------------------------|
| `ref`  | `string` | No       | Commit ref to diff against. Omit to diff working tree against the index.    |
| `path` | `string` | No       | Restrict diff output to this file path.                                     |

## Result

| Name   | Type     | Description                                                        |
|--------|----------|--------------------------------------------------------------------|
| `diff` | `string` | Unified diff output. Empty string when there are no differences.   |

## Example Usage

```json
{
  "tool": "git_diff",
  "params": {}
}
```

```json
{
  "tool": "git_diff",
  "params": {
    "ref": "HEAD~1"
  }
}
```

```json
{
  "tool": "git_diff",
  "params": {
    "ref": "abc1234",
    "path": "src/index.ts"
  }
}
```

## Error Handling

| Error Code  | Cause                                                               |
|-------------|---------------------------------------------------------------------|
| `git-error` | `git diff` exited with a non-zero status (e.g. not a git repo, invalid ref). |

## Out of Scope

- Binary file diffs
- External diff tools
- Staged changes (`git diff --cached`)
- Diff statistics only (`git diff --stat`)

## Action Class

This tool is classified as `vcs.read` — a low-risk read-only operation that does not modify the git index or working tree. It is not subject to HITL gating.

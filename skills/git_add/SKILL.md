---
name: git_add
version: 1.0.0
author: clawthority
license: MIT-0
description: Stages specified file paths or glob patterns for commit in a git repository.
read_when: user asks to stage files, add files to git, add files to the index, or prepare files for commit
action_class: vcs.write
---

# /git_add — Stage Files for Commit

You are the **git_add** tool for Clawthority. You stage specified file paths or glob patterns in a git repository by running `git add`.

## What You Do

You accept a list of file paths or glob patterns and stage them in the current git repository's index, preparing them for the next commit.

## When to Trigger

Invoke this tool when the user or agent wants to:

- Stage one or more specific files (`src/index.ts`, `README.md`)
- Stage files matching a pattern (`*.ts`, `src/**/*.js`)
- Prepare a set of changes for an upcoming commit

## Parameters

| Name    | Type       | Required | Description                                             |
|---------|------------|----------|---------------------------------------------------------|
| `paths` | `string[]` | Yes      | File paths or glob patterns to stage. Must be non-empty.|

## Result

| Name          | Type       | Description                                      |
|---------------|------------|--------------------------------------------------|
| `stagedPaths` | `string[]` | The paths that were passed to `git add`.         |

## Example Usage

```json
{
  "tool": "git_add",
  "params": {
    "paths": ["src/index.ts", "README.md"]
  }
}
```

```json
{
  "tool": "git_add",
  "params": {
    "paths": ["*.ts"]
  }
}
```

## Error Handling

| Error Code      | Cause                                                         |
|-----------------|---------------------------------------------------------------|
| `path-not-found`| A concrete (non-glob) path does not exist on the filesystem.  |
| `git-error`     | `git add` exited with a non-zero status (e.g. not a git repo).|

## Out of Scope

- Interactive staging (`git add -p`)
- Patch mode
- Pushing or committing staged changes

## Action Class

This tool is classified as `vcs.write` — a medium-risk operation that modifies the git index. It is subject to `per_request` HITL gating when HITL policies are active.

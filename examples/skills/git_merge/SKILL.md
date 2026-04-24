---
name: git_merge
version: 1.0.0
author: clawthority
license: MIT-0
description: Merges a specified branch into the current branch in a git repository.
read_when: user asks to merge a branch, combine branch changes, or integrate a feature branch
action_class: vcs.write
---

# /git_merge — Merge Branch

You are the **git_merge** tool for Clawthority. You merge a specified branch into the current branch of a git repository by running `git merge`.

## What You Do

You accept a branch name and merge it into whatever branch is currently checked out. On success you return a status message from git. On conflict you raise a `merge-conflict` error that includes the list of files with conflicts.

## When to Trigger

Invoke this tool when the user or agent wants to:

- Merge a feature branch into the main branch (`merge feature into main`)
- Integrate upstream changes from another branch
- Combine work from a parallel branch into the current working branch

## Parameters

| Name     | Type     | Required | Description                                              |
|----------|----------|----------|----------------------------------------------------------|
| `branch` | `string` | Yes      | Name of the branch to merge into the current branch.     |

## Result

| Name      | Type      | Description                                         |
|-----------|-----------|-----------------------------------------------------|
| `merged`  | `boolean` | `true` when the merge completed without conflicts.  |
| `message` | `string`  | Human-readable status message from `git merge`.     |

## Example Usage

```json
{
  "tool": "git_merge",
  "params": {
    "branch": "feature/my-feature"
  }
}
```

```json
{
  "tool": "git_merge",
  "params": {
    "branch": "main"
  }
}
```

## Error Handling

| Error Code       | Cause                                                                          |
|------------------|--------------------------------------------------------------------------------|
| `branch-not-found` | The specified branch does not exist in the repository.                       |
| `merge-conflict`   | The merge produced conflicts; the `conflicts` property lists affected files. |
| `git-error`        | `git merge` exited with a non-zero status for another reason.                |

When `code` is `merge-conflict`, the error object exposes a `conflicts` array of file paths that need manual resolution before the merge can be completed.

## Out of Scope

- Conflict resolution (manual or automatic)
- Merge strategies (`--strategy`, `--strategy-option`)
- Squash merges (`--squash`)
- No-fast-forward enforcement (`--no-ff`)
- Rebasing

## Action Class

This tool is classified as `vcs.write` — a medium-risk operation that modifies the git history and working tree. It is subject to `per_request` HITL gating when HITL policies are active.

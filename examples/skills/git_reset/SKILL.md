---
name: git_reset
version: 1.0.0
author: clawthority
license: MIT-0
description: Resets the current HEAD to a specified commit with a chosen reset mode (soft, mixed, or hard).
read_when: user asks to undo a commit, reset HEAD, unstage changes, or discard commits
action_class: vcs.write
---

# /git_reset — Reset HEAD to Commit

You are the **git_reset** tool for Clawthority. You reset the current branch's HEAD to a specified commit by running `git reset --<mode> <ref>`.

## What You Do

You accept a reset mode (`soft`, `mixed`, or `hard`) and a commit reference (`ref`), then reset the repository state accordingly:

- **soft**: Moves HEAD to `ref`. The index (staging area) and working tree are unchanged. Commits after `ref` become staged changes ready to re-commit.
- **mixed** (git default): Moves HEAD to `ref` and resets the index. The working tree is unchanged. Commits after `ref` become unstaged changes.
- **hard**: Moves HEAD to `ref` and resets both the index and the working tree. All uncommitted changes to tracked files are permanently discarded.

On success you return `{ mode, ref, message }`. Hard resets additionally include a `warning` field reminding the caller that uncommitted changes have been discarded.

## When to Trigger

Invoke this tool when the user or agent wants to:

- Undo the last N commits while keeping the changes staged (`soft`)
- Undo commits and unstage the changes (`mixed`)
- Discard commits and all local changes completely (`hard`)
- Reset the index to a clean state matching a known commit

## Parameters

| Name   | Type                            | Required | Description                                                                          |
|--------|---------------------------------|----------|--------------------------------------------------------------------------------------|
| `mode` | `'soft' \| 'mixed' \| 'hard'` | Yes      | Reset mode controlling which layers (HEAD, index, working tree) are reset.           |
| `ref`  | `string`                        | Yes      | Commit reference (branch name, tag, relative ref like `HEAD~2`, or commit hash).    |

## Result

| Name      | Type     | Description                                                                                         |
|-----------|----------|-----------------------------------------------------------------------------------------------------|
| `mode`    | `string` | The reset mode that was applied.                                                                    |
| `ref`     | `string` | The commit reference that was reset to.                                                             |
| `message` | `string` | Human-readable status message from `git reset`.                                                     |
| `warning` | `string` | *(hard only)* Warns that uncommitted changes have been permanently discarded.                       |

## Example Usage

```json
{
  "tool": "git_reset",
  "params": {
    "mode": "soft",
    "ref": "HEAD~1"
  }
}
```

```json
{
  "tool": "git_reset",
  "params": {
    "mode": "mixed",
    "ref": "abc1234"
  }
}
```

```json
{
  "tool": "git_reset",
  "params": {
    "mode": "hard",
    "ref": "main"
  }
}
```

## Error Handling

| Error Code    | Cause                                                                        |
|---------------|------------------------------------------------------------------------------|
| `invalid-ref` | The specified commit reference does not exist or cannot be resolved.         |
| `git-error`   | `git reset` exited with a non-zero status for another reason (e.g. not in a git repo). |

## Out of Scope

- File-specific reset (`git reset <ref> -- <path>`)
- Interactive reset (`git reset -p`)
- Resetting a remote branch

## Action Class

This tool is classified as `vcs.write` — a medium-risk operation that modifies HEAD, the index, and potentially the working tree. It is subject to `per_request` HITL gating when HITL policies are active.

> **Warning:** Hard resets (`mode: 'hard'`) are destructive. They permanently discard all uncommitted changes to tracked files in the working tree and cannot be undone except via `git reflog`. Always confirm with the user before performing a hard reset.

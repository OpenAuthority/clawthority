---
name: git_status
version: 1.0.0
author: clawthority
license: MIT-0
description: Returns the current git repository status with staged, unstaged, and untracked file lists.
read_when: user asks to view repository status, show working tree state, see what files are changed, list staged or unstaged files, or check if there are uncommitted changes
action_class: vcs.read
---

# /git_status — View Repository Status

You are the **git_status** tool for Clawthority. You return the current working tree status from a git repository by running `git status --porcelain`.

## What You Do

You query the git repository state and return three lists of file paths:
- **staged**: files with changes staged for the next commit
- **unstaged**: files with changes in the working tree not yet staged
- **untracked**: files not tracked by git

A file that has been partially staged (staged with additional unstaged changes on top) appears in both `staged` and `unstaged`.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Check whether the repository is clean
- See which files have been modified
- List staged changes before committing
- Identify untracked files
- Inspect working tree state before running other VCS operations

## Parameters

This tool takes no parameters.

## Result

| Name        | Type       | Description                                              |
|-------------|------------|----------------------------------------------------------|
| `staged`    | `string[]` | Files with changes staged for commit.                    |
| `unstaged`  | `string[]` | Files with changes in the working tree not yet staged.   |
| `untracked` | `string[]` | Files not tracked by git.                                |

## Example Usage

```json
{
  "tool": "git_status",
  "params": {}
}
```

### Example Response (clean repo)

```json
{
  "staged": [],
  "unstaged": [],
  "untracked": []
}
```

### Example Response (dirty repo)

```json
{
  "staged": ["src/index.ts"],
  "unstaged": ["README.md"],
  "untracked": ["scratch.txt"]
}
```

## Error Handling

| Error Code  | Cause                                                                    |
|-------------|--------------------------------------------------------------------------|
| `git-error` | `git status` exited with a non-zero status (e.g. not a git repository).  |

## Out of Scope

- Remote tracking information (ahead/behind counts)
- Submodule status
- Branch name or HEAD reference
- Ignored files

## Action Class

This tool is classified as `vcs.read` — a low-risk read-only operation that does not modify the git index or working tree. It is not subject to HITL gating.

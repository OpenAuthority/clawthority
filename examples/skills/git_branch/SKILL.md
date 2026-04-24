---
name: git_branch
version: 1.0.0
author: clawthority
license: MIT-0
description: Creates a new branch in a git repository with an optional starting point.
read_when: user asks to create a branch, make a new branch, or branch from a commit or ref
action_class: vcs.write
---

# /git_branch — Create Branch

You are the **git_branch** tool for Clawthority. You create a new branch in a git repository by running `git branch <name> [<from>]`.

## What You Do

You accept a branch name (`name`) and an optional starting point (`from`) and create a new branch without switching to it. On success you return the branch name and a status message. If the branch already exists you raise a `branch-already-exists` error. If the starting point does not exist you raise a `from-not-found` error.

## When to Trigger

Invoke this tool when the user or agent wants to:

- Create a new feature branch (`branch feature/my-feature`)
- Create a branch from a specific commit or tag (`branch hotfix from v1.2.0`)
- Prepare a release branch from a development branch

## Parameters

| Name   | Type     | Required | Description                                                                 |
|--------|----------|----------|-----------------------------------------------------------------------------|
| `name` | `string` | Yes      | Name of the new branch to create.                                           |
| `from` | `string` | No       | Optional starting point (branch name, tag, or commit hash). Defaults to HEAD. |

## Result

| Name      | Type     | Description                              |
|-----------|----------|------------------------------------------|
| `name`    | `string` | The name of the branch that was created. |
| `message` | `string` | Human-readable status message.           |

## Example Usage

```json
{
  "tool": "git_branch",
  "params": {
    "name": "feature/my-feature"
  }
}
```

```json
{
  "tool": "git_branch",
  "params": {
    "name": "hotfix",
    "from": "v1.2.0"
  }
}
```

## Error Handling

| Error Code              | Cause                                                              |
|-------------------------|--------------------------------------------------------------------|
| `branch-already-exists` | A branch with the specified name already exists in the repository. |
| `from-not-found`        | The specified starting point does not exist.                       |
| `git-error`             | `git branch` exited with a non-zero status for another reason.    |

When `code` is `branch-already-exists`, the user must choose a different branch name or delete the existing branch first.

## Out of Scope

- Switching to the newly created branch (use `git_checkout` after creation)
- Branch deletion
- Branch listing

## Action Class

This tool is classified as `vcs.write` — a medium-risk operation that modifies the repository's ref namespace. It is subject to `per_request` HITL gating when HITL policies are active.

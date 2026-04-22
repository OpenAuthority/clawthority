---
name: git_checkout
version: 1.0.0
author: clawthority
license: MIT-0
description: Switches the working directory to a specified branch or commit in a git repository.
read_when: user asks to checkout a branch, switch to a branch, switch branches, or detach HEAD to a commit
action_class: vcs.write
---

# /git_checkout — Checkout Branch or Commit

You are the **git_checkout** tool for Clawthority. You switch the working directory to a specified branch or commit in a git repository by running `git checkout`.

## What You Do

You accept a branch name or commit hash (`ref`) and switch the current working directory to it. On success you return the ref and a status message from git. If the ref does not exist you raise a `ref-not-found` error. If uncommitted local changes would be overwritten you raise an `uncommitted-changes` error.

## When to Trigger

Invoke this tool when the user or agent wants to:

- Switch to a different branch (`checkout feature/my-feature`)
- Inspect a historical commit in detached HEAD state
- Return to the main branch after working on a feature branch

## Parameters

| Name  | Type     | Required | Description                                    |
|-------|----------|----------|------------------------------------------------|
| `ref` | `string` | Yes      | Branch name or commit hash to check out.       |

## Result

| Name      | Type     | Description                                           |
|-----------|----------|-------------------------------------------------------|
| `ref`     | `string` | The ref that was checked out.                         |
| `message` | `string` | Human-readable status message from `git checkout`.    |

## Example Usage

```json
{
  "tool": "git_checkout",
  "params": {
    "ref": "feature/my-feature"
  }
}
```

```json
{
  "tool": "git_checkout",
  "params": {
    "ref": "a1b2c3d4"
  }
}
```

## Error Handling

| Error Code            | Cause                                                                              |
|-----------------------|------------------------------------------------------------------------------------|
| `ref-not-found`       | The specified branch or commit does not exist in the repository.                   |
| `uncommitted-changes` | Local uncommitted changes to tracked files would be overwritten by the checkout.   |
| `git-error`           | `git checkout` exited with a non-zero status for another reason.                   |

When `code` is `uncommitted-changes`, the user must commit or stash their local changes before the checkout can proceed.

## Out of Scope

- Creating new branches (`git checkout -b`)
- Force-checkout that discards local changes (`git checkout --force`)
- Restoring individual files from a ref (`git checkout <ref> -- <path>`)

## Action Class

This tool is classified as `vcs.write` — a medium-risk operation that modifies the working tree and HEAD pointer. It is subject to `per_request` HITL gating when HITL policies are active.

---
name: git_push
version: 1.0.0
author: clawthority
license: MIT-0
description: Pushes commits from the current branch to a remote git repository.
read_when: user asks to push commits, upload changes to remote, publish a branch, or sync local commits to origin
action_class: vcs.remote
---

# /git_push — Push Commits to Remote

You are the **git_push** tool for Clawthority. You push commits from the current branch to a remote git repository by running `git push [remote] [branch]`.

## What You Do

You accept an optional remote name and an optional branch name. When neither is provided, git uses the configured tracking remote and branch. On success you return the remote, the branch, and a status message. If the remote does not exist you raise a `remote-not-found` error. If credentials are invalid you raise an `auth-error`. If the push is rejected (e.g. non-fast-forward) you raise a `rejected` error.

## When to Trigger

Invoke this tool when the user or agent wants to:

- Push local commits to a remote repository (`push to origin`)
- Publish a branch to a remote (`push my-feature to origin`)
- Upload work so others can see it or CI can run

## Parameters

| Name     | Type     | Required | Description                                                                                         |
|----------|----------|----------|-----------------------------------------------------------------------------------------------------|
| `remote` | `string` | No       | Name of the remote to push to (e.g. `"origin"`). Uses the configured tracking remote when omitted.  |
| `branch` | `string` | No       | Local branch to push (e.g. `"main"`). Uses the currently checked-out branch when omitted.           |

## Result

| Name      | Type      | Description                                        |
|-----------|-----------|----------------------------------------------------|
| `pushed`  | `boolean` | `true` when the push completed successfully.       |
| `remote`  | `string`  | Remote that was pushed to.                         |
| `branch`  | `string`  | Branch that was pushed.                            |
| `message` | `string`  | Human-readable status message from `git push`.     |

## Example Usage

```json
{
  "tool": "git_push",
  "params": {}
}
```

```json
{
  "tool": "git_push",
  "params": {
    "remote": "origin"
  }
}
```

```json
{
  "tool": "git_push",
  "params": {
    "remote": "origin",
    "branch": "main"
  }
}
```

## Error Handling

| Error Code         | Cause                                                                                          |
|--------------------|------------------------------------------------------------------------------------------------|
| `auth-error`       | Authentication or permission failure (wrong credentials, SSH key not authorized).              |
| `rejected`         | The push was rejected because the remote has commits that are not in the local history (non-fast-forward). Pull and rebase or merge before pushing. |
| `remote-not-found` | The remote name is not configured or the remote URL is unreachable.                            |
| `git-error`        | `git push` exited with a non-zero status for another reason (e.g. no upstream configured).     |

When `code` is `rejected`, the caller should pull and integrate the latest remote changes before retrying the push.

When `code` is `auth-error`, the user must configure valid credentials (SSH key, personal access token, or credential helper) before retrying.

## Out of Scope

- Force push (`--force`, `--force-with-lease`)
- Pushing tags (`--tags`)
- Setting upstream tracking (`--set-upstream`, `-u`)
- Push options (`--push-option`)

## Action Class

This tool is classified as `vcs.remote` — a medium-risk operation that contacts a remote git host and uploads local commits. It is subject to `per_request` HITL gating when HITL policies are active.

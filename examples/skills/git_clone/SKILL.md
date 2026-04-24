---
name: git_clone
version: 1.0.0
author: clawthority
license: MIT-0
description: Clones a remote git repository to a specified local path.
read_when: user asks to clone a repository, copy a remote repo locally, or download a git project
action_class: vcs.remote
---

# /git_clone — Clone Repository

You are the **git_clone** tool for Clawthority. You clone a remote git repository to a local path by running `git clone <url> <path>`.

## What You Do

You accept a repository URL (`url`) and a local destination path (`path`), validate both before execution, and clone the remote repository. On success you return the URL, the local path, and a status message. If the URL format is unrecognized you raise an `invalid-url` error. If the destination path already exists you raise a `path-exists` error.

## When to Trigger

Invoke this tool when the user or agent wants to:

- Clone a GitHub, GitLab, or other hosted repository to a local directory
- Copy a remote git repository for local development
- Download a project by its repository URL

## Parameters

| Name   | Type     | Required | Description                                                                             |
|--------|----------|----------|-----------------------------------------------------------------------------------------|
| `url`  | `string` | Yes      | URL of the remote repository. Accepted schemes: `https://`, `http://`, `git@`, `ssh://`, `git://`, `file://`. |
| `path` | `string` | Yes      | Local filesystem path where the repository will be cloned. Must not already exist.      |

## Result

| Name      | Type     | Description                                    |
|-----------|----------|------------------------------------------------|
| `url`     | `string` | The remote URL that was cloned.                |
| `path`    | `string` | The local path where the repository was cloned. |
| `message` | `string` | Human-readable status message.                 |

## Example Usage

```json
{
  "tool": "git_clone",
  "params": {
    "url": "https://github.com/example/my-project.git",
    "path": "/home/user/projects/my-project"
  }
}
```

```json
{
  "tool": "git_clone",
  "params": {
    "url": "git@github.com:example/my-project.git",
    "path": "/home/user/projects/my-project"
  }
}
```

## Error Handling

| Error Code    | Cause                                                                              |
|---------------|------------------------------------------------------------------------------------|
| `invalid-url` | The URL does not match a recognized git URL pattern (`https://`, `git@`, etc.).    |
| `path-exists` | The destination path already exists on the filesystem.                             |
| `git-error`   | `git clone` exited with a non-zero status for another reason (e.g. repo not found, network failure). |

When `code` is `path-exists`, the user must remove or rename the existing directory, or choose a different destination path.

When `code` is `git-error`, the error message will include the stderr output from git for diagnosis.

## Out of Scope

- Shallow clones (`--depth`)
- Cloning a specific branch (`--branch`)
- Authentication configuration (SSH keys, tokens must be pre-configured in the environment)

## Action Class

This tool is classified as `vcs.remote` — a medium-risk operation that initiates network contact with a remote git host and writes data to the local filesystem. It is subject to `per_request` HITL gating when HITL policies are active.

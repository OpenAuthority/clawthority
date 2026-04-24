---
name: make_dir
version: 1.0.0
author: clawthority
license: MIT-0
description: Creates a directory at the specified path, including any missing parent directories. Returns gracefully if the directory already exists.
read_when: user asks to create a directory, make a folder, mkdir, create nested directories, ensure a directory exists
action_class: filesystem.write
---

# /make_dir — Create Directory

You are the **make_dir** tool for Clawthority. You create a directory at the specified path, automatically creating any missing parent directories. If the directory already exists, you return successfully without modification.

## What You Do

- Creates the directory at `path`, including all missing intermediate directories.
- Returns gracefully (no error) if the directory already exists.
- Throws an error if `path` already exists as a file.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Create a new directory or folder
- Ensure a directory exists before writing files into it
- Create a nested directory structure in one call
- Set up project scaffolding directories

## Parameters

| Name   | Type     | Required | Description                          |
|--------|----------|----------|--------------------------------------|
| `path` | `string` | Yes      | Path of the directory to create.     |

## Result

| Name   | Type     | Description                                                  |
|--------|----------|--------------------------------------------------------------|
| `path` | `string` | Absolute path of the created (or already existing) directory. |

## Example Usage

### Create a new directory

```json
{
  "tool": "make_dir",
  "params": {
    "path": "/project/src/components"
  }
}
```

### Example Response

```json
{
  "path": "/project/src/components"
}
```

### Create nested directories

```json
{
  "tool": "make_dir",
  "params": {
    "path": "/project/src/features/auth/hooks"
  }
}
```

## Error Handling

| Error Code  | Cause                                                              |
|-------------|--------------------------------------------------------------------|
| `not-a-dir` | The specified `path` exists but is a file, not a directory.        |
| `fs-error`  | An unexpected filesystem error occurred while creating the directory. |

An already-existing directory is **not** an error — the tool returns `{ path }` successfully.

## Out of Scope

- Permission setting (chmod)
- Symbolic links
- Ownership changes

## Action Class

This tool is classified as `filesystem.write` — it modifies the filesystem by creating directories. It is subject to HITL gating.

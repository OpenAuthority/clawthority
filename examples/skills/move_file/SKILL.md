---
name: move_file
version: 1.0.0
author: clawthority
license: MIT-0
description: Moves a file from a source path to a destination path. The source file is removed after a successful move.
read_when: user asks to move a file, rename a file, mv, relocate a file, transfer a file to another path
action_class: filesystem.write
---

# /move_file — Move File

You are the **move_file** tool for Clawthority. You move a file from a source path to a destination path, removing the source file after a successful move.

## What You Do

- Moves the file at `from` to the path specified by `to`.
- The source file is removed after a successful move.
- The destination file is created if it does not exist, or overwritten if it does.
- Validates that the source path exists and is a regular file before moving.
- Uses `renameSync` for an atomic move on the same filesystem; falls back to copy+delete for cross-device moves with rollback on failure.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Move a file to a new location
- Rename a file (same or different directory)
- Relocate a file as part of a refactor or reorganization
- Transfer a file from one directory to another

## Parameters

| Name   | Type     | Required | Description                        |
|--------|----------|----------|------------------------------------|
| `from` | `string` | Yes      | Path of the source file to move.   |
| `to`   | `string` | Yes      | Path of the destination file.      |

## Result

| Name   | Type     | Description                                        |
|--------|----------|----------------------------------------------------|
| `from` | `string` | Absolute path of the source file (now removed).    |
| `to`   | `string` | Absolute path of the destination file.             |

## Example Usage

### Move a file to a new location

```json
{
  "tool": "move_file",
  "params": {
    "from": "/project/src/old-name.ts",
    "to": "/project/src/new-name.ts"
  }
}
```

### Example Response

```json
{
  "from": "/project/src/old-name.ts",
  "to": "/project/src/new-name.ts"
}
```

## Error Handling

| Error Code  | Cause                                                               |
|-------------|---------------------------------------------------------------------|
| `not-found` | The source path does not exist.                                     |
| `not-a-file`| The source path exists but is a directory, not a file.              |
| `fs-error`  | An unexpected filesystem error occurred during the move.            |

## Out of Scope

- Directory moves
- Overwrite protection (destination is always overwritten if it exists)
- Permission or metadata preservation
- Symbolic link handling

## Action Class

This tool is classified as `filesystem.write` — it modifies the filesystem by creating or overwriting the destination file and removing the source file. It is subject to HITL gating.

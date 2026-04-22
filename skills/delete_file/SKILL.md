---
name: delete_file
version: 1.0.0
author: clawthority
license: MIT-0
description: Removes a file or empty directory at the specified path. Recursive deletion and trash/recycle-bin moves are out of scope.
read_when: user asks to delete a file, remove a file, unlink a file, rm, delete a directory, remove an empty directory, rmdir
action_class: filesystem.delete
---

# /delete_file — Delete File or Empty Directory

You are the **delete_file** tool for Clawthority. You permanently remove a file or empty directory from the filesystem.

## What You Do

- Deletes the file or empty directory at `path`.
- Uses `unlinkSync` for regular files and `rmdirSync` for empty directories.
- Validates that the path exists before attempting deletion.
- Enforces a safety block on critical system paths (e.g. `/`, `/etc`, `/usr`).
- Rejects non-empty directories with a clear error rather than silently deleting content.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Delete a file that is no longer needed
- Remove a temporary or generated file
- Clean up an empty directory
- Unlink a file as part of a refactor or cleanup

## Parameters

| Name   | Type     | Required | Description                                      |
|--------|----------|----------|--------------------------------------------------|
| `path` | `string` | Yes      | Path of the file or empty directory to delete.   |

## Result

| Name   | Type     | Description                                           |
|--------|----------|-------------------------------------------------------|
| `path` | `string` | Absolute path of the deleted file or directory.       |

## Example Usage

### Delete a file

```json
{
  "tool": "delete_file",
  "params": {
    "path": "/project/tmp/output.log"
  }
}
```

### Example Response

```json
{
  "path": "/project/tmp/output.log"
}
```

### Delete an empty directory

```json
{
  "tool": "delete_file",
  "params": {
    "path": "/project/tmp/empty-dir"
  }
}
```

## Error Handling

| Error Code  | Cause                                                                   |
|-------------|-------------------------------------------------------------------------|
| `not-found` | The path does not exist on the filesystem.                              |
| `forbidden` | The path is a protected critical system path (e.g. `/`, `/etc`).       |
| `not-empty` | The path is a directory that still contains files or subdirectories.    |
| `fs-error`  | An unexpected filesystem error occurred during deletion.                |

## Out of Scope

- Recursive directory deletion (use a shell command for `rm -rf`)
- Moving to trash or recycle bin
- Deleting symlinks as their targets
- Permission changes before deletion

## Action Class

This tool is classified as `filesystem.delete` — it permanently removes files and directories from the filesystem. It is subject to HITL gating and carries a **high** risk tier.

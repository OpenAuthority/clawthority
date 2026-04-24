---
name: copy_file
version: 1.0.0
author: clawthority
license: MIT-0
description: Copies a file from a source path to a destination path. The source file remains unchanged after the operation.
read_when: user asks to copy a file, duplicate a file, cp, clone a file, make a copy of a file
action_class: filesystem.write
---

# /copy_file — Copy File

You are the **copy_file** tool for Clawthority. You copy a file from a source path to a destination path, leaving the source file unchanged.

## What You Do

- Copies the file at `from` to the path specified by `to`.
- The source file remains unchanged after the operation.
- The destination file is created if it does not exist, or overwritten if it does.
- Validates that the source path exists and is a regular file before copying.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Duplicate a file to a new location
- Back up a file before modifying it
- Copy a template file to a new destination
- Create a copy of a configuration or script file

## Parameters

| Name   | Type     | Required | Description                        |
|--------|----------|----------|------------------------------------|
| `from` | `string` | Yes      | Path of the source file to copy.   |
| `to`   | `string` | Yes      | Path of the destination file.      |

## Result

| Name   | Type     | Description                              |
|--------|----------|------------------------------------------|
| `from` | `string` | Absolute path of the source file.        |
| `to`   | `string` | Absolute path of the destination file.   |

## Example Usage

### Copy a file

```json
{
  "tool": "copy_file",
  "params": {
    "from": "/project/src/config.template.json",
    "to": "/project/src/config.json"
  }
}
```

### Example Response

```json
{
  "from": "/project/src/config.template.json",
  "to": "/project/src/config.json"
}
```

## Error Handling

| Error Code  | Cause                                                          |
|-------------|----------------------------------------------------------------|
| `not-found` | The source path does not exist.                                |
| `not-a-file`| The source path exists but is a directory, not a file.         |
| `fs-error`  | An unexpected filesystem error occurred during the copy.       |

## Out of Scope

- Directory copying
- Permission preservation
- Symbolic link handling

## Action Class

This tool is classified as `filesystem.write` — it modifies the filesystem by creating or overwriting the destination file. It is subject to HITL gating.

---
name: check_exists
version: 1.0.0
author: clawthority
license: MIT-0
description: Checks whether a given path exists in the filesystem, returning a boolean result for both files and directories.
read_when: user asks to check if file exists, verify path exists, check if directory exists, test file existence, path exists
action_class: filesystem.read
---

# /check_exists — Check Path Existence

You are the **check_exists** tool for Clawthority. You check whether a given path exists in the filesystem and return a boolean result.

## What You Do

- Returns `{ exists: true }` if the path exists (file or directory).
- Returns `{ exists: false }` if the path does not exist.
- Does not throw errors for non-existent paths.
- Works for both files and directories.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Verify whether a file or directory exists before reading or writing
- Guard conditional logic on path existence
- Check if a configuration file or output directory is present

## Parameters

| Name   | Type     | Required | Description                           |
|--------|----------|----------|---------------------------------------|
| `path` | `string` | Yes      | Absolute path to check for existence. |

## Result

| Name     | Type      | Description                                     |
|----------|-----------|-------------------------------------------------|
| `exists` | `boolean` | Whether the path exists in the filesystem.      |

## Example Usage

### Check if a file exists

```json
{
  "tool": "check_exists",
  "params": {
    "path": "/project/src/index.ts"
  }
}
```

### Example Response (file exists)

```json
{
  "exists": true
}
```

### Example Response (path does not exist)

```json
{
  "exists": false
}
```

### Check if a directory exists

```json
{
  "tool": "check_exists",
  "params": {
    "path": "/project/dist"
  }
}
```

## Error Handling

| Error Code | Cause                                            |
|------------|--------------------------------------------------|
| `fs-error` | An unexpected filesystem error occurred.         |

Non-existent paths return `{ exists: false }` and do not throw errors.

## Out of Scope

- File type detection (file vs. directory)
- Permission checks
- File metadata (size, modification time)

## Action Class

This tool is classified as `filesystem.read` — a read-only operation that does not modify the filesystem. It is not subject to HITL gating.

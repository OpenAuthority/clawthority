---
name: edit_file
version: 1.0.0
author: clawthority
license: MIT-0
description: Replaces the first occurrence of old_string with new_string in a file.
read_when: user asks to edit a file, replace text in a file, update a specific string in a file, or make a targeted change to file content
action_class: filesystem.write
---

# /edit_file — Edit File Contents

You are the **edit_file** tool for Clawthority. You perform a targeted string replacement in a file by reading its content, replacing the first occurrence of `old_string` with `new_string`, and writing the result back.

## What You Do

You modify a file in-place using an exact string replacement:
- Reads the file at `path` as UTF-8 text.
- Replaces the **first** occurrence of `old_string` with `new_string`.
- Writes the updated content back to the same path.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Edit a specific piece of text in a file
- Replace a function name, variable, or string literal
- Update configuration values in a file
- Make a targeted, surgical change to file content

## Parameters

| Name         | Type     | Required | Description                              |
|--------------|----------|----------|------------------------------------------|
| `path`       | `string` | Yes      | Path to the file to edit.                |
| `old_string` | `string` | Yes      | The string to find and replace.          |
| `new_string` | `string` | Yes      | The string to replace `old_string` with. |

## Result

| Name   | Type     | Description                        |
|--------|----------|------------------------------------|
| `path` | `string` | Absolute path of the modified file. |

## Example Usage

```json
{
  "tool": "edit_file",
  "params": {
    "path": "/project/src/config.ts",
    "old_string": "const PORT = 3000;",
    "new_string": "const PORT = 8080;"
  }
}
```

### Example Response

```json
{
  "path": "/project/src/config.ts"
}
```

## Error Handling

| Error Code         | Cause                                                              |
|--------------------|--------------------------------------------------------------------|
| `not-found`        | The specified `path` does not exist.                               |
| `not-a-file`       | The specified `path` exists but is a directory, not a file.        |
| `string-not-found` | `old_string` was not found in the file content.                    |
| `fs-error`         | An unexpected filesystem error occurred while reading or writing.  |

## Out of Scope

- Regex-based replacement
- Replacing all occurrences (only the first is replaced)
- Editing multiple files in one call
- Binary file editing

## Action Class

This tool is classified as `filesystem.write` — it modifies file content on disk. It is subject to HITL gating.

---
name: write_file
version: 1.0.0
author: clawthority
license: MIT-0
description: Writes UTF-8 text content to a file, creating it (and any missing parent directories) if it does not exist, or overwriting it if it does.
read_when: user asks to write a file, create a new file, save content to a file, overwrite a file, or create files with specific content
action_class: filesystem.write
---

# /write_file — Write File Contents

You are the **write_file** tool for Clawthority. You write UTF-8 text content to a file, creating the file and any missing parent directories if they do not exist, or overwriting the file if it already exists.

## What You Do

You write content to a file path:
- Creates the file at `path` with the specified `content`.
- Creates any missing intermediate directories automatically.
- Overwrites the file if it already exists.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Create a new file with specific content
- Save text output to a file
- Overwrite an existing file with new content
- Write configuration, code, or data files

## Parameters

| Name      | Type     | Required | Description                              |
|-----------|----------|----------|------------------------------------------|
| `path`    | `string` | Yes      | Path to the file to write.               |
| `content` | `string` | Yes      | UTF-8 text content to write to the file. |

## Result

| Name   | Type     | Description                       |
|--------|----------|-----------------------------------|
| `path` | `string` | Absolute path of the written file. |

## Example Usage

```json
{
  "tool": "write_file",
  "params": {
    "path": "/project/src/config.ts",
    "content": "export const PORT = 8080;\n"
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

| Error Code  | Cause                                                             |
|-------------|-------------------------------------------------------------------|
| `not-a-file` | The specified `path` exists but is a directory, not a file.      |
| `fs-error`  | An unexpected filesystem error occurred while writing the file.   |

## Out of Scope

- Append mode (use `edit_file` for targeted modifications)
- Binary content
- Atomic writes (rename-based)
- File permission control

## Action Class

This tool is classified as `filesystem.write` — it modifies file content on disk. It is subject to HITL gating.

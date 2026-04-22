---
name: read_file
version: 1.0.0
author: clawthority
license: MIT-0
description: Reads the UTF-8 text content of a file and returns it as a string.
read_when: user asks to read a file, show file contents, display a file, cat a file, or view the text of a file
action_class: filesystem.read
---

# /read_file — Read File Contents

You are the **read_file** tool for Clawthority. You return the UTF-8 text content of a file by reading it from the filesystem.

## What You Do

You read a file at a given path and return its full text content:
- Returns the complete file contents as a UTF-8 string.
- Preserves all whitespace, newlines, and unicode characters exactly as stored.
- Does not modify the file in any way.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Read the contents of a file
- Display what is in a file
- Retrieve source code or configuration from a file
- Inspect a text file before editing it

## Parameters

| Name   | Type     | Required | Description               |
|--------|----------|----------|---------------------------|
| `path` | `string` | Yes      | Path to the file to read. |

## Result

| Name      | Type     | Description                         |
|-----------|----------|-------------------------------------|
| `content` | `string` | UTF-8 text content of the file.     |

## Example Usage

```json
{
  "tool": "read_file",
  "params": {
    "path": "/project/src/index.ts"
  }
}
```

### Example Response

```json
{
  "content": "import { foo } from './foo.js';\n\nfoo();\n"
}
```

## Error Handling

| Error Code  | Cause                                                           |
|-------------|-----------------------------------------------------------------|
| `not-found` | The specified `path` does not exist.                            |
| `not-a-file`| The specified `path` exists but is a directory, not a file.     |
| `fs-error`  | An unexpected filesystem error occurred while reading the file. |

## Out of Scope

- Binary files (images, archives, compiled artifacts)
- Directory listing
- File metadata (size, permissions, modification time)
- Partial reads or line-range selection

## Action Class

This tool is classified as `filesystem.read` — a read-only operation that does not modify the filesystem. It is not subject to HITL gating.

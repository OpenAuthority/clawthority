---
name: read_files_batch
version: 1.0.0
author: clawthority
license: MIT-0
description: Reads the UTF-8 text content of multiple files in a single concurrent operation, returning a mapping of paths to their content or error status.
read_when: user asks to read multiple files at once, batch read files, read several files, read a list of files
action_class: filesystem.read
---

# /read_files_batch — Batch Read File Contents

You are the **read_files_batch** tool for Clawthority. You read multiple files concurrently in a single operation and return each file's content or a typed error result, keyed by the original path.

## What You Do

- Reads all specified files concurrently using `Promise.allSettled`.
- Returns a `results` object mapping each requested path to either a success or error entry.
- A failure on one file does not prevent the remaining files from being read.
- Does not modify any files.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Read the contents of multiple files in one operation
- Avoid repeated individual `read_file` calls for a known list of paths
- Inspect several source files, configurations, or text files at once

## Parameters

| Name    | Type       | Required | Description                        |
|---------|------------|----------|------------------------------------|
| `paths` | `string[]` | Yes      | List of file paths to read.        |

## Result

| Name      | Type     | Description                                                                     |
|-----------|----------|---------------------------------------------------------------------------------|
| `results` | `object` | Mapping of each requested path to its per-file result (see below).              |

### Per-file result shape

**Success:**
```json
{ "status": "ok", "content": "<utf-8 string>" }
```

**Failure:**
```json
{ "status": "error", "code": "not-found | not-a-file | fs-error", "message": "<description>" }
```

## Example Usage

```json
{
  "tool": "read_files_batch",
  "params": {
    "paths": [
      "/project/src/index.ts",
      "/project/src/utils.ts"
    ]
  }
}
```

### Example Response

```json
{
  "results": {
    "/project/src/index.ts": {
      "status": "ok",
      "content": "import { foo } from './foo.js';\n\nfoo();\n"
    },
    "/project/src/utils.ts": {
      "status": "error",
      "code": "not-found",
      "message": "File not found: /project/src/utils.ts"
    }
  }
}
```

## Error Handling

| Error Code   | Cause                                                           |
|--------------|-----------------------------------------------------------------|
| `not-found`  | The specified path does not exist.                              |
| `not-a-file` | The specified path exists but is a directory, not a file.       |
| `fs-error`   | An unexpected filesystem error occurred while reading the file. |

Errors are returned per-file in the `results` map — the tool itself never throws.

## Out of Scope

- Binary files (images, archives, compiled artifacts)
- Directory listing
- Streaming large files
- File metadata (size, permissions, modification time)

## Action Class

This tool is classified as `filesystem.read` — a read-only operation that does not modify the filesystem. It is not subject to HITL gating.

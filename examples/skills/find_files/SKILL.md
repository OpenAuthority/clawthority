---
name: find_files
version: 1.0.0
author: clawthority
license: MIT-0
description: Searches a directory tree recursively for files whose relative path matches a glob pattern, returning an array of absolute file paths.
read_when: user asks to find files, locate files by pattern, search for files, find all .ts files, glob search
action_class: filesystem.read
---

# /find_files — Find Files by Glob Pattern

You are the **find_files** tool for Clawthority. You search a directory tree recursively for files whose relative path matches a glob pattern and return an array of matching absolute file paths.

## What You Do

- Traverses the specified directory (or current working directory) recursively.
- Matches each file's **relative path from the search root** against the glob pattern.
- Returns an array of absolute file paths for every matched file.
- Does not follow symbolic links or read file contents.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Find all files matching a name pattern (e.g., all `.ts` files, all `package.json` files)
- Locate specific files anywhere in a project tree
- Enumerate files of a given extension before batch-reading them

## Parameters

| Name      | Type     | Required | Description                                                                                                       |
|-----------|----------|----------|-------------------------------------------------------------------------------------------------------------------|
| `pattern` | `string` | Yes      | Glob pattern matched against each file's relative path. Supports `*`, `**`, `?`, and `{a,b}` alternation.        |
| `path`    | `string` | No       | Absolute path of the directory to search. Defaults to the current working directory when omitted.                 |

### Pattern Syntax

| Token    | Matches                                                                 |
|----------|-------------------------------------------------------------------------|
| `*`      | Zero or more characters, excluding `/` (single directory level only).   |
| `**`     | Zero or more path segments, including `/` (crosses directory boundaries). Use as `**/` prefix or at end of pattern. |
| `?`      | Exactly one character, excluding `/`.                                   |
| `{a,b}`  | Either `a` or `b` (literal alternatives, comma-separated).              |

## Result

| Name    | Type       | Description                                                    |
|---------|------------|----------------------------------------------------------------|
| `paths` | `string[]` | Array of absolute file paths whose relative path matched the pattern. Empty array when no files match. |

## Example Usage

### Find all TypeScript files recursively

```json
{
  "tool": "find_files",
  "params": {
    "pattern": "**/*.ts",
    "path": "/project/src"
  }
}
```

### Example Response

```json
{
  "paths": [
    "/project/src/index.ts",
    "/project/src/utils/helpers.ts",
    "/project/src/tools/read_file/read-file.ts"
  ]
}
```

### Find all package.json files

```json
{
  "tool": "find_files",
  "params": {
    "pattern": "**/package.json",
    "path": "/project"
  }
}
```

### Find TypeScript or TSX files at root level

```json
{
  "tool": "find_files",
  "params": {
    "pattern": "*.{ts,tsx}",
    "path": "/project/src"
  }
}
```

## Error Handling

| Error Code  | Cause                                                              |
|-------------|--------------------------------------------------------------------|
| `not-found` | The specified `path` does not exist.                               |
| `not-a-dir` | The specified `path` exists but is a file, not a directory.        |
| `fs-error`  | An unexpected filesystem error occurred while accessing the path.  |

Errors are thrown as `FindFilesError` instances with a `code` discriminant. When `path` is omitted and the current working directory is inaccessible, an `fs-error` is thrown.

## Out of Scope

- Content-based search (use `read_files_batch` to read matched files)
- Following symbolic links
- Returning directory paths (only regular files are included in results)
- File metadata (size, permissions, modification time)

## Action Class

This tool is classified as `filesystem.read` — a read-only operation that does not modify the filesystem. It is not subject to HITL gating.

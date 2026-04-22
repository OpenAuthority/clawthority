---
name: list_dir
version: 1.0.0
author: clawthority
license: MIT-0
description: Lists file and directory names in a specified path, with optional recursive traversal.
read_when: user asks to list files in a directory, show directory contents, explore a folder, or traverse a file tree
action_class: filesystem.list
---

# /list_dir — List Directory Contents

You are the **list_dir** tool for Clawthority. You return an array of file and directory names in a specified path by reading the filesystem.

## What You Do

You read the contents of a directory and return a list of entry names:
- **Flat mode** (default): returns the immediate children of `path` (file and directory names only).
- **Recursive mode**: returns all descendants as relative paths (e.g. `"sub/file.txt"`), including intermediate directory names.

## When to Trigger

Invoke this tool when the user or agent wants to:
- List files in a directory
- Explore what is inside a folder
- Find all files under a directory tree (recursive mode)
- Check if a directory is empty

## Parameters

| Name        | Type      | Required | Description                                                         |
|-------------|-----------|----------|---------------------------------------------------------------------|
| `path`      | `string`  | Yes      | Directory path to list.                                             |
| `recursive` | `boolean` | No       | When `true`, recursively list all subdirectories. Defaults to `false`. |

## Result

| Name      | Type       | Description                                                                                  |
|-----------|------------|----------------------------------------------------------------------------------------------|
| `entries` | `string[]` | Array of names (flat) or relative paths (recursive). Empty array for an empty directory.     |

## Example Usage

### Flat listing

```json
{
  "tool": "list_dir",
  "params": {
    "path": "/project/src"
  }
}
```

### Example Response

```json
{
  "entries": ["index.ts", "utils", "types.ts"]
}
```

### Recursive listing

```json
{
  "tool": "list_dir",
  "params": {
    "path": "/project/src",
    "recursive": true
  }
}
```

### Example Response

```json
{
  "entries": ["index.ts", "utils", "utils/helpers.ts", "types.ts"]
}
```

## Error Handling

| Error Code  | Cause                                                             |
|-------------|-------------------------------------------------------------------|
| `not-found` | The specified `path` does not exist.                              |
| `not-a-dir` | The specified `path` exists but is a file, not a directory.       |
| `fs-error`  | An unexpected filesystem error occurred while reading the path.   |

## Out of Scope

- File metadata (size, permissions, modification time)
- Filtering by file type or extension
- Hidden file exclusion

## Action Class

This tool is classified as `filesystem.list` — a read-only operation that does not modify the filesystem. It is not subject to HITL gating.

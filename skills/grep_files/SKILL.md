---
name: grep_files
version: 1.0.0
author: clawthority
license: MIT-0
description: Searches for a regex pattern across files in a directory tree, returning an array of matches with file paths, line numbers, and matched line content.
read_when: user asks to search file contents, find text in files, grep files, search for a pattern, find which files contain a string
action_class: filesystem.read
---

# /grep_files — Search File Contents by Pattern

You are the **grep_files** tool for Clawthority. You search for a regular expression pattern across files in a directory tree and return an array of matches with file paths, 1-based line numbers, and matched line content.

## What You Do

- Traverses the specified directory (or current working directory) recursively.
- Optionally filters candidate files using a glob pattern before searching.
- Reads each candidate file as UTF-8 text and tests every line against the regex pattern.
- Returns all matching lines with their absolute file path, 1-based line number, and line content.
- Does not modify any files. Binary files that cannot be decoded as UTF-8 are silently skipped.

## When to Trigger

Invoke this tool when the user or agent wants to:
- Find all occurrences of a function, variable, or string literal across a project
- Locate which files contain a specific import, class name, or keyword
- Perform content-based file search rather than name-based search (use `find_files` for name-based)

## Parameters

| Name      | Type     | Required | Description                                                                                                                    |
|-----------|----------|----------|--------------------------------------------------------------------------------------------------------------------------------|
| `pattern` | `string` | Yes      | Regular expression pattern to search for in file contents. Supports standard JavaScript regex syntax.                          |
| `path`    | `string` | No       | Absolute path of the directory to search. Defaults to the current working directory when omitted.                              |
| `glob`    | `string` | No       | Optional glob pattern to restrict which files are searched. Supports `*`, `**`, `?`, and `{a,b}` alternation. When omitted, all files are searched. |

## Result

| Name      | Type          | Description                                                                           |
|-----------|---------------|---------------------------------------------------------------------------------------|
| `matches` | `GrepMatch[]` | Array of matches found across all searched files. Empty array when nothing is found.  |

### GrepMatch shape

| Field     | Type     | Description                                          |
|-----------|----------|------------------------------------------------------|
| `file`    | `string` | Absolute path of the file containing the match.      |
| `line`    | `number` | 1-based line number of the matching line.            |
| `content` | `string` | Full text of the matching line (newline stripped).   |

## Example Usage

### Search for a function across all TypeScript files

```json
{
  "tool": "grep_files",
  "params": {
    "pattern": "function grepFiles",
    "path": "/project/src",
    "glob": "**/*.ts"
  }
}
```

### Example Response

```json
{
  "matches": [
    {
      "file": "/project/src/tools/grep_files/grep-files.ts",
      "line": 42,
      "content": "export function grepFiles(params: GrepFilesParams): GrepFilesResult {"
    }
  ]
}
```

### Search with regex

```json
{
  "tool": "grep_files",
  "params": {
    "pattern": "^import.*from",
    "path": "/project/src",
    "glob": "**/*.ts"
  }
}
```

### Search all files (no glob filter)

```json
{
  "tool": "grep_files",
  "params": {
    "pattern": "TODO",
    "path": "/project"
  }
}
```

## Error Handling

| Error Code      | Cause                                                              |
|-----------------|--------------------------------------------------------------------|
| `not-found`     | The specified `path` does not exist.                               |
| `not-a-dir`     | The specified `path` exists but is a file, not a directory.        |
| `invalid-regex` | The supplied `pattern` is not a valid regular expression.          |
| `fs-error`      | An unexpected filesystem error occurred while accessing the path.  |

Errors are thrown as `GrepFilesError` instances with a `code` discriminant.

## Out of Scope

- Binary file search
- Complex regex features beyond standard JavaScript RegExp
- Streaming large files
- File metadata (size, permissions, modification time)
- Context lines (lines before/after matches)

## Action Class

This tool is classified as `filesystem.read` — a read-only operation that does not modify the filesystem. It is not subject to HITL gating.

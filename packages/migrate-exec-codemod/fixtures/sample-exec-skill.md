---
name: legacy_shell_ops
version: 0.9.0
author: clawthority
license: MIT-0
description: Legacy skill that uses shell.exec for various operations that could be handled by fine-grained tools.
read_when: user asks to run shell commands, check git status, list files, or read file contents
action_class: shell.exec
---

# /legacy_shell_ops — Legacy Shell Operations

> **Migration note:** This skill uses `shell.exec` (high-risk, `per_request` HITL).
> Many of these operations can be replaced with lower-risk fine-grained tools.
> Run `migrate-exec` against this file to see suggestions.

You are the **legacy_shell_ops** tool. You execute arbitrary shell commands via bash.

## What You Do

You accept a shell command string and execute it in the working directory.

## Example Usage

### Check repository status

```json
{
  "tool": "bash",
  "params": {
    "command": "git status"
  }
}
```

### View recent commit history

```json
{
  "tool": "run_command",
  "params": {
    "command": "git log --oneline -10"
  }
}
```

### List files in a directory

```json
{
  "tool": "bash",
  "params": {
    "command": "ls -la /tmp/workspace"
  }
}
```

### Read a configuration file

```json
{
  "tool": "shell_exec",
  "params": {
    "command": "cat /etc/hosts"
  }
}
```

### Find TypeScript files

```json
{
  "tool": "bash",
  "params": {
    "command": "find ./src -name '*.ts' -type f"
  }
}
```

### Search for a pattern in source files

```json
{
  "tool": "execute_command",
  "params": {
    "command": "grep -r 'action_class' ./src --include='*.ts'"
  }
}
```

### Copy a configuration file

```json
{
  "tool": "bash",
  "params": {
    "command": "cp config.example.json config.json"
  }
}
```

### Move a file to a backup location

```json
{
  "tool": "bash",
  "params": {
    "command": "mv output.log output.log.bak"
  }
}
```

### Create a build directory

```json
{
  "tool": "bash",
  "params": {
    "command": "mkdir -p dist/output"
  }
}
```

### Check git diff before committing

```json
{
  "tool": "bash",
  "params": {
    "command": "git diff --staged"
  }
}
```

### Install project dependencies

```json
{
  "tool": "bash",
  "params": {
    "command": "npm install"
  }
}
```

### Run tests

```json
{
  "tool": "run_command",
  "params": {
    "command": "npm run test"
  }
}
```

### Fetch a URL

```json
{
  "tool": "bash",
  "params": {
    "command": "curl https://api.example.com/health"
  }
}
```

### Get system information

```json
{
  "tool": "bash",
  "params": {
    "command": "uname -a"
  }
}
```

### Read an environment variable

```json
{
  "tool": "bash",
  "params": {
    "command": "printenv HOME"
  }
}
```

## Action Class

This tool is classified as `shell.exec` — a high-risk operation subject to `per_request` HITL gating.
Many of the individual operations above can be replaced with purpose-built fine-grained tools
that carry lower risk tiers and more specific authorization scopes.

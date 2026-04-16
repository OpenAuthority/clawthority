# Rule Deletion Guide

> **What this page is for.** How to safely remove rules from the active policy bundle — bundle structure, impact preview, and step-by-step procedure.

---

## Table of Contents

1. [Overview](#overview)
2. [Policy Bundle Structure](#policy-bundle-structure)
3. [Rule File Location and Format](#rule-file-location-and-format)
4. [Step-by-Step Deletion Procedure](#step-by-step-deletion-procedure)
5. [Examples](#examples)
6. [Troubleshooting](#troubleshooting)

---

## Overview

Rules in Clawthority are stored in a versioned JSON bundle at `data/bundles/active/bundle.json`. Deleting a rule requires three steps:

1. Remove the rule object from the `rules` array.
2. Increment the bundle `version`.
3. Recompute the `checksum` over the new `rules` array.

The adapter hot-reloads the bundle within ~500 ms. No restart is needed.

> **Forbid-wins warning**: removing a `forbid` rule immediately lifts the restriction it enforced. Double-check the impact before saving.

---

## Policy Bundle Structure

```
~/.openclaw/plugins/clawthority/
└── data/
    └── bundles/
        ├── active/
        │   └── bundle.json     ← live bundle; watched for changes
        └── proposals/          ← staged bundles not yet activated
```

`bundle.json` contains three top-level fields:

| Field | Type | Description |
|---|---|---|
| `version` | `number` (≥ 1) | Monotonically increasing bundle version. Must be strictly greater than the previously loaded version. |
| `rules` | `BundleRule[]` | Ordered array of policy rules. Evaluated in array order; `forbid` wins over `permit` regardless of position. |
| `checksum` | `string` | SHA-256 hex digest of `JSON.stringify(rules)`. Tamper-evident; mismatches reject the bundle. |

### Rule object fields

Each entry in `rules` supports:

| Field | Required | Description |
|---|---|---|
| `effect` | Yes | `"permit"` or `"forbid"` |
| `action_class` | One of these three is required | Canonical action class (e.g., `"filesystem.read"`) |
| `resource` | One of these three is required | Resource type (`"tool"`, `"command"`, `"channel"`, `"prompt"`, `"model"`) |
| `intent_group` | One of these three is required | Named intent group (e.g., `"destructive_fs"`) |
| `match` | No | Glob or `/regex/` pattern matched against the resource name |
| `reason` | No | Human-readable explanation; appears in audit logs |
| `tags` | No | String array for grouping and filtering |
| `rateLimit` | No | `{ maxCalls, windowSeconds }` sliding-window rate limit |
| `target_match` | No | Regex/string narrowing by action target (email address, URL, path) |
| `target_in` | No | Explicit list of targets for case-insensitive equality check |
| `priority` | No | Evaluation order hint (lower = earlier). Tiers: 10 permitted baseline, 90 HITL-gated forbid, 100 unconditional forbid |

---

## Rule File Location and Format

**Default path:** `data/bundles/active/bundle.json` (relative to the plugin root)

**Override:** set `bundlePath` in `openclaw.plugin.json`:

```json
{
  "bundlePath": "/var/clawthority/bundles/active"
}
```

The file must be valid UTF-8 JSON. Trailing commas and comments are not supported.

**Minimal valid bundle:**

```json
{
  "version": 2,
  "rules": [],
  "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

> The checksum above is the SHA-256 of an empty string, which equals `JSON.stringify([])`.

---

## Step-by-Step Deletion Procedure

### 1. Back up the current bundle

```bash
cp data/bundles/active/bundle.json data/bundles/active/bundle.json.bak
```

### 2. Open the bundle file

```bash
$EDITOR data/bundles/active/bundle.json
```

### 3. Identify and remove the target rule

Locate the rule in the `rules` array. Each rule is a JSON object. Remove the entire object — including the surrounding `{…}` and the preceding or trailing comma.

**Before:**
```json
{
  "rules": [
    { "effect": "permit", "action_class": "filesystem.read",   "reason": "Reads permitted" },
    { "effect": "forbid", "action_class": "payment.initiate",  "reason": "Transfers blocked" },
    { "effect": "permit", "action_class": "web.search",        "reason": "Search permitted" }
  ]
}
```

**After** (removing the `payment.initiate` rule):
```json
{
  "rules": [
    { "effect": "permit", "action_class": "filesystem.read", "reason": "Reads permitted" },
    { "effect": "permit", "action_class": "web.search",      "reason": "Search permitted" }
  ]
}
```

### 4. Increment the version

Change `"version"` to a value strictly greater than the current number:

```json
{
  "version": 2,
  ...
}
```

### 5. Recompute the checksum

Run this one-liner from the plugin root (or from the directory containing `bundle.json`):

```bash
node -e "
  const fs = require('fs');
  const crypto = require('crypto');
  const bundle = JSON.parse(fs.readFileSync('data/bundles/active/bundle.json', 'utf8'));
  const checksum = crypto.createHash('sha256').update(JSON.stringify(bundle.rules)).digest('hex');
  console.log(checksum);
"
```

Copy the printed hex string and set it as the `checksum` field in `bundle.json`.

### 6. Save and verify

Save the file. The `FileAuthorityAdapter` detects the change and reloads within ~500 ms. Check the OpenClaw log for:

```
[clawthority] Bundle reloaded (version 2, 11 rules)
```

If the bundle is rejected, the log shows:

```
[clawthority] Bundle reload failed: <reason>
```

The previously loaded bundle stays active until a valid bundle is accepted.

---

## Examples

### Remove a single `forbid` rule by action class

**Scenario:** Lift the `payment.initiate` block to allow payment initiation through without HITL.

Starting bundle (version 3, 12 rules):

```json
{
  "version": 3,
  "rules": [
    { "effect": "permit",  "action_class": "filesystem.read",   "reason": "Reads permitted" },
    { "effect": "forbid",  "action_class": "payment.initiate",  "reason": "Initiation requires HITL", "tags": ["payment", "hitl"] },
    { "effect": "forbid",  "action_class": "credential.write",  "reason": "Credential writes require HITL", "tags": ["credential", "hitl"] }
  ],
  "checksum": "..."
}
```

After removing `payment.initiate` (version bumped to 4):

```json
{
  "version": 4,
  "rules": [
    { "effect": "permit",  "action_class": "filesystem.read",  "reason": "Reads permitted" },
    { "effect": "forbid",  "action_class": "credential.write", "reason": "Credential writes require HITL", "tags": ["credential", "hitl"] }
  ],
  "checksum": "<recomputed>"
}
```

Recompute checksum:

```bash
node -e "
  const crypto = require('crypto');
  const rules = [
    { effect: 'permit', action_class: 'filesystem.read', reason: 'Reads permitted' },
    { effect: 'forbid', action_class: 'credential.write', reason: 'Credential writes require HITL', tags: ['credential', 'hitl'] }
  ];
  console.log(crypto.createHash('sha256').update(JSON.stringify(rules)).digest('hex'));
"
```

### Remove an intent group rule

**Scenario:** Remove the `destructive_fs` intent group block.

Locate the rule:

```json
{
  "effect": "forbid",
  "intent_group": "destructive_fs",
  "reason": "Destructive filesystem operations are unconditionally forbidden",
  "tags": ["filesystem", "security"]
}
```

Delete the object from the array, bump `version`, recompute the checksum.

> **Warning:** Removing this rule allows filesystem tools aliased to the `destructive_fs` intent group (e.g., `rm`, `delete_file`, `unlink`) to execute if no other `forbid` rule blocks them. Consider replacing it with a narrower rule before deleting the broad intent group rule.

### Remove all rules with a given tag

Use `jq` to filter out rules tagged `hitl` and produce a new rules array:

```bash
jq '.rules |= map(select(.tags | if . then index("hitl") == null else true end))' \
  data/bundles/active/bundle.json > /tmp/bundle-new.json
```

Inspect the result:

```bash
cat /tmp/bundle-new.json
```

If it looks correct, bump the version, recompute the checksum, then replace the file:

```bash
# Bump version manually in /tmp/bundle-new.json, then:
node -e "
  const fs = require('fs');
  const crypto = require('crypto');
  const b = JSON.parse(fs.readFileSync('/tmp/bundle-new.json', 'utf8'));
  b.checksum = crypto.createHash('sha256').update(JSON.stringify(b.rules)).digest('hex');
  fs.writeFileSync('/tmp/bundle-new.json', JSON.stringify(b, null, 2));
  console.log('checksum written:', b.checksum);
"
cp /tmp/bundle-new.json data/bundles/active/bundle.json
```

### Stage a deletion as a proposal

If you want to review the change before it goes live, write the modified bundle to the `proposals/` directory first:

```bash
cp data/bundles/active/bundle.json data/bundles/proposals/bundle-v4.json
# Edit data/bundles/proposals/bundle-v4.json: remove rule, bump version, recompute checksum
# When ready to activate:
cp data/bundles/proposals/bundle-v4.json data/bundles/active/bundle.json
```

The adapter only watches `data/bundles/active/`. The `proposals/` directory is inert until you promote a bundle into `active/`.

---

## Troubleshooting

### Bundle reload fails: "Checksum mismatch"

The `checksum` field does not match `SHA-256(JSON.stringify(rules))`.

**Fix:** Recompute the checksum after every edit to the `rules` array:

```bash
node -e "
  const fs = require('fs');
  const crypto = require('crypto');
  const bundle = JSON.parse(fs.readFileSync('data/bundles/active/bundle.json', 'utf8'));
  console.log(crypto.createHash('sha256').update(JSON.stringify(bundle.rules)).digest('hex'));
"
```

Common causes:
- Whitespace or key ordering changes — `JSON.stringify` is sensitive to key order in objects. Always pass the parsed `bundle.rules` array through `JSON.stringify` rather than computing the hash on the raw file text.
- Editing the file with a tool that normalises the JSON (e.g., Prettier) before you recompute the checksum.

### Bundle reload fails: "Version must be greater than current version"

The new bundle's `version` is not strictly greater than the version in the currently active bundle.

**Fix:** Read the current version from the running bundle:

```bash
node -e "const b=require('./data/bundles/active/bundle.json'); console.log(b.version);"
```

Set `version` in your edited bundle to at least that number plus 1.

### Bundle reload fails: "Rule at index N must have either action_class, resource, or intent_group"

After removing a rule you may have left a partial object or an empty `{}` behind.

**Fix:** Ensure every remaining rule object has at least one of `action_class`, `resource`, or `intent_group`. Use a JSON linter to verify:

```bash
node -e "JSON.parse(require('fs').readFileSync('data/bundles/active/bundle.json','utf8')); console.log('valid JSON')"
```

### Reload log does not appear

The `FileAuthorityAdapter` watches the `active/` directory using Chokidar. If the log is silent after saving:

1. Confirm the file was actually saved to the watched path (`data/bundles/active/bundle.json`, not a backup or temp file).
2. Some editors write to a temp file then rename it. Chokidar handles renames but the debounce window is ~500 ms — wait a moment.
3. Restart OpenClaw if the watcher has become unresponsive (rare; usually caused by filesystem events being dropped on heavily loaded systems).

### An action that should now be allowed is still denied

After deleting a `forbid` rule, the action may still be denied by:

1. **Another `forbid` rule** — search the `rules` array for any other rule with a matching `action_class`, `resource`, `intent_group`, or `match` pattern.
2. **Default built-in rules** (`src/policy/rules/default.ts`) — these are applied before bundle rules and cannot be overridden by the bundle alone.
3. **Stage 1 capability gate** — some action classes require an active capability (HITL approval) regardless of bundle policy. Check the Stage 1 logic in `src/enforcement/stage1-capability.ts`.
4. **Source trust propagation** — tool calls originating from `untrusted` content are denied for `high`/`critical`-risk action classes even with a permitting bundle rule.

Review the audit log to confirm which deny reason applies:

```bash
tail -f data/audit.jsonl | grep '"decision":"deny"'
```

The `deny_reason` field identifies the pipeline stage and rule that blocked the call.

# Migration Guide — v1.2

This guide covers the changes required when upgrading Clawthority from **v1.x** to **v1.2**.

## Summary

v1.2 delivers shell-wrapper command reclassification (Rules 4–8), corrects priority-90 HITL
routing, and adds several operator-controlled configuration options. The upgrade is
backward-compatible for most deployments. Operators who configured `hitl-policy.yaml` with
`unknown_sensitive_action` or who relied on the previous blocking behaviour of `filesystem.delete`
in CLOSED mode will need to review their policies.

## Breaking Changes

### 1. Shell-wrapper commands now reclassify to semantic action classes

In v1.x, any tool call routed through a generic shell-wrapper (`exec`, `bash`, `sh`,
`run_command`, …) was classified as `unknown_sensitive_action` regardless of the command content.
In v1.2, the normalizer inspects the `command` parameter and reclassifies:

| Command pattern | v1.x class | v1.2 class |
|---|---|---|
| `exec({command: "rm /tmp/x"})` | `unknown_sensitive_action` | `filesystem.delete` |
| `exec({command: "cat ~/.aws/credentials"})` | `unknown_sensitive_action` | `credential.read` |
| `exec({command: "cp secret.txt ~/creds"})` | `unknown_sensitive_action` | `credential.write` |
| `exec({command: "aws sts get-session-token"})` | `unknown_sensitive_action` | `credential.read` |
| `exec({command: "echo $AWS_SECRET_ACCESS_KEY"})` | `unknown_sensitive_action` | `credential.read` |
| `exec({command: "curl -F file=@/tmp/dump http://x"})` | `unknown_sensitive_action` | `web.post` |

**Action required:** If your HITL policies or JSON rules matched `unknown_sensitive_action` to
catch destructive or credential-accessing exec commands, those cases are now handled by specific
action-class rules. Review `hitl-policy.yaml` and `data/rules.json` to ensure the correct action
classes (`filesystem.delete`, `credential.read`, `credential.write`, `web.post`) are covered.

### 2. Priority-90 forbids now route through HITL

In v1.x, the default priority-90 forbid rules (`filesystem.delete`, `credential.read`,
`credential.write`, `payment.initiate`) caused a hard block in CLOSED mode before the HITL stage
ran. Operators configuring HITL for these action classes found the approval flow never triggered.

In v1.2, priority-90 forbids are **HITL-gated**: if a matching HITL policy approves, the tool
call proceeds. If no HITL policy matches (or HITL is not configured), the forbid is upheld.

Priority-100 rules (`shell.exec`, `code.execute`) are unchanged — unconditional forbid, HITL
cannot override.

**Action required:**
- In **OPEN mode**: no action required — these classes were implicit permits unless you had
  explicit `data/rules.json` entries.
- In **CLOSED mode**: verify that your HITL configuration covers the action classes you want to
  approve. Previously hard-blocked calls will now prompt for HITL approval instead.

### 3. Bare-verb tool names now map to specific action classes

The following tool name aliases are now registered in the normalizer:

| Tool name | v1.x class | v1.2 class |
|---|---|---|
| `read` | `unknown_sensitive_action` | `filesystem.read` |
| `write` | `unknown_sensitive_action` | `filesystem.write` |
| `edit` | `unknown_sensitive_action` | `filesystem.write` |
| `list` | `unknown_sensitive_action` | `filesystem.list` |

**Action required:** If you had explicit rules matching `unknown_sensitive_action` to gate these
tools, replace them with action-class-specific rules. No change needed if you rely on the default
rule set.

### 4. `unknown_sensitive_action` in HITL policies now warns at load time

If `hitl-policy.yaml` contains a policy matching `unknown_sensitive_action` (or a bare `*`),
Clawthority logs a `[hitl-policy] ⚠` warning at activation. Matching on `unknown_sensitive_action`
routes all unrecognized tools — including read-only operations — through human approval, which can
lock the agent in an approval loop it cannot exit.

**Action required:** Review `hitl-policy.yaml` and replace `unknown_sensitive_action` entries with
specific action classes.

---

## Migration Steps

### Step 1 — Review HITL policies

Open `hitl-policy.yaml` and check for `unknown_sensitive_action` entries:

```yaml
# Before (v1.x — catches unknown tools, but also locks out read-only ops):
- action_class: unknown_sensitive_action
  channel: slack
  mode: per_request
```

Replace with the specific action classes you want to gate:

```yaml
# After (v1.2):
- action_class: filesystem.delete
  channel: slack
  mode: per_request

- action_class: credential.read
  channel: slack
  mode: per_request
```

### Step 2 — Verify HITL routing for filesystem.delete

If you run in CLOSED mode and expect `filesystem.delete` to trigger HITL approval:

1. Ensure `hitl-policy.yaml` has an entry for `filesystem.delete`.
2. Test with a staging tool call: `exec({command: "rm /tmp/test"})`.
3. Confirm the approval prompt appears in your configured HITL channel.

Previously this hard-blocked without prompting. If you see the approval flow, the fix is working.

### Step 3 — Review data/rules.json for exec-based rules

If you added `data/rules.json` rules matching exec by tool name (e.g.
`{"resource": "tool", "match": "exec", "effect": "forbid"}`), review whether the new semantic
reclassification makes them redundant. Overly broad exec rules may now fire alongside the new
action-class rules.

Migrate to action-class matching where appropriate:

```json
[
  { "action_class": "filesystem.delete", "effect": "forbid", "priority": 90 },
  { "action_class": "credential.read",   "effect": "forbid", "priority": 90 }
]
```

### Step 4 — Set OPENAUTH_FORCE_ACTIVE=1 in production

Security finding F-01 recommends this for production. Add to your deployment configuration:

```bash
export OPENAUTH_FORCE_ACTIVE=1
```

This prevents the install-phase enforcement bypass from activating in production environments
where npm lifecycle events might re-run (e.g. dependency updates in containerised deploys).

### Step 5 — Update audit log monitoring

The audit log (`data/audit.jsonl`) now emits `{type: "policy"}` entries for every block decision,
not just HITL events. Update any log-parsing scripts or alerting pipelines that assumed only HITL
entries appear in the audit log.

Filter by type in queries:

```bash
# All block decisions
tail -n 100 data/audit.jsonl | jq 'select(.type == "policy" and .effect == "forbid")'

# HITL events only
tail -n 100 data/audit.jsonl | jq 'select(.type == "hitl")'
```

---

## New Configuration Options

### CLAWTHORITY_CREDENTIAL_PATHS

Append custom credential file path patterns to Rule 5:

```bash
export CLAWTHORITY_CREDENTIAL_PATHS='\\.company/secrets\\b,/var/run/my-secrets/\\w+'
```

Comma-separated list of regex sources. Each entry is compile-tested at load; invalid patterns are
logged and skipped, leaving the rest of the list intact.

### CLAWTHORITY_RULES_FILE

Override the default `data/rules.json` path:

```bash
export CLAWTHORITY_RULES_FILE=/opt/clawthority/rules/production.json
```

Useful for non-standard install layouts or when pointing a test harness at a fixture rule file.

### New data/rules.json matching forms

The `data/rules.json` format now supports `action_class` and `intent_group` matching in addition
to the existing `resource`/`match` form:

```json
[
  { "action_class": "filesystem.delete",   "effect": "forbid", "priority": 90 },
  { "intent_group": "data_exfiltration",   "effect": "forbid", "priority": 90 },
  { "resource": "tool", "match": "my_tool", "effect": "permit" }
]
```

`priority` is optional. Rules without `priority` default to unconditional forbid (fail-closed for
user-written forbids). Priority 90 is HITL-gated; priority 100 is unconditional and cannot be
overridden by HITL.

---

## Verification

Run the automated release validator to confirm all checks pass:

```typescript
import { ReleaseValidator } from './src/validation/release-validator.js';

const result = new ReleaseValidator().validate({
  root: process.cwd(),
  targetVersion: '1.2.0',
});

if (!result.valid) {
  for (const f of result.failures) {
    console.error(`[${f.id}] ${f.description}: ${f.reason}`);
  }
} else {
  console.log('All release checks passed.');
}
```

Run the full test suite:

```bash
npm test
npm run test:e2e
```

Verify no open critical findings remain:

```bash
grep -E '\|\s*[A-Z]-[0-9]+\s*\|[^|]*\|\s*Critical\s*\|\s*Open\s*\|' docs/security-review-v2.md \
  && echo "BLOCKER: open critical findings" \
  || echo "OK: no open critical findings"
```

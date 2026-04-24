# Operator Security Guide

> **What this page is for.** Security procedures and configuration requirements for operators deploying Clawthority in production environments. Covers F-01 (`OPENAUTH_FORCE_ACTIVE`), F-02 (in-memory token consumption), `unsafe_admin_exec` usage guidance, and the G-06 quarterly security audit process.
>
> **Audience:** Operators installing, configuring, or maintaining Clawthority in any environment beyond local development.

---

## Table of Contents

1. [F-01: OPENAUTH_FORCE_ACTIVE Configuration](#f-01-openauth_force_active-configuration)
2. [F-02: In-Memory Token Consumption — Production Considerations](#f-02-in-memory-token-consumption--production-considerations)
3. [unsafe_admin_exec — Operator Guidance](#unsafe_admin_exec--operator-guidance)
4. [G-06: Quarterly Security Audit Process](#g-06-quarterly-security-audit-process)

---

## F-01: OPENAUTH_FORCE_ACTIVE Configuration

**Finding severity:** Medium
**Reference:** [Security Review §3.1](security-review.md#f-01--install-phase-bypass-via-environment-variable)

### What it controls

Clawthority includes an install-phase bypass: when `npm_lifecycle_event` is one of `install`, `preinstall`, `postinstall`, or `prepare`, the enforcement pipeline is suspended and all requests are permitted. This prevents enforcement from blocking npm's own lifecycle scripts during package installation.

The `OPENAUTH_FORCE_ACTIVE` environment variable controls whether this bypass is active:

| Value | Behavior |
|---|---|
| Unset or any value other than `'1'` | Install-phase bypass is active: enforcement suspends during npm lifecycle events |
| `'1'` | Install-phase bypass is suppressed: enforcement stays active throughout the process lifetime |

### Runtime warning

When `OPENAUTH_FORCE_ACTIVE` is not set to `'1'` and an npm lifecycle event fires in the host process, Clawthority logs:

```
[clawthority] install_phase_bypass: enforcement suspended during npm lifecycle
```

This line in a production log is a signal that enforcement was suspended. If you see it outside an intentional package-install window, investigate whether a dependency `postinstall` script triggered it.

With `OPENAUTH_FORCE_ACTIVE=1`, this log line will never appear — enforcement remains active regardless of npm lifecycle events.

### Required configuration for production

**Set `OPENAUTH_FORCE_ACTIVE=1` in every production deployment.** Without it, any code running inside an npm lifecycle event — including a compromised `postinstall` script from a supply-chain dependency — can bypass all enforcement for its duration.

#### Plugin manifest example

Production plugin manifest deployments must include `OPENAUTH_FORCE_ACTIVE=1`:

```json
{
  "id": "clawthority",
  "name": "clawthority",
  "displayName": "Clawthority",
  "openclaw": {
    "apiVersion": "1",
    "type": "plugin",
    "capabilities": [
      "semantic-authorization",
      "action-normalization",
      "audit-logging",
      "hitl-approval"
    ],
    "hooks": ["before_tool_call", "before_prompt_build"],
    "installPath": "~/.openclaw/plugins/clawthority"
  },
  "env": {
    "OPENAUTH_FORCE_ACTIVE": "1",
    "CLAWTHORITY_MODE": "closed"
  }
}
```

#### Docker

```dockerfile
ENV OPENAUTH_FORCE_ACTIVE=1
ENV CLAWTHORITY_MODE=closed
```

Or at runtime:

```bash
docker run \
  -e OPENAUTH_FORCE_ACTIVE=1 \
  -e CLAWTHORITY_MODE=closed \
  your-openclaw-image
```

Or in `docker-compose.yml`:

```yaml
services:
  openclaw:
    image: your-openclaw-image
    environment:
      - OPENAUTH_FORCE_ACTIVE=1
      - CLAWTHORITY_MODE=closed
```

#### systemd

```ini
[Unit]
Description=OpenClaw agent with Clawthority enforcement
After=network.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/opt/openclaw
ExecStart=/usr/bin/node dist/index.js
Environment=OPENAUTH_FORCE_ACTIVE=1
Environment=CLAWTHORITY_MODE=closed
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

#### .env file / process manager

```bash
# .env (injected at runtime — do not commit to git)
OPENAUTH_FORCE_ACTIVE=1
CLAWTHORITY_MODE=closed
```

### Verification

After setting the variable, confirm the bypass is disabled by checking startup logs. The normal activation message should appear without any `install_phase_bypass` entries:

```
[clawthority] mode: CLOSED (implicit deny; explicit permits required)
[clawthority] Plugin activated. Watching rules for changes.
```

If you see `install_phase_bypass` in a production log after setting `OPENAUTH_FORCE_ACTIVE=1`, the variable may not be propagated to the plugin process. Verify the variable is set in the correct process environment (not just the shell session that launched the process manager).

---

## F-02: In-Memory Token Consumption — Production Considerations

**Finding severity:** Medium
**Status:** Documented limit; persistent revocation deferred — see [Security Review §3.2](security-review.md#f-02--in-memory-token-consumption-tracking)

### The limitation

`ApprovalManager` tracks consumed capability tokens **in memory only**. A process restart clears the consumed-token set. A capability token issued immediately before a restart but not yet consumed remains valid and replayable until its TTL expires.

The full replay attack chain:
1. Attacker (or benign actor) obtains a valid, unconsumed capability token via a HITL approval
2. Attacker forces a process restart (crash, SIGKILL, container restart)
3. Token is replayed within its TTL window (default: 120 seconds)

This requires both HITL approval access and process-restart capability — a moderate-difficulty combination in practice.

### Mitigation tiers

| Deployment type | Recommended mitigation |
|---|---|
| Local development | Acceptable risk. Use the default file adapter. |
| Staging / low-frequency restarts | Minimize unplanned restarts. Use a process manager with restart backoff ≥ TTL. |
| Production with strict security requirements | Use the Firma remote adapter for persistent revocation (see below). |

### Production recommendation

For deployments requiring strict token revocation guarantees:

1. **Firma remote adapter** (in development): persists consumed capability IDs server-side via `watchRevocations()`, surviving process restarts. Upgrade to the remote adapter when it ships.

2. **Minimize restart windows**: configure your process manager to restart only when necessary. In systemd, set `RestartSec` to at least the configured capability TTL:

   ```ini
   RestartSec=120s   # match or exceed capability TTL
   ```

3. **Reduce capability TTL**: lower the TTL to the minimum value that still allows approvers to respond. A 30–60 second TTL significantly reduces the replay window versus the default 120 seconds.

4. **Alert on unexpected restarts**: treat any process restart preceded by a recent HITL approval as a potential security event. Correlate restart timestamps with HITL audit entries.

### File adapter limitation notice

When using the file adapter (the default), the plugin warns at startup:

```
[clawthority] WARNING: Using file adapter — capability token revocation is in-memory only.
              Production deployments should use the Firma remote adapter for persistent revocation.
```

Do not rely on the file adapter for token revocation integrity in high-security production environments.

---

## unsafe_admin_exec — Operator Guidance

**Tool action class:** `shell.exec`
**Risk tier:** High
**Default HITL mode:** per_request
**Reference:** [Security Review §5](security-review.md#5-cs-11-emergency-exec--pre-implementation-review)

### What it is

`unsafe_admin_exec` is a break-glass tool for executing shell commands in emergency recovery scenarios where normal agent tools cannot resolve the situation. It is **not** intended for routine automation.

`shell.exec` is unconditionally forbidden at priority 100 by default. Enabling `unsafe_admin_exec` requires three independent operator actions, and every invocation must clear four runtime gates.

### Enabling the tool

#### Step 1 — Set the environment variable

```bash
export CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC=1
```

Without this set to `'1'`, every invocation is rejected immediately:

```
[clawthority] unsafe-admin-exec: disabled — CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC is not set to 1
```

#### Step 2 — Add an explicit permit rule

Add a targeted permit rule to your rules file. Because the default priority 100 forbid covers `shell.exec`, the permit rule must use a higher priority:

```json
[
  {
    "id": "break-glass-unsafe-admin-exec",
    "effect": "permit",
    "resource": "tool",
    "match": "unsafe_admin_exec",
    "priority": 101,
    "reason": "Operator break-glass: emergency shell execution — remove when emergency is resolved",
    "tags": ["security", "break-glass", "temporary"]
  }
]
```

> **Warning:** This rule grants shell execution. Remove it immediately after the emergency is resolved. Consider restricting it further using the `condition` field to limit by agent ID or session.

#### Step 3 — Configure a HITL policy

Every invocation requires a capability token from a completed HITL approval. Add a policy covering `shell.exec`:

```yaml
version: "1"
policies:
  - name: unsafe-admin-exec-approval
    description: Every shell execution requires explicit human approval
    actions:
      - "shell.exec"
    approval:
      channel: telegram   # or slack
      timeout: 120
      fallback: deny
    tags: [break-glass, security]
```

### Per-invocation runtime gates

Each invocation must clear all four gates in order:

| Gate | Requirement | Error code on failure |
|---|---|---|
| Environment | `CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC=1` | `disabled` |
| Justification | `justification` parameter ≥ 20 characters | `invalid-justification` |
| HITL token | `approval_id` must be present | `hitl-required` |
| Replay prevention | Token must not have been previously consumed | `token-replayed` |

The token is consumed before command execution, so it cannot be replayed even if the process is interrupted mid-command.

### Audit log events

All gate checks and executions are written to the audit log:

| `event` field | Logged when |
|---|---|
| `disabled` | Environment variable absent or not `'1'` |
| `invalid-justification` | Justification shorter than 20 characters |
| `hitl-required` | No `approval_id` provided |
| `token-replayed` | Capability token already consumed |
| `exec-attempt` | All gates passed; command about to execute |
| `exec-complete` | Command exited; exit code recorded |
| `exec-error` | Command spawn failed (e.g., invalid working directory) |

Commands are sanitized before logging (truncated, credentials redacted). The `justification` string is recorded verbatim in every entry.

### Operational checklist

Before enabling `unsafe_admin_exec` in any environment:

- [ ] Confirm the emergency cannot be resolved with scoped tools (`filesystem.*`, `web.*`, `credential.*`)
- [ ] Confirm a HITL approver is available on the configured channel
- [ ] Set `CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC=1` in the environment
- [ ] Add the break-glass permit rule to the rules file
- [ ] Request and receive HITL approval for the specific command before calling the tool
- [ ] Provide a justification of at least 20 characters describing the exact reason
- [ ] Verify the `exec-complete` audit log entry after execution
- [ ] **Remove the permit rule and unset the environment variable immediately when the emergency is resolved**
- [ ] File a post-incident note referencing the audit log `approvalId`

### Compliance with CS-11 pre-implementation requirements

`unsafe_admin_exec` partially satisfies the F-06/CS-11 mandatory requirements from the security review:

| Requirement | Status | Notes |
|---|---|---|
| Multi-factor authorization | Partial | HITL approval + env var; hardware-token factor not implemented |
| Time-bounded window | Partial | Capability TTL limits per-token window; no session-level time bound |
| Command allowlist | Not implemented | Arbitrary shell allowed; scope via HITL policy and permit rules |
| Immutable audit trail | ✅ Implemented | All events logged before and after execution |
| Process isolation | Not implemented | Executes in the plugin process |
| No agent-accessible path | ✅ Implemented | Requires operator-set environment variable |
| Rate limiting | Not implemented | Must be enforced via HITL policy and ops process |

Use `unsafe_admin_exec` as a break-glass tool only, not for sustained automation.

---

## G-06: Quarterly Security Audit Process

**Cadence:** Once per quarter
**Owner:** Security-responsible engineer or designated security reviewer
**Output:** Updated `docs/security-review.md` (§8 Document History) and filed action items

### Purpose

G-06 is a quarterly review that validates the ongoing accuracy of `docs/security-review.md`, confirms open findings are progressing, and identifies any new security-relevant changes that warrant a finding update.

G-06 focuses on **security posture**. It is distinct from the coverage review (see `docs/coverage-review-runbook.md`), which focuses on taxonomy health (unsafe-legacy deadlines, unclassified-tool drift, RFC progress).

### Schedule

| Quarter | Review window | Output |
|---|---|---|
| Q1 | January 8 – January 21 | Revision entry added to `docs/security-review.md` §8 |
| Q2 | April 8 – April 21 | Revision entry added to `docs/security-review.md` §8 |
| Q3 | July 8 – July 21 | Revision entry added to `docs/security-review.md` §8 |
| Q4 | October 8 – October 21 | Revision entry added to `docs/security-review.md` §8 |

Assign a primary reviewer and a backup at the start of each quarter. Record the assignment in the Document History entry.

### Step 1 — Review open findings

For each finding in `docs/security-review.md` with status `Open` or `Mitigated via documentation`:

1. Re-read the finding description and recommended remediation.
2. Check whether the remediation has been applied (code review, documentation check, or infrastructure verification).
3. Update the finding status:
   - `Open` → `Mitigated via documentation` if documentation-only remediation is now complete
   - `Open` or `Mitigated via documentation` → `Resolved` if full technical remediation is shipped
   - Keep as-is with a progress note if no change has occurred
4. Update both the summary table in §1 and the detailed finding section.

### Step 2 — Review new code changes

```bash
git log --since="3 months ago" --oneline -- \
  src/enforcement/ src/hitl/ src/policy/ src/tools/unsafe_admin_exec/
```

For each significant commit:

1. Assess whether the change introduces, removes, or modifies a security boundary.
2. If a new finding is warranted, add it to the findings table in §1 (next available F-number) and create a numbered section.
3. If an existing finding is resolved by the commit, update its status.

### Step 3 — F-01 and F-02 operational check

1. Open this guide (`docs/operator-security-guide.md`) and `docs/installation.md`.
2. Verify all production deployment examples include `OPENAUTH_FORCE_ACTIVE=1` (Docker, systemd, `.env`).
3. Confirm the F-02 limitation notice is present in `docs/installation.md` under "Production Deployment".
4. Check whether the Firma remote adapter has shipped. If so:
   - Update F-02 status to `Resolved` in `docs/security-review.md`
   - Document the persistent revocation path in [F-02 section](#f-02-in-memory-token-consumption--production-considerations) of this guide
   - Remove the file adapter limitation notice if no longer applicable

### Step 4 — unsafe_admin_exec gate audit

1. Read `src/tools/unsafe_admin_exec/unsafe-admin-exec.ts` and confirm all four gates are intact:
   - Gate 1: `CLAWTHORITY_ENABLE_UNSAFE_ADMIN_EXEC === '1'`
   - Gate 2: `justification.length >= 20`
   - Gate 3: `approval_id` present
   - Gate 4: token not consumed (`approvalManager.isConsumed()`)
2. Confirm audit log events cover all gate outcomes.
3. Update the CS-11 compliance table in this guide if any new F-06 requirements have been implemented.

### Step 5 — Document history entry

Add a revision row to `docs/security-review.md` §8 (Document History):

```markdown
| rev N | YYYY-MM | @reviewer | G-06 Q{N} review: {summary — "no new findings" or list of changes} |
```

If the review produced no changes, still add the row with "No new findings."

### Action item tracking

File GitHub issues for any open items with:
- Labels: `security`, `g-06`
- Title prefix: `[G-06] `

Reference the issue number(s) in the Document History entry.

### Escalation to full external review

Request an external security review when:
- A new finding is rated **Critical** or **High**
- The enforcement gate receives substantial new logic (≥ 150 lines changed in `src/enforcement/`)
- `unsafe_admin_exec` is enabled in production for more than 48 continuous hours
- The Firma remote adapter ships and changes the token revocation architecture
- An incident or near-miss implicates the enforcement gate or HITL flow

---

## Related Documents

- [Security Review](security-review.md) — Full finding record and pre-implementation requirements
- [Installation Guide — Production Deployment](installation.md#production-deployment) — F-01 deployment examples
- [Configuration Reference — Environment Variables](configuration.md#environment-variables) — Full environment variable table
- [Human-in-the-Loop](human-in-the-loop.md) — HITL channel setup and capability token lifecycle
- [Coverage Review Runbook](coverage-review-runbook.md) — Taxonomy health review (E-06/E-07/E-08)

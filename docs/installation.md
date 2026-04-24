# Installation Guide

> **What this page is for.** Installing and registering the Clawthority plugin for OpenClaw, and configuring the HITL approval flow.

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and configured
- Node.js 18 or later
- npm 9 or later

## Plugin Installation

### 1. Install from npm

```bash
mkdir -p ~/.openclaw/plugins/clawthority
cd ~/.openclaw/plugins/clawthority
npm init -y >/dev/null
npm install @clawthority/clawthority
```

The published package contains only `dist/`, `openclaw.plugin.json`, and `scripts/post-install.mjs` — no source, tests, or examples. The `postinstall` hook runs `scripts/post-install.mjs`, which writes a `data/.installed` activation marker into the plugin directory and does nothing else (no shell-outs, no network, no writes outside the plugin root).

> If you want to build from source (for development or to audit the code), clone the repository to a working directory and run `npm install && npm run build`. Do not `git clone` into `~/.openclaw/plugins/` directly — that directory should contain the published artifact only.

### 2. Register with OpenClaw

Add the plugin to your OpenClaw configuration file at `~/.openclaw/config.json`:

```json
{
  "plugins": ["clawthority"]
}
```

OpenClaw will load `dist/index.js` as the plugin entry point on next start.

### 3. Choose your install mode (optional)

Clawthority ships with two postures:

- **`open` (default)** — implicit permit with a critical-forbid safety net. Every tool call is allowed unless it hits `shell.exec`, `code.execute`, `payment.initiate`, `credential.read`, `credential.write`, or `unknown_sensitive_action`. Pick this for a zero-friction install when you plan to add forbids as you discover what needs locking down.

- **`closed`** — implicit deny. No tool call is allowed unless an explicit `permit` rule covers it. Pick this for locked-down production deployments where the allow-list is authoritative.

Select mode via the `CLAWTHORITY_MODE` environment variable before launching the agent:

```bash
# open (default) — nothing to set
# closed
export CLAWTHORITY_MODE=closed
```

Mode is read once at activation; restart the agent to change it. See [configuration.md — Install mode](configuration.md#install-mode) for the full rule-set breakdown per mode.

### 4. Verify installation

Restart OpenClaw and check the logs for a line like:

```
[clawthority] mode: OPEN (implicit permit; critical forbids enforced)
[clawthority] Plugin activated. Watching rules for changes.
```

---

## HITL Policy Setup

To enable Human-in-the-Loop approval flows, create a HITL policy file.

### 1. Create the policy file

Create `hitl-policy.yaml` in the plugin directory:

```yaml
version: "1"
policies:
  - name: destructive-actions
    description: Require human approval for irreversible operations
    actions:
      - "email.delete"
      - "file.delete"
      - "*.deploy"
    approval:
      channel: telegram
      timeout: 120
      fallback: deny
    tags: [production, safety]
```

### 2. Configure the approval channel

The `channel` field determines where approval requests are sent. Supported channels:

| Channel | Status | Description |
|---|---|---|
| `telegram` | Primary | Approval via Telegram bot messages |
| `slack` | Planned | Approval via Slack message buttons |
| `console` | Available | Interactive terminal prompt (dev/testing) |
| `webhook` | Planned | POST to any HTTP endpoint |

### 3. Verify HITL is active

When the plugin starts, it will log the loaded HITL policies:

```
[clawthority] HITL policies loaded: 1 policy, 3 action patterns
```

The policy file is hot-reloaded --- edit it while the plugin is running and changes take effect immediately.

For the full HITL reference, see [Human-in-the-Loop](human-in-the-loop.md).

---

## UI Dashboard Installation

The dashboard is an optional Express + React application for managing rules and viewing the audit log.

### 1. Install UI dependencies

```bash
# Server dependencies
cd ~/.openclaw/plugins/clawthority/ui
npm install

# Client dependencies
cd ~/.openclaw/plugins/clawthority/ui/client
npm install
```

### 2. Build the client

```bash
cd ~/.openclaw/plugins/clawthority/ui/client
npm run build
```

This compiles the React app to `ui/client/dist/`, which the server serves as static files.

### 3. Start the dashboard server

```bash
cd ~/.openclaw/plugins/clawthority/ui
npm start
```

The server listens on **port 7331** by default. Open `http://localhost:7331` in your browser.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7331` | HTTP port for the dashboard server |
| `RULES_FILE` | `../../data/rules.json` | Path to the persisted rules JSON file |
| `AUDIT_LOG_FILE` | `../../data/audit.jsonl` | Path to the JSONL audit log file |

Example with custom paths:

```bash
PORT=8080 RULES_FILE=/var/clawthority/rules.json AUDIT_LOG_FILE=/var/log/clawthority/audit.jsonl npm start
```

### Data directory

By default, persisted data is written to a `data/` directory at the repository root. The server creates this directory automatically if it does not exist. You can override both paths using environment variables above.

---

## Production Deployment

> **Security note (F-01):** Clawthority includes an install-phase bypass that suppresses enforcement while npm lifecycle scripts (`install`, `preinstall`, `postinstall`, `prepare`) are running. In production environments you **must** set `OPENAUTH_FORCE_ACTIVE=1` to disable this bypass. Without it, any code that runs inside an npm lifecycle event — including compromised `postinstall` scripts from a supply-chain dependency — will bypass all enforcement for its duration.

### Docker

Set `OPENAUTH_FORCE_ACTIVE=1` in your container environment. Using a `Dockerfile`:

```dockerfile
ENV OPENAUTH_FORCE_ACTIVE=1
```

Or via `docker run`:

```bash
docker run -e OPENAUTH_FORCE_ACTIVE=1 your-openclaw-image
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

### systemd

Add `OPENAUTH_FORCE_ACTIVE=1` to the `[Service]` section of your systemd unit file:

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

Reload and restart after editing:

```bash
sudo systemctl daemon-reload
sudo systemctl restart openclaw
```

### What happens without OPENAUTH_FORCE_ACTIVE=1

If the variable is unset and an npm lifecycle event is triggered in the host process, Clawthority logs:

```
[clawthority] install_phase_bypass: enforcement suspended during npm lifecycle
```

With `OPENAUTH_FORCE_ACTIVE=1` set, the bypass is suppressed and enforcement remains active throughout the process lifetime. This variable has no effect on normal (non-npm) process startup.

---

### F-02: In-Memory Token Consumption — Production Considerations

> **Security note (F-02):** The `ApprovalManager` tracks consumed HITL capability tokens in memory only. If the plugin process restarts, the consumed-token set is lost. A token issued immediately before a restart but not yet consumed can be replayed within its TTL window (default: 120 seconds). See [Security Review §3.2](security-review.md#f-02--in-memory-token-consumption-tracking) for full details.

**For production deployments:**

- Configure your process manager with a restart backoff of at least the configured capability TTL (default: `RestartSec=120s` in systemd) to reduce replay window exposure.
- Consider lowering the capability TTL to 30–60 seconds to further limit the replay window.
- Alert on unexpected process restarts that follow recent HITL approvals.
- When the Firma remote adapter ships, migrate to it for persistent server-side token revocation.

The file adapter (default) emits a startup warning when in-memory-only revocation is active:

```
[clawthority] WARNING: Using file adapter — capability token revocation is in-memory only.
              Production deployments should use the Firma remote adapter for persistent revocation.
```

For a full mitigation guide, see [Operator Security Guide — F-02](operator-security-guide.md#f-02-in-memory-token-consumption--production-considerations).

---

## Known Limits

### F-02: In-Memory Revocation

HITL revocation state — the set of capability tokens that have been explicitly revoked before consumption — is held in memory only. When the gateway process restarts, all pending revocations are cleared.

**What this means in practice:**

If an operator grants a HITL approval and then revokes it before the agent uses the capability, but the gateway restarts before the agent presents the token, the revocation is lost. The capability token remains valid until its TTL expires. This affects the same in-memory store as token consumption tracking (see [F-02: In-Memory Token Consumption](#f-02-in-memory-token-consumption--production-considerations) above): a restart resets both the consumed-token set and the revocation set.

**When this limitation matters:**

| Scenario | Impact |
|---|---|
| Frequent restarts (rolling deploys, crash loops, container reschedules) | Revocations issued near a restart window may not take effect |
| Long capability TTLs (>60 s) | Wider window for a revoked token to survive a restart |
| Revocation used as a primary safety control for high-risk approvals | Revocation durability cannot be guaranteed with the file adapter |

**Mitigations (file adapter):**

- Keep the capability TTL short (30–60 seconds). A revoked token with a 30-second TTL expires quickly after a restart, limiting exposure.
- Configure your process manager with a restart backoff of at least the configured TTL (e.g., `RestartSec=60s` in systemd).
- Alert on unexpected process restarts that follow recent HITL approvals or revocations.

**Persistent revocation:**

When the Firma remote adapter ships, migrate to it for server-side revocation that survives gateway restarts. The Firma adapter persists revocations externally and validates them on every token presentation, eliminating this in-memory limitation. See [Operator Security Guide — F-02](operator-security-guide.md#f-02-in-memory-token-consumption--production-considerations) for the full mitigation guide.

---

## Development Setup

Use this setup when working on the plugin or dashboard locally.

### Plugin (watch mode)

```bash
cd ~/.openclaw/plugins/clawthority
npm run dev
```

TypeScript source is compiled and re-compiled automatically on change.

### UI server (watch mode)

```bash
cd ~/.openclaw/plugins/clawthority/ui
npm run dev
```

Uses `tsx watch` for instant TypeScript reload on save.

### UI client (Vite dev server)

```bash
cd ~/.openclaw/plugins/clawthority/ui/client
npm run dev
```

Starts a Vite dev server on **port 5173** with HMR. The server allows CORS from `http://localhost:5173` and `http://127.0.0.1:5173` for local development.

### Running tests

```bash
# Plugin tests
cd ~/.openclaw/plugins/clawthority
npm test

# Client tests
cd ~/.openclaw/plugins/clawthority/ui/client
npm test

# Client tests with coverage
cd ~/.openclaw/plugins/clawthority/ui/client
npm run test:coverage
```

---

## Upgrading

```bash
cd ~/.openclaw/plugins/clawthority
git pull
npm install
npm run build
```

Restart openclaw after upgrading. The hot-reload watcher does not require a full restart for rule changes, but a code change to the plugin itself does.

---

## Uninstallation

Remove the plugin directory and the entry from `~/.openclaw/config.json`:

```bash
rm -rf ~/.openclaw/plugins/clawthority
```

Edit `~/.openclaw/config.json` and remove `"clawthority"` from the `plugins` array.

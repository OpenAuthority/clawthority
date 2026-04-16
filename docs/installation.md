# Installation Guide

> **What this page is for.** Installing and registering the Clawthority plugin for OpenClaw, and configuring the HITL approval flow.

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and configured
- Node.js 18 or later
- npm 9 or later

## Plugin Installation

### 1. Clone the repository

```bash
git clone https://github.com/OpenAuthority/clawthority ~/.openclaw/plugins/clawthority
cd ~/.openclaw/plugins/clawthority
```

### 2. Install dependencies

```bash
npm install
```

### 3. Build the plugin

```bash
npm run build
```

The compiled plugin is output to `dist/`.

### 4. Register with OpenClaw

Add the plugin to your OpenClaw configuration file at `~/.openclaw/config.json`:

```json
{
  "plugins": ["clawthority"]
}
```

OpenClaw will load `dist/index.js` as the plugin entry point on next start.

### 5. Choose your install mode (optional)

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

### 6. Verify installation

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

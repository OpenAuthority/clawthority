# Troubleshooting Guide

> **What this page is for.** Common errors you may hit when running Clawthority, their likely causes, and how to resolve them.

---

## Plugin Issues

### Plugin not loading

**Symptom:** openclaw starts without logging `[clawthority] Plugin activated`.

**Checks:**

1. Confirm the plugin is registered in `~/.openclaw/config.json`:
   ```json
   { "plugins": ["clawthority"] }
   ```
2. Confirm the build output exists:
   ```bash
   ls ~/.openclaw/plugins/clawthority/dist/index.js
   ```
   If missing, run `npm run build` inside the plugin directory.
3. Check that `package.json` has `"main": "dist/index.js"`.

---

### All requests are denied

**Symptom:** Every tool call, command, or prompt is blocked.

**Cause:** No rules match the incoming request context (implicit deny), or the `untrusted` channel is being used.

**Resolution:**

1. Check the `channel` value being passed in the `RuleContext`. If it is `untrusted`, all requests are denied by default rule.
2. Confirm the `agentId` is set and does not violate channel restrictions (e.g., `admin` channel requires `agentId` to start with `admin-`).
3. Add a catch-all permit rule if you want an open-by-default policy:
   ```typescript
   {
     effect: "permit",
     resource: "tool",
     match: "*",
     reason: "Catch-all: permit all tools"
   }
   ```
4. Reload the rules file and watch for log output confirming the reload succeeded.

---

### Hot reload not working

**Symptom:** Editing `src/policy/rules.ts` does not change engine behavior.

**Checks:**

1. Confirm the watcher started — look for `[clawthority] Watching src/policy/rules/` in the openclaw log.
2. The watcher debounces by 300 ms. Wait a moment after saving.
3. Check the log for a reload error:
   ```
   [clawthority] Failed to reload rules: SyntaxError: ...
   ```
   If present, fix the syntax error in your rules file and save again.
4. Ensure the file being edited is the one being watched. The watcher resolves the path relative to the plugin install directory.

---

### Rules reload but behavior is unchanged

**Symptom:** Reload log appears, but requests are still evaluated against old rules.

**Cause:** The hot reload mechanism busts the ESM module cache using a timestamp query parameter on the import URL. If the import fails silently, the old engine stays active.

**Resolution:**

1. Add a `console.log` at the top of `rules.ts` to confirm the new module is being executed.
2. Check that the default export from `rules.ts` is a `Rule[]` array, not `undefined`.
3. Restart openclaw if the watcher appears to be in a broken state.

---

### Prompt injection detection blocking legitimate prompts

**Symptom:** Prompts are rejected with a message about injection detection.

**Cause:** The `before_prompt_build` hook checks non-user message text against 5 injection regex patterns. If a message contains phrases like "ignore previous instructions", "new instructions:", or "act without restrictions", it is blocked. See [architecture.md — Prompt Injection Detection](architecture.md#prompt-injection-detection) for the full pattern list.

**Resolution:**

Review the blocked prompt text. If it is legitimate content that accidentally matches a pattern, rephrase it to avoid the trigger phrases. The detection patterns are intentionally strict.

---

### Action denied with reason "unknown_sensitive_action"

**Symptom:** A tool call is denied with `reason: "unknown_sensitive_action"` or `risk: "critical"`.

**Cause:** The action normalization registry does not recognize the tool name. Unknown tools fail closed to action class `unknown_sensitive_action` with `risk: critical`, which triggers a HITL request or deny depending on your HITL policy. This happens in **both** `open` and `closed` install modes — `unknown_sensitive_action` is in the critical-forbid set that ships in both. See [configuration.md — Install mode](configuration.md#install-mode).

**Resolution:**

1. Check the tool name against the [Action Registry](action-registry.md). All canonical action classes and their aliases are listed there.
2. If the tool is a legitimate custom tool, add it to the normalization registry in `src/enforcement/normalize.ts` by adding an alias to an existing action class or creating a new entry.
3. To temporarily permit it without a registry entry, add a Cedar `permit` rule matching the tool name:
   ```typescript
   { effect: "permit", resource: "tool", match: "my_custom_tool", reason: "Custom tool" }
   ```

---

### HITL approval lockout after adding `unknown_sensitive_action` to the policy

**Symptom:** Every tool call — including `read`, `list`, and other read-only operations — starts firing a HITL approval request. The agent cannot recover because even its fix-up reads are blocked pending approval. `hitl-policy.yaml` contains a pattern that matches `unknown_sensitive_action` (either directly, or via `*`).

**Cause:** `unknown_sensitive_action` is the fallback class for every tool name not listed in the normalizer alias registry. Putting it in a HITL policy means every unregistered tool routes through approval — which in practice is most of a host's tool surface, because the alias registry only covers canonical names (`read_file`, not `read`; `bash`, not `exec`). Operators hit this trying to catch destructive shell commands and unintentionally catch everything.

At load time the parser logs a warning:

```
[hitl-policy] HITL policy "<name>" matches unknown_sensitive_action. …
```

**Resolution:**

1. Remove the `unknown_sensitive_action` (or bare `*`) pattern from your HITL policy.
2. If you were trying to gate destructive shell commands through HITL, use `filesystem.delete` instead — shell-wrapper tools (`exec`, `bash`, `cmd`, …) whose `command` param begins with `rm`/`rmdir`/`unlink`/`shred`/`trash` are automatically reclassified to `filesystem.delete` by the normalizer (Rule 4 in [`src/enforcement/normalize.ts`](../src/enforcement/normalize.ts)).
3. If the host exposes a tool that really should need approval, register it as an alias in the normalizer registry and match on its canonical action class — not on the unknown fallback.

---

### Edits to `src/enforcement/normalize.ts` don't take effect on reload

**Symptom:** You update a normalizer rule (a new alias, a new reclassification rule) and the gateway's hot-reload fires, but tool classifications keep using the old behavior.

**Cause:** The hot-reload watchers reload `hitl-policy.yaml` and `data/rules.json` in place. They do **not** re-import the compiled plugin code. Node's module cache keeps the original `normalize.js` loaded for the lifetime of the process, so classifier changes only take effect after the gateway process restarts.

**Resolution:**

Restart the gateway process:

```bash
sudo systemctl restart openclaw-gateway
```

The hot-reload surface is intentionally narrow:

| Change                                            | Picked up via |
|---------------------------------------------------|---------------|
| `hitl-policy.yaml` edits                          | Watcher       |
| `data/rules.json` edits                           | Watcher       |
| `src/enforcement/normalize.ts` — aliases, rules   | **Restart**   |
| Any other `src/` file (policy engine, hooks, …)   | **Restart**   |
| `dist/**` compiled output                         | **Restart**   |

---

### Total lockout recovery — everything is blocked, I cannot fix the policy

**Symptom:** Every tool call returns a block. Even the agent's recovery tools (`read`, `list`, `cat`) are denied, so you cannot use the agent to inspect or edit the policy that's doing the blocking. Typical causes:

- A HITL policy that matches `unknown_sensitive_action` (every unrecognised tool loops waiting for approval — see the separate entry above).
- CLOSED mode with a rule that forbids a class the agent needs for its own recovery path (e.g. blanket forbid on `filesystem.read`).
- `data/rules.json` ships a `forbid` rule with no `action_class` / `resource` qualifier.
- HITL transport misconfigured (Telegram/Slack credentials missing) combined with `fallback: deny` on a rule that covers common tool calls.

**Diagnose from `data/audit.jsonl`.** Every block now writes a structured entry with `stage`, `rule`, `priority`, and `mode`. Tail the file to see exactly what is blocking:

```bash
tail -n 20 data/audit.jsonl | jq 'select(.type == "policy" and .effect == "forbid")'
```

The `stage` field tells you where to fix it: `stage1-trust` is the source-trust gate (adjust the tool's `source` or remove the high/critical risk classification), `cedar` is the TS defaults in `src/policy/rules/default.ts`, `json-rules` is `data/rules.json`, and `hitl-gated` means a priority-90 rule fired but no HITL policy matched.

**Recovery — from the host OS (SSH into the gateway machine):**

1. **Disable HITL temporarily** so priority-90 rules stop loop-blocking everything:

   ```bash
   mv <plugin-root>/hitl-policy.yaml <plugin-root>/hitl-policy.yaml.disabled
   sudo systemctl restart openclaw-gateway
   ```

   HITL is now off. Priority-90 Cedar forbids will uphold their block (same as pre-HITL behaviour), but at least the approval-loop side of the lockout is gone.

2. **If even non-HITL tools are blocked**, the problem is in Cedar itself. Look at the top of `data/audit.jsonl` entries for the offending `rule` and `priority`:

   - A `priority: 100` entry is a hard forbid. Either the rule is correct and you need to change the agent's behaviour, or you need to edit the rule source and rebuild.
   - A `priority: 90` entry with `stage: hitl-gated` means "this rule wants HITL approval but no policy matches." Add a HITL policy covering that action class in `hitl-policy.yaml`, or remove the rule.
   - A rule from `data/rules.json` can be edited live (hot-reload). Delete or adjust the offending entry and save — no restart needed.

3. **If `data/rules.json` is the problem**, edit it. The watcher will pick up the change within ~300ms:

   ```bash
   vim <plugin-root>/data/rules.json
   ```

4. **If `src/policy/rules/default.ts` is the problem** (or any other compiled code), edit the source, rebuild, and restart — hot-reload does not cover compiled plugin code:

   ```bash
   cd <plugin-root>
   vim src/policy/rules/default.ts
   npm run build
   sudo systemctl restart openclaw-gateway
   ```

**Recovery — from the operator dashboard / remote control UI:** if your control surface can push edits to `hitl-policy.yaml` or `data/rules.json` directly, those changes hot-reload. Editing anything under `src/` still requires a gateway restart.

**Before you ask the agent to help again**, verify the audit log shows the most recent tool calls are no longer blocked. The agent being able to `read` a file is the minimum recovery signal.

### HITL message body is wrong / confusing / too verbose

**Symptom:** The "Effects" or "Warnings" section in a Telegram / Slack / console approval message names the wrong files, lists the wrong flags, or shows generic "Runs `<binary>`" copy when you expected a specific summary.

**Root cause:** The v1.3.0+ message body is generated by the rule-based explainer at [`src/enforcement/command-explainer/patterns.ts`](../src/enforcement/command-explainer/patterns.ts), which dispatches by command binary. A wrong summary means either: (a) the command falls through to the catch-all because no rule matches its binary, or (b) a matching rule has a parsing bug (e.g. flag detection that misses your specific invocation form).

**Confirm:** Find the matching rule for your binary in `patterns.ts` (search for `^<binary>\b`). If none exists, you've hit the catch-all path. If one exists, run the unit test for that rule to reproduce:

```bash
npx vitest run src/enforcement/command-explainer/patterns.test.ts -t "<binary>"
```

**Fix options:**

- **Quick mitigation** — set `CLAWTHORITY_HITL_MINIMAL=1` to suppress the rich body across all channels and fall back to the v1.2.x-style raw-command-only message. Buttons (including Approve Always) continue to work. Read once at module load — restart the plugin.
- **Per-call mitigation** — the agent can populate `ctx.metadata.intent_hint` to add a "Why this is happening" line that supplements (or compensates for) a confusing summary. Truncated to 200 chars.
- **Permanent fix** — file an issue or PR with the misclassified command and the expected summary. The explainer is metadata-only — fixes are pure UX work, no security review required.

The explainer **never** participates in enforcement decisions. A wrong summary is a documentation bug, not a security one. The action class, risk tier, and HITL routing are all driven by the action registry (`packages/action-registry/src/index.ts`), not by the explainer.

### Approve Always button is missing from the approval message

**Symptom:** Telegram / Slack approval messages show only Approve Once / Deny — no Approve Always button.

**Root cause:** Either `CLAWTHORITY_DISABLE_APPROVE_ALWAYS=1` is set, or the channel is the console adapter (which has its own `[s]` keystroke for Approve Always — keystroke-only, no on-screen button).

**Fix:** Unset the env var and restart the plugin. The flag is read once at module load.

### Auto-permits stopped matching after I edited `data/auto-permits.json` by hand

**Symptom:** Saved permits no longer trigger; HITL fires for commands that previously bypassed it.

**Root cause:** Manual edits that don't preserve the `version` counter or invalidate the `checksum` are rejected by the file watcher.

**Confirm:**

```bash
npm run validate-auto-permits
```

This validates the schema and the SHA-256 checksum without modifying anything. Errors are printed with the field paths.

**Fix:** Use the CLI helpers (`npm run remove-auto-permit`, `npm run revoke-auto-permit`) or the Telegram bot (`/approve_always` then `/revoke N`) for edits — they bump the version counter and rewrite the checksum atomically. If you want to inspect the file, `list-auto-permits` and Telegram `/approve_always` are read-only.

### Revoked Approve Always rule still seems active

**Symptom:** You removed a saved pattern but matching calls continue to bypass HITL in the current gateway process.

**Root cause:** There are two approval layers:

- persisted auto-permit rules in `data/auto-permits.json`
- in-memory session auto-approvals keyed by channel/action class

File edits and CLI removals hot-reload the persisted pattern rules, but they do not necessarily clear session-scoped approvals that were created earlier in the same process.

**Fix:** Prefer Telegram `/revoke N` for live operations. It rewrites the store, reloads rules, and clears in-memory session auto-approvals immediately. If you used the CLI or edited the file directly, restart the gateway to clear session approvals:

```bash
openclaw gateway restart
```

---

## Rate Limiting Issues

### Rate limit not resetting

**Symptom:** A rate-limited rule remains blocked even after waiting for the window to expire.

**Cause:** The sliding window tracks timestamps of individual calls. The window expires per call, not as a fixed reset at a clock boundary.

**Resolution:**

Wait for the oldest call's timestamp to fall outside the window. If `windowSeconds` is 60, the rate limit clears 60 seconds after the **oldest** call in the current window, not 60 seconds after the limit was hit.

If you need the counter to reset sooner, reduce the `windowSeconds` value or decrease `maxCalls`.

---

### Rate limit memory grows unbounded

**Symptom:** Memory usage increases over time when many unique `agentId:resourceName` pairs are rate-limited.

**Cause:** The engine stores a timestamp array per `(rule, agentId:resourceName)` pair. Expired entries are cleaned up only when `cleanup()` is called or the automatic cleanup timer runs.

**Resolution:**

Enable the automatic cleanup timer when constructing the Cedar engine:

```typescript
const engine = new PolicyEngine({ cleanupIntervalMs: 60_000 }); // clean up every 60s
```

Or call `engine.cleanup()` periodically in your application.

---

## UI Dashboard Issues

### Dashboard server does not start

**Symptom:** `npm start` in `ui/` fails.

**Checks:**

1. Confirm the client is built: `ls ui/client/dist/index.html`. If missing, run `npm run build` in `ui/client/`.
2. Check that port 7331 is not already in use:
   ```bash
   lsof -i :7331
   ```
   Use `PORT=8080 npm start` to use a different port.
3. Ensure server dependencies are installed: `npm install` in `ui/`.

---

### Rules not persisting after server restart

**Symptom:** Rules created via the UI disappear after restarting the dashboard server.

**Cause:** The server reads and writes rules from the path specified by `RULES_FILE`. If the path changes between starts, the file is not found.

**Resolution:**

Set `RULES_FILE` to an absolute path:

```bash
RULES_FILE=/var/clawthority/rules.json npm start
```

Verify the file exists and is readable:

```bash
cat $RULES_FILE
```

---

### Audit log stream disconnects frequently

**Symptom:** The live audit stream in the browser keeps reconnecting.

**Cause:** SSE connections drop when the network is interrupted or the server restarts. The client-side `EventSource` API reconnects automatically.

**Resolution:**

This is expected behavior. The client reconnects and continues receiving events. If disconnects are frequent and not caused by network issues, check for unhandled errors in the server log.

---

### No entries in audit log

**Symptom:** The audit log page is empty.

**Checks:**

1. Confirm the `AUDIT_LOG_FILE` (or `auditLogFile` in `openclaw.plugin.json`) path is set correctly and the file exists.
2. Audit entries are written by `JsonlAuditLogger` in the enforcement pipeline. Confirm the plugin is actively processing tool calls (check that `[clawthority] Plugin activated` appeared in the openclaw log).
3. Entries can also be posted directly via `POST /api/audit` for testing. The SSE stream only broadcasts entries recorded after the stream connects — historical entries are served by `GET /api/audit`.

---

## Build Issues

### TypeScript compilation errors

**Symptom:** `npm run build` fails with type errors.

**Common causes and fixes:**

- Missing `.js` extension on relative imports: All ESM imports of local files must use `.js` (even for `.ts` source files). Example: `import { foo } from "./foo.js"`.
- `NodeNext` module resolution requires explicit extensions.
- Type errors in `rules.ts` after editing. Run `npx tsc --noEmit` to see all errors without building.

---

### Tests failing after rule changes

**Symptom:** `npm test` reports failures after editing `src/policy/rules.ts`.

**Resolution:**

Tests in `src/policy/engine.test.ts` import the engine directly, not the default rules. Rule changes in `rules.ts` do not affect these tests.

If you added new rules and want to test them, add corresponding test cases to `engine.test.ts`.

---

## Common Pitfalls

### Forbid rules override permit rules

The Cedar-style engine uses **forbid-wins** semantics. If **any** `forbid` rule matches, access is denied regardless of matching `permit` rules. Order does not matter — a single `forbid` takes precedence over all `permit` rules.

If a resource is being unexpectedly blocked, check for `forbid` rules with `match: "*"` or broad patterns that may unintentionally match.

### Condition functions and serialization

Condition functions stored in the rules file are serialized as strings (the function body). When loaded, they are reconstructed with `new Function(...)`. This means:

- Arrow function syntax works: `(ctx) => ctx.channel === "admin"`
- Closures over external variables do not work — only the function body is preserved
- Async condition functions are not supported

### Channel values are not validated by default

The `channel` field in `RuleContext` is not validated against an enum — any string can be passed. Default rules check against known values (`admin`, `trusted`, `ci`, `readonly`, `default`, `untrusted`). An unexpected channel value that does not match any rule will result in implicit deny.

Always use one of the documented channel values when constructing contexts.

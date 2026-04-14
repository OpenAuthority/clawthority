# Troubleshooting Guide

This guide covers common issues and how to resolve them.

---

## Plugin Issues

### Plugin not loading

**Symptom:** openclaw starts without logging `[openauthority] Plugin activated`.

**Checks:**

1. Confirm the plugin is registered in `~/.openclaw/config.json`:
   ```json
   { "plugins": ["openauthority"] }
   ```
2. Confirm the build output exists:
   ```bash
   ls ~/.openclaw/plugins/openauthority/dist/index.js
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

1. Confirm the watcher started — look for `[openauthority] Watching src/policy/rules/` in the openclaw log.
2. The watcher debounces by 300 ms. Wait a moment after saving.
3. Check the log for a reload error:
   ```
   [openauthority] Failed to reload rules: SyntaxError: ...
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

**Cause:** The `before_prompt_build` hook checks for 8 regex patterns. If your prompt contains phrases like "ignore previous instructions" or "jailbreak", it is blocked.

**Resolution:**

Review the blocked prompt text. If it is legitimate content that accidentally matches a pattern, rephrase it to avoid the trigger phrases. The detection patterns are intentionally strict.

---

### Action denied with reason "unknown_sensitive_action"

**Symptom:** A tool call is denied with `reason: "unknown_sensitive_action"` or `risk: "critical"`.

**Cause:** The action normalization registry does not recognize the tool name. Unknown tools fail closed to action class `unknown_sensitive_action` with `risk: critical`, which triggers a HITL request or deny depending on your HITL policy.

**Resolution:**

1. Check the tool name against the [Action Registry](action-registry.md). All 17 canonical action classes and their aliases are listed there.
2. If the tool is a legitimate custom tool, add it to the normalization registry in `src/enforcement/normalize.ts` by adding an alias to an existing action class or creating a new entry.
3. To temporarily permit it without a registry entry, add a Cedar `permit` rule matching the tool name:
   ```typescript
   { effect: "permit", resource: "tool", match: "my_custom_tool", reason: "Custom tool" }
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
RULES_FILE=/var/openauthority/rules.json npm start
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
2. Audit entries are written by `JsonlAuditLogger` in the enforcement pipeline. Confirm the plugin is actively processing tool calls (check that `[openauthority] Plugin activated` appeared in the openclaw log).
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

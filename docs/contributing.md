# Contributing Guide

Thank you for contributing to Open Authority. This guide covers development setup, code conventions, testing requirements, and the pull request process.

---

## Development Setup

### Prerequisites

- Node.js 18 or later
- npm 9 or later
- Git

### Clone and install

```bash
git clone https://github.com/Firma-AI/openauthority
cd openauthority

# Plugin dependencies
npm install

# UI server dependencies
cd ui && npm install

# UI client dependencies
cd client && npm install
```

### Start development servers

```bash
# In one terminal: plugin (watch mode)
npm run dev

# In another terminal: UI server (watch mode)
cd ui && npm run dev

# In another terminal: Vite client dev server
cd ui/client && npm run dev
```

The dashboard is available at `http://localhost:7331` (served by Express) or `http://localhost:5173` (Vite HMR, proxied to the Express API).

---

## Project Structure

```
openauthority/
├── src/                        # Plugin source
│   ├── index.ts                # Plugin entry point and openclaw hooks
│   ├── types.ts                # Core v0.1 runtime types (Intent, Capability, ExecutionEnvelope, CeeDecision)
│   ├── audit.ts                # JsonlAuditLogger, PolicyDecisionEntry, HitlDecisionEntry
│   ├── envelope.ts             # Canonical re-export shim (buildEnvelope, sortedJsonStringify, uuidv7)
│   ├── watcher.ts              # Hot-reload file watcher (JSON + TypeScript rules)
│   ├── enforcement/
│   │   ├── pipeline.ts         # runPipeline, EnforcementPolicyEngine, ExecutionEnvelope builder
│   │   ├── normalize.ts        # Action normalization registry (tool name → action_class)
│   │   ├── decision.ts         # StructuredDecision type layer (fromCeeDecision, askUser, forbidDecision)
│   │   └── stage2-policy.ts    # Stage 2 evaluator factory (createStage2, createEnforcementEngine)
│   ├── policy/
│   │   ├── engine.ts           # Cedar-style PolicyEngine (forbid-wins, rate limiting)
│   │   ├── types.ts            # Rule, RuleContext, Effect, Resource, RateLimit
│   │   ├── rules.ts            # Re-export shim → rules/index.ts
│   │   ├── rules/
│   │   │   ├── default.ts      # Baseline action-class rules (priority 10/90/100)
│   │   │   └── index.ts        # mergeRules() + combined default export
│   │   ├── bundle.ts           # Bundle loader and validation
│   │   ├── coverage.ts         # CoverageMap — rule coverage tracking
│   │   ├── exporter.ts         # Rule export utilities
│   │   └── loader.ts           # JSON rules file loader
│   ├── hitl/
│   │   ├── index.ts            # HITL module barrel export
│   │   ├── types.ts            # TypeBox schemas for HITL policy config
│   │   ├── matcher.ts          # Action pattern matching (dot-notation wildcards)
│   │   ├── parser.ts           # YAML/JSON policy file parsing and validation
│   │   ├── watcher.ts          # HITL policy hot-reload watcher
│   │   ├── approval-manager.ts # Approval lifecycle and token management
│   │   ├── telegram.ts         # Telegram approval channel adapter
│   │   └── slack.ts            # Slack approval channel adapter
│   └── adapter/
│       ├── index.ts            # IAuthorityAdapter interface
│       ├── types.ts            # Adapter types
│       └── file-adapter.ts     # File-based adapter implementation
│
├── ui/
│   ├── server.ts               # Express server entry point
│   ├── routes/
│   │   ├── rules.ts            # Rules CRUD API
│   │   └── audit.ts            # Audit log API and SSE
│   └── client/
│       ├── src/
│       │   ├── api.ts          # HTTP client for the REST API
│       │   ├── pages/          # React page components
│       │   ├── views/          # Reusable view components + CSS
│       │   ├── components/     # Shared UI components
│       │   └── test/
│       │       └── setup.ts    # Test setup (jest-dom)
│       ├── vitest.config.ts
│       └── package.json
│
├── docs/                       # Documentation
├── data/                       # Persisted rules, bundles and audit log (gitignored)
│   ├── rules.json              # JSON-format runtime rules (loaded by watcher)
│   ├── audit.jsonl             # JSONL audit log
│   └── bundles/                # Policy bundle directory
│       └── active/             # Active bundle (loaded at startup)
├── openclaw.plugin.json        # Plugin manifest
├── tsconfig.json
└── package.json
```

---

## Code Conventions

### TypeScript

- **Strict mode** is enabled. All code must satisfy `strict: true`.
- Use `.js` extensions on all relative imports in ESM source files:
  ```typescript
  import { PolicyEngine } from "./policy/engine.js"; // correct
  import { PolicyEngine } from "./policy/engine";    // wrong
  ```
- Prefer `const` over `let`. Never use `var`.
- Avoid `any`. Use `unknown` and narrow with type guards when the type is genuinely unknown.

### File organization

- Local client-side types (`Effect`, `Resource`, `RateLimit`, `Rule`) are defined at the top of the view file that first needs them, not in a shared `types.ts`. Keep each view self-contained.
- View components co-locate their CSS file in `ui/client/src/views/<ComponentName>.css` and import it directly.
- `startRulesWatcher` lives in `src/watcher.ts` and is imported inline into `src/index.ts`. Watcher logic is not inlined into the plugin file.

### Architecture patterns

- **Hot reload**: Wrap the live Cedar engine in `engineRef: { current: Engine }`. Hook handlers dereference `.current` at call time. The watcher swaps `.current` atomically.
- **ESM cache busting**: Append `?t=Date.now()` to the import URL when dynamically importing a module that may have changed on disk.
- **Chokidar lifecycle**: Start in `activate()`, stop in `async deactivate()` via `WatcherHandle`. Always set `persistent: false`.
- **Debounce**: 300 ms default on file-change events. `clearTimeout` before each new `setTimeout`.
- **Error isolation**: Wrap reload paths in `try/catch`. Log and return early on failure; leave the previous engine active.

---

## Testing

### Running tests

```bash
# Plugin tests
npm test

# Plugin tests in watch mode
npm run test:watch

# UI client tests
cd ui/client && npm test

# UI client tests with coverage report
cd ui/client && npm run test:coverage
```

### Coverage thresholds

The client enforces 80% coverage thresholds via `@vitest/coverage-v8`. A PR must not reduce coverage below the threshold.

### Writing tests

**Co-location**: Test files live next to their source file:
```
views/RulesTable.tsx
views/RulesTable.test.tsx   ← here
```

**API mocking**: Mock `../api` with `vi.mock`. Include a hand-crafted `ApiError` class matching the real constructor signature. Never import the real `ApiError` in mocks.

**SSE (EventSource) testing**: Stub `EventSource` globally with a class that stores the instance; dispatch events inside `act()` using helpers like `fireMessage`, `fireOpen`, `fireError`.

**`navigator.clipboard` mock**: Use `Object.defineProperty` with `{ configurable: true, writable: true }`. Re-assign the mock inside `beforeEach` (not at module level) to survive replacement by `userEvent.setup()`. Use `fireEvent.click` (not `userEvent.click`) for buttons that trigger clipboard calls.

**Special input characters**: Use `userEvent.paste` instead of `userEvent.type` when the input string contains regex special characters like `[` that userEvent v14 interprets as keyboard modifiers.

**Select assertions**: Assert select value after `userEvent.selectOptions` with `expect(selectEl).toHaveValue("value")`, not `getByDisplayValue`, since display value returns option text (capitalized), not the HTML value attribute.

---

## Pull Request Process

1. Create a feature branch from `main`:
   ```bash
   git checkout -b my-feature
   ```
2. Make your changes, keeping commits focused.
3. Run tests and ensure they pass:
   ```bash
   npm test
   cd ui/client && npm test
   ```
4. Run the TypeScript compiler with no emit to catch type errors:
   ```bash
   npx tsc --noEmit
   cd ui && npx tsc --noEmit
   ```
5. Push your branch and open a pull request against `main`.
6. Describe what the PR changes and why.

### Commit messages

Write commit messages in the imperative mood, focused on the "why" not the "what":

```
Add rate limiting to write_file tool rule
Prevent admin channel access for unrecognized agent prefixes
Fix sliding window cleanup leaving stale entries after engine reload
```

---

## Adding New Rules

To add a rule to the default rule set:

1. Open `src/policy/rules/default.ts`
2. Add your rule object to the `DEFAULT_RULES` array, choosing the appropriate priority tier (10/90/100)
3. Save the file — the hot-reload watcher picks it up immediately if openclaw is running
4. Add a test case in `src/policy/engine.test.ts` covering the new rule's behavior
5. Update `docs/usage.md` if the rule introduces a new pattern

To add agent-specific rules, create a sibling file in `src/policy/rules/` and register it in `KNOWN_RULE_FILES` inside `src/watcher.ts`. Use `mergeRules()` in `src/policy/rules/index.ts` to combine it with the baseline.

---

## Adding a New Resource Type

To support a new resource type beyond the five built-in types:

1. Add the new type literal to the `Resource` union in `src/policy/types.ts`
2. Update the `resource` validation in `ui/routes/rules.ts`
3. Update the `resource` field's accepted values in `docs/configuration.md` and `docs/api.md`
4. Add a hook handler in `src/index.ts` if the new resource type requires a new openclaw lifecycle hook
5. Update the Coverage Map component if you want the new type to appear in the UI matrix

---

## Reporting Issues

Open an issue on GitHub with:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Node.js version (`node --version`)
- npm version (`npm --version`)
- Any relevant log output

For security vulnerabilities, please email the maintainers directly rather than opening a public issue.

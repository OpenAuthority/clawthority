# Contributing Guide

> **What this page is for.** Dev setup, code conventions, testing requirements, and the pull-request process. Read this before opening your first PR.

Thank you for contributing to Clawthority.

---

## Development Setup

### Prerequisites

- Node.js 18 or later
- npm 9 or later
- Git

### Clone and install

```bash
git clone https://github.com/OpenAuthority/clawthority
cd clawthority

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
clawthority/
├── src/                        # Plugin source
│   ├── index.ts                # Plugin entry point and openclaw hooks
│   ├── types.ts                # Core runtime types (Intent, Capability, ExecutionEnvelope, CeeDecision)
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

Clawthority has three layers of automated tests:

| Layer | Files | Runner |
|---|---|---|
| Unit tests | `src/**/*.test.ts` | `npm test` |
| E2E pipeline tests | `src/**/*.e2e.ts` | `npm run test:e2e` |
| Harness smoke tests | `e2e/**/*.test.ts` | `npm run test:e2e` |

### Running tests

```bash
# Unit tests (src/**/*.test.ts) — fast, no external dependencies
npm test

# Unit tests with coverage report and threshold enforcement
npm run test:coverage

# Unit tests in watch mode during development
npm run test:watch

# E2E tests (src/**/*.e2e.ts + e2e/**/*.test.ts)
npm run test:e2e

# E2E tests with coverage report (informational only, no thresholds)
npm run test:e2e:coverage

# UI client tests
cd ui/client && npm test

# UI client tests with coverage report
cd ui/client && npm run test:coverage
```

### Coverage thresholds

Plugin unit tests enforce per-directory coverage minimums via `@vitest/coverage-v8`:

| Directory | Lines threshold |
|---|---|
| `src/enforcement/**` | 95% |
| `src/hitl/**` | 90% |
| `src/policy/**` | 90% |
| `src/adapter/**` | 85% |
| `src/index.ts` | 80% |

E2E coverage (`npm run test:e2e:coverage`) generates reports but enforces no thresholds — it is informational only. The UI client enforces an 80% threshold across all metrics.

---

## End-to-End (E2E) Testing

E2E tests drive the full two-stage enforcement pipeline (`runPipeline`) directly in-process, without spawning an external process. They live in `src/` alongside source files as `*.e2e.ts`.

The harness smoke tests (`e2e/harness.test.ts`) exercise `OpenClawHarness` itself — they spawn the `e2e/runner.mjs` fallback process over stdio and verify the JSON-RPC protocol.

### OpenClaw requirement

The `OpenClawHarness` class (used in harness smoke tests) can run against either a real OpenClaw binary or the bundled `e2e/runner.mjs` simulator:

- **Without OpenClaw** (local development): pass no `openclawBin`; the harness falls back to `node e2e/runner.mjs` automatically. All CI and local `npm run test:e2e` runs use this path.
- **With OpenClaw** (integration against the real binary): set `openclawBin` in the `HarnessConfig`:
  ```typescript
  const harness = new OpenClawHarness({
    openclawBin: '/usr/local/bin/openclaw',
    pluginDir: '.',
    workDir: '/tmp/oa-e2e',
    bundleFixture: 'data/bundles/active/bundle.json',
    auditLogPath: '/tmp/oa-e2e/audit.jsonl',
  });
  ```

The `*.e2e.ts` pipeline tests do not use `OpenClawHarness` at all — they call `runPipeline` directly and are always runnable without OpenClaw.

### Local development setup for E2E tests

No extra setup is required for pipeline E2E tests. For the harness smoke tests:

```bash
# Build the plugin first so runner.mjs can import the compiled output
npm run build

# Then run all E2E tests (harness smoke + pipeline scenarios)
npm run test:e2e
```

The runner simulator (`e2e/runner.mjs`) permits `read_file` and forbids all other tools. This is sufficient for harness infrastructure tests (HC-01 through HC-05).

### Adding a new E2E scenario

Follow these steps to add a new pipeline scenario:

**Step 1 — Create a fixture (if needed)**

If your scenario depends on external data (e.g., a domain allowlist, an agent config), add a JSON file under `data/fixtures/`:

```json
// data/fixtures/trusted-partner.json
{
  "name": "trusted-partner",
  "version": 1,
  "description": "Partner org domain trust policy",
  "trustedDomains": ["partner.example.com"]
}
```

Load it in your test with `readFileSync` + `JSON.parse`, using `__dirname` relative to `src/`:

```typescript
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../data/fixtures/trusted-partner.json'), 'utf-8'),
);
```

**Step 2 — Create the test file**

Create `src/<feature-name>.e2e.ts`. Start with the standard file-level JSDoc listing test cases, then define your Stage 2 helper and optional `HitlTestHarness`:

```typescript
/**
 * <Feature> e2e tests
 *
 *  TC-<PREFIX>-01  <description>
 *  TC-<PREFIX>-02  <description>
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runPipeline } from './enforcement/pipeline.js';
import type { PipelineContext, Stage1Fn, Stage2Fn, CeeDecision } from './enforcement/pipeline.js';
import { validateCapability } from './enforcement/stage1-capability.js';
import { ApprovalManager, computeBinding } from './hitl/approval-manager.js';
import type { HitlPolicy } from './hitl/types.js';
import type { Capability } from './adapter/types.js';

// Stage 2 helper — define policy logic for this test suite
function buildMyStage2(): Stage2Fn {
  return async (ctx: PipelineContext): Promise<CeeDecision> => {
    // Apply your policy rules here
    return { effect: 'permit', reason: 'action_class', stage: 'stage2' };
  };
}

// HITL test harness — only needed if your scenario involves approval tokens
const TEST_POLICY: HitlPolicy = {
  name: 'test-hitl-policy',
  actions: ['*'],
  approval: { channel: 'test', timeout: 3600, fallback: 'deny' },
};

interface ApproveNextOpts {
  action_class: string;
  target: string;
  payload_hash: string;
}

class HitlTestHarness {
  private readonly approvalManager = new ApprovalManager();
  private readonly issued = new Map<string, Capability>();
  readonly stage1: Stage1Fn;

  constructor() {
    this.stage1 = (ctx) => validateCapability(ctx, this.approvalManager, (id) => this.issued.get(id));
  }

  approveNext(opts: ApproveNextOpts): string {
    const handle = this.approvalManager.createApprovalRequest({
      toolName: opts.action_class,
      agentId: 'test-agent',
      channelId: 'test-channel',
      policy: TEST_POLICY,
      ...opts,
    });
    const now = Date.now();
    const cap: Capability = {
      approval_id: handle.token,
      binding: computeBinding(opts.action_class, opts.target, opts.payload_hash),
      action_class: opts.action_class,
      target: opts.target,
      issued_at: now,
      expires_at: now + 3_600_000,
    };
    this.issued.set(handle.token, cap);
    return handle.token;
  }

  shutdown(): void { this.approvalManager.shutdown(); }
}

describe('<feature name>', () => {
  let emitter: EventEmitter;
  let harness: HitlTestHarness;

  beforeEach(() => {
    emitter = new EventEmitter();
    harness = new HitlTestHarness();
  });

  afterEach(() => { harness.shutdown(); });

  it('TC-<PREFIX>-01: <description>', async () => {
    const ACTION = '<action_class>' as const;
    const TARGET = '<target>' as const;
    const HASH = 'hash-<prefix>-01';

    const token = harness.approveNext({ action_class: ACTION, target: TARGET, payload_hash: HASH });

    const result = await runPipeline(
      {
        action_class: ACTION,
        target: TARGET,
        payload_hash: HASH,
        hitl_mode: 'per_request',
        approval_id: token,
        rule_context: { agentId: 'agent-1', channel: 'default' },
      },
      harness.stage1,
      buildMyStage2(),
      emitter,
    );

    expect(result.decision.effect).toBe('permit');
  });
});
```

**Step 3 — Choose a test case ID prefix**

Pick a short, unique prefix for test case IDs (e.g., `EMAIL`, `FS`, `HITL`, `AUDIT`). Use the format `TC-<PREFIX>-NN`. Document the prefix at the top of the file in the JSDoc.

**Step 4 — Verify the test runs**

```bash
npm run test:e2e
```

The new `*.e2e.ts` file is picked up automatically by the `vitest.e2e.config.ts` include glob.

### Fixture checksum regeneration

Bundle fixtures (`data/bundles/active/bundle.json` and any fixture bundles passed via `bundleFixture`) carry a `checksum` field. When you modify the `rules` array in a bundle fixture, regenerate the checksum with:

```bash
node -e "
  const { createHash } = require('crypto');
  const bundle = require('./data/bundles/active/bundle.json');
  const checksum = createHash('sha256').update(JSON.stringify(bundle.rules)).digest('hex');
  console.log('New checksum:', checksum);
"
```

Then update the `checksum` field in the JSON file to the printed value. The formula is:

```
checksum = SHA-256( JSON.stringify(bundle.rules) )
```

`JSON.stringify` is called without a replacer or space argument — the checksum is computed over the compact, key-insertion-order serialization. Changing rule order or adding whitespace will produce a different checksum.

---

## Writing unit tests

**Co-location**: Test files live next to their source file:
```
src/policy/engine.ts
src/policy/engine.test.ts   ← here
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
   npm run test:e2e
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

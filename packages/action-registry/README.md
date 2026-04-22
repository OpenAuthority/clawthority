# @openclaw/action-registry

Single source of truth for the OpenClaw action class taxonomy. Exports the frozen registry of all 26 canonical action classes with their default risk levels, HITL modes, tool name aliases, and intent group assignments.

## Installation

```bash
npm install @openclaw/action-registry
```

## Usage

### Action class constants

Use `ActionClass` constants instead of raw strings to avoid typos in policy code:

```typescript
import { ActionClass } from '@openclaw/action-registry';

console.log(ActionClass.FilesystemRead);   // 'filesystem.read'
console.log(ActionClass.ShellExec);        // 'shell.exec'
console.log(ActionClass.CredentialWrite);  // 'credential.write'
```

### Lookup an entry from the registry

```typescript
import { REGISTRY, ActionClass } from '@openclaw/action-registry';

const entry = REGISTRY.find(e => e.action_class === ActionClass.FilesystemDelete);
// { action_class: 'filesystem.delete', default_risk: 'high', default_hitl_mode: 'per_request',
//   aliases: [...], intent_group: 'destructive_fs' }
```

### TypeScript types

```typescript
import type {
  ActionClassValue,
  ActionRegistryEntry,
  RiskLevel,
  HitlModeNorm,
  IntentGroup,
} from '@openclaw/action-registry';

function checkRisk(action: ActionClassValue): RiskLevel {
  const entry = REGISTRY.find(e => e.action_class === action);
  return entry?.default_risk ?? 'critical';
}
```

## Exports

| Export | Kind | Description |
|---|---|---|
| `ActionClass` | `const` | All 26 canonical action class strings as named constants |
| `ActionClassValue` | `type` | Union type of all `ActionClass` values |
| `REGISTRY` | `const` | Read-only array of all `ActionRegistryEntry` objects |
| `ActionRegistryEntry` | `interface` | Shape of a registry entry |
| `RiskLevel` | `type` | `'low' \| 'medium' \| 'high' \| 'critical'` |
| `HitlModeNorm` | `type` | `'none' \| 'per_request' \| 'session_approval'` |
| `IntentGroup` | `type` | All recognized intent group strings |

## Action classes

The taxonomy is frozen at v1. See `docs/action-taxonomy.md` in the root repository for the full specification including intent groups and change-control requirements.

| Action class | Risk | HITL mode |
|---|---|---|
| `filesystem.read` | low | none |
| `filesystem.write` | medium | per_request |
| `filesystem.delete` | high | per_request |
| `filesystem.list` | low | none |
| `web.search` | medium | per_request |
| `web.fetch` | medium | per_request |
| `web.post` | medium | per_request |
| `browser.scrape` | medium | per_request |
| `shell.exec` | high | per_request |
| `communication.email` | high | per_request |
| `communication.slack` | medium | per_request |
| `communication.webhook` | medium | per_request |
| `memory.read` | low | none |
| `memory.write` | medium | none |
| `credential.read` | high | per_request |
| `credential.write` | critical | per_request |
| `code.execute` | high | per_request |
| `payment.initiate` | critical | per_request |
| `vcs.read` | low | none |
| `vcs.write` | medium | per_request |
| `vcs.remote` | medium | per_request |
| `package.install` | medium | per_request |
| `build.compile` | medium | per_request |
| `build.test` | low | none |
| `build.lint` | low | none |
| `unknown_sensitive_action` | critical | per_request |

## Integration with normalize.ts

`normalize.ts` imports `REGISTRY` and the shared types from this package to resolve tool names to action classes:

```typescript
import { REGISTRY } from '@openclaw/action-registry';
import type { RiskLevel, HitlModeNorm, IntentGroup } from '@openclaw/action-registry';
```

## Building

```bash
npm run build   # compile TypeScript to dist/
npm run dev     # watch mode
npm run clean   # remove dist/
```

## Change control

The action taxonomy is frozen at v1. Any addition, removal, rename, or risk-level change requires an approved RFC. Do not modify `src/index.ts` without a corresponding RFC approval — the `ReleaseValidator` V-13 check gates releases on the freeze status in `docs/action-taxonomy.md`.

## License

Apache-2.0

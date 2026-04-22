/**
 * SpecAlignmentValidator — test suite
 *
 * Verifies that the spec alignment validator correctly validates all three
 * spec groups:
 *   FEP §2              — typed Intent / ToolUseParams structure checks
 *   FEP Shell Prohibition — raw shell execution prohibition checks
 *   Integration Spec    — OpenClaw integration requirement checks
 *
 * Test IDs:
 *   TC-SA-01: SA-F-01 — src/types.ts exists
 *   TC-SA-02: SA-F-02 — Intent interface exported
 *   TC-SA-03: SA-F-03 — Intent.action_class typed as string
 *   TC-SA-04: SA-F-04 — Intent.target typed as string
 *   TC-SA-05: SA-F-05 — Intent.summary typed as string
 *   TC-SA-06: SA-F-06 — Intent.payload_hash typed as string
 *   TC-SA-07: SA-F-07 — Intent.parameters typed as Record<string, unknown>
 *   TC-SA-08: SA-F-08 — ExecutionEnvelope wraps Intent
 *   TC-SA-09: SA-S-01 — no child_process imports in src/
 *   TC-SA-10: SA-S-02 — no execSync/spawnSync calls in src/
 *   TC-SA-11: SA-I-01 — normalize_action in normalize.ts
 *   TC-SA-12: SA-I-02 — stage1-capability.ts exists
 *   TC-SA-13: SA-I-03 — stage2-policy.ts exists
 *   TC-SA-14: SA-I-04 — IAuthorityAdapter in adapter/types.ts
 *   TC-SA-15: SA-I-05 — HITL approval-manager.ts exists
 *   TC-SA-16: SA-I-06 — @openclaw/action-registry in package.json
 *   TC-SA-17: SA-I-07 — unknown_sensitive_action in normalize.ts
 *   TC-SA-18: Aggregated result — all checks pass when compliant
 *   TC-SA-19: Aggregated result — failures reported correctly
 *   TC-SA-20: generateReport — formats report with sections and summary
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SpecAlignmentValidator } from './spec-alignment-validator.js';
import type { SpecAlignmentContext } from './spec-alignment-validator.js';

// ─── Virtual file system shared state ────────────────────────────────────────
//
// `vi.mock` is hoisted before any imports, so we cannot reference local
// variables in the factory directly. Instead we use a module-level `_vfs`
// map that each test populates, and the mock implementation reads from it.
//
// Pattern: setFiles() → vi.mock reads _vfs → afterEach clears _vfs.

let _vfs: Record<string, string> = {};

vi.mock('node:fs', () => ({
  existsSync: (p: unknown) => {
    const key = String(p);
    return (
      Object.prototype.hasOwnProperty.call(_vfs, key) ||
      Object.keys(_vfs).some((f) => f.startsWith(key + '/'))
    );
  },
  readFileSync: (p: unknown, _options?: unknown) => {
    const key = String(p);
    if (!Object.prototype.hasOwnProperty.call(_vfs, key)) {
      const err = Object.assign(new Error(`ENOENT: no such file: ${key}`), { code: 'ENOENT' });
      throw err;
    }
    return _vfs[key];
  },
  readdirSync: (dir: unknown, _options?: unknown) => {
    const dirStr = String(dir);
    const prefix = dirStr.endsWith('/') ? dirStr : dirStr + '/';
    const entries = new Set<string>();
    for (const filePath of Object.keys(_vfs)) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const childName = rest.split('/')[0];
      if (childName !== undefined && childName !== '') {
        entries.add(childName);
      }
    }
    return [...entries];
  },
  statSync: (p: unknown) => {
    const key = String(p);
    const dirPrefix = key.endsWith('/') ? key : key + '/';
    const isDir = Object.keys(_vfs).some((f) => f.startsWith(dirPrefix));
    const isFile = Object.prototype.hasOwnProperty.call(_vfs, key);
    if (!isDir && !isFile) {
      const err = Object.assign(new Error(`ENOENT: ${key}`), { code: 'ENOENT' });
      throw err;
    }
    return {
      isDirectory: () => isDir && !isFile,
      isFile: () => isFile,
    };
  },
}));

function setFiles(files: Record<string, string>): void {
  _vfs = files;
}

afterEach(() => {
  _vfs = {};
});

// ─── Minimal "compliant" fixture ──────────────────────────────────────────────

const ROOT = '/project';

function path(relative: string): string {
  return `${ROOT}/${relative}`;
}

const TYPES_TS = `
/** Rate limit info. */
export interface RateLimitInfo {
  maxCalls: number;
  windowSeconds: number;
}

/** Semantic description of what an agent intends to do. */
export interface Intent {
  action_class: string;
  target: string;
  summary: string;
  payload_hash: string;
  parameters: Record<string, unknown>;
}

/** Execution envelope wrapping an agent action. */
export interface ExecutionEnvelope {
  intent: Intent;
  capability: null;
  metadata: Record<string, unknown>;
  provenance: Record<string, unknown>;
}
`;

const NORMALIZE_TS = `
import { REGISTRY } from '@openclaw/action-registry';

const UNKNOWN_ENTRY = REGISTRY.find(e => e.action_class === 'unknown_sensitive_action')!;

export function normalize_action(toolName: string, params: Record<string, unknown>) {
  return { action_class: 'filesystem.read', risk: 'low', hitl_mode: 'none', target: '' };
}
`;

const ADAPTER_TYPES_TS = `
export interface IAuthorityAdapter {
  issueCapability(opts: unknown): Promise<unknown>;
  watchPolicyBundle(onUpdate: (bundle: unknown) => void): Promise<unknown>;
  watchRevocations(): AsyncIterable<string>;
}
`;

const PACKAGE_JSON = JSON.stringify({
  name: '@clawthority/clawthority',
  version: '1.1.4',
  dependencies: {
    '@openclaw/action-registry': '*',
    '@sinclair/typebox': '^0.34.0',
  },
});

/** Returns a full set of file contents representing a spec-compliant project. */
function compliantFiles(): Record<string, string> {
  return {
    [path('src/types.ts')]: TYPES_TS,
    [path('src/enforcement/normalize.ts')]: NORMALIZE_TS,
    [path('src/enforcement/stage1-capability.ts')]: '// stage 1\nexport function stage1() {}',
    [path('src/enforcement/stage2-policy.ts')]: '// stage 2\nexport function stage2() {}',
    [path('src/adapter/types.ts')]: ADAPTER_TYPES_TS,
    [path('src/hitl/approval-manager.ts')]: '// hitl approval manager\nexport class ApprovalManager {}',
    [path('package.json')]: PACKAGE_JSON,
  };
}

function ctx(): SpecAlignmentContext {
  return { root: ROOT };
}

// ─── TC-SA-01: SA-F-01 — src/types.ts exists ─────────────────────────────────

describe('TC-SA-01: SA-F-01 — src/types.ts exists', () => {
  it('passes when src/types.ts exists', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-01')!;
    expect(check.passed).toBe(true);
  });

  it('fails when src/types.ts is missing', () => {
    const files = compliantFiles();
    delete files[path('src/types.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-01')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('src/types.ts not found');
  });
});

// ─── TC-SA-02: SA-F-02 — Intent interface exported ───────────────────────────

describe('TC-SA-02: SA-F-02 — Intent interface exported from src/types.ts', () => {
  it('passes when Intent is exported', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-02')!;
    expect(check.passed).toBe(true);
  });

  it('fails when Intent interface is absent', () => {
    const files = compliantFiles();
    files[path('src/types.ts')] = '// no Intent here\nexport type Foo = string;\n';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-02')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('Intent interface');
  });

  it('fails when types.ts is missing', () => {
    const files = compliantFiles();
    delete files[path('src/types.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-02')!;
    expect(check.passed).toBe(false);
  });
});

// ─── TC-SA-03: SA-F-03 — Intent.action_class typed as string ─────────────────

describe('TC-SA-03: SA-F-03 — Intent.action_class typed as string', () => {
  it('passes when action_class: string is present', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-03')!;
    expect(check.passed).toBe(true);
  });

  it('fails when action_class field is absent', () => {
    const files = compliantFiles();
    files[path('src/types.ts')] = 'export interface Intent { target: string; }\nexport interface ExecutionEnvelope { intent: Intent; capability: null; metadata: Record<string, unknown>; provenance: Record<string, unknown>; }';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-03')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('action_class');
  });
});

// ─── TC-SA-04: SA-F-04 — Intent.target typed as string ───────────────────────

describe('TC-SA-04: SA-F-04 — Intent.target typed as string', () => {
  it('passes when target: string is present', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-04')!;
    expect(check.passed).toBe(true);
  });

  it('fails when target field is absent', () => {
    const files = compliantFiles();
    files[path('src/types.ts')] = 'export interface Intent { action_class: string; }\nexport interface ExecutionEnvelope { intent: Intent; capability: null; metadata: Record<string, unknown>; provenance: Record<string, unknown>; }';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-04')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('target');
  });
});

// ─── TC-SA-05: SA-F-05 — Intent.summary typed as string ──────────────────────

describe('TC-SA-05: SA-F-05 — Intent.summary typed as string', () => {
  it('passes when summary: string is present', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-05')!;
    expect(check.passed).toBe(true);
  });

  it('fails when summary field is absent', () => {
    const files = compliantFiles();
    files[path('src/types.ts')] = 'export interface Intent { action_class: string; target: string; }\nexport interface ExecutionEnvelope { intent: Intent; capability: null; metadata: Record<string, unknown>; provenance: Record<string, unknown>; }';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-05')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('summary');
  });
});

// ─── TC-SA-06: SA-F-06 — Intent.payload_hash typed as string ─────────────────

describe('TC-SA-06: SA-F-06 — Intent.payload_hash typed as string', () => {
  it('passes when payload_hash: string is present', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-06')!;
    expect(check.passed).toBe(true);
  });

  it('fails when payload_hash field is absent', () => {
    const files = compliantFiles();
    files[path('src/types.ts')] = 'export interface Intent { action_class: string; target: string; summary: string; parameters: Record<string, unknown>; }\nexport interface ExecutionEnvelope { intent: Intent; capability: null; metadata: Record<string, unknown>; provenance: Record<string, unknown>; }';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-06')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('payload_hash');
  });
});

// ─── TC-SA-07: SA-F-07 — Intent.parameters typed as Record<string, unknown> ──

describe('TC-SA-07: SA-F-07 — Intent.parameters typed as Record<string, unknown>', () => {
  it('passes when parameters: Record<string, unknown> is present', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-07')!;
    expect(check.passed).toBe(true);
  });

  it('fails when parameters field is absent', () => {
    const files = compliantFiles();
    files[path('src/types.ts')] = 'export interface Intent { action_class: string; target: string; summary: string; payload_hash: string; }\nexport interface ExecutionEnvelope { intent: Intent; capability: null; metadata: Record<string, unknown>; provenance: Record<string, unknown>; }';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-07')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('Record<string, unknown>');
  });

  it('fails when parameters is typed as any (not Record<string, unknown>)', () => {
    const files = compliantFiles();
    files[path('src/types.ts')] = 'export interface Intent { action_class: string; target: string; summary: string; payload_hash: string; parameters: any; }\nexport interface ExecutionEnvelope { intent: Intent; capability: null; metadata: Record<string, unknown>; provenance: Record<string, unknown>; }';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-07')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('prohibits untyped');
  });
});

// ─── TC-SA-08: SA-F-08 — ExecutionEnvelope wraps Intent ──────────────────────

describe('TC-SA-08: SA-F-08 — ExecutionEnvelope wraps Intent type', () => {
  it('passes when ExecutionEnvelope has intent: Intent', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-08')!;
    expect(check.passed).toBe(true);
  });

  it('fails when ExecutionEnvelope interface is absent', () => {
    const files = compliantFiles();
    files[path('src/types.ts')] = TYPES_TS.replace(
      /export\s+interface\s+ExecutionEnvelope[\s\S]*?\}/,
      '',
    );
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-08')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('ExecutionEnvelope interface not found');
  });

  it('fails when ExecutionEnvelope does not have intent: Intent field', () => {
    const files = compliantFiles();
    files[path('src/types.ts')] = `
export interface Intent { action_class: string; target: string; summary: string; payload_hash: string; parameters: Record<string, unknown>; }
export interface ExecutionEnvelope {
  envelope_data: Record<string, unknown>;
}
`;
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-F-08')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('intent: Intent');
  });
});

// ─── TC-SA-09: SA-S-01 — no child_process imports ────────────────────────────

describe('TC-SA-09: SA-S-01 — no child_process imports in src/ source files', () => {
  it('passes when no source file imports child_process', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-S-01')!;
    expect(check.passed).toBe(true);
  });

  it('fails when a source file imports child_process', () => {
    const files = compliantFiles();
    files[path('src/enforcement/normalize.ts')] =
      "import { execSync } from 'node:child_process';\n" + NORMALIZE_TS;
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-S-01')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('child_process');
  });

  it('does not flag test files (.test.ts)', () => {
    const files = compliantFiles();
    files[path('src/enforcement/normalize.test.ts')] =
      "import { execSync } from 'node:child_process';\n// test\n";
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-S-01')!;
    expect(check.passed).toBe(true);
  });

  it('does not flag e2e files (.e2e.ts)', () => {
    const files = compliantFiles();
    files[path('src/pipeline.e2e.ts')] =
      "import { execSync } from 'node:child_process';\n// e2e setup\n";
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-S-01')!;
    expect(check.passed).toBe(true);
  });
});

// ─── TC-SA-10: SA-S-02 — no execSync/spawnSync calls ─────────────────────────

describe('TC-SA-10: SA-S-02 — no execSync/spawnSync calls in src/ source files', () => {
  it('passes when no source file calls execSync or spawnSync', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-S-02')!;
    expect(check.passed).toBe(true);
  });

  it('fails when a source file calls execSync()', () => {
    const files = compliantFiles();
    files[path('src/enforcement/normalize.ts')] =
      NORMALIZE_TS + '\nconst result = execSync("ls");\n';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-S-02')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('execSync');
  });

  it('fails when a source file calls spawnSync()', () => {
    const files = compliantFiles();
    files[path('src/adapter/file-adapter.ts')] = 'const r = spawnSync("node", ["-e", "1"]);\n';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-S-02')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('spawnSync');
  });

  it('does not flag execSync in .test.ts files', () => {
    const files = compliantFiles();
    files[path('src/enforcement/normalize.test.ts')] =
      'import { execSync } from "child_process";\nconst out = execSync("echo hi");\n';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-S-02')!;
    expect(check.passed).toBe(true);
  });
});

// ─── TC-SA-11: SA-I-01 — normalize_action in normalize.ts ────────────────────

describe('TC-SA-11: SA-I-01 — normalize_action function in normalize.ts', () => {
  it('passes when normalize_action exists', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-01')!;
    expect(check.passed).toBe(true);
  });

  it('fails when normalize.ts is missing', () => {
    const files = compliantFiles();
    delete files[path('src/enforcement/normalize.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-01')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('normalize.ts not found');
  });

  it('fails when normalize.ts lacks normalize_action function', () => {
    const files = compliantFiles();
    files[path('src/enforcement/normalize.ts')] = '// action normalization\nexport function foo() {}\n';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-01')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('normalize_action');
  });
});

// ─── TC-SA-12: SA-I-02 — stage1-capability.ts exists ────────────────────────

describe('TC-SA-12: SA-I-02 — stage1-capability.ts exists', () => {
  it('passes when stage1-capability.ts exists', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-02')!;
    expect(check.passed).toBe(true);
  });

  it('fails when stage1-capability.ts is missing', () => {
    const files = compliantFiles();
    delete files[path('src/enforcement/stage1-capability.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-02')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('stage1-capability.ts');
  });
});

// ─── TC-SA-13: SA-I-03 — stage2-policy.ts exists ─────────────────────────────

describe('TC-SA-13: SA-I-03 — stage2-policy.ts exists', () => {
  it('passes when stage2-policy.ts exists', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-03')!;
    expect(check.passed).toBe(true);
  });

  it('fails when stage2-policy.ts is missing', () => {
    const files = compliantFiles();
    delete files[path('src/enforcement/stage2-policy.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-03')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('stage2-policy.ts');
  });
});

// ─── TC-SA-14: SA-I-04 — IAuthorityAdapter in adapter/types.ts ───────────────

describe('TC-SA-14: SA-I-04 — IAuthorityAdapter in src/adapter/types.ts', () => {
  it('passes when IAuthorityAdapter is exported', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-04')!;
    expect(check.passed).toBe(true);
  });

  it('fails when adapter/types.ts is missing', () => {
    const files = compliantFiles();
    delete files[path('src/adapter/types.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-04')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('adapter/types.ts not found');
  });

  it('fails when IAuthorityAdapter interface is not exported', () => {
    const files = compliantFiles();
    files[path('src/adapter/types.ts')] = '// no IAuthorityAdapter\nexport type Foo = string;\n';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-04')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('IAuthorityAdapter');
  });
});

// ─── TC-SA-15: SA-I-05 — HITL approval-manager.ts exists ─────────────────────

describe('TC-SA-15: SA-I-05 — HITL approval-manager.ts exists', () => {
  it('passes when approval-manager.ts exists', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-05')!;
    expect(check.passed).toBe(true);
  });

  it('fails when approval-manager.ts is missing', () => {
    const files = compliantFiles();
    delete files[path('src/hitl/approval-manager.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-05')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('approval-manager.ts');
  });
});

// ─── TC-SA-16: SA-I-06 — @openclaw/action-registry in package.json ───────────

describe('TC-SA-16: SA-I-06 — @openclaw/action-registry in package.json dependencies', () => {
  it('passes when @openclaw/action-registry is declared', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-06')!;
    expect(check.passed).toBe(true);
  });

  it('fails when package.json is missing', () => {
    const files = compliantFiles();
    delete files[path('package.json')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-06')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('package.json not found');
  });

  it('fails when @openclaw/action-registry is absent from dependencies', () => {
    const files = compliantFiles();
    files[path('package.json')] = JSON.stringify({ name: 'foo', version: '1.0.0', dependencies: {} });
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-06')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('@openclaw/action-registry');
  });

  it('fails when package.json has no dependencies key', () => {
    const files = compliantFiles();
    files[path('package.json')] = JSON.stringify({ name: 'foo', version: '1.0.0' });
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-06')!;
    expect(check.passed).toBe(false);
  });

  it('fails when package.json is invalid JSON', () => {
    const files = compliantFiles();
    files[path('package.json')] = '{ invalid json }';
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-06')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('not valid JSON');
  });
});

// ─── TC-SA-17: SA-I-07 — unknown_sensitive_action in normalize.ts ─────────────

describe('TC-SA-17: SA-I-07 — unknown_sensitive_action in src/enforcement/normalize.ts', () => {
  it('passes when unknown_sensitive_action is referenced', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-07')!;
    expect(check.passed).toBe(true);
  });

  it('fails when normalize.ts is missing', () => {
    const files = compliantFiles();
    delete files[path('src/enforcement/normalize.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-07')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('normalize.ts not found');
  });

  it('fails when unknown_sensitive_action is absent from normalize.ts', () => {
    const files = compliantFiles();
    files[path('src/enforcement/normalize.ts')] =
      "export function normalize_action() { return 'filesystem.read'; }\n";
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const check = result.checks.find((c) => c.id === 'SA-I-07')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toContain('fail-closed');
  });
});

// ─── TC-SA-18: Aggregated result — all checks pass when compliant ─────────────

describe('TC-SA-18: aggregated result when project is spec-compliant', () => {
  it('returns compliant: true', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    expect(result.compliant).toBe(true);
  });

  it('returns an empty failures array', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    expect(result.failures).toHaveLength(0);
  });

  it('returns exactly 17 checks (SA-F-01..08 + SA-S-01..02 + SA-I-01..07)', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    expect(result.checks).toHaveLength(17);
  });

  it('summary.total matches checks length', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    expect(result.summary.total).toBe(result.checks.length);
  });

  it('summary.passed equals total when all checks pass', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    expect(result.summary.passed).toBe(result.summary.total);
    expect(result.summary.failed).toBe(0);
  });

  it('all checks have non-empty id and description', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    for (const check of result.checks) {
      expect(check.id.length).toBeGreaterThan(0);
      expect(check.description.length).toBeGreaterThan(0);
    }
  });

  it('passed checks have no reason field', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    for (const check of result.checks.filter((c) => c.passed)) {
      expect(check.reason, `${check.id} should have no reason when passed`).toBeUndefined();
    }
  });

  it('check IDs cover SA-F-01..SA-F-08, SA-S-01..SA-S-02, SA-I-01..SA-I-07', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const ids = result.checks.map((c) => c.id);
    for (let i = 1; i <= 8; i++) {
      expect(ids).toContain(`SA-F-0${i}`);
    }
    for (let i = 1; i <= 2; i++) {
      expect(ids).toContain(`SA-S-0${i}`);
    }
    for (let i = 1; i <= 7; i++) {
      expect(ids).toContain(`SA-I-0${i}`);
    }
  });

  it('specSection fields match the expected spec groups', () => {
    setFiles(compliantFiles());
    const result = new SpecAlignmentValidator().validate(ctx());
    const fChecks = result.checks.filter((c) => c.id.startsWith('SA-F'));
    const sChecks = result.checks.filter((c) => c.id.startsWith('SA-S'));
    const iChecks = result.checks.filter((c) => c.id.startsWith('SA-I'));
    expect(fChecks.every((c) => c.specSection === 'FEP §2')).toBe(true);
    expect(sChecks.every((c) => c.specSection === 'FEP Shell Prohibition')).toBe(true);
    expect(iChecks.every((c) => c.specSection === 'Integration Spec')).toBe(true);
  });
});

// ─── TC-SA-19: Aggregated result — failures reported correctly ────────────────

describe('TC-SA-19: aggregated result — failures reported correctly', () => {
  it('returns compliant: false when any check fails', () => {
    const files = compliantFiles();
    delete files[path('src/types.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    expect(result.compliant).toBe(false);
  });

  it('failures array contains only the failing checks', () => {
    const files = compliantFiles();
    delete files[path('src/enforcement/stage1-capability.ts')];
    delete files[path('src/enforcement/stage2-policy.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    const failedIds = result.failures.map((f) => f.id);
    expect(failedIds).toContain('SA-I-02');
    expect(failedIds).toContain('SA-I-03');
    expect(failedIds).not.toContain('SA-I-01');
  });

  it('summary.failed equals failures length', () => {
    const files = compliantFiles();
    delete files[path('src/types.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    expect(result.summary.failed).toBe(result.failures.length);
  });

  it('failed checks have a non-empty reason field', () => {
    const files = compliantFiles();
    delete files[path('src/types.ts')];
    setFiles(files);
    const result = new SpecAlignmentValidator().validate(ctx());
    for (const f of result.failures) {
      expect(typeof f.reason === 'string' && f.reason.length > 0).toBe(true);
    }
  });
});

// ─── TC-SA-20: generateReport — formats report with sections and summary ──────

describe('TC-SA-20: generateReport — compliance report formatting', () => {
  it('includes all three spec section headings', () => {
    setFiles(compliantFiles());
    const validator = new SpecAlignmentValidator();
    const result = validator.validate(ctx());
    const report = validator.generateReport(result);
    expect(report).toContain('FEP §2');
    expect(report).toContain('FEP Shell Prohibition');
    expect(report).toContain('Integration Spec');
  });

  it('includes COMPLIANT when all checks pass', () => {
    setFiles(compliantFiles());
    const validator = new SpecAlignmentValidator();
    const result = validator.validate(ctx());
    const report = validator.generateReport(result);
    expect(report).toContain('COMPLIANT');
    expect(report).not.toContain('NON-COMPLIANT');
  });

  it('includes NON-COMPLIANT and failure details when checks fail', () => {
    const files = compliantFiles();
    delete files[path('src/types.ts')];
    setFiles(files);
    const validator = new SpecAlignmentValidator();
    const result = validator.validate(ctx());
    const report = validator.generateReport(result);
    expect(report).toContain('NON-COMPLIANT');
    expect(report).toContain('SA-F-01');
  });

  it('includes [PASS] and [FAIL] markers', () => {
    const files = compliantFiles();
    delete files[path('src/enforcement/stage2-policy.ts')];
    setFiles(files);
    const validator = new SpecAlignmentValidator();
    const result = validator.validate(ctx());
    const report = validator.generateReport(result);
    expect(report).toContain('[PASS]');
    expect(report).toContain('[FAIL]');
  });

  it('includes the pass/total count in the result line', () => {
    setFiles(compliantFiles());
    const validator = new SpecAlignmentValidator();
    const result = validator.validate(ctx());
    const report = validator.generateReport(result);
    expect(report).toContain('17/17');
  });
});

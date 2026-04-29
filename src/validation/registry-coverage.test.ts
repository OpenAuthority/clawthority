/**
 * Registry coverage contract test.
 *
 * Asserts that every action_class entry in the @openclaw/action-registry
 * has at least one implementing first-party tool in @openclaw/* packages.
 * Scans src/tools/<tool>/manifest.ts files and extracts their action_class
 * declarations, then cross-checks against the canonical REGISTRY.
 *
 * Test IDs:
 *   TC-RCT-01: Manifest scanning — discovers manifest.ts files under src/tools/
 *   TC-RCT-02: Action class extraction — parses action_class from manifest source
 *   TC-RCT-03: Contract — all scanned manifests declare a registered action_class
 *   TC-RCT-04: Contract — every registry entry has at least one implementing tool
 */

import { describe, it, expect } from 'vitest';
import { REGISTRY, ActionClass } from '@openclaw/action-registry';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Path resolution ───────────────────────────────────────────────────────────

const _dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(_dirname, '../tools');
const MANIFEST_FILENAME = 'manifest.ts';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ManifestInfo {
  /** Tool directory name (e.g. "git_add"). */
  toolName: string;
  /** Extracted action_class value, or null if not found. */
  action_class: string | null;
  /** Absolute path to the manifest.ts file. */
  filePath: string;
}

// ─── Registry entries that require first-party tool coverage ───────────────────

/**
 * Action classes that are intentionally exempt from the first-party coverage
 * requirement.
 *
 * Permanent exemptions:
 * - `unknown_sensitive_action`: Meta catch-all entry with no aliases; no tool
 *   declares it directly. It is used by the normalizer as a fallback.
 * - `shell.exec`: First-party tools are blocked from using this action_class
 *   by SkillManifestValidator rule E-03, so it can never have a first-party
 *   implementing tool. Covered by the shell.exec regression contract test.
 *
 * Roadmap exemptions (remove once the corresponding tool lands under
 * src/tools/<name>/manifest.ts). This test is forward-looking: it prevents
 * a NEW registry entry from being added without a tool.
 */
const COVERAGE_EXEMPT = new Set<string>([
  ActionClass.UnknownSensitiveAction,
  ActionClass.ShellExec,
  // Roadmap — awaiting first-party tool implementation:
  ActionClass.MemoryRead,
  ActionClass.MemoryWrite,
  ActionClass.PaymentInitiate,
  // v1.3.2: typed tools for systemctl/service/reboot/shutdown/init.
  // v1.3.1 ships only the registry alias + explainer pattern (Layers 1+2);
  // typed tool wrappers land in v1.3.2 once HITL volume is measured.
  ActionClass.SystemService,
  // v1.3.2: typed tools for chmod/chown/chgrp/umask. Same v1.3.1 / v1.3.2
  // split as system.service.
  ActionClass.PermissionsModify,
  // v1.3.2: permissions.elevate (sudo / su / doas / passwd) is intentionally
  // *not* getting a typed-tool wrapper — see docs/release-plans/v1.3.2.md
  // §2.2. The v1.3.2 plan ships a default-forbid policy rule on this class
  // instead. Operators who need privilege elevation use unsafe_admin_exec.
  ActionClass.PermissionsElevate,
  // v1.3.2: typed tools for kill/pkill/killall (see release-plan §6).
  // PID resolution to process name+cmdline happens inside the typed tool so
  // HITL messages can show "TERM pid 1234 (/usr/bin/java -jar app.jar)".
  ActionClass.ProcessSignal,
  // v1.3.x: network.diagnose covers ping/traceroute/nslookup/dig/netstat/ss
  // — read-only diagnostics. Typed tools deferred indefinitely; the registry
  // alias + explainer pattern is sufficient and these are HITL-mode 'none'
  // by default (no operator interruption needed).
  ActionClass.NetworkDiagnose,
  // v1.4: typed tool wrapper for nmap is genuinely useful (could constrain
  // scan types, target ranges, opt-in --script). Deferred to v1.4 — for
  // v1.3.1 the registry alias + explainer + per_request HITL is enough.
  ActionClass.NetworkScan,
  // v1.3.2: typed tools for crontab/at/batch (see release-plan §9). The
  // typed wrapper deliberately omits interactive `crontab -e` mode; install-
  // from-file is the supported persistence path.
  ActionClass.SchedulingPersist,
  // v1.4: typed tools for rsync/scp/sftp would constrain endpoints to a
  // configured allowlist (similar to web.fetch's `allowed_domains`). v1.3.1
  // ships only the registry alias + explainer + per_request HITL, with the
  // data_exfiltration intent_group so a single rule can cover all transports.
  ActionClass.NetworkTransfer,
  // v1.3.2: typed tools for kubectl (apply / get / delete / rollout — see
  // release-plan §7). kubectl exec / port-forward are in the "long-running /
  // separate process" bucket and need the v1.4 streams design before they
  // get typed wrappers. v1.3.1 ships only the registry alias + explainer +
  // per_request HITL.
  ActionClass.ClusterManage,
  // v1.4: typed tool wrappers for ssh / mosh / telnet would constrain the
  // remote-host endpoint to a configured allowlist (analogous to web.fetch's
  // `allowed_domains`). Interactive remote shells also fall into the
  // long-running-streams bucket — see the v1.4 RFC. v1.3.1 ships only the
  // registry alias + explainer + per_request HITL.
  ActionClass.NetworkShell,
]);

// ─── Scanning helpers ──────────────────────────────────────────────────────────

/**
 * Regex that matches the action_class property assignment in a manifest.ts file.
 * Handles both single-quoted and double-quoted string values.
 * Example match: `  action_class: 'filesystem.read',`
 */
const ACTION_CLASS_RE = /action_class:\s*['"]([^'"]+)['"]/;

/**
 * Extracts the action_class value from manifest.ts source text.
 * Returns `null` when no action_class property is found.
 */
export function extractActionClass(source: string): string | null {
  const match = ACTION_CLASS_RE.exec(source);
  return match ? (match[1] ?? null) : null;
}

/**
 * Finds all manifest.ts paths directly under the given tools directory.
 * Each tool lives in its own subdirectory: tools/<tool_name>/manifest.ts
 */
export function findToolManifests(toolsDir: string): string[] {
  if (!existsSync(toolsDir)) return [];
  const manifests: string[] = [];
  for (const entry of readdirSync(toolsDir)) {
    const toolDir = join(toolsDir, entry);
    if (!statSync(toolDir).isDirectory()) continue;
    const manifestPath = join(toolDir, MANIFEST_FILENAME);
    if (existsSync(manifestPath)) manifests.push(manifestPath);
  }
  return manifests;
}

/**
 * Scans the tools directory and returns manifest info for each discovered tool.
 */
export function scanFirstPartyManifests(toolsDir: string): ManifestInfo[] {
  const manifestPaths = findToolManifests(toolsDir);
  return manifestPaths.map((absPath) => {
    const toolName = absPath
      .split('/')
      .reverse()
      .slice(1)[0] ?? absPath;
    const source = readFileSync(absPath, 'utf-8');
    return {
      toolName,
      action_class: extractActionClass(source),
      filePath: absPath,
    };
  });
}

// ─── Coverage computation ─────────────────────────────────────────────────────

/**
 * Builds a coverage map from action_class → array of tool names that implement it.
 */
export function buildCoverageMap(manifests: ManifestInfo[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { toolName, action_class } of manifests) {
    if (action_class === null) continue;
    const tools = map.get(action_class) ?? [];
    tools.push(toolName);
    map.set(action_class, tools);
  }
  return map;
}

// ─── TC-RCT-01: Manifest scanning ─────────────────────────────────────────────

describe('TC-RCT-01: manifest scanning discovers manifest.ts files under src/tools/', () => {
  it('returns empty array when tools directory does not exist', () => {
    const result = findToolManifests('/nonexistent/path/to/tools');
    expect(result).toHaveLength(0);
  });

  it('real tools directory exists and contains at least one manifest', () => {
    const manifests = findToolManifests(TOOLS_DIR);
    expect(manifests.length).toBeGreaterThan(0);
  });

  it('each discovered manifest path ends with manifest.ts', () => {
    const manifests = findToolManifests(TOOLS_DIR);
    for (const p of manifests) {
      expect(p.endsWith(MANIFEST_FILENAME)).toBe(true);
    }
  });

  it('each discovered manifest path exists on disk', () => {
    const manifests = findToolManifests(TOOLS_DIR);
    for (const p of manifests) {
      expect(existsSync(p), `Expected manifest to exist at: ${p}`).toBe(true);
    }
  });
});

// ─── TC-RCT-02: Action class extraction ───────────────────────────────────────

describe('TC-RCT-02: action class extraction parses action_class from manifest source', () => {
  it('extracts action_class from a single-quoted property', () => {
    const source = `export const myManifest = {\n  action_class: 'filesystem.read',\n};`;
    expect(extractActionClass(source)).toBe('filesystem.read');
  });

  it('extracts action_class from a double-quoted property', () => {
    const source = `export const myManifest = {\n  action_class: "vcs.write",\n};`;
    expect(extractActionClass(source)).toBe('vcs.write');
  });

  it('handles whitespace variations between colon and value', () => {
    expect(extractActionClass(`action_class:  'web.fetch'`)).toBe('web.fetch');
    expect(extractActionClass(`action_class:\t'build.test'`)).toBe('build.test');
  });

  it('returns null when no action_class property is present', () => {
    const source = `export const myManifest = {\n  name: 'my-tool',\n};`;
    expect(extractActionClass(source)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractActionClass('')).toBeNull();
  });

  it('does not match a comment like "* Action class: vcs.read"', () => {
    const source = `/**\n * Action class: vcs.read\n */\nexport const m = { name: 'x' };`;
    expect(extractActionClass(source)).toBeNull();
  });

  it('extracts only the first action_class occurrence when multiple exist', () => {
    const source = `const a = { action_class: 'vcs.read' };\nconst b = { action_class: 'vcs.write' };`;
    expect(extractActionClass(source)).toBe('vcs.read');
  });
});

// ─── TC-RCT-03: Contract — scanned manifests have registered action_classes ────

describe('TC-RCT-03: all scanned tool manifests declare a registered action_class', () => {
  const registeredClasses = new Set(REGISTRY.map((e) => e.action_class));
  const manifests = scanFirstPartyManifests(TOOLS_DIR);

  it('each scanned manifest has an action_class field', () => {
    const missing = manifests.filter((m) => m.action_class === null);
    expect(
      missing,
      `Manifest files with no action_class property:\n${missing
        .map((m) => `  - ${m.filePath}`)
        .join('\n')}`,
    ).toHaveLength(0);
  });

  it('each scanned manifest action_class is in the action registry', () => {
    const unregistered = manifests.filter(
      (m) => m.action_class !== null && !registeredClasses.has(m.action_class),
    );
    expect(
      unregistered,
      `Manifests declaring an unregistered action_class:\n${unregistered
        .map((m) => `  - ${m.toolName}: action_class="${m.action_class}"`)
        .join('\n')}`,
    ).toHaveLength(0);
  });
});

// ─── TC-RCT-04: Contract — every registry entry has at least one tool ──────────

describe('TC-RCT-04: every registry action_class has at least one implementing first-party tool', () => {
  const manifests = scanFirstPartyManifests(TOOLS_DIR);
  const coverageMap = buildCoverageMap(manifests);

  const requiresCoverage = REGISTRY.filter(
    (entry) => !COVERAGE_EXEMPT.has(entry.action_class),
  );

  it('coverage map is built from at least one tool manifest', () => {
    expect(coverageMap.size).toBeGreaterThan(0);
  });

  it('every non-exempt registry entry has at least one implementing tool', () => {
    const uncovered = requiresCoverage.filter(
      (entry) => (coverageMap.get(entry.action_class) ?? []).length === 0,
    );

    const report = uncovered
      .map(
        (entry) =>
          `  - ${entry.action_class} (risk: ${entry.default_risk}): ` +
          `add src/tools/<name>/manifest.ts with action_class: '${entry.action_class}'`,
      )
      .join('\n');

    expect(
      uncovered,
      `Registry coverage gaps — ${uncovered.length} action_class(es) have no first-party tool:\n${report}`,
    ).toHaveLength(0);
  });
});

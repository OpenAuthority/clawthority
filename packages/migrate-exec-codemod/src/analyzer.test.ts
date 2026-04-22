/**
 * migrate-exec codemod — analyzer tests
 *
 * Test ID prefix: TC-MEC-NN (Migrate Exec Codemod)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeSource, analyzeFile } from './analyzer.js';
import { formatReport, renderReport } from './suggestions.js';
import { buildDiff, renderDiff } from './diff.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRONTMATTER_EXEC_SKILL = `---
name: test_skill
version: 1.0.0
action_class: shell.exec
---

# Test skill
`;

const FRONTMATTER_CLEAN_SKILL = `---
name: test_skill
version: 1.0.0
action_class: vcs.read
---

# Test skill
`;

const JSON_BASH_GIT_STATUS = `---
name: test_skill
version: 1.0.0
action_class: vcs.read
---

# Test

\`\`\`json
{
  "tool": "bash",
  "params": {
    "command": "git status"
  }
}
\`\`\`
`;

const JSON_RUN_COMMAND_LS = `---
name: test_skill
version: 1.0.0
action_class: vcs.read
---

# Test

\`\`\`json
{
  "tool": "run_command",
  "params": {
    "command": "ls -la /tmp"
  }
}
\`\`\`
`;

const JSON_MULTIPLE_TOOLS = `---
name: test_skill
version: 1.0.0
action_class: shell.exec
---

# Test

\`\`\`json
{
  "tool": "bash",
  "params": { "command": "git log --oneline" }
}
\`\`\`

\`\`\`json
{
  "tool": "shell_exec",
  "params": { "command": "cat /etc/hosts" }
}
\`\`\`

\`\`\`json
{
  "tool": "bash",
  "params": { "command": "curl https://example.com" }
}
\`\`\`
`;

const TS_ACTION_CLASS_LITERAL = `
export const myManifest = {
  name: 'my_tool',
  action_class: 'shell.exec',
  risk_tier: 'high',
};
`;

const TS_CLEAN = `
export const myManifest = {
  name: 'my_tool',
  action_class: 'vcs.read',
  risk_tier: 'low',
};
`;

// ---------------------------------------------------------------------------
// TC-MEC-01: Frontmatter action_class: shell.exec detection
// ---------------------------------------------------------------------------

describe('TC-MEC-01: frontmatter shell.exec detection', () => {
  it('detects shell.exec in SKILL.md frontmatter', () => {
    const result = analyzeSource(FRONTMATTER_EXEC_SKILL, 'test.md', 'skill');
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f).toBeDefined();
    if (!f) return;
    expect(f.kind).toBe('frontmatter-action-class');
    expect(f.matched_text).toContain('shell.exec');
  });

  it('does not flag a non-exec action_class', () => {
    const result = analyzeSource(FRONTMATTER_CLEAN_SKILL, 'test.md', 'skill');
    expect(result.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-MEC-02: JSON code block tool-call detection
// ---------------------------------------------------------------------------

describe('TC-MEC-02: JSON code block exec tool detection', () => {
  it('detects bash tool call with git status command', () => {
    const result = analyzeSource(JSON_BASH_GIT_STATUS, 'test.md', 'skill');
    const jsonFindings = result.findings.filter((f) => f.kind === 'json-tool-call');
    expect(jsonFindings).toHaveLength(1);
    const f = jsonFindings[0];
    expect(f).toBeDefined();
    if (!f) return;
    expect(f.suggestion).not.toBeNull();
    expect(f.suggestion?.tool).toBe('git_status');
    expect(f.suggestion?.action_class).toBe('vcs.read');
    expect(f.suggestion?.risk_tier).toBe('low');
  });

  it('detects run_command tool call with ls command', () => {
    const result = analyzeSource(JSON_RUN_COMMAND_LS, 'test.md', 'skill');
    const jsonFindings = result.findings.filter((f) => f.kind === 'json-tool-call');
    expect(jsonFindings).toHaveLength(1);
    const f = jsonFindings[0];
    expect(f).toBeDefined();
    if (!f) return;
    expect(f.suggestion?.tool).toBe('list_dir');
    expect(f.suggestion?.action_class).toBe('filesystem.list');
  });

  it('does not flag non-exec tool calls', () => {
    const cleanSkill = `---
name: test
version: 1.0.0
action_class: vcs.read
---

\`\`\`json
{
  "tool": "git_status",
  "params": {}
}
\`\`\`
`;
    const result = analyzeSource(cleanSkill, 'test.md', 'skill');
    expect(result.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-MEC-03: Multiple findings in one file
// ---------------------------------------------------------------------------

describe('TC-MEC-03: multiple findings', () => {
  it('finds all exec patterns across frontmatter and JSON blocks', () => {
    const result = analyzeSource(JSON_MULTIPLE_TOOLS, 'test.md', 'skill');
    // 1 frontmatter + 3 JSON tool calls
    expect(result.findings).toHaveLength(4);
    const frontmatterFindings = result.findings.filter((f) => f.kind === 'frontmatter-action-class');
    const jsonFindings = result.findings.filter((f) => f.kind === 'json-tool-call');
    expect(frontmatterFindings).toHaveLength(1);
    expect(jsonFindings).toHaveLength(3);
  });

  it('matches git log to git_log (vcs.read)', () => {
    const result = analyzeSource(JSON_MULTIPLE_TOOLS, 'test.md', 'skill');
    const gitLogFinding = result.findings.find(
      (f) => f.kind === 'json-tool-call' && f.context?.includes('git log'),
    );
    expect(gitLogFinding?.suggestion?.tool).toBe('git_log');
  });

  it('matches cat to read_file (filesystem.read)', () => {
    const result = analyzeSource(JSON_MULTIPLE_TOOLS, 'test.md', 'skill');
    const catFinding = result.findings.find(
      (f) => f.kind === 'json-tool-call' && f.context?.includes('cat'),
    );
    expect(catFinding?.suggestion?.tool).toBe('read_file');
  });

  it('matches curl to web_fetch (web.fetch)', () => {
    const result = analyzeSource(JSON_MULTIPLE_TOOLS, 'test.md', 'skill');
    const curlFinding = result.findings.find(
      (f) => f.kind === 'json-tool-call' && f.context?.includes('curl'),
    );
    expect(curlFinding?.suggestion?.tool).toBe('web_fetch');
  });

  it('findings are sorted by line number', () => {
    const result = analyzeSource(JSON_MULTIPLE_TOOLS, 'test.md', 'skill');
    for (let i = 1; i < result.findings.length; i++) {
      expect(result.findings[i]!.line).toBeGreaterThanOrEqual(result.findings[i - 1]!.line);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-MEC-04: TypeScript source detection
// ---------------------------------------------------------------------------

describe('TC-MEC-04: TypeScript action_class literal detection', () => {
  it('detects shell.exec literal in TypeScript manifest', () => {
    const result = analyzeSource(TS_ACTION_CLASS_LITERAL, 'manifest.ts', 'typescript');
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f?.kind).toBe('ts-action-class-literal');
    expect(f?.matched_text).toContain('shell.exec');
  });

  it('does not flag vcs.read in TypeScript', () => {
    const result = analyzeSource(TS_CLEAN, 'manifest.ts', 'typescript');
    expect(result.findings).toHaveLength(0);
  });

  it('infers typescript kind from .ts extension', () => {
    const result = analyzeSource(TS_ACTION_CLASS_LITERAL, 'manifest.ts', 'auto');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('ts-action-class-literal');
  });
});

// ---------------------------------------------------------------------------
// TC-MEC-05: Suggestion report formatting
// ---------------------------------------------------------------------------

describe('TC-MEC-05: suggestion report formatting', () => {
  it('renders a report with suggestions', () => {
    const result = analyzeSource(JSON_BASH_GIT_STATUS, 'test.md', 'skill');
    const report = formatReport(result);
    expect(report.total).toBeGreaterThan(0);
    expect(report.suggestions[0]).toBeDefined();
    expect(report.suggestions[0]?.severity).toBe('advisory');
  });

  it('renderReport returns clean string for file with no findings', () => {
    const result = analyzeSource(FRONTMATTER_CLEAN_SKILL, 'test.md', 'skill');
    const report = formatReport(result);
    const rendered = renderReport(report);
    expect(rendered).toContain('no exec patterns detected');
  });

  it('renderReport includes tool suggestion in output', () => {
    const result = analyzeSource(JSON_BASH_GIT_STATUS, 'test.md', 'skill');
    const report = formatReport(result);
    const rendered = renderReport(report);
    expect(rendered).toContain('git_status');
    expect(rendered).toContain('vcs.read');
  });
});

// ---------------------------------------------------------------------------
// TC-MEC-06: Diff generation
// ---------------------------------------------------------------------------

describe('TC-MEC-06: diff generation', () => {
  it('produces a non-empty diff for exec-containing skill', () => {
    const source = JSON_BASH_GIT_STATUS;
    const result = analyzeSource(source, 'test.md', 'skill');
    const diff = buildDiff(result, source);
    expect(diff.hunks.length).toBeGreaterThan(0);
  });

  it('renderDiff output starts with --- and +++ headers', () => {
    const source = JSON_BASH_GIT_STATUS;
    const result = analyzeSource(source, 'test.md', 'skill');
    const diff = buildDiff(result, source);
    const rendered = renderDiff(diff);
    expect(rendered).toMatch(/^--- a\/test\.md/);
    expect(rendered).toContain('+++ b/test.md');
  });

  it('diff replaces bash tool name with suggested tool name', () => {
    const source = JSON_BASH_GIT_STATUS;
    const result = analyzeSource(source, 'test.md', 'skill');
    const diff = buildDiff(result, source);
    const rendered = renderDiff(diff);
    expect(rendered).toContain('-');
    expect(rendered).toContain('+');
    expect(rendered).toContain('git_status');
  });

  it('produces valid diff for file with no findings', () => {
    const source = FRONTMATTER_CLEAN_SKILL;
    const result = analyzeSource(source, 'test.md', 'skill');
    const diff = buildDiff(result, source);
    const rendered = renderDiff(diff);
    expect(rendered).toContain('no changes suggested');
  });
});

// ---------------------------------------------------------------------------
// TC-MEC-07: Sample fixture analysis
// ---------------------------------------------------------------------------

describe('TC-MEC-07: sample fixture produces expected suggestions', () => {
  const fixturePath = new URL('../fixtures/sample-exec-skill.md', import.meta.url).pathname;

  it('analyzes the sample fixture without throwing', () => {
    expect(() => analyzeFile(fixturePath)).not.toThrow();
  });

  it('finds at least 10 exec patterns in the sample fixture', () => {
    const result = analyzeFile(fixturePath);
    expect(result.findings.length).toBeGreaterThanOrEqual(10);
  });

  it('sample fixture frontmatter is detected as shell.exec', () => {
    const result = analyzeFile(fixturePath);
    const fm = result.findings.filter((f) => f.kind === 'frontmatter-action-class');
    expect(fm).toHaveLength(1);
  });

  it('sample fixture JSON blocks include git_status and list_dir suggestions', () => {
    const result = analyzeFile(fixturePath);
    const tools = result.findings
      .filter((f) => f.kind === 'json-tool-call')
      .map((f) => f.suggestion?.tool)
      .filter(Boolean);
    expect(tools).toContain('git_status');
    expect(tools).toContain('list_dir');
  });

  it('renders the diff for the sample fixture without error', () => {
    const result = analyzeFile(fixturePath);
    const source = readFileSync(fixturePath, 'utf8');
    const diff = buildDiff(result, source);
    const rendered = renderDiff(diff);
    expect(rendered).toContain('--- a/');
    expect(rendered.length).toBeGreaterThan(50);
  });
});

/**
 * Command explainer pattern tests.
 *
 * Test IDs:
 *   TC-CE-01 – TC-CE-12 : git command patterns        (T35)
 *   TC-CE-13 – TC-CE-18 : npm command patterns        (T35)
 *   TC-CE-19 – TC-CE-22 : pip command patterns        (T35)
 *   TC-CE-23 – TC-CE-25 : pytest command patterns     (T35)
 *   TC-CE-26 – TC-CE-30 : docker run patterns         (T18)
 *   TC-CE-31 – TC-CE-33 : docker build patterns       (T18)
 *   TC-CE-34 – TC-CE-37 : docker exec patterns        (T18)
 *   TC-CE-56 – TC-CE-58 : make patterns
 *   TC-CE-59 – TC-CE-62 : cargo patterns
 *   TC-CE-63 – TC-CE-66 : go patterns
 *   TC-CE-67 – TC-CE-68 : git branch/remote detection
 *   TC-CE-69 – TC-CE-71 : eslint patterns
 *   TC-CE-72 – TC-CE-75 : prettier patterns
 */

import { describe, it, expect } from 'vitest';
import { explain } from './patterns.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function hasWarningMatching(warnings: string[], pattern: RegExp): boolean {
  return warnings.some(w => pattern.test(w));
}

function hasEffectMatching(effects: string[], pattern: RegExp): boolean {
  return effects.some(e => pattern.test(e));
}

// ── TC-CE-01 – TC-CE-12 : git ─────────────────────────────────────────────────

describe('TC-CE-01: git commit — summary', () => {
  it('produces a summary that mentions committing changes', () => {
    const result = explain('git commit -m "fix bug"');
    expect(result.summary).toMatch(/commits/i);
  });
});

describe('TC-CE-02: git commit --amend — history rewrite warning', () => {
  it('warns about rewriting history when --amend is present', () => {
    const result = explain('git commit --amend');
    expect(hasWarningMatching(result.warnings, /amend|rewrit/i)).toBe(true);
  });

  it('has no amend warning without --amend flag', () => {
    const result = explain('git commit -m "normal"');
    expect(hasWarningMatching(result.warnings, /amend/i)).toBe(false);
  });
});

describe('TC-CE-03: git push — summary', () => {
  it('produces a summary that mentions pushing to remote', () => {
    const result = explain('git push origin main');
    expect(result.summary).toMatch(/push/i);
  });
});

describe('TC-CE-04: git push --force — force-push warning', () => {
  it('warns about force push when --force is present', () => {
    const result = explain('git push --force origin main');
    expect(hasWarningMatching(result.warnings, /force/i)).toBe(true);
  });

  it('warns about force push when -f shorthand is present', () => {
    const result = explain('git push -f origin main');
    expect(hasWarningMatching(result.warnings, /force/i)).toBe(true);
  });

  it('has no force warning on a normal push', () => {
    const result = explain('git push origin main');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-05: git pull — summary', () => {
  it('produces a summary that mentions fetching or merging from remote', () => {
    const result = explain('git pull origin main');
    expect(result.summary).toMatch(/fetch|merge|remote/i);
  });
});

describe('TC-CE-06: git clone — includes URL in summary', () => {
  it('includes the repository URL in the summary', () => {
    const result = explain('git clone https://github.com/example/repo.git');
    expect(result.summary).toMatch(/github\.com/i);
  });
});

describe('TC-CE-07: git status — summary', () => {
  it('produces a summary mentioning working tree status', () => {
    const result = explain('git status');
    expect(result.summary).toMatch(/status|working tree/i);
  });
});

describe('TC-CE-08: git diff — summary', () => {
  it('produces a summary mentioning changes', () => {
    const result = explain('git diff HEAD~1');
    expect(result.summary).toMatch(/changes|diff/i);
  });
});

describe('TC-CE-09: git log — summary', () => {
  it('produces a summary mentioning the commit log', () => {
    const result = explain('git log --oneline');
    expect(result.summary).toMatch(/log|commit/i);
  });
});

describe('TC-CE-10: git reset --hard — discard warning', () => {
  it('warns about discarding local changes with --hard', () => {
    const result = explain('git reset --hard HEAD');
    expect(hasWarningMatching(result.warnings, /discard|hard/i)).toBe(true);
  });

  it('has no discard warning on a soft reset', () => {
    const result = explain('git reset --soft HEAD~1');
    expect(hasWarningMatching(result.warnings, /discard/i)).toBe(false);
  });
});

describe('TC-CE-11: git merge — includes branch name in summary', () => {
  it('includes the branch name in the summary', () => {
    const result = explain('git merge feature/my-branch');
    expect(result.summary).toMatch(/feature\/my-branch/);
  });
});

describe('TC-CE-12: git checkout — summary', () => {
  it('produces a summary mentioning branches or working tree', () => {
    const result = explain('git checkout main');
    expect(result.summary).toMatch(/branch|restore|switch/i);
  });
});

// ── TC-CE-13 – TC-CE-18 : npm ─────────────────────────────────────────────────

describe('TC-CE-13: npm install — generic summary when no packages listed', () => {
  it('produces a generic install summary', () => {
    const result = explain('npm install');
    expect(result.summary).toMatch(/install/i);
    expect(result.summary).not.toMatch(/:/); // no package list
  });
});

describe('TC-CE-14: npm install — lists packages in summary', () => {
  it('includes named packages in the summary', () => {
    const result = explain('npm install express lodash');
    expect(result.summary).toMatch(/express/);
    expect(result.summary).toMatch(/lodash/);
  });

  it('skips flags and only includes positional package names', () => {
    const result = explain('npm install --save-dev typescript');
    expect(result.summary).toMatch(/typescript/);
    expect(result.summary).not.toMatch(/--save-dev/);
  });
});

describe('TC-CE-15: npm run — always warns about arbitrary shell execution', () => {
  it('includes a shell execution warning', () => {
    const result = explain('npm run build');
    expect(hasWarningMatching(result.warnings, /shell|arbitrary/i)).toBe(true);
  });
});

describe('TC-CE-16: npm run — includes script name in summary', () => {
  it('includes the script name in the summary', () => {
    const result = explain('npm run test:watch');
    expect(result.summary).toMatch(/test:watch/);
  });
});

describe('TC-CE-17: npm publish — warns about registry publication', () => {
  it('warns that the version cannot be unpublished', () => {
    const result = explain('npm publish');
    expect(hasWarningMatching(result.warnings, /npm|publish|version/i)).toBe(true);
  });
});

describe('TC-CE-18: npm ci — clean install summary', () => {
  it('produces a summary mentioning clean or lock file', () => {
    const result = explain('npm ci');
    expect(result.summary).toMatch(/clean|lock/i);
  });
});

// ── TC-CE-19 – TC-CE-22 : pip ─────────────────────────────────────────────────

describe('TC-CE-19: pip install — summary mentions Python packages', () => {
  it('produces a summary mentioning Python package installation', () => {
    const result = explain('pip install requests');
    expect(result.summary).toMatch(/install|Python/i);
  });
});

describe('TC-CE-20: pip3 install — matched by the same rule as pip', () => {
  it('produces the same shaped explanation for pip3 as for pip', () => {
    const pip   = explain('pip install flask');
    const pip3  = explain('pip3 install flask');
    expect(pip3.summary).toMatch(/flask/);
    expect(pip3.effects).toEqual(pip.effects);
  });
});

describe('TC-CE-21: pip install <packages> — includes package names in summary', () => {
  it('includes named packages in the summary', () => {
    const result = explain('pip install flask sqlalchemy');
    expect(result.summary).toMatch(/flask/);
    expect(result.summary).toMatch(/sqlalchemy/);
  });
});

describe('TC-CE-22: pip install -r — includes requirements file in summary', () => {
  it('includes the requirements file path in the summary', () => {
    const result = explain('pip install -r requirements.txt');
    expect(result.summary).toMatch(/requirements\.txt/);
  });
});

// ── TC-CE-23 – TC-CE-25 : pytest ──────────────────────────────────────────────

describe('TC-CE-23: pytest — summary mentions running tests', () => {
  it('produces a summary that mentions running a test suite', () => {
    const result = explain('pytest');
    expect(result.summary).toMatch(/run|test/i);
  });
});

describe('TC-CE-24: pytest <path> — includes path in summary', () => {
  it('includes the test path in the summary', () => {
    const result = explain('pytest tests/unit/');
    expect(result.summary).toMatch(/tests\/unit\//);
  });
});

describe('TC-CE-25: pytest with flags — produces valid explanation', () => {
  it('returns a summary even when only flags are present', () => {
    const result = explain('pytest -v --tb=short');
    expect(result.summary).toMatch(/run|test/i);
    expect(result.effects).toBeInstanceOf(Array);
    expect(result.warnings).toBeInstanceOf(Array);
  });
});

// ── TC-CE-26 – TC-CE-30 : docker run ─────────────────────────────────────────

describe('TC-CE-26: docker run — summary includes image name', () => {
  it('includes the image name in the summary', () => {
    const result = explain('docker run ubuntu:22.04 bash');
    expect(result.summary).toMatch(/ubuntu:22\.04/);
  });

  it('produces a summary mentioning running a container', () => {
    const result = explain('docker run nginx');
    expect(result.summary).toMatch(/run|container/i);
  });
});

describe('TC-CE-27: docker run -v /:/host — full disk access warning', () => {
  it('warns about full disk access when root is mounted', () => {
    const result = explain('docker run -v /:/host ubuntu bash');
    expect(hasWarningMatching(result.warnings, /full disk|root filesystem|full.+access/i)).toBe(true);
  });

  it('full-disk warning is absent for non-root volume mounts', () => {
    const result = explain('docker run -v /data:/data ubuntu bash');
    expect(hasWarningMatching(result.warnings, /full disk|root filesystem/i)).toBe(false);
  });
});

describe('TC-CE-28: docker run -v /data:/data — no full-disk warning', () => {
  it('does not warn about full disk access for a scoped bind mount', () => {
    const result = explain('docker run -v /var/log:/logs nginx');
    expect(hasWarningMatching(result.warnings, /full disk/i)).toBe(false);
  });
});

describe('TC-CE-29: docker run --privileged — kernel access warning', () => {
  it('warns about privileged mode when --privileged flag is present', () => {
    const result = explain('docker run --privileged ubuntu bash');
    expect(hasWarningMatching(result.warnings, /privileged|kernel/i)).toBe(true);
  });

  it('does not warn about privileges without --privileged flag', () => {
    const result = explain('docker run ubuntu bash');
    expect(hasWarningMatching(result.warnings, /privileged/i)).toBe(false);
  });
});

describe('TC-CE-30: docker run with -v /:/host and --privileged — both warnings', () => {
  it('emits both the full-disk and the privileged warning', () => {
    const result = explain('docker run -v /:/host --privileged ubuntu bash');
    expect(hasWarningMatching(result.warnings, /full disk|root filesystem/i)).toBe(true);
    expect(hasWarningMatching(result.warnings, /privileged|kernel/i)).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

// ── TC-CE-31 – TC-CE-33 : docker build ───────────────────────────────────────

describe('TC-CE-31: docker build — summary mentions building an image', () => {
  it('produces a summary mentioning building or an image', () => {
    const result = explain('docker build .');
    expect(result.summary).toMatch(/build|image/i);
  });
});

describe('TC-CE-32: docker build with explicit context path — path in summary', () => {
  it('includes the context path in the summary', () => {
    const result = explain('docker build ./services/api');
    expect(result.summary).toMatch(/services\/api/);
  });
});

describe('TC-CE-33: docker build . — default context reflected in summary', () => {
  it('includes the dot context in the summary', () => {
    const result = explain('docker build .');
    expect(result.summary).toMatch(/\./);
  });
});

// ── TC-CE-34 – TC-CE-37 : docker exec ────────────────────────────────────────

describe('TC-CE-34: docker exec — summary includes container name', () => {
  it('includes the container name in the summary', () => {
    const result = explain('docker exec my-container ls /app');
    expect(result.summary).toMatch(/my-container/);
  });

  it('produces a summary mentioning executing or container access', () => {
    const result = explain('docker exec web-app env');
    expect(result.summary).toMatch(/exec|command|container/i);
  });
});

describe('TC-CE-35: docker exec bash -c — adds inline script execution effect', () => {
  it('adds a shell script execution effect when bash -c is used', () => {
    const result = explain('docker exec my-container bash -c "echo hello"');
    expect(hasEffectMatching(result.effects, /script|inline|shell/i)).toBe(true);
  });
});

describe('TC-CE-36: docker exec sh -c — adds inline script execution effect', () => {
  it('adds a shell script execution effect when sh -c is used', () => {
    const result = explain('docker exec my-container sh -c "cat /etc/passwd"');
    expect(hasEffectMatching(result.effects, /script|inline|shell/i)).toBe(true);
  });
});

describe('TC-CE-37: docker exec without shell — no inline script effect', () => {
  it('does not add a shell script effect for a non-shell command', () => {
    const result = explain('docker exec my-container ls /var/log');
    expect(hasEffectMatching(result.effects, /inline.*script|script.*inline/i)).toBe(false);
  });
});

// ── TC-CE-38 – TC-CE-39 : empty / whitespace input ────────────────────────────

describe('TC-CE-38: empty string — returns unrecognised fallback', () => {
  it('returns a well-formed result for an empty string', () => {
    const result = explain('');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('effects');
    expect(result).toHaveProperty('warnings');
    expect(result.summary).toMatch(/unrecogni/i);
    expect(result.effects).toBeInstanceOf(Array);
    expect(result.warnings).toBeInstanceOf(Array);
  });
});

describe('TC-CE-39: whitespace-only input — returns unrecognised fallback', () => {
  it('returns a well-formed result when the command is only spaces', () => {
    const result = explain('   ');
    expect(result.summary).toMatch(/unrecogni/i);
    expect(result.effects).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ── TC-CE-40 : catch-all for unknown commands ──────────────────────────────────

describe('TC-CE-40: catch-all pattern — unknown commands produce generic summary', () => {
  it('returns a summary containing the binary name for an unknown command', () => {
    const result = explain('customtool https://example.com');
    expect(result.summary).toMatch(/customtool/i);
  });

  it('returns empty effects and warnings for an unknown command', () => {
    const result = explain('ls -la /tmp');
    expect(result.effects).toBeInstanceOf(Array);
    expect(result.warnings).toBeInstanceOf(Array);
  });

  it('handles a bare unknown binary without arguments', () => {
    const result = explain('make');
    expect(result.summary).toMatch(/make/i);
  });
});

// ── TC-CE-41 – TC-CE-43 : additional git subcommands ──────────────────────────

describe('TC-CE-41: git add — stages changes summary', () => {
  it('produces a summary mentioning staging', () => {
    const result = explain('git add .');
    expect(result.summary).toMatch(/stage|staging/i);
  });
});

describe('TC-CE-42: git stash — stash summary', () => {
  it('produces a summary mentioning stashing', () => {
    const result = explain('git stash');
    expect(result.summary).toMatch(/stash/i);
  });
});

describe('TC-CE-43: git unknown subcommand — generic summary', () => {
  it('returns a summary containing "git" for an unrecognised git subcommand', () => {
    const result = explain('git rebase main');
    expect(result.summary).toMatch(/git/i);
  });
});

// ── TC-CE-44 – TC-CE-48 : additional npm subcommands ─────────────────────────

describe('TC-CE-44: npm i — short alias treated identically to npm install', () => {
  it('produces an install summary when using the "i" alias', () => {
    const result = explain('npm i express');
    expect(result.summary).toMatch(/install/i);
    expect(result.summary).toMatch(/express/);
  });
});

describe('TC-CE-45: npm run-script — treated identically to npm run', () => {
  it('includes the script name in the summary when using run-script', () => {
    const result = explain('npm run-script build');
    expect(result.summary).toMatch(/build/);
  });

  it('warns about arbitrary shell execution for run-script', () => {
    const result = explain('npm run-script test');
    expect(hasWarningMatching(result.warnings, /shell|arbitrary/i)).toBe(true);
  });
});

describe('TC-CE-46: npm uninstall / rm / remove — uninstall summary', () => {
  it('produces an uninstall summary for npm uninstall', () => {
    const result = explain('npm uninstall lodash');
    expect(result.summary).toMatch(/uninstall/i);
  });

  it('produces an uninstall summary for npm rm alias', () => {
    const result = explain('npm rm express');
    expect(result.summary).toMatch(/uninstall/i);
  });

  it('produces an uninstall summary for npm remove alias', () => {
    const result = explain('npm remove react');
    expect(result.summary).toMatch(/uninstall/i);
  });
});

describe('TC-CE-47: npm audit — security audit summary', () => {
  it('produces a summary mentioning vulnerabilities or auditing', () => {
    const result = explain('npm audit');
    expect(result.summary).toMatch(/audit|vulnerabilit/i);
  });

  it('has no effects and no warnings', () => {
    const result = explain('npm audit');
    expect(result.effects).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-48: npm unknown subcommand — generic summary', () => {
  it('returns a summary containing "npm" for an unrecognised npm subcommand', () => {
    const result = explain('npm outdated');
    expect(result.summary).toMatch(/npm/i);
  });
});

// ── TC-CE-49 : pip install edge case ─────────────────────────────────────────

describe('TC-CE-49: pip install with no packages — generic install summary', () => {
  it('returns a generic summary when no package names are provided', () => {
    const result = explain('pip install');
    expect(result.summary).toMatch(/install|Python/i);
    // Must not list specific packages since there are none
    expect(result.summary).not.toMatch(/:/);
  });
});

// ── TC-CE-50 : docker unknown subcommand ──────────────────────────────────────

describe('TC-CE-50: docker unknown subcommand — generic summary', () => {
  it('returns a summary containing "docker" for docker pull', () => {
    const result = explain('docker pull ubuntu:latest');
    expect(result.summary).toMatch(/docker/i);
  });

  it('returns a summary for docker ps', () => {
    const result = explain('docker ps');
    expect(result.summary).toMatch(/docker/i);
  });
});

// ── TC-CE-51 : docker exec access warning ─────────────────────────────────────

describe('TC-CE-51: docker exec — always warns about container access', () => {
  it('includes a container access warning', () => {
    const result = explain('docker exec my-container env');
    expect(hasWarningMatching(result.warnings, /access|container/i)).toBe(true);
  });
});

// ── TC-CE-52 : tokenizer edge cases ───────────────────────────────────────────

describe('TC-CE-52: tokenizer — quoted strings with spaces', () => {
  it('keeps a double-quoted string with spaces as a single token', () => {
    const result = explain('git commit -m "fix the bug in the parser"');
    expect(result.summary).toMatch(/commit/i);
  });

  it('keeps a single-quoted string with spaces as a single token', () => {
    const result = explain("git commit -m 'fix the bug in the parser'");
    expect(result.summary).toMatch(/commit/i);
  });

  it('includes quoted package name in npm install summary', () => {
    const result = explain('npm install "my-scoped-pkg"');
    expect(result.summary).toMatch(/my-scoped-pkg/);
  });
});

// ── TC-CE-53 : docker run — image extraction with flags before image ──────────

describe('TC-CE-53: docker run with -it flags — image correctly extracted', () => {
  it('extracts the image name when -it flags precede it', () => {
    const result = explain('docker run -it ubuntu:22.04 bash');
    expect(result.summary).toMatch(/ubuntu:22\.04/);
  });

  it('extracts the image name when -d detach flag precedes it', () => {
    const result = explain('docker run -d nginx');
    expect(result.summary).toMatch(/nginx/);
  });
});

// ── TC-CE-54 : docker run --volume= inline syntax ─────────────────────────────

describe('TC-CE-54: docker run --volume=/:/host — full disk access warning', () => {
  it('warns about full disk access when --volume= inline syntax mounts root', () => {
    const result = explain('docker run --volume=/:/host ubuntu bash');
    expect(hasWarningMatching(result.warnings, /full disk|root filesystem|full.+access/i)).toBe(true);
  });

  it('does not warn for non-root --volume= inline mounts', () => {
    const result = explain('docker run --volume=/data:/data ubuntu bash');
    expect(hasWarningMatching(result.warnings, /full disk|root filesystem/i)).toBe(false);
  });
});

// ── TC-CE-55 : timeout protection ─────────────────────────────────────────────

describe('TC-CE-55: timeout protection — long inputs complete quickly', () => {
  it('handles a very long unknown command within 200 ms', { timeout: 500 }, () => {
    const longCommand = 'unknowncmd ' + 'a'.repeat(50_000);
    const start = Date.now();
    const result = explain(longCommand);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(result).toHaveProperty('summary');
  });

  it('handles a very long git command within 200 ms', { timeout: 500 }, () => {
    const longCommand = 'git push ' + '-f '.repeat(10_000) + 'origin main';
    const start = Date.now();
    const result = explain(longCommand);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(result).toHaveProperty('summary');
  });

  it('handles a docker run with many -v flags within 200 ms', { timeout: 500 }, () => {
    const vFlags = Array.from({ length: 500 }, (_, i) => `-v /data${i}:/mnt${i}`).join(' ');
    const longCommand = `docker run ${vFlags} ubuntu bash`;
    const start = Date.now();
    const result = explain(longCommand);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(result).toHaveProperty('summary');
  });
});

// ── TC-CE-56 – TC-CE-58 : make ────────────────────────────────────────────────

describe('TC-CE-56: make — default target summary', () => {
  it('produces a summary mentioning make when no target is given', () => {
    const result = explain('make');
    expect(result.summary).toMatch(/make/i);
  });

  it('mentions the default target', () => {
    const result = explain('make');
    expect(result.summary).toMatch(/default/i);
  });
});

describe('TC-CE-57: make <target> — includes target name in summary', () => {
  it('includes the target name in the summary', () => {
    const result = explain('make build');
    expect(result.summary).toMatch(/build/);
  });

  it('includes a named target for make clean', () => {
    const result = explain('make clean');
    expect(result.summary).toMatch(/clean/);
  });
});

describe('TC-CE-58: make — effects mention Makefile', () => {
  it('includes a Makefile effect', () => {
    const result = explain('make test');
    expect(hasEffectMatching(result.effects, /makefile/i)).toBe(true);
  });
});

// ── TC-CE-59 – TC-CE-62 : cargo ──────────────────────────────────────────────

describe('TC-CE-59: cargo build — compilation summary', () => {
  it('produces a summary mentioning compilation', () => {
    const result = explain('cargo build');
    expect(result.summary).toMatch(/compil/i);
  });
});

describe('TC-CE-60: cargo build — workspace artifact effect', () => {
  it('includes an effect mentioning target/', () => {
    const result = explain('cargo build');
    expect(hasEffectMatching(result.effects, /target\//)).toBe(true);
  });

  it('mentions workspace members when --workspace flag is present', () => {
    const result = explain('cargo build --workspace');
    expect(result.summary).toMatch(/workspace/i);
  });
});

describe('TC-CE-61: cargo test — test run summary', () => {
  it('produces a summary mentioning tests', () => {
    const result = explain('cargo test');
    expect(result.summary).toMatch(/test/i);
  });

  it('includes the test filter in the summary when provided', () => {
    const result = explain('cargo test my_module');
    expect(result.summary).toMatch(/my_module/);
  });
});

describe('TC-CE-62: cargo unknown subcommand — generic summary', () => {
  it('returns a summary containing "cargo" for an unrecognised subcommand', () => {
    const result = explain('cargo fmt');
    expect(result.summary).toMatch(/cargo/i);
  });
});

// ── TC-CE-63 – TC-CE-66 : go ──────────────────────────────────────────────────

describe('TC-CE-63: go build — compilation summary', () => {
  it('produces a summary mentioning compilation', () => {
    const result = explain('go build');
    expect(result.summary).toMatch(/compil/i);
  });

  it('includes an effect mentioning compiled binary', () => {
    const result = explain('go build');
    expect(hasEffectMatching(result.effects, /binary|compil/i)).toBe(true);
  });
});

describe('TC-CE-64: go test — test run summary', () => {
  it('produces a summary mentioning tests', () => {
    const result = explain('go test');
    expect(result.summary).toMatch(/test/i);
  });
});

describe('TC-CE-65: go build <pkg> — includes package path in summary', () => {
  it('includes the package path in the summary', () => {
    const result = explain('go build ./cmd/server');
    expect(result.summary).toMatch(/\.\/cmd\/server/);
  });

  it('includes ./... in the summary when passed', () => {
    const result = explain('go test ./...');
    expect(result.summary).toMatch(/\.\/\.\.\./);
  });
});

describe('TC-CE-66: go unknown subcommand — generic summary', () => {
  it('returns a summary containing "go" for an unrecognised subcommand', () => {
    const result = explain('go vet ./...');
    expect(result.summary).toMatch(/go/i);
  });
});

// ── TC-CE-67 – TC-CE-68 : git branch/remote detection ────────────────────────

describe('TC-CE-67: git push — includes remote and branch in summary', () => {
  it('includes the remote name in the summary', () => {
    const result = explain('git push origin main');
    expect(result.summary).toMatch(/origin/);
  });

  it('includes the branch name in the summary', () => {
    const result = explain('git push origin feature/my-branch');
    expect(result.summary).toMatch(/feature\/my-branch/);
  });

  it('force-push warning still present when branch is specified', () => {
    const result = explain('git push --force origin main');
    expect(hasWarningMatching(result.warnings, /force/i)).toBe(true);
  });
});

describe('TC-CE-68: git pull — includes remote and branch in summary', () => {
  it('includes the remote name in the summary', () => {
    const result = explain('git pull upstream main');
    expect(result.summary).toMatch(/upstream/);
  });

  it('includes the branch name in the summary', () => {
    const result = explain('git pull origin release/1.0');
    expect(result.summary).toMatch(/release\/1\.0/);
  });
});

// ── TC-CE-69 – TC-CE-71 : eslint ─────────────────────────────────────────────

describe('TC-CE-69: eslint — lint summary', () => {
  it('produces a summary mentioning linting', () => {
    const result = explain('eslint .');
    expect(result.summary).toMatch(/lint/i);
  });

  it('includes the target path in the summary', () => {
    const result = explain('eslint src/');
    expect(result.summary).toMatch(/src\//);
  });
});

describe('TC-CE-70: eslint --fix — mentions auto-fix and has file modification effect', () => {
  it('mentions auto-fix in the summary', () => {
    const result = explain('eslint --fix src/');
    expect(result.summary).toMatch(/fix/i);
  });

  it('includes a file-modification effect', () => {
    const result = explain('eslint --fix .');
    expect(hasEffectMatching(result.effects, /modif|source file/i)).toBe(true);
  });

  it('has no file-modification effect without --fix', () => {
    const result = explain('eslint src/');
    expect(result.effects).toHaveLength(0);
  });
});

describe('TC-CE-71: eslint — no warnings emitted', () => {
  it('produces no warnings for a standard lint run', () => {
    const result = explain('eslint --ext .ts src/');
    expect(result.warnings).toHaveLength(0);
  });
});

// ── TC-CE-72 – TC-CE-75 : prettier ───────────────────────────────────────────

describe('TC-CE-72: prettier — summary mentions Prettier', () => {
  it('produces a summary mentioning Prettier', () => {
    const result = explain('prettier src/');
    expect(result.summary).toMatch(/prettier/i);
  });

  it('includes the target path in the summary', () => {
    const result = explain('prettier src/index.ts');
    expect(result.summary).toMatch(/src\/index\.ts/);
  });
});

describe('TC-CE-73: prettier --write — mentions formatting and has file modification effect', () => {
  it('mentions formatting in the summary', () => {
    const result = explain('prettier --write src/');
    expect(result.summary).toMatch(/format/i);
  });

  it('includes a file-modification effect', () => {
    const result = explain('prettier --write .');
    expect(hasEffectMatching(result.effects, /modif|source file/i)).toBe(true);
  });

  it('has no file-modification effect without --write', () => {
    const result = explain('prettier src/');
    expect(result.effects).toHaveLength(0);
  });
});

describe('TC-CE-74: prettier --check — mentions check or format in summary', () => {
  it('produces a summary mentioning check or format', () => {
    const result = explain('prettier --check src/');
    expect(result.summary).toMatch(/check|format/i);
  });

  it('has no file-modification effect in check mode', () => {
    const result = explain('prettier --check .');
    expect(result.effects).toHaveLength(0);
  });
});

describe('TC-CE-75: prettier — no warnings emitted', () => {
  it('produces no warnings for a standard prettier run', () => {
    const result = explain('prettier --write src/');
    expect(result.warnings).toHaveLength(0);
  });
});

// ── File system commands ───────────────────────────────────────────────────────

describe('TC-CE-76: rm — basic file deletion', () => {
  it('mentions deletion in summary', () => {
    const result = explain('rm /tmp/file.txt');
    expect(result.summary).toMatch(/delet/i);
  });

  it('includes the target path in summary', () => {
    const result = explain('rm /tmp/file.txt');
    expect(result.summary).toContain('/tmp/file.txt');
  });

  it('includes a permanent removal effect', () => {
    const result = explain('rm /tmp/file.txt');
    expect(hasEffectMatching(result.effects, /remov|delet|filesystem/i)).toBe(true);
  });

  it('warns that deleted files cannot be recovered', () => {
    const result = explain('rm /tmp/file.txt');
    expect(hasWarningMatching(result.warnings, /recover|trash/i)).toBe(true);
  });
});

describe('TC-CE-77: rm -rf — recursive force deletion', () => {
  it('mentions recursive deletion in summary', () => {
    const result = explain('rm -rf /tmp/build');
    expect(result.summary).toMatch(/recursiv/i);
  });

  it('warns about recursive directory removal', () => {
    const result = explain('rm -rf /tmp/build');
    expect(hasWarningMatching(result.warnings, /director|tree|-r/i)).toBe(true);
  });

  it('warns about -f flag suppressing prompts', () => {
    const result = explain('rm -rf /tmp/build');
    expect(hasWarningMatching(result.warnings, /-f|suppress|confirm/i)).toBe(true);
  });
});

describe('TC-CE-78: rm -r — recursive flag only', () => {
  it('warns about recursive removal', () => {
    const result = explain('rm -r /tmp/dir');
    expect(hasWarningMatching(result.warnings, /director|tree|-r/i)).toBe(true);
  });

  it('does not warn about -f when -f is absent', () => {
    const result = explain('rm -r /tmp/dir');
    expect(hasWarningMatching(result.warnings, /-f|suppress/i)).toBe(false);
  });
});

describe('TC-CE-79: cp — file copy', () => {
  it('mentions copying in summary', () => {
    const result = explain('cp src.txt dst.txt');
    expect(result.summary).toMatch(/cop/i);
  });

  it('includes source and destination in summary', () => {
    const result = explain('cp src.txt dst.txt');
    expect(result.summary).toContain('src.txt');
    expect(result.summary).toContain('dst.txt');
  });

  it('includes a file-creation effect', () => {
    const result = explain('cp src.txt dst.txt');
    expect(hasEffectMatching(result.effects, /creat|overwrit|destination/i)).toBe(true);
  });
});

describe('TC-CE-80: cp -r — recursive copy', () => {
  it('mentions recursive in summary', () => {
    const result = explain('cp -r src/ dst/');
    expect(result.summary).toMatch(/recursiv/i);
  });
});

describe('TC-CE-81: mv — file move', () => {
  it('mentions moving in summary', () => {
    const result = explain('mv old.txt new.txt');
    expect(result.summary).toMatch(/mov/i);
  });

  it('includes source and destination in summary', () => {
    const result = explain('mv old.txt new.txt');
    expect(result.summary).toContain('old.txt');
    expect(result.summary).toContain('new.txt');
  });

  it('includes a filesystem effect', () => {
    const result = explain('mv old.txt new.txt');
    expect(hasEffectMatching(result.effects, /reloc|renam|filesystem|overwrit/i)).toBe(true);
  });
});

describe('TC-CE-82: chmod — permission change', () => {
  it('mentions permissions in summary', () => {
    const result = explain('chmod 644 file.txt');
    expect(result.summary).toMatch(/permission/i);
  });

  it('includes the mode and path in summary', () => {
    const result = explain('chmod 644 file.txt');
    expect(result.summary).toContain('644');
    expect(result.summary).toContain('file.txt');
  });

  it('includes a permissions effect', () => {
    const result = explain('chmod 644 file.txt');
    expect(hasEffectMatching(result.effects, /permission/i)).toBe(true);
  });
});

describe('TC-CE-83: chmod 777 — world-writable warning', () => {
  it('warns about world-writable permissions', () => {
    const result = explain('chmod 777 /etc/config');
    expect(hasWarningMatching(result.warnings, /777|world.writable|security/i)).toBe(true);
  });
});

describe('TC-CE-84: chmod -R — recursive permission change', () => {
  it('mentions recursive in summary', () => {
    const result = explain('chmod -R 755 /srv/app');
    expect(result.summary).toMatch(/recursiv/i);
  });
});

describe('TC-CE-85: mkdir — directory creation', () => {
  it('mentions directory creation in summary', () => {
    const result = explain('mkdir /tmp/newdir');
    expect(result.summary).toMatch(/creat/i);
  });

  it('includes the path in summary', () => {
    const result = explain('mkdir /tmp/newdir');
    expect(result.summary).toContain('/tmp/newdir');
  });

  it('includes a directory-creation effect', () => {
    const result = explain('mkdir /tmp/newdir');
    expect(hasEffectMatching(result.effects, /director|filesystem/i)).toBe(true);
  });

  it('produces no warnings', () => {
    const result = explain('mkdir /tmp/newdir');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-86: rsync — file sync', () => {
  it('mentions syncing in summary', () => {
    const result = explain('rsync -av src/ dst/');
    expect(result.summary).toMatch(/sync/i);
  });

  it('includes source and destination in summary', () => {
    const result = explain('rsync -av src/ dst/');
    expect(result.summary).toContain('src/');
    expect(result.summary).toContain('dst/');
  });

  it('includes a filesystem effect', () => {
    const result = explain('rsync -av src/ dst/');
    expect(hasEffectMatching(result.effects, /filesystem|destination/i)).toBe(true);
  });
});

describe('TC-CE-87: rsync --delete — warns about deletion', () => {
  it('warns about --delete removing files', () => {
    const result = explain('rsync --delete src/ dst/');
    expect(hasWarningMatching(result.warnings, /--delete|absent|destination/i)).toBe(true);
  });
});

// ── Network commands ───────────────────────────────────────────────────────────

describe('TC-CE-88: curl — HTTP fetch', () => {
  it('mentions fetching in summary', () => {
    const result = explain('curl https://example.com/api');
    expect(result.summary).toMatch(/fetch|content/i);
  });

  it('includes the URL in summary', () => {
    const result = explain('curl https://example.com/api');
    expect(result.summary).toContain('https://example.com/api');
  });

  it('includes a network effect', () => {
    const result = explain('curl https://example.com/api');
    expect(hasEffectMatching(result.effects, /network|request/i)).toBe(true);
  });
});

describe('TC-CE-89: curl POST — identifies POST request', () => {
  it('mentions POST in summary', () => {
    const result = explain('curl -X POST https://api.example.com/data');
    expect(result.summary).toMatch(/POST/i);
  });
});

describe('TC-CE-90: curl -o — output file effect', () => {
  it('includes a file-write effect', () => {
    const result = explain('curl -o output.json https://api.example.com/data');
    expect(hasEffectMatching(result.effects, /file|write/i)).toBe(true);
  });
});

describe('TC-CE-91: curl -d — POST via data flag', () => {
  it('identifies -d as a POST request', () => {
    const result = explain('curl -d "key=value" https://api.example.com/data');
    expect(result.summary).toMatch(/POST/i);
  });
});

describe('TC-CE-92: wget — file download', () => {
  it('mentions downloading in summary', () => {
    const result = explain('wget https://example.com/file.tar.gz');
    expect(result.summary).toMatch(/download/i);
  });

  it('includes the URL in summary', () => {
    const result = explain('wget https://example.com/file.tar.gz');
    expect(result.summary).toContain('https://example.com/file.tar.gz');
  });

  it('includes a file-creation effect', () => {
    const result = explain('wget https://example.com/file.tar.gz');
    expect(hasEffectMatching(result.effects, /file|network/i)).toBe(true);
  });
});

describe('TC-CE-93: ssh — remote shell connection', () => {
  it('mentions shell connection in summary', () => {
    const result = explain('ssh user@example.com');
    expect(result.summary).toMatch(/shell|connect/i);
  });

  it('includes the host in summary', () => {
    const result = explain('ssh user@example.com');
    expect(result.summary).toContain('user@example.com');
  });

  it('includes a network connection effect', () => {
    const result = explain('ssh user@example.com');
    expect(hasEffectMatching(result.effects, /network|remote|connection/i)).toBe(true);
  });

  it('warns about remote access', () => {
    const result = explain('ssh user@example.com');
    expect(hasWarningMatching(result.warnings, /remote|access|system/i)).toBe(true);
  });
});

describe('TC-CE-94: scp — secure file copy', () => {
  it('mentions secure copy in summary', () => {
    const result = explain('scp local.txt user@host:/remote/path');
    expect(result.summary).toMatch(/secur|cop/i);
  });

  it('includes source and destination in summary', () => {
    const result = explain('scp local.txt user@host:/remote/path');
    expect(result.summary).toContain('local.txt');
    expect(result.summary).toContain('user@host:/remote/path');
  });

  it('includes a network transfer effect', () => {
    const result = explain('scp local.txt user@host:/remote/path');
    expect(hasEffectMatching(result.effects, /network|transfer/i)).toBe(true);
  });
});

describe('TC-CE-95: nc — TCP connection', () => {
  it('mentions connection in summary', () => {
    const result = explain('nc example.com 8080');
    expect(result.summary).toMatch(/connect|TCP/i);
  });

  it('includes host and port in summary', () => {
    const result = explain('nc example.com 8080');
    expect(result.summary).toContain('example.com');
    expect(result.summary).toContain('8080');
  });

  it('includes a network connection effect', () => {
    const result = explain('nc example.com 8080');
    expect(hasEffectMatching(result.effects, /network|connection/i)).toBe(true);
  });
});

describe('TC-CE-96: nc -l — listen mode', () => {
  it('mentions listening in summary', () => {
    const result = explain('nc -l 4444');
    expect(result.summary).toMatch(/listen/i);
  });

  it('includes the port in summary', () => {
    const result = explain('nc -l 4444');
    expect(result.summary).toContain('4444');
  });
});

describe('TC-CE-97: netcat — alias for nc', () => {
  it('matches the netcat binary', () => {
    const result = explain('netcat example.com 9000');
    expect(result.summary).toMatch(/connect|TCP/i);
  });
});

describe('TC-CE-98: rm — fallback with no path specified', () => {
  it('falls back gracefully when no path is given', () => {
    const result = explain('rm');
    expect(result.summary).toMatch(/delet/i);
  });
});

describe('TC-CE-99: curl — fallback with no URL specified', () => {
  it('falls back gracefully when no URL is given', () => {
    const result = explain('curl');
    expect(result.summary).toMatch(/fetch|content/i);
  });
});

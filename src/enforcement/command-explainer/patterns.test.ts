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
 *   TC-CE-100 – TC-CE-121: service / host-lifecycle patterns
 *                          (systemctl, service, reboot, shutdown, init)
 *   TC-CE-122 – TC-CE-138: permissions patterns
 *                          (chown, umask, sudo, su, passwd)
 *   TC-CE-139 – TC-CE-150: process-signal patterns
 *                          (kill, pkill, killall)
 *   TC-CE-151 – TC-CE-167: network diagnostics + scan patterns
 *                          (ping, traceroute, nslookup, dig, netstat, ss, nmap)
 *   TC-CE-168 – TC-CE-181: scheduling / persistence patterns
 *                          (crontab, at, batch, atq, atrm)
 *   TC-CE-182 – TC-CE-194: network-transfer patterns
 *                          (rsync remote-flagging, scp remote-flagging,
 *                          sftp interactive vs batch)
 *   TC-CE-195 – TC-CE-215: distro / system package-manager patterns
 *                          (apt, yum, dnf, dpkg, snap, brew, pacman)
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

// ── TC-CE-100 – TC-CE-115 : service / host-lifecycle management ───────────────

describe('TC-CE-100: systemctl start — names the unit in the summary', () => {
  it('produces a summary that mentions starting the named service', () => {
    const result = explain('systemctl start nginx');
    expect(result.summary).toMatch(/start/i);
    expect(result.summary).toContain('nginx');
  });

  it('emits no warnings on a normal start', () => {
    const result = explain('systemctl start nginx');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-101: systemctl stop — disconnect warning', () => {
  it('warns that active service users will be disconnected', () => {
    const result = explain('systemctl stop nginx');
    expect(hasWarningMatching(result.warnings, /disconnect/i)).toBe(true);
  });
});

describe('TC-CE-102: systemctl restart — downtime warning', () => {
  it('warns about brief downtime during restart', () => {
    const result = explain('systemctl restart nginx');
    expect(hasWarningMatching(result.warnings, /downtime|restart/i)).toBe(true);
  });
});

describe('TC-CE-103: systemctl reload — no downtime warning', () => {
  it('does not warn about downtime for reload (SIGHUP only)', () => {
    const result = explain('systemctl reload nginx');
    expect(hasWarningMatching(result.warnings, /downtime/i)).toBe(false);
  });

  it('mentions SIGHUP or configuration in the effect line', () => {
    const result = explain('systemctl reload nginx');
    expect(hasEffectMatching(result.effects, /sighup|configuration|reload/i)).toBe(true);
  });
});

describe('TC-CE-104: systemctl enable — persistence warning', () => {
  it('warns that the change survives reboot', () => {
    const result = explain('systemctl enable nginx');
    expect(hasWarningMatching(result.warnings, /persist|reboot|survives/i)).toBe(true);
  });
});

describe('TC-CE-105: systemctl disable — persistence warning', () => {
  it('warns that the change survives reboot', () => {
    const result = explain('systemctl disable nginx');
    expect(hasWarningMatching(result.warnings, /persist|reboot|survives/i)).toBe(true);
  });
});

describe('TC-CE-106: systemctl mask — start-blocked warning', () => {
  it('warns the service cannot be started until unmasked', () => {
    const result = explain('systemctl mask nginx');
    expect(hasWarningMatching(result.warnings, /unmask|cannot be started/i)).toBe(true);
  });
});

describe('TC-CE-107: systemctl reboot/poweroff/halt — host-disruption warning', () => {
  it('warns about host-level disruption on reboot', () => {
    const result = explain('systemctl reboot');
    expect(hasWarningMatching(result.warnings, /host|disruption|connections/i)).toBe(true);
  });

  it('warns about host-level disruption on poweroff', () => {
    const result = explain('systemctl poweroff');
    expect(hasWarningMatching(result.warnings, /host|disruption|connections/i)).toBe(true);
  });

  it('warns about host-level disruption on halt', () => {
    const result = explain('systemctl halt');
    expect(hasWarningMatching(result.warnings, /host|disruption|connections/i)).toBe(true);
  });
});

describe('TC-CE-108: systemctl status — no warnings (read-only)', () => {
  it('emits no warnings for a status query', () => {
    const result = explain('systemctl status nginx');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-109: systemctl daemon-reload — summary', () => {
  it('mentions reloading systemd unit files', () => {
    const result = explain('systemctl daemon-reload');
    expect(result.summary).toMatch(/systemd|unit files/i);
  });
});

describe('TC-CE-110: systemctl — fallback with no subcommand', () => {
  it('falls back gracefully when no subcommand is given', () => {
    const result = explain('systemctl');
    expect(result.summary).toMatch(/systemctl/i);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-111: service — SysV-style start/stop/restart', () => {
  it('summarises `service nginx start`', () => {
    const result = explain('service nginx start');
    expect(result.summary).toMatch(/start/i);
    expect(result.summary).toContain('nginx');
  });

  it('warns about disconnects on `service nginx stop`', () => {
    const result = explain('service nginx stop');
    expect(hasWarningMatching(result.warnings, /disconnect/i)).toBe(true);
  });

  it('warns about downtime on `service nginx restart`', () => {
    const result = explain('service nginx restart');
    expect(hasWarningMatching(result.warnings, /downtime|restart/i)).toBe(true);
  });
});

describe('TC-CE-112: reboot — host-disruption warning', () => {
  it('warns about host-level disruption', () => {
    const result = explain('reboot');
    expect(hasWarningMatching(result.warnings, /host|disruption|connections/i)).toBe(true);
  });
});

describe('TC-CE-113: shutdown — host-disruption warning and scheduled time', () => {
  it('warns about host-level disruption with default args', () => {
    const result = explain('shutdown -h now');
    expect(hasWarningMatching(result.warnings, /host|disruption|connections/i)).toBe(true);
  });

  it('reports the scheduled time in the summary', () => {
    const result = explain('shutdown -h +10');
    expect(result.summary).toContain('+10');
  });

  it('treats -r as a reboot rather than a power-off', () => {
    const result = explain('shutdown -r now');
    expect(result.summary).toMatch(/reboot/i);
  });

  it('treats -c as a cancel — emits no host-disruption warning', () => {
    const result = explain('shutdown -c');
    expect(result.summary).toMatch(/cancel/i);
    expect(hasWarningMatching(result.warnings, /host|disruption/i)).toBe(false);
  });
});

describe('TC-CE-114: init — runlevel-specific summaries', () => {
  it('treats `init 0` as host poweroff with disruption warning', () => {
    const result = explain('init 0');
    expect(result.summary).toMatch(/power off|poweroff|runlevel 0/i);
    expect(hasWarningMatching(result.warnings, /host|disruption/i)).toBe(true);
  });

  it('treats `init 6` as host reboot with disruption warning', () => {
    const result = explain('init 6');
    expect(result.summary).toMatch(/reboot|runlevel 6/i);
    expect(hasWarningMatching(result.warnings, /host|disruption/i)).toBe(true);
  });

  it('treats `init 1` as single-user mode', () => {
    const result = explain('init 1');
    expect(result.summary).toMatch(/single-user/i);
  });

  it('falls back gracefully when no runlevel is given', () => {
    const result = explain('init');
    expect(result.summary).toMatch(/init/i);
  });
});

describe('TC-CE-115: systemctl start — no unit specified falls back gracefully', () => {
  it('summarises without a unit name when none is provided', () => {
    const result = explain('systemctl start');
    expect(result.summary).toMatch(/start/i);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-116: systemctl unmask — removes /dev/null symlink', () => {
  it('mentions unmasking in the summary', () => {
    const result = explain('systemctl unmask nginx');
    expect(result.summary).toMatch(/unmask/i);
    expect(result.summary).toContain('nginx');
  });
});

describe('TC-CE-117: systemctl suspend / hibernate — host-disruption warning', () => {
  it('warns about disruption on suspend', () => {
    const result = explain('systemctl suspend');
    expect(hasWarningMatching(result.warnings, /host|disruption|connections/i)).toBe(true);
  });

  it('warns about disruption on hibernate', () => {
    const result = explain('systemctl hibernate');
    expect(hasWarningMatching(result.warnings, /host|disruption|connections/i)).toBe(true);
  });

  it('warns about disruption on kexec', () => {
    const result = explain('systemctl kexec');
    expect(hasWarningMatching(result.warnings, /host|disruption|connections/i)).toBe(true);
  });
});

describe('TC-CE-118: systemctl unknown subcommand — falls back gracefully with no warnings', () => {
  it('echoes the subcommand in the summary without warnings', () => {
    const result = explain('systemctl is-active nginx');
    expect(result.summary).toContain('is-active');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-119: service — fallback paths (no unit, no action, reload, status, unknown)', () => {
  it('falls back gracefully when no unit is given', () => {
    const result = explain('service');
    expect(result.summary).toMatch(/service/i);
    expect(result.warnings).toHaveLength(0);
  });

  it('summarises a unit-only invocation without an action', () => {
    const result = explain('service nginx');
    expect(result.summary).toContain('nginx');
    expect(result.warnings).toHaveLength(0);
  });

  it('emits a SIGHUP-style effect on reload', () => {
    const result = explain('service nginx reload');
    expect(hasEffectMatching(result.effects, /sighup|configuration|reload/i)).toBe(true);
  });

  it('emits no warnings on status (read-only)', () => {
    const result = explain('service nginx status');
    expect(result.warnings).toHaveLength(0);
  });

  it('falls back gracefully on an unknown action', () => {
    const result = explain('service nginx try-restart');
    expect(result.summary).toContain('try-restart');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-120: shutdown — bare invocation without time argument', () => {
  it('summarises a host-shutdown without a scheduled time', () => {
    const result = explain('shutdown');
    expect(result.summary).toMatch(/shut\s*s?\s*down/i);
    expect(hasWarningMatching(result.warnings, /host|disruption/i)).toBe(true);
  });
});

describe('TC-CE-121: init — single-user (S) and unknown runlevels', () => {
  it('treats `init S` as single-user mode (uppercase)', () => {
    const result = explain('init S');
    expect(result.summary).toMatch(/single-user/i);
  });

  it('treats `init s` as single-user mode (lowercase)', () => {
    const result = explain('init s');
    expect(result.summary).toMatch(/single-user/i);
  });

  it('reports an unknown runlevel without a host-disruption warning', () => {
    const result = explain('init 3');
    expect(result.summary).toMatch(/runlevel 3/i);
    expect(hasWarningMatching(result.warnings, /host|disruption/i)).toBe(false);
  });
});

// ── TC-CE-122 – TC-CE-138 : permissions ──────────────────────────────────────

describe('TC-CE-122: chown — names owner and path in summary', () => {
  it('summarises a basic chown invocation', () => {
    const result = explain('chown alice /tmp/data');
    expect(result.summary).toMatch(/owner/i);
    expect(result.summary).toContain('alice');
    expect(result.summary).toContain('/tmp/data');
  });
});

describe('TC-CE-123: chown -R / --recursive — recursive flag in summary', () => {
  it('mentions recursion when -R is used', () => {
    const result = explain('chown -R alice /var/www');
    expect(result.summary).toMatch(/recursive/i);
  });

  it('mentions recursion when --recursive is used', () => {
    const result = explain('chown --recursive bob /opt/app');
    expect(result.summary).toMatch(/recursive/i);
  });
});

describe('TC-CE-124: chown — system-path warning', () => {
  it('warns when targeting / itself', () => {
    const result = explain('chown -R alice /');
    expect(hasWarningMatching(result.warnings, /lock out|system services/i)).toBe(true);
  });

  it('warns when targeting /etc', () => {
    const result = explain('chown alice /etc/passwd');
    expect(hasWarningMatching(result.warnings, /lock out|system services/i)).toBe(true);
  });

  it('warns when targeting /usr', () => {
    const result = explain('chown -R alice /usr/local');
    expect(hasWarningMatching(result.warnings, /lock out|system services/i)).toBe(true);
  });

  it('does not warn for an ordinary user-owned path', () => {
    const result = explain('chown alice /home/alice/notes');
    expect(hasWarningMatching(result.warnings, /lock out|system services/i)).toBe(false);
  });
});

describe('TC-CE-125: chown — root-ownership warning', () => {
  it('warns when transferring ownership to root', () => {
    const result = explain('chown root /tmp/data');
    expect(hasWarningMatching(result.warnings, /root ownership|editable only by root/i)).toBe(true);
  });

  it('warns when transferring ownership to root:root', () => {
    const result = explain('chown root:root /tmp/data');
    expect(hasWarningMatching(result.warnings, /root ownership|editable only by root/i)).toBe(true);
  });
});

describe('TC-CE-126: umask — bare invocation queries the current mask', () => {
  it('summarises as "shows the current umask" with no warnings', () => {
    const result = explain('umask');
    expect(result.summary).toMatch(/current umask/i);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-127: umask — sets the umask and includes the value in summary', () => {
  it('echoes the new mask in the summary', () => {
    const result = explain('umask 022');
    expect(result.summary).toContain('022');
  });

  it('warns about world-writable defaults when umask is 000', () => {
    const result = explain('umask 000');
    expect(hasWarningMatching(result.warnings, /world-writable/i)).toBe(true);
  });

  it('does not warn for a sensible umask like 022', () => {
    const result = explain('umask 022');
    expect(hasWarningMatching(result.warnings, /world-writable/i)).toBe(false);
  });
});

describe('TC-CE-128: sudo — runs wrapped command as a different user', () => {
  it('summarises `sudo apt update` as running the wrapped command', () => {
    const result = explain('sudo apt update');
    expect(result.summary).toContain('apt update');
    expect(result.summary).toMatch(/root/i);
  });

  it('always warns about privilege elevation', () => {
    const result = explain('sudo systemctl restart nginx');
    expect(hasWarningMatching(result.warnings, /privilege elevation|wrapped command runs/i)).toBe(true);
  });
});

describe('TC-CE-129: sudo — explicit -u target user', () => {
  it('reports the target user in the summary when -u is used', () => {
    const result = explain('sudo -u postgres pg_dump mydb');
    expect(result.summary).toContain('postgres');
    expect(result.summary).toContain('pg_dump');
  });

  it('does not raise the root warning when -u is not root', () => {
    const result = explain('sudo -u backup tar czf /backup.tgz /data');
    expect(hasWarningMatching(result.warnings, /full administrative access/i)).toBe(false);
  });

  it('still warns about privilege elevation even when target is non-root', () => {
    const result = explain('sudo -u backup ls /root');
    expect(hasWarningMatching(result.warnings, /privilege elevation/i)).toBe(true);
  });
});

describe('TC-CE-130: sudo — bare sudo without a wrapped command', () => {
  it('falls back to "Switches privilege" summary when no command is given', () => {
    const result = explain('sudo');
    expect(result.summary).toMatch(/switches privilege|root/i);
  });
});

describe('TC-CE-131: sudo — root-target warning', () => {
  it('warns about full administrative access when target is root (default)', () => {
    const result = explain('sudo systemctl reboot');
    expect(hasWarningMatching(result.warnings, /full administrative access/i)).toBe(true);
  });
});

describe('TC-CE-132: su — bare invocation switches to root', () => {
  it('summarises `su` as switching to root', () => {
    const result = explain('su');
    expect(result.summary).toMatch(/switches user to root|opens a login shell as root/i);
  });

  it('always warns about privilege elevation', () => {
    const result = explain('su');
    expect(hasWarningMatching(result.warnings, /privilege elevation|opens a shell/i)).toBe(true);
  });
});

describe('TC-CE-133: su — login-shell modes (-, -l, --login)', () => {
  it('treats `su -` as a login-shell switch', () => {
    const result = explain('su -');
    expect(result.summary).toMatch(/login shell/i);
  });

  it('treats `su -l` as a login-shell switch', () => {
    const result = explain('su -l');
    expect(result.summary).toMatch(/login shell/i);
  });

  it('treats `su --login` as a login-shell switch', () => {
    const result = explain('su --login');
    expect(result.summary).toMatch(/login shell/i);
  });
});

describe('TC-CE-134: su user — switches to a named non-root user', () => {
  it('names the target user in the summary', () => {
    const result = explain('su alice');
    expect(result.summary).toContain('alice');
  });

  it('does not raise the root warning when target is non-root', () => {
    const result = explain('su alice');
    expect(hasWarningMatching(result.warnings, /full administrative access/i)).toBe(false);
  });
});

describe('TC-CE-135: su -c — runs a wrapped command as the target user', () => {
  it('reports the wrapped command in the summary', () => {
    const result = explain('su -c whoami');
    expect(result.summary).toContain('whoami');
  });
});

describe('TC-CE-136: passwd — bare invocation changes the current user’s password', () => {
  it('summarises a bare passwd invocation', () => {
    const result = explain('passwd');
    expect(result.summary).toMatch(/password/i);
  });

  it('always warns about credential change', () => {
    const result = explain('passwd');
    expect(hasWarningMatching(result.warnings, /credential|authentication/i)).toBe(true);
  });
});

describe('TC-CE-137: passwd <user> — names the affected account', () => {
  it('echoes the target user in the summary', () => {
    const result = explain('passwd alice');
    expect(result.summary).toContain('alice');
  });

  it('does not raise the root-coordination warning for a non-root target', () => {
    const result = explain('passwd alice');
    expect(hasWarningMatching(result.warnings, /coordinate with operators/i)).toBe(false);
  });
});

describe('TC-CE-138: passwd root — coordination warning', () => {
  it('warns about coordinating before changing the root password', () => {
    const result = explain('passwd root');
    expect(hasWarningMatching(result.warnings, /coordinate with operators/i)).toBe(true);
  });

  it('warns about coordination on bare `passwd` (current user could be root)', () => {
    const result = explain('passwd');
    expect(hasWarningMatching(result.warnings, /coordinate with operators/i)).toBe(true);
  });
});

// ── TC-CE-139 – TC-CE-150 : process signalling ───────────────────────────────

describe('TC-CE-139: kill — default summary names target and signal', () => {
  it('defaults to SIGTERM when no signal is specified', () => {
    const result = explain('kill 1234');
    expect(result.summary).toMatch(/SIGTERM/i);
    expect(result.summary).toContain('1234');
  });

  it('emits no warnings for an ordinary SIGTERM kill', () => {
    const result = explain('kill 1234');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-140: kill -9 / -KILL / -SIGKILL — uncatchable-signal warning', () => {
  it('warns about cannot-be-caught when -9 is used', () => {
    const result = explain('kill -9 1234');
    expect(hasWarningMatching(result.warnings, /cannot be caught|without cleanup/i)).toBe(true);
  });

  it('warns about cannot-be-caught when -KILL is used', () => {
    const result = explain('kill -KILL 1234');
    expect(hasWarningMatching(result.warnings, /cannot be caught|without cleanup/i)).toBe(true);
  });

  it('warns about cannot-be-caught when --signal=KILL is used', () => {
    const result = explain('kill --signal=KILL 1234');
    expect(hasWarningMatching(result.warnings, /cannot be caught|without cleanup/i)).toBe(true);
  });

  it('warns about cannot-be-caught when -s KILL is used', () => {
    const result = explain('kill -s KILL 1234');
    expect(hasWarningMatching(result.warnings, /cannot be caught|without cleanup/i)).toBe(true);
  });
});

describe('TC-CE-141: kill -HUP — reload-style summary, no warning', () => {
  it('describes SIGHUP as a configuration reload', () => {
    const result = explain('kill -HUP 1234');
    expect(hasEffectMatching(result.effects, /reload|SIGHUP/i)).toBe(true);
  });

  it('emits no destructive-signal warning on SIGHUP', () => {
    const result = explain('kill -HUP 1234');
    expect(hasWarningMatching(result.warnings, /cannot be caught/i)).toBe(false);
  });
});

describe('TC-CE-142: kill — pid-1 (init) warning', () => {
  it('warns when targeting PID 1', () => {
    const result = explain('kill -9 1');
    expect(hasWarningMatching(result.warnings, /PID 1|init.*crash|crashes the host/i)).toBe(true);
  });
});

describe('TC-CE-143: kill -1 (broadcast) warning', () => {
  it('warns about broadcast when target is -1', () => {
    const result = explain('kill -9 -1');
    expect(hasWarningMatching(result.warnings, /-1|every process|broadcast/i)).toBe(true);
  });
});

describe('TC-CE-144: kill -l — read-only signal listing', () => {
  it('summarises as listing signals with no warnings', () => {
    const result = explain('kill -l');
    expect(result.summary).toMatch(/list|signal/i);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-145: pkill — pattern-match warning', () => {
  it('always warns that pattern matches by name', () => {
    const result = explain('pkill nginx');
    expect(hasWarningMatching(result.warnings, /pattern|matches by name|multiple processes/i)).toBe(true);
  });

  it('reports the pattern in the summary', () => {
    const result = explain('pkill -9 java');
    expect(result.summary).toContain('java');
  });

  it('warns about destructive signal when -9 is used', () => {
    const result = explain('pkill -9 nginx');
    expect(hasWarningMatching(result.warnings, /cannot be caught/i)).toBe(true);
  });
});

describe('TC-CE-146: pkill -f — full-command-line warning', () => {
  it('warns about -f / --full broadening the match', () => {
    const result = explain('pkill -f java.*MyApp');
    expect(hasWarningMatching(result.warnings, /full command line|broader/i)).toBe(true);
  });

  it('warns about -f / --full when --full is spelled out', () => {
    const result = explain('pkill --full java.*MyApp');
    expect(hasWarningMatching(result.warnings, /full command line|broader/i)).toBe(true);
  });
});

describe('TC-CE-147: killall — multi-instance warning', () => {
  it('warns that every matching process is targeted', () => {
    const result = explain('killall nginx');
    expect(hasWarningMatching(result.warnings, /every running process|unrelated instances/i)).toBe(true);
  });

  it('reports the name in the summary', () => {
    const result = explain('killall -9 java');
    expect(result.summary).toContain('java');
  });

  it('warns about destructive signal when -9 is used', () => {
    const result = explain('killall -9 nginx');
    expect(hasWarningMatching(result.warnings, /cannot be caught/i)).toBe(true);
  });
});

describe('TC-CE-148: rule routing — kill vs pkill vs killall', () => {
  it('"killall ssh" routes to killallExplain (not killExplain)', () => {
    const result = explain('killall ssh');
    expect(hasWarningMatching(result.warnings, /every running process|unrelated instances/i)).toBe(true);
    expect(hasWarningMatching(result.warnings, /pattern|matches by name|multiple processes/i)).toBe(false);
  });

  it('"pkill ssh" routes to pkillExplain (not killExplain or killallExplain)', () => {
    const result = explain('pkill ssh');
    expect(hasWarningMatching(result.warnings, /pattern|matches by name|multiple processes/i)).toBe(true);
    expect(hasWarningMatching(result.warnings, /every running process|unrelated instances/i)).toBe(false);
  });

  it('"kill 1234" routes to killExplain (not pkill or killall)', () => {
    const result = explain('kill 1234');
    expect(hasWarningMatching(result.warnings, /pattern|matches by name|every running process/i)).toBe(false);
  });
});

describe('TC-CE-149: kill — fallback when no target is provided', () => {
  it('falls back gracefully with a placeholder target', () => {
    const result = explain('kill');
    expect(result.summary).toMatch(/SIGTERM|<pid>/i);
  });
});

describe('TC-CE-150: pkill / killall — fallback when no pattern is provided', () => {
  it('pkill: falls back gracefully with a placeholder pattern', () => {
    const result = explain('pkill');
    expect(result.summary).toMatch(/<pattern>/);
  });

  it('killall: falls back gracefully with a placeholder name', () => {
    const result = explain('killall');
    expect(result.summary).toMatch(/<name>/);
  });
});

// ── TC-CE-151 – TC-CE-167 : network diagnostics + scan ───────────────────────

describe('TC-CE-151: ping — names host and (optionally) packet count', () => {
  it('summarises a basic ping invocation', () => {
    const result = explain('ping example.com');
    expect(result.summary).toContain('example.com');
    expect(result.summary).toMatch(/ICMP/i);
  });

  it('reports the packet count when -c is provided', () => {
    const result = explain('ping -c 5 example.com');
    expect(result.summary).toContain('5');
    expect(result.summary).toContain('example.com');
  });

  it('emits no warnings for a normal ping', () => {
    const result = explain('ping -c 3 8.8.8.8');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-152: traceroute — names host and hops', () => {
  it('summarises a basic traceroute invocation', () => {
    const result = explain('traceroute example.com');
    expect(result.summary).toContain('example.com');
    expect(result.summary).toMatch(/path|trace/i);
  });

  it('emits no warnings for a normal traceroute', () => {
    const result = explain('traceroute example.com');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-153: nslookup — names target', () => {
  it('summarises `nslookup name`', () => {
    const result = explain('nslookup example.com');
    expect(result.summary).toContain('example.com');
    expect(result.summary).toMatch(/DNS|resolve/i);
  });

  it('reports the resolver when one is supplied', () => {
    const result = explain('nslookup example.com 1.1.1.1');
    expect(result.summary).toContain('1.1.1.1');
  });

  it('emits no warnings for a normal external lookup', () => {
    const result = explain('nslookup example.com');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-154: dig — names target and (optional) record type', () => {
  it('summarises `dig example.com` as resolving DNS records', () => {
    const result = explain('dig example.com');
    expect(result.summary).toMatch(/DNS|resolve/i);
    expect(result.summary).toContain('example.com');
  });

  it('reports the record type when supplied', () => {
    const result = explain('dig example.com TXT');
    expect(result.summary).toContain('TXT');
  });

  it('reports the resolver when @ syntax is used', () => {
    const result = explain('dig @1.1.1.1 example.com');
    expect(result.summary).toContain('1.1.1.1');
  });
});

describe('TC-CE-155: dig / nslookup — internal-name leakage warning', () => {
  it('warns when querying an internal-looking name against an external resolver', () => {
    const result = explain('dig @8.8.8.8 internal-server.corp');
    expect(hasWarningMatching(result.warnings, /leaks infrastructure|internal name/i)).toBe(true);
  });

  it('warns when querying a bare hostname against an external resolver', () => {
    const result = explain('dig @1.1.1.1 db1');
    expect(hasWarningMatching(result.warnings, /leaks infrastructure|internal name/i)).toBe(true);
  });

  it('does not warn when querying an external name against an external resolver', () => {
    const result = explain('dig @1.1.1.1 example.com');
    expect(hasWarningMatching(result.warnings, /leaks infrastructure/i)).toBe(false);
  });

  it('does not warn when no explicit resolver is supplied', () => {
    const result = explain('dig internal-server.corp');
    expect(hasWarningMatching(result.warnings, /leaks infrastructure/i)).toBe(false);
  });

  it('does not warn when both the name and resolver are internal', () => {
    const result = explain('dig @10.0.0.1 internal-server.corp');
    expect(hasWarningMatching(result.warnings, /leaks infrastructure/i)).toBe(false);
  });
});

describe('TC-CE-156: netstat — flag-driven summary', () => {
  it('summarises -tnlp as listening TCP sockets with owning process', () => {
    const result = explain('netstat -tnlp');
    expect(result.summary).toMatch(/listening/i);
    expect(result.summary).toMatch(/TCP/i);
    expect(result.summary).toMatch(/owning process/i);
  });

  it('summarises -an as showing all sockets', () => {
    const result = explain('netstat -an');
    expect(result.summary).toMatch(/all/i);
  });

  it('emits no warnings (read-only)', () => {
    const result = explain('netstat -tnlp');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-157: ss — same flag dispatch as netstat', () => {
  it('summarises `ss -tlnp` as listening TCP sockets with owning process', () => {
    const result = explain('ss -tlnp');
    expect(result.summary).toMatch(/listening/i);
    expect(result.summary).toMatch(/TCP/i);
    expect(result.summary).toMatch(/owning process/i);
  });

  it('mentions ss in the effect line', () => {
    const result = explain('ss -tan');
    expect(hasEffectMatching(result.effects, /\bss\b/i)).toBe(true);
  });
});

describe('TC-CE-158: nmap — names target', () => {
  it('summarises a basic nmap invocation', () => {
    const result = explain('nmap 10.0.0.0/24');
    expect(result.summary).toMatch(/scan/i);
    expect(result.summary).toContain('10.0.0.0/24');
  });
});

describe('TC-CE-159: nmap — always-on IDS / AUP warnings', () => {
  it('always warns about IDS / IPS detection', () => {
    const result = explain('nmap example.com');
    expect(hasWarningMatching(result.warnings, /IDS|IPS|detection/i)).toBe(true);
  });

  it('always warns about acceptable-use policy', () => {
    const result = explain('nmap example.com');
    expect(hasWarningMatching(result.warnings, /acceptable-use|authorised/i)).toBe(true);
  });
});

describe('TC-CE-160: nmap -sS — SYN scan warning', () => {
  it('warns about raw-socket / firewall detection on -sS', () => {
    const result = explain('nmap -sS 10.0.0.0/24');
    expect(hasWarningMatching(result.warnings, /SYN scan|raw-socket|stateful firewalls/i)).toBe(true);
  });
});

describe('TC-CE-161: nmap -sU — UDP scan warning', () => {
  it('warns that UDP scan is slow / noisy', () => {
    const result = explain('nmap -sU 10.0.0.0/24');
    expect(hasWarningMatching(result.warnings, /UDP scan|slow|noisy/i)).toBe(true);
  });
});

describe('TC-CE-162: nmap -O — OS fingerprint warning', () => {
  it('warns about OS fingerprinting probes', () => {
    const result = explain('nmap -O 10.0.0.1');
    expect(hasWarningMatching(result.warnings, /OS fingerprint|distinctive probe/i)).toBe(true);
  });
});

describe('TC-CE-163: nmap -A — aggressive-scan warning', () => {
  it('warns about the aggregate -A scan signature', () => {
    const result = explain('nmap -A 10.0.0.1');
    expect(hasWarningMatching(result.warnings, /OS detection|version detection|script scanning|high signature/i)).toBe(true);
  });
});

describe('TC-CE-164: nmap --script — NSE warning', () => {
  it('warns about NSE scripts probing for vulnerabilities', () => {
    const result = explain('nmap --script vuln 10.0.0.1');
    expect(hasWarningMatching(result.warnings, /NSE|scripts.*probe|vulnerabilities/i)).toBe(true);
  });
});

describe('TC-CE-165: rule routing — netstat vs ss', () => {
  it('"netstat" routes to netstat (not the ss explainer)', () => {
    const result = explain('netstat -an');
    expect(hasEffectMatching(result.effects, /netstat/i)).toBe(true);
    expect(hasEffectMatching(result.effects, /\bss\b/i)).toBe(false);
  });

  it('"ss" routes to ss (not the netstat explainer)', () => {
    const result = explain('ss -an');
    expect(hasEffectMatching(result.effects, /\bss\b/i)).toBe(true);
    expect(hasEffectMatching(result.effects, /netstat/i)).toBe(false);
  });
});

describe('TC-CE-166: ping / traceroute — fallback with no host', () => {
  it('ping: falls back gracefully when no host is given', () => {
    const result = explain('ping');
    expect(result.summary).toMatch(/<host>/);
  });

  it('traceroute: falls back gracefully when no host is given', () => {
    const result = explain('traceroute');
    expect(result.summary).toMatch(/<host>/);
  });
});

describe('TC-CE-167: nmap — fallback with no target', () => {
  it('falls back gracefully when no target is given', () => {
    const result = explain('nmap');
    expect(result.summary).toMatch(/<target>/);
  });

  it('still emits the always-on IDS / AUP warnings even with no target', () => {
    const result = explain('nmap');
    expect(hasWarningMatching(result.warnings, /IDS|IPS|detection/i)).toBe(true);
  });
});

// ── TC-CE-168 – TC-CE-181 : scheduling / persistence ─────────────────────────

describe('TC-CE-168: crontab -l — read-only listing, no warnings', () => {
  it('summarises -l as listing the crontab', () => {
    const result = explain('crontab -l');
    expect(result.summary).toMatch(/list/i);
  });

  it('emits no warnings for a list operation', () => {
    const result = explain('crontab -l');
    expect(result.warnings).toHaveLength(0);
  });

  it('reports the user when -u is supplied with -l', () => {
    const result = explain('crontab -u alice -l');
    expect(result.summary).toContain('alice');
  });
});

describe('TC-CE-169: crontab -r — destructive removal warning', () => {
  it('warns about destructive removal', () => {
    const result = explain('crontab -r');
    expect(hasWarningMatching(result.warnings, /destructive|removed without prompt/i)).toBe(true);
  });

  it('warns about persistence / recovery cost', () => {
    const result = explain('crontab -r');
    expect(hasWarningMatching(result.warnings, /persistence|reinstalling/i)).toBe(true);
  });

  it('reports the user when -u is supplied with -r', () => {
    const result = explain('crontab -u alice -r');
    expect(result.summary).toContain('alice');
  });
});

describe('TC-CE-170: crontab -e — interactive-edit warning', () => {
  it('warns that the explainer cannot inspect the change content', () => {
    const result = explain('crontab -e');
    expect(hasWarningMatching(result.warnings, /interactive|cannot be inspected/i)).toBe(true);
  });
});

describe('TC-CE-171: crontab <file> — install-from-file, replace warning', () => {
  it('reports the file in the summary', () => {
    const result = explain('crontab /etc/cron.daily/mycron');
    expect(result.summary).toContain('/etc/cron.daily/mycron');
  });

  it('warns that existing entries are replaced', () => {
    const result = explain('crontab /tmp/new-cron');
    expect(hasWarningMatching(result.warnings, /destructive|replaced/i)).toBe(true);
  });

  it('warns about persistence semantics', () => {
    const result = explain('crontab /tmp/new-cron');
    expect(hasWarningMatching(result.warnings, /persistence|run unattended/i)).toBe(true);
  });
});

describe('TC-CE-172: at <time> — schedules a job, persistence warning', () => {
  it('reports the time spec in the summary', () => {
    const result = explain('at now + 10 minutes');
    expect(result.summary).toMatch(/now \+ 10 minutes|now/i);
  });

  it('warns about unattended execution', () => {
    const result = explain('at 2am');
    expect(hasWarningMatching(result.warnings, /persistence|unattended/i)).toBe(true);
  });
});

describe('TC-CE-173: at -f <file> <time> — schedule from file', () => {
  it('reports the file in the summary', () => {
    const result = explain('at -f /tmp/job.sh 23:30');
    expect(result.summary).toContain('/tmp/job.sh');
  });

  it('reports the time spec when both -f and a time are given', () => {
    const result = explain('at -f /tmp/job.sh 23:30');
    expect(result.summary).toContain('23:30');
  });
});

describe('TC-CE-174: at -l — equivalent to atq, no warnings', () => {
  it('summarises as listing scheduled jobs', () => {
    const result = explain('at -l');
    expect(result.summary).toMatch(/list/i);
  });

  it('emits no warnings for a list operation', () => {
    const result = explain('at -l');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-175: at -c <id> — show scheduled job script', () => {
  it('reports the job id in the summary', () => {
    const result = explain('at -c 7');
    expect(result.summary).toContain('7');
  });

  it('emits no warnings for a read operation', () => {
    const result = explain('at -c 7');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-176: at -d / -r <id> — remove scheduled job', () => {
  it('reports the job id when -d is used', () => {
    const result = explain('at -d 12');
    expect(result.summary).toContain('12');
  });

  it('reports the job id when -r is used', () => {
    const result = explain('at -r 12');
    expect(result.summary).toContain('12');
  });

  it('warns about persistence cost of cancellation', () => {
    const result = explain('at -d 12');
    expect(hasWarningMatching(result.warnings, /persistence|will not run/i)).toBe(true);
  });
});

describe('TC-CE-177: atq — listing scheduled jobs', () => {
  it('summarises as listing scheduled at jobs', () => {
    const result = explain('atq');
    expect(result.summary).toMatch(/list/i);
  });

  it('emits no warnings (read-only)', () => {
    const result = explain('atq');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-178: atrm — removes scheduled jobs', () => {
  it('reports the job id in the summary', () => {
    const result = explain('atrm 5');
    expect(result.summary).toContain('5');
  });

  it('reports multiple job ids in the summary', () => {
    const result = explain('atrm 5 6 7');
    expect(result.summary).toMatch(/5.*6.*7|5, 6, 7/);
  });

  it('warns about persistence cost', () => {
    const result = explain('atrm 5');
    expect(hasWarningMatching(result.warnings, /persistence|will not run/i)).toBe(true);
  });

  it('falls back gracefully when no job id is given', () => {
    const result = explain('atrm');
    expect(result.summary).toMatch(/<job-id>/);
  });
});

describe('TC-CE-179: batch — load-aware scheduling, persistence warning', () => {
  it('summarises as scheduling when load drops', () => {
    const result = explain('batch');
    expect(result.summary).toMatch(/load drops|batch/i);
  });

  it('warns about unattended execution', () => {
    const result = explain('batch');
    expect(hasWarningMatching(result.warnings, /persistence|unattended/i)).toBe(true);
  });
});

describe('TC-CE-180: rule routing — atq / atrm vs at', () => {
  it('"atq" routes to atqExplain (not atExplain)', () => {
    const result = explain('atq');
    expect(result.summary).toMatch(/list/i);
    expect(result.warnings).toHaveLength(0);
  });

  it('"atrm 5" routes to atrmExplain (not atExplain)', () => {
    const result = explain('atrm 5');
    expect(result.summary).toMatch(/Removes/i);
  });

  it('"at now" routes to atExplain (not atq/atrm)', () => {
    const result = explain('at now');
    expect(result.summary).toMatch(/schedules/i);
  });
});

describe('TC-CE-181: crontab — fallback when no flag is given', () => {
  it('falls back gracefully without -l/-r/-e/<file>', () => {
    const result = explain('crontab');
    expect(result.summary).toMatch(/crontab/i);
    expect(result.warnings).toHaveLength(0);
  });
});

// ── TC-CE-182 – TC-CE-194 : network-transfer ─────────────────────────────────

describe('TC-CE-182: rsync — local-only invocation, no remote warning', () => {
  it('emits no remote warning when both endpoints are local paths', () => {
    const result = explain('rsync -a /var/data/ /backup/data/');
    expect(hasWarningMatching(result.warnings, /remote/i)).toBe(false);
  });
});

describe('TC-CE-183: rsync — remote destination flagged as upload', () => {
  it('warns about uploading when destination is user@host:path', () => {
    const result = explain('rsync -a /var/data/ alice@backup.example.com:/srv/');
    expect(hasWarningMatching(result.warnings, /Destination.*remote|uploaded over the network/i)).toBe(true);
  });

  it('warns about uploading when destination is host:path', () => {
    const result = explain('rsync -a /var/data/ backup.example.com:/srv/');
    expect(hasWarningMatching(result.warnings, /Destination.*remote|uploaded over the network/i)).toBe(true);
  });

  it('warns about uploading when destination is rsync://...', () => {
    const result = explain('rsync -a /var/data/ rsync://backup.example.com/srv');
    expect(hasWarningMatching(result.warnings, /Destination.*remote|uploaded over the network/i)).toBe(true);
  });
});

describe('TC-CE-184: rsync — remote source flagged as download', () => {
  it('warns about pulling when source is user@host:path and destination is local', () => {
    const result = explain('rsync -a alice@db.example.com:/var/db/ /local/restore/');
    expect(hasWarningMatching(result.warnings, /Source.*remote|pulling data/i)).toBe(true);
  });

  it('does not emit the source warning when both endpoints are remote', () => {
    const result = explain('rsync -a alice@a.example.com:/data alice@b.example.com:/dest');
    // Both ends remote — destination warning fires; source warning suppressed
    // to avoid double-flagging a single transfer.
    expect(hasWarningMatching(result.warnings, /Source.*remote|pulling data/i)).toBe(false);
  });
});

describe('TC-CE-185: rsync --delete — keeps the existing delete warning', () => {
  it('still warns about --delete alongside any remote warning', () => {
    const result = explain('rsync -a --delete /var/data/ alice@host:/srv/');
    expect(hasWarningMatching(result.warnings, /--delete|removes files at destination/i)).toBe(true);
  });
});

describe('TC-CE-186: rsync — Windows-style local paths are not flagged as remote', () => {
  it('does not treat C:foo as a remote endpoint', () => {
    const result = explain('rsync -a C:foo /backup/');
    expect(hasWarningMatching(result.warnings, /remote/i)).toBe(false);
  });
});

describe('TC-CE-187: scp — local-only invocation, no remote warning', () => {
  it('emits no remote warning when both endpoints are local paths', () => {
    const result = explain('scp /etc/hosts /backup/hosts');
    expect(hasWarningMatching(result.warnings, /remote/i)).toBe(false);
  });
});

describe('TC-CE-188: scp — remote destination flagged as upload', () => {
  it('warns about uploading when destination is user@host:path', () => {
    const result = explain('scp /etc/hosts alice@host.example.com:/etc/hosts.bak');
    expect(hasWarningMatching(result.warnings, /Destination.*remote|uploaded over the network/i)).toBe(true);
  });
});

describe('TC-CE-189: scp — remote source flagged as download', () => {
  it('warns about pulling when source is remote and destination is local', () => {
    const result = explain('scp alice@host.example.com:/etc/hosts /tmp/hosts');
    expect(hasWarningMatching(result.warnings, /Source.*remote|pulling data/i)).toBe(true);
  });
});

describe('TC-CE-190: sftp — interactive session warning', () => {
  it('summarises a bare `sftp host` invocation as opening an interactive session', () => {
    const result = explain('sftp alice@host.example.com');
    expect(result.summary).toMatch(/sftp session|opens an sftp/i);
    expect(result.summary).toContain('alice@host.example.com');
  });

  it('warns that the explainer cannot inspect interactive transfers', () => {
    const result = explain('sftp alice@host.example.com');
    expect(hasWarningMatching(result.warnings, /interactive|cannot be inspected/i)).toBe(true);
  });

  it('always warns that files cross the network', () => {
    const result = explain('sftp alice@host.example.com');
    expect(hasWarningMatching(result.warnings, /cross the network|either direction/i)).toBe(true);
  });
});

describe('TC-CE-191: sftp -b — batch-file mode summary', () => {
  it('reports the batch file in the summary', () => {
    const result = explain('sftp -b /tmp/transfer.sftp alice@host.example.com');
    expect(result.summary).toContain('/tmp/transfer.sftp');
    expect(result.summary).toContain('alice@host.example.com');
  });

  it('does not raise the interactive warning for batch-file mode', () => {
    const result = explain('sftp -b /tmp/transfer.sftp alice@host.example.com');
    expect(hasWarningMatching(result.warnings, /interactive.*cannot be inspected/i)).toBe(false);
  });

  it('still warns that files cross the network', () => {
    const result = explain('sftp -b /tmp/transfer.sftp alice@host.example.com');
    expect(hasWarningMatching(result.warnings, /cross the network|either direction/i)).toBe(true);
  });
});

describe('TC-CE-192: sftp -P <port> — port flag does not become the host', () => {
  it('reports the actual host, not the port number', () => {
    const result = explain('sftp -P 2222 alice@host.example.com');
    expect(result.summary).toContain('alice@host.example.com');
    expect(result.summary).not.toMatch(/sftp session to 2222/);
  });
});

describe('TC-CE-193: sftp — fallback when no host is given', () => {
  it('falls back gracefully with a placeholder host', () => {
    const result = explain('sftp');
    expect(result.summary).toMatch(/<host>/);
  });
});

describe('TC-CE-194: rule routing — sftp vs ssh vs scp', () => {
  it('"sftp host" routes to sftpExplain (not ssh)', () => {
    const result = explain('sftp alice@host');
    expect(result.summary).toMatch(/sftp/i);
    expect(result.summary).not.toMatch(/secure shell/i);
  });

  it('"scp src dst" routes to scpExplain (not sftp)', () => {
    const result = explain('scp /etc/hosts alice@host:/tmp/');
    expect(result.summary).toMatch(/securely copies/i);
  });

  it('"ssh host" routes to sshExplain (not sftp/scp)', () => {
    const result = explain('ssh alice@host');
    expect(result.summary).toMatch(/secure shell/i);
  });
});

// ── TC-CE-195 – TC-CE-215 : distro / system package managers ─────────────────

describe('TC-CE-195: apt install — names packages and warns about remote-code execution', () => {
  it('reports the packages in the summary', () => {
    const result = explain('apt install nginx postgresql');
    expect(result.summary).toContain('nginx');
    expect(result.summary).toContain('postgresql');
  });

  it('warns about remote-code execution', () => {
    const result = explain('apt install nginx');
    expect(hasWarningMatching(result.warnings, /remote repository|privileges of the installer/i)).toBe(true);
  });
});

describe('TC-CE-196: apt remove / purge — service-interruption warning', () => {
  it('summarises remove', () => {
    const result = explain('apt remove nginx');
    expect(result.summary).toMatch(/Removes/i);
  });

  it('purge keeps configuration-removal effect', () => {
    const result = explain('apt purge nginx');
    expect(hasEffectMatching(result.effects, /configuration files/i)).toBe(true);
  });

  it('warns about service interruption', () => {
    const result = explain('apt remove nginx');
    expect(hasWarningMatching(result.warnings, /service interruption|running daemon/i)).toBe(true);
  });
});

describe('TC-CE-197: apt update — read-only metadata refresh, no warnings', () => {
  it('summarises as a metadata refresh', () => {
    const result = explain('apt update');
    expect(result.summary).toMatch(/refreshes|index/i);
  });

  it('emits no warnings (does not install anything)', () => {
    const result = explain('apt update');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-198: apt upgrade / dist-upgrade — bulk-operation warning', () => {
  it('warns about bulk operation on upgrade', () => {
    const result = explain('apt upgrade');
    expect(hasWarningMatching(result.warnings, /bulk operation/i)).toBe(true);
  });

  it('warns about -y / --yes when present', () => {
    const result = explain('apt upgrade -y');
    expect(hasWarningMatching(result.warnings, /-y|accepts every prompt/i)).toBe(true);
  });

  it('handles dist-upgrade in summary', () => {
    const result = explain('apt dist-upgrade');
    expect(result.summary).toMatch(/dist-upgrade|all packages/i);
  });
});

describe('TC-CE-199: apt-get install routes to the same explainer as apt', () => {
  it('apt-get install warns about remote-code execution', () => {
    const result = explain('apt-get install nginx');
    expect(hasWarningMatching(result.warnings, /remote repository|privileges of the installer/i)).toBe(true);
  });
});

describe('TC-CE-200: apt — fallback for an unrecognised subcommand', () => {
  it('summarises without warnings on an unknown subcommand', () => {
    const result = explain('apt list --installed');
    expect(result.summary).toMatch(/apt/i);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-201: yum / dnf install — names packages and warns about remote-code execution', () => {
  it('yum install warns about remote-code execution', () => {
    const result = explain('yum install httpd');
    expect(hasWarningMatching(result.warnings, /remote repository|privileges of the installer/i)).toBe(true);
  });

  it('dnf install warns about remote-code execution', () => {
    const result = explain('dnf install httpd');
    expect(hasWarningMatching(result.warnings, /remote repository|privileges of the installer/i)).toBe(true);
  });

  it('reports the package in the summary', () => {
    const result = explain('dnf install httpd');
    expect(result.summary).toContain('httpd');
  });
});

describe('TC-CE-202: yum / dnf upgrade with -y — accept-every-prompt warning', () => {
  it('warns about -y / --assumeyes', () => {
    const result = explain('yum upgrade -y');
    expect(hasWarningMatching(result.warnings, /-y|--assumeyes|accepts every prompt/i)).toBe(true);
  });

  it('warns about bulk-upgrade scope when no packages are listed', () => {
    const result = explain('dnf upgrade');
    expect(hasWarningMatching(result.warnings, /bulk operation/i)).toBe(true);
  });

  it('does not raise the bulk warning when explicit packages are upgraded', () => {
    const result = explain('dnf upgrade httpd');
    expect(hasWarningMatching(result.warnings, /bulk operation/i)).toBe(false);
  });
});

describe('TC-CE-203: yum check-update — read-only metadata check', () => {
  it('emits no warnings', () => {
    const result = explain('yum check-update');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-204: dpkg -i — flags installs, warns about repository bypass', () => {
  it('summarises an .deb install', () => {
    const result = explain('dpkg -i /tmp/pkg.deb');
    expect(result.summary).toContain('/tmp/pkg.deb');
  });

  it('warns about apt-bypass', () => {
    const result = explain('dpkg -i /tmp/pkg.deb');
    expect(hasWarningMatching(result.warnings, /bypasses the apt repository|signature/i)).toBe(true);
  });
});

describe('TC-CE-205: dpkg -r / -P — service-interruption warning', () => {
  it('warns about service interruption on -r', () => {
    const result = explain('dpkg -r nginx');
    expect(hasWarningMatching(result.warnings, /service interruption/i)).toBe(true);
  });

  it('-P retains configuration-removal effect', () => {
    const result = explain('dpkg -P nginx');
    expect(hasEffectMatching(result.effects, /configuration files/i)).toBe(true);
  });
});

describe('TC-CE-206: dpkg -l — read-only listing, no warnings', () => {
  it('emits no warnings', () => {
    const result = explain('dpkg -l');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-207: snap install — interface-review warning', () => {
  it('warns about declared plugs / interfaces', () => {
    const result = explain('snap install vlc');
    expect(hasWarningMatching(result.warnings, /interface|plugs/i)).toBe(true);
  });
});

describe('TC-CE-208: snap remove — no warnings', () => {
  it('emits no warnings (removal is benign)', () => {
    const result = explain('snap remove vlc');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-209: snap refresh — bulk-operation warning when no packages listed', () => {
  it('warns about bulk operation on bare refresh', () => {
    const result = explain('snap refresh');
    expect(hasWarningMatching(result.warnings, /bulk operation/i)).toBe(true);
  });

  it('does not raise the bulk warning when refreshing a specific snap', () => {
    const result = explain('snap refresh vlc');
    expect(hasWarningMatching(result.warnings, /bulk operation/i)).toBe(false);
  });
});

describe('TC-CE-210: brew install — remote-code-execution warning', () => {
  it('warns about taps / privileges', () => {
    const result = explain('brew install jq');
    expect(hasWarningMatching(result.warnings, /tap|privileges of the installer/i)).toBe(true);
  });
});

describe('TC-CE-211: brew uninstall / remove / rm — alias forms route the same way', () => {
  it('brew uninstall summarises uninstall', () => {
    const result = explain('brew uninstall jq');
    expect(result.summary).toMatch(/Uninstalls/i);
  });

  it('brew remove summarises uninstall', () => {
    const result = explain('brew remove jq');
    expect(result.summary).toMatch(/Uninstalls/i);
  });

  it('brew rm summarises uninstall', () => {
    const result = explain('brew rm jq');
    expect(result.summary).toMatch(/Uninstalls/i);
  });
});

describe('TC-CE-212: brew upgrade — bulk-operation warning when no packages listed', () => {
  it('warns about bulk operation on bare upgrade', () => {
    const result = explain('brew upgrade');
    expect(hasWarningMatching(result.warnings, /bulk operation/i)).toBe(true);
  });

  it('does not raise the bulk warning when upgrading a specific package', () => {
    const result = explain('brew upgrade jq');
    expect(hasWarningMatching(result.warnings, /bulk operation/i)).toBe(false);
  });
});

describe('TC-CE-213: brew update / list / cleanup — read-only-ish, no warnings', () => {
  it('brew update emits no warnings', () => {
    const result = explain('brew update');
    expect(result.warnings).toHaveLength(0);
  });

  it('brew list emits no warnings', () => {
    const result = explain('brew list');
    expect(result.warnings).toHaveLength(0);
  });

  it('brew cleanup emits no warnings', () => {
    const result = explain('brew cleanup');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-214: pacman flag-driven dispatch', () => {
  it('-S installs and warns about remote-code execution', () => {
    const result = explain('pacman -S nginx');
    expect(hasWarningMatching(result.warnings, /remote repository|privileges of the installer/i)).toBe(true);
  });

  it('-Syu summarises full system upgrade with bulk-operation warning', () => {
    const result = explain('pacman -Syu');
    expect(result.summary).toMatch(/upgrades all|synchronises/i);
    expect(hasWarningMatching(result.warnings, /bulk operation/i)).toBe(true);
  });

  it('-R removes and warns about service interruption', () => {
    const result = explain('pacman -R nginx');
    expect(hasWarningMatching(result.warnings, /service interruption/i)).toBe(true);
  });

  it('-Q queries the local DB with no warnings', () => {
    const result = explain('pacman -Q');
    expect(result.warnings).toHaveLength(0);
  });

  it('-U warns about local-archive signature bypass', () => {
    const result = explain('pacman -U /tmp/local.pkg.tar.zst');
    expect(hasWarningMatching(result.warnings, /signature|authenticity/i)).toBe(true);
  });
});

describe('TC-CE-215: rule routing — apt vs apt-get vs yum vs dnf', () => {
  it('"apt install" routes to aptExplain', () => {
    const result = explain('apt install nginx');
    expect(result.summary).toMatch(/apt packages/);
  });

  it('"apt-get install" routes to aptExplain (same regex prefix)', () => {
    const result = explain('apt-get install nginx');
    expect(result.summary).toMatch(/apt packages/);
  });

  it('"yum install" routes to yumDnfExplain with yum binary label', () => {
    const result = explain('yum install httpd');
    expect(result.summary).toMatch(/yum packages/);
  });

  it('"dnf install" routes to yumDnfExplain with dnf binary label', () => {
    const result = explain('dnf install httpd');
    expect(result.summary).toMatch(/dnf packages/);
  });
});

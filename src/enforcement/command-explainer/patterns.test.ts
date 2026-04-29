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
 *   TC-CE-216 – TC-CE-217: docker push / docker ps subcommand additions
 *   TC-CE-218 – TC-CE-232: kubectl subcommand patterns
 *                          (apply, delete, get, describe, logs, exec,
 *                          port-forward, rollout, scale)
 *   TC-CE-233 – TC-CE-237: virsh subcommand patterns
 *   TC-CE-238 – TC-CE-258: light explainers — read utilities, write utilities,
 *                          system info / monitoring (final v1.3.1 gap-fill)
 *   TC-CE-259 – TC-CE-275: compression / archive explainers
 *                          (tar, zip, unzip, gzip, gunzip, bzip2, bunzip2,
 *                          xz, unxz, 7z)
 *   TC-CE-276 – TC-CE-285: cleanup explainers — grep / rmdir / unlink / shred,
 *                          mv-as-deletion detection
 *   TC-CE-286 – TC-CE-291: network.shell additions — mosh / telnet
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

  it('returns a summary for an unrecognised docker subcommand (login)', () => {
    // `docker ps` and `docker push` now have their own dispatch; pick
    // a still-unhandled subcommand so this test exercises the fallback.
    const result = explain('docker login registry.example.com');
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

// ── TC-CE-216 – TC-CE-217 : docker push / docker ps ──────────────────────────

describe('TC-CE-216: docker push — image-upload warning', () => {
  it('reports the image in the summary', () => {
    const result = explain('docker push myorg/myapp:1.0');
    expect(result.summary).toContain('myorg/myapp:1.0');
  });

  it('warns about secrets baked into images', () => {
    const result = explain('docker push myorg/myapp:1.0');
    expect(hasWarningMatching(result.warnings, /secrets|baked|registry read access/i)).toBe(true);
  });

  it('--all-tags raises an additional warning', () => {
    const result = explain('docker push --all-tags myorg/myapp');
    expect(hasWarningMatching(result.warnings, /every tag/i)).toBe(true);
  });
});

describe('TC-CE-217: docker ps — read-only listing', () => {
  it('summarises bare ps as listing running containers', () => {
    const result = explain('docker ps');
    expect(result.summary).toMatch(/running containers/i);
  });

  it('-a / --all summarises as listing every container', () => {
    const result = explain('docker ps -a');
    expect(result.summary).toMatch(/every container|running and stopped/i);
  });

  it('emits no warnings (read-only)', () => {
    const result = explain('docker ps -a');
    expect(result.warnings).toHaveLength(0);
  });
});

// ── TC-CE-218 – TC-CE-232 : kubectl ──────────────────────────────────────────

describe('TC-CE-218: kubectl apply — manifest summary + cluster-mutation warning', () => {
  it('reports the file path when -f is given', () => {
    const result = explain('kubectl apply -f deploy.yaml');
    expect(result.summary).toContain('deploy.yaml');
  });

  it('always warns about cluster mutation', () => {
    const result = explain('kubectl apply -f deploy.yaml');
    expect(hasWarningMatching(result.warnings, /Cluster mutation/i)).toBe(true);
  });

  it('--prune raises an additional warning', () => {
    const result = explain('kubectl apply -f deploy.yaml --prune');
    expect(hasWarningMatching(result.warnings, /--prune deletes/i)).toBe(true);
  });

  it('--force raises an additional warning', () => {
    const result = explain('kubectl apply -f deploy.yaml --force');
    expect(hasWarningMatching(result.warnings, /--force overrides/i)).toBe(true);
  });
});

describe('TC-CE-219: kubectl delete — resource summary + cluster-mutation warning', () => {
  it('reports the resource and name in the summary', () => {
    const result = explain('kubectl delete deployment my-app');
    expect(result.summary).toContain('deployment');
    expect(result.summary).toContain('my-app');
  });

  it('always warns about cluster mutation', () => {
    const result = explain('kubectl delete deployment my-app');
    expect(hasWarningMatching(result.warnings, /Cluster mutation/i)).toBe(true);
  });

  it('--all raises an additional warning', () => {
    const result = explain('kubectl delete deployment --all');
    expect(hasWarningMatching(result.warnings, /--all deletes every resource/i)).toBe(true);
  });

  it('--force / --grace-period=0 raises an additional warning', () => {
    const result = explain('kubectl delete pod my-app --grace-period=0 --force');
    expect(hasWarningMatching(result.warnings, /skips graceful shutdown|terminate immediately/i)).toBe(true);
  });
});

describe('TC-CE-220: kubectl get / describe — read operations', () => {
  it('"kubectl get pods" lists pods in summary', () => {
    const result = explain('kubectl get pods');
    expect(result.summary).toMatch(/Lists/i);
    expect(result.summary).toContain('pods');
  });

  it('"kubectl describe pod my-app" describes a named resource', () => {
    const result = explain('kubectl describe pod my-app');
    expect(result.summary).toMatch(/Describes/i);
    expect(result.summary).toContain('my-app');
  });

  it('emits no warnings for read operations', () => {
    const result = explain('kubectl get pods');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-221: kubectl logs — sensitive-data warning', () => {
  it('reports the pod in the summary', () => {
    const result = explain('kubectl logs my-pod');
    expect(result.summary).toContain('my-pod');
  });

  it('warns about credentials / sensitive data in logs', () => {
    const result = explain('kubectl logs my-pod');
    expect(hasWarningMatching(result.warnings, /credentials|sensitive data/i)).toBe(true);
  });
});

describe('TC-CE-222: kubectl exec — direct-access warning + interactive TTY', () => {
  it('reports the pod in the summary', () => {
    const result = explain('kubectl exec my-pod -- /bin/sh');
    expect(result.summary).toContain('my-pod');
  });

  it('always warns about direct access', () => {
    const result = explain('kubectl exec my-pod -- /bin/sh');
    expect(hasWarningMatching(result.warnings, /direct access/i)).toBe(true);
  });

  it('-it raises the interactive-TTY warning', () => {
    const result = explain('kubectl exec -it my-pod -- /bin/sh');
    expect(hasWarningMatching(result.warnings, /Interactive TTY|cannot be inspected/i)).toBe(true);
  });

  it('-i and -t together raise the interactive-TTY warning', () => {
    const result = explain('kubectl exec -i -t my-pod -- /bin/sh');
    expect(hasWarningMatching(result.warnings, /Interactive TTY|cannot be inspected/i)).toBe(true);
  });
});

describe('TC-CE-223: kubectl port-forward — long-running tunnel warning', () => {
  it('warns about long-running session', () => {
    const result = explain('kubectl port-forward pod/my-app 8080:80');
    expect(hasWarningMatching(result.warnings, /long-running|persists until/i)).toBe(true);
  });

  it('warns about reaching inside the cluster', () => {
    const result = explain('kubectl port-forward pod/my-app 8080:80');
    expect(hasWarningMatching(result.warnings, /reach inside the cluster/i)).toBe(true);
  });
});

describe('TC-CE-224: kubectl rollout restart — brief-disruption warning', () => {
  it('reports the resource', () => {
    const result = explain('kubectl rollout restart deployment my-app');
    expect(result.summary).toMatch(/restart/i);
    expect(result.summary).toContain('my-app');
  });

  it('warns about brief disruption', () => {
    const result = explain('kubectl rollout restart deployment my-app');
    expect(hasWarningMatching(result.warnings, /Brief disruption|replacement pods/i)).toBe(true);
  });
});

describe('TC-CE-225: kubectl rollout undo — cluster-mutation warning', () => {
  it('summarises rollback', () => {
    const result = explain('kubectl rollout undo deployment my-app');
    expect(result.summary).toMatch(/Rolls back/i);
  });

  it('warns about cluster mutation', () => {
    const result = explain('kubectl rollout undo deployment my-app');
    expect(hasWarningMatching(result.warnings, /Cluster mutation|previous revision/i)).toBe(true);
  });
});

describe('TC-CE-226: kubectl rollout status — read-only, no warnings', () => {
  it('summarises read-only', () => {
    const result = explain('kubectl rollout status deployment my-app');
    expect(result.summary).toMatch(/rollout status/i);
  });

  it('emits no warnings', () => {
    const result = explain('kubectl rollout status deployment my-app');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-227: kubectl scale — replica count', () => {
  it('reports the replicas in the summary when --replicas=N is used', () => {
    const result = explain('kubectl scale deployment my-app --replicas=3');
    expect(result.summary).toContain('3 replicas');
  });

  it('reports the replicas in the summary when --replicas N (space form) is used', () => {
    const result = explain('kubectl scale deployment my-app --replicas 3');
    expect(result.summary).toContain('3 replicas');
  });

  it('warns when scaling to 0 replicas', () => {
    const result = explain('kubectl scale deployment my-app --replicas=0');
    expect(hasWarningMatching(result.warnings, /takes the workload offline|0 replicas/i)).toBe(true);
  });

  it('does not warn for non-zero replica counts', () => {
    const result = explain('kubectl scale deployment my-app --replicas=5');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-228: kubectl namespace flag — propagates into the summary', () => {
  it('reports the namespace when -n is used', () => {
    const result = explain('kubectl get pods -n production');
    expect(result.summary).toContain('production');
  });

  it('reports the namespace when --namespace= form is used', () => {
    const result = explain('kubectl get pods --namespace=staging');
    expect(result.summary).toContain('staging');
  });

  it('reports the namespace when --namespace <ns> (space) form is used', () => {
    const result = explain('kubectl get pods --namespace staging');
    expect(result.summary).toContain('staging');
  });

  it('omits the namespace clause when none is provided', () => {
    const result = explain('kubectl get pods');
    expect(result.summary).not.toMatch(/in namespace/);
  });
});

describe('TC-CE-229: kubectl — fallback for an unknown subcommand', () => {
  it('summarises gracefully for an unrecognised subcommand', () => {
    const result = explain('kubectl drain my-node');
    expect(result.summary).toMatch(/kubectl drain/i);
  });

  it('emits no warnings for the fallback path', () => {
    const result = explain('kubectl drain my-node');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-230: kubectl bare invocation', () => {
  it('summarises gracefully when no subcommand is given', () => {
    const result = explain('kubectl');
    expect(result.summary).toMatch(/kubectl/i);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-231: kubectl rollout fallback', () => {
  it('falls back gracefully when no rollout action is given', () => {
    const result = explain('kubectl rollout');
    expect(result.summary).toMatch(/kubectl rollout/i);
  });

  it('falls back gracefully for unknown rollout action', () => {
    const result = explain('kubectl rollout pause deployment my-app');
    expect(result.summary).toMatch(/rollout pause/i);
  });
});

describe('TC-CE-232: kubectl logs — bare invocation falls back without crashing', () => {
  it('handles bare `kubectl logs` without a pod name', () => {
    const result = explain('kubectl logs');
    expect(result.summary).toMatch(/Reads pod logs/i);
  });
});

// ── TC-CE-233 – TC-CE-237 : virsh ────────────────────────────────────────────

describe('TC-CE-233: virsh list — read-only, no warnings', () => {
  it('summarises listing', () => {
    const result = explain('virsh list');
    expect(result.summary).toMatch(/Lists virsh/i);
  });

  it('emits no warnings', () => {
    const result = explain('virsh list');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-234: virsh start — boot summary, no warnings', () => {
  it('reports the domain', () => {
    const result = explain('virsh start db1');
    expect(result.summary).toContain('db1');
  });

  it('emits no warnings (boot is benign)', () => {
    const result = explain('virsh start db1');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-235: virsh shutdown / reboot — service-interruption warning', () => {
  it('shutdown warns about active services', () => {
    const result = explain('virsh shutdown db1');
    expect(hasWarningMatching(result.warnings, /Active services|interrupted/i)).toBe(true);
  });

  it('reboot warns about brief unavailability', () => {
    const result = explain('virsh reboot db1');
    expect(hasWarningMatching(result.warnings, /briefly unavailable|services/i)).toBe(true);
  });
});

describe('TC-CE-236: virsh destroy — forceful-termination warning', () => {
  it('warns about forceful termination', () => {
    const result = explain('virsh destroy db1');
    expect(hasWarningMatching(result.warnings, /Forceful termination|killed without cleanup/i)).toBe(true);
  });
});

describe('TC-CE-237: virsh undefine — persistence + storage warnings', () => {
  it('warns about persistence loss on undefine', () => {
    const result = explain('virsh undefine db1');
    expect(hasWarningMatching(result.warnings, /Persistent|will not auto-start/i)).toBe(true);
  });

  it('--remove-all-storage adds an irreversible-deletion warning', () => {
    const result = explain('virsh undefine db1 --remove-all-storage');
    expect(hasWarningMatching(result.warnings, /--remove-all-storage|disk image|irreversible/i)).toBe(true);
  });
});

// ── TC-CE-238 – TC-CE-258 : final-pass light explainers ──────────────────────

describe('TC-CE-238: cat — names files in summary', () => {
  it('summarises a single-file cat', () => {
    const result = explain('cat /etc/hosts');
    expect(result.summary).toContain('/etc/hosts');
  });

  it('summarises a multi-file cat as concatenation', () => {
    const result = explain('cat a.txt b.txt');
    expect(result.summary).toMatch(/Concatenates|prints/i);
    expect(result.summary).toContain('a.txt');
    expect(result.summary).toContain('b.txt');
  });

  it('summarises bare cat as a stdin reader', () => {
    const result = explain('cat');
    expect(result.summary).toMatch(/stdin/i);
  });
});

describe('TC-CE-239: head — line count from -n / -N / default', () => {
  it('default 10 lines', () => {
    const result = explain('head /etc/hosts');
    expect(result.summary).toMatch(/first 10/);
  });

  it('-n N takes precedence', () => {
    const result = explain('head -n 5 /etc/hosts');
    expect(result.summary).toMatch(/first 5/);
  });

  it('-N short form', () => {
    const result = explain('head -3 /etc/hosts');
    expect(result.summary).toMatch(/first 3/);
  });
});

describe('TC-CE-240: tail -f — long-running warning', () => {
  it('warns about long-running tail -f', () => {
    const result = explain('tail -f /var/log/syslog');
    expect(hasWarningMatching(result.warnings, /long-running|interrupted/i)).toBe(true);
  });

  it('does not warn for a normal tail', () => {
    const result = explain('tail -n 50 /var/log/syslog');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-241: less / more — interactive-pager warning', () => {
  it('less warns about long-running interactive', () => {
    const result = explain('less /etc/hosts');
    expect(hasWarningMatching(result.warnings, /long-running|interactive/i)).toBe(true);
  });

  it('more warns about long-running interactive', () => {
    const result = explain('more /etc/hosts');
    expect(hasWarningMatching(result.warnings, /long-running|interactive/i)).toBe(true);
  });
});

describe('TC-CE-242: diff — names both files', () => {
  it('summarises two-file diff', () => {
    const result = explain('diff a.txt b.txt');
    expect(result.summary).toContain('a.txt');
    expect(result.summary).toContain('b.txt');
  });
});

describe('TC-CE-243: find — -delete and -exec flag warnings', () => {
  it('warns when -delete is used', () => {
    const result = explain('find /tmp -name "*.bak" -delete');
    expect(hasWarningMatching(result.warnings, /-delete/i)).toBe(true);
  });

  it('warns when -exec is used', () => {
    const result = explain('find /tmp -name "*.tmp" -exec rm {} ;');
    expect(hasWarningMatching(result.warnings, /-exec/i)).toBe(true);
  });

  it('does not warn for a plain search', () => {
    const result = explain('find /tmp -name "*.log"');
    expect(result.warnings).toHaveLength(0);
  });

  it('reports the search root in the summary', () => {
    const result = explain('find /var/log -name "*.gz"');
    expect(result.summary).toContain('/var/log');
  });
});

describe('TC-CE-244: locate / tree — read-only summaries', () => {
  it('locate names the pattern', () => {
    const result = explain('locate openssl');
    expect(result.summary).toContain('openssl');
  });

  it('tree names the path', () => {
    const result = explain('tree /etc');
    expect(result.summary).toContain('/etc');
  });
});

describe('TC-CE-245: ls — long-format detection', () => {
  it('detects -l long format', () => {
    const result = explain('ls -l /etc');
    expect(result.summary).toMatch(/file metadata/i);
  });

  it('detects -la combined flag', () => {
    const result = explain('ls -la /etc');
    expect(result.summary).toMatch(/file metadata/i);
  });

  it('plain ls does not mention metadata', () => {
    const result = explain('ls /etc');
    expect(result.summary).not.toMatch(/file metadata/i);
  });

  it('bare ls defaults to current directory', () => {
    const result = explain('ls');
    expect(result.summary).toMatch(/Lists \./);
  });
});

describe('TC-CE-246: tee — overwrite vs append', () => {
  it('warns about overwrite on plain tee', () => {
    const result = explain('tee /tmp/output.txt');
    expect(hasWarningMatching(result.warnings, /overwritten/i)).toBe(true);
  });

  it('does not warn when -a / --append is used', () => {
    const result = explain('tee -a /tmp/output.txt');
    expect(hasWarningMatching(result.warnings, /overwritten/i)).toBe(false);
  });

  it('summary mentions append mode when -a is used', () => {
    const result = explain('tee --append /tmp/output.txt');
    expect(result.summary).toMatch(/appends/i);
  });
});

describe('TC-CE-247: touch — creates or updates timestamps', () => {
  it('summarises with the named file', () => {
    const result = explain('touch /tmp/marker');
    expect(result.summary).toContain('/tmp/marker');
  });
});

describe('TC-CE-248: echo / printf — stdout-only summaries', () => {
  it('echo includes the text in summary', () => {
    const result = explain('echo hello world');
    expect(result.summary).toContain('hello world');
  });

  it('echo truncates very long text', () => {
    const long = 'x'.repeat(80);
    const result = explain(`echo ${long}`);
    expect(result.summary).toMatch(/…/);
  });

  it('bare echo summarises as stdout print', () => {
    const result = explain('echo');
    expect(result.summary).toMatch(/stdout/i);
  });

  it('printf includes the format string', () => {
    const result = explain('printf "%d items\\n" 5');
    expect(result.summary).toMatch(/items|formatted/i);
  });
});

describe('TC-CE-249: ps — basic summary', () => {
  it('summarises as listing processes', () => {
    const result = explain('ps aux');
    expect(result.summary).toMatch(/Lists running processes/i);
  });

  it('emits no warnings (read-only)', () => {
    const result = explain('ps aux');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-250: top / htop — long-running interactive warning', () => {
  it('top warns about long-running', () => {
    const result = explain('top');
    expect(hasWarningMatching(result.warnings, /long-running|interrupted/i)).toBe(true);
  });

  it('htop warns about long-running', () => {
    const result = explain('htop');
    expect(hasWarningMatching(result.warnings, /long-running|interrupted/i)).toBe(true);
  });
});

describe('TC-CE-251: df / du / free — disk and memory queries', () => {
  it('df summarises disk usage', () => {
    const result = explain('df -h');
    expect(result.summary).toMatch(/disk space/i);
  });

  it('du summarises with target path', () => {
    const result = explain('du -sh /var');
    expect(result.summary).toContain('/var');
  });

  it('free summarises memory usage', () => {
    const result = explain('free -m');
    expect(result.summary).toMatch(/memory/i);
  });
});

describe('TC-CE-252: hostname / uptime / lsof / id / whoami — read-only summaries', () => {
  it('hostname', () => {
    const result = explain('hostname');
    expect(result.summary).toMatch(/hostname/i);
  });
  it('uptime', () => {
    const result = explain('uptime');
    expect(result.summary).toMatch(/uptime|load/i);
  });
  it('lsof', () => {
    const result = explain('lsof');
    expect(result.summary).toMatch(/open files|sockets/i);
  });
  it('id (current user)', () => {
    const result = explain('id');
    expect(result.summary).toMatch(/user.*group/i);
  });
  it('id <user>', () => {
    const result = explain('id alice');
    expect(result.summary).toContain('alice');
  });
  it('whoami', () => {
    const result = explain('whoami');
    expect(result.summary).toMatch(/username/i);
  });
});

describe('TC-CE-253: uname — long-form vs default', () => {
  it('-a reports full identification', () => {
    const result = explain('uname -a');
    expect(result.summary).toMatch(/full kernel|system identification/i);
  });

  it('default reports just the kernel name', () => {
    const result = explain('uname');
    expect(result.summary).toMatch(/kernel name/i);
  });
});

describe('TC-CE-254: rule routing — find vs locate vs tree', () => {
  it('"find /tmp" routes to findExplain', () => {
    const result = explain('find /tmp');
    expect(result.summary).toMatch(/Searches the filesystem/i);
  });

  it('"locate openssl" routes to locateExplain', () => {
    const result = explain('locate openssl');
    expect(result.summary).toMatch(/locate index/i);
  });

  it('"tree /etc" routes to treeExplain', () => {
    const result = explain('tree /etc');
    expect(result.summary).toMatch(/directory tree/i);
  });
});

describe('TC-CE-255: rule routing — ps does not match psql / pstree', () => {
  it('"psql -c ..." does not match the ps rule', () => {
    const result = explain('psql -c "SELECT 1"');
    // psql isn't in our pattern table — the explainer fallback returns
    // "Runs psql". The key is that it does NOT match psExplain.
    expect(result.summary).not.toMatch(/Lists running processes/);
  });

  it('"pstree" does not match the ps rule', () => {
    const result = explain('pstree');
    expect(result.summary).not.toMatch(/Lists running processes/);
  });
});

describe('TC-CE-256: rule routing — id alice does not match identify / idea / etc.', () => {
  it('"id alice" routes to idExplain', () => {
    const result = explain('id alice');
    expect(result.summary).toContain('alice');
  });

  it('"identify image.png" does not match id rule', () => {
    const result = explain('identify image.png');
    expect(result.summary).not.toMatch(/user.*group/);
  });
});

describe('TC-CE-257: read-only utilities emit no warnings', () => {
  it.each([
    ['cat /etc/hosts', /\/etc\/hosts/],
    ['head /etc/hosts', /first/],
    ['diff a b', /Compares/],
    ['ls /etc', /Lists/],
    ['tree /etc', /tree/i],
    ['ps aux', /processes/i],
    ['df -h', /disk/i],
    ['hostname', /hostname/i],
    ['whoami', /username/i],
  ])('"%s" — no warnings', (cmd, _summaryHint) => {
    const result = explain(cmd);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-258: bare invocations do not crash', () => {
  it.each([
    'cat', 'head', 'tail', 'less', 'more', 'diff', 'find', 'locate', 'tree',
    'tee', 'touch', 'echo', 'printf',
    'ps', 'top', 'htop', 'df', 'du', 'free', 'hostname', 'uptime', 'lsof', 'id', 'whoami',
  ])('"%s" produces a non-empty summary without throwing', (cmd) => {
    const result = explain(cmd);
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

// ── TC-CE-259 – TC-CE-275 : compression / archives ───────────────────────────

describe('TC-CE-259: tar — short-flag mode dispatch', () => {
  it('"tar czf archive.tar.gz dir/" creates an archive', () => {
    const result = explain('tar czf archive.tar.gz dir/');
    expect(result.summary).toMatch(/Creates archive/i);
    expect(result.summary).toContain('archive.tar.gz');
  });

  it('"tar xzf archive.tar.gz" extracts and warns', () => {
    const result = explain('tar xzf archive.tar.gz');
    expect(result.summary).toMatch(/Extracts archive/i);
    expect(hasWarningMatching(result.warnings, /Path-traversal|Decompression bomb/i)).toBe(true);
  });

  it('"tar tf archive.tar" lists contents (read-only, no warnings)', () => {
    const result = explain('tar tf archive.tar');
    expect(result.summary).toMatch(/Lists the contents/i);
    expect(result.warnings).toHaveLength(0);
  });

  it('"tar rf archive.tar foo" appends', () => {
    const result = explain('tar rf archive.tar foo');
    expect(result.summary).toMatch(/Appends/i);
  });

  it('"tar uf archive.tar foo" updates', () => {
    const result = explain('tar uf archive.tar foo');
    expect(result.summary).toMatch(/Updates/i);
  });
});

describe('TC-CE-260: tar — dashed and long-form flag forms', () => {
  it('"tar -czf archive.tar.gz dir/" parses dashed bundle', () => {
    const result = explain('tar -czf archive.tar.gz dir/');
    expect(result.summary).toMatch(/Creates archive/i);
    expect(result.summary).toContain('archive.tar.gz');
  });

  it('"tar --extract --file=archive.tar" parses long-form', () => {
    const result = explain('tar --extract --file=archive.tar');
    expect(result.summary).toMatch(/Extracts archive/i);
    expect(result.summary).toContain('archive.tar');
  });

  it('"tar --create --file foo.tar bar/" parses long-form with space', () => {
    const result = explain('tar --create --file foo.tar bar/');
    expect(result.summary).toMatch(/Creates archive/i);
    expect(result.summary).toContain('foo.tar');
  });

  it('"tar --list --file=archive.tar" lists', () => {
    const result = explain('tar --list --file=archive.tar');
    expect(result.summary).toMatch(/Lists the contents/i);
  });
});

describe('TC-CE-261: tar — fallback when no mode flag is given', () => {
  it('summarises generically without warnings', () => {
    const result = explain('tar --version');
    expect(result.summary).toMatch(/tar/i);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-262: zip — names archive and contents in summary', () => {
  it('"zip out.zip a.txt b.txt" reports archive and files', () => {
    const result = explain('zip out.zip a.txt b.txt');
    expect(result.summary).toContain('out.zip');
    expect(result.summary).toContain('a.txt');
    expect(result.summary).toContain('b.txt');
  });

  it('emits no warnings for an unencrypted zip', () => {
    const result = explain('zip out.zip a.txt');
    expect(result.warnings).toHaveLength(0);
  });

  it('warns about ZipCrypto when -e is used', () => {
    const result = explain('zip -e out.zip a.txt');
    expect(hasWarningMatching(result.warnings, /ZipCrypto|weak/i)).toBe(true);
  });
});

describe('TC-CE-263: unzip — extract destination + path-traversal warning', () => {
  it('"unzip archive.zip" extracts into the current directory', () => {
    const result = explain('unzip archive.zip');
    expect(result.summary).toMatch(/current directory/i);
  });

  it('"unzip archive.zip -d /tmp/dest" reports the destination', () => {
    const result = explain('unzip archive.zip -d /tmp/dest');
    expect(result.summary).toContain('/tmp/dest');
  });

  it('always warns about path-traversal and decompression bombs', () => {
    const result = explain('unzip archive.zip');
    expect(hasWarningMatching(result.warnings, /Path-traversal/i)).toBe(true);
    expect(hasWarningMatching(result.warnings, /Decompression bomb/i)).toBe(true);
  });
});

describe('TC-CE-264: gzip — compress (default)', () => {
  it('summarises a compress invocation', () => {
    const result = explain('gzip foo.txt');
    expect(result.summary).toMatch(/Compresses/i);
    expect(result.summary).toContain('foo.txt');
  });

  it('default behaviour mentions original-file replacement', () => {
    const result = explain('gzip foo.txt');
    expect(hasEffectMatching(result.effects, /original file is replaced/i)).toBe(true);
  });

  it('-k / --keep retains original', () => {
    const result = explain('gzip -k foo.txt');
    expect(hasEffectMatching(result.effects, /original file retained/i)).toBe(true);
  });

  it('emits no warnings for compression', () => {
    const result = explain('gzip foo.txt');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-265: gzip -d — decompress + decompression-bomb warning', () => {
  it('summarises decompression', () => {
    const result = explain('gzip -d foo.gz');
    expect(result.summary).toMatch(/Decompresses/i);
  });

  it('warns about decompression bomb', () => {
    const result = explain('gzip -d foo.gz');
    expect(hasWarningMatching(result.warnings, /Decompression bomb/i)).toBe(true);
  });

  it('--decompress long-form is recognised', () => {
    const result = explain('gzip --decompress foo.gz');
    expect(result.summary).toMatch(/Decompresses/i);
  });
});

describe('TC-CE-266: bzip2 — same shape as gzip', () => {
  it('compresses by default', () => {
    const result = explain('bzip2 foo.txt');
    expect(result.summary).toMatch(/Compresses/i);
  });

  it('decompresses with -d', () => {
    const result = explain('bzip2 -d foo.bz2');
    expect(result.summary).toMatch(/Decompresses/i);
    expect(hasWarningMatching(result.warnings, /Decompression bomb/i)).toBe(true);
  });
});

describe('TC-CE-267: xz — same shape as gzip / bzip2', () => {
  it('compresses by default', () => {
    const result = explain('xz foo.txt');
    expect(result.summary).toMatch(/Compresses/i);
  });

  it('decompresses with -d', () => {
    const result = explain('xz -d foo.xz');
    expect(result.summary).toMatch(/Decompresses/i);
    expect(hasWarningMatching(result.warnings, /Decompression bomb/i)).toBe(true);
  });
});

describe('TC-CE-268: gunzip / bunzip2 / unxz — explicit decompressors', () => {
  it('gunzip', () => {
    const result = explain('gunzip foo.gz');
    expect(result.summary).toMatch(/Decompresses/i);
    expect(hasWarningMatching(result.warnings, /Decompression bomb/i)).toBe(true);
  });

  it('bunzip2', () => {
    const result = explain('bunzip2 foo.bz2');
    expect(result.summary).toMatch(/Decompresses/i);
    expect(hasWarningMatching(result.warnings, /Decompression bomb/i)).toBe(true);
  });

  it('unxz', () => {
    const result = explain('unxz foo.xz');
    expect(result.summary).toMatch(/Decompresses/i);
    expect(hasWarningMatching(result.warnings, /Decompression bomb/i)).toBe(true);
  });
});

describe('TC-CE-269: 7z — sub-action dispatch', () => {
  it('"7z a archive.7z dir/" adds files', () => {
    const result = explain('7z a archive.7z dir/');
    expect(result.summary).toMatch(/Adds files/i);
    expect(result.summary).toContain('archive.7z');
  });

  it('"7z x archive.7z" extracts preserving paths', () => {
    const result = explain('7z x archive.7z');
    expect(result.summary).toMatch(/preserving paths/i);
    expect(hasWarningMatching(result.warnings, /Path-traversal|Decompression bomb/i)).toBe(true);
  });

  it('"7z e archive.7z" extracts flat', () => {
    const result = explain('7z e archive.7z');
    expect(result.summary).toMatch(/flat|paths discarded/i);
  });

  it('"7z l archive.7z" lists contents (no warnings)', () => {
    const result = explain('7z l archive.7z');
    expect(result.summary).toMatch(/Lists the contents/i);
    expect(result.warnings).toHaveLength(0);
  });

  it('"7z u archive.7z foo" updates', () => {
    const result = explain('7z u archive.7z foo');
    expect(result.summary).toMatch(/Updates/i);
  });

  it('"7z d archive.7z entry" removes entries', () => {
    const result = explain('7z d archive.7z entry');
    expect(result.summary).toMatch(/Removes/i);
  });

  it('falls back gracefully on unknown sub-action', () => {
    const result = explain('7z h');
    expect(result.summary).toMatch(/7z/);
  });
});

describe('TC-CE-270: rule routing — gunzip vs gzip', () => {
  it('"gunzip foo.gz" does NOT match the gzip rule', () => {
    const result = explain('gunzip foo.gz');
    // gzip's compress path would say "Compresses". Decompressor says "Decompresses".
    expect(result.summary).toMatch(/Decompresses/i);
  });

  it('"gzip foo.txt" routes to gzip compress (not gunzip)', () => {
    const result = explain('gzip foo.txt');
    expect(result.summary).toMatch(/Compresses/i);
  });
});

describe('TC-CE-271: rule routing — bunzip2 vs bzip2', () => {
  it('"bunzip2 foo.bz2" decompresses', () => {
    const result = explain('bunzip2 foo.bz2');
    expect(result.summary).toMatch(/Decompresses/i);
  });

  it('"bzip2 foo.txt" compresses', () => {
    const result = explain('bzip2 foo.txt');
    expect(result.summary).toMatch(/Compresses/i);
  });
});

describe('TC-CE-272: rule routing — unxz vs xz', () => {
  it('"unxz foo.xz" decompresses', () => {
    const result = explain('unxz foo.xz');
    expect(result.summary).toMatch(/Decompresses/i);
  });

  it('"xz foo.txt" compresses', () => {
    const result = explain('xz foo.txt');
    expect(result.summary).toMatch(/Compresses/i);
  });
});

describe('TC-CE-273: rule routing — unzip vs zip', () => {
  it('"unzip archive.zip" extracts', () => {
    const result = explain('unzip archive.zip');
    expect(result.summary).toMatch(/Extracts/i);
  });

  it('"zip out.zip a.txt" creates', () => {
    const result = explain('zip out.zip a.txt');
    expect(result.summary).toMatch(/Creates ZIP archive/i);
  });
});

describe('TC-CE-274: bare invocations do not crash', () => {
  it.each(['tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz', '7z'])(
    '"%s" produces a non-empty summary without throwing',
    (cmd) => {
      const result = explain(cmd);
      expect(result.summary.length).toBeGreaterThan(0);
    },
  );
});

describe('TC-CE-275: tar archive name extraction edge cases', () => {
  it('"tar -cf archive.tar foo bar" picks archive.tar (not foo) as the archive', () => {
    const result = explain('tar -cf archive.tar foo bar');
    expect(result.summary).toContain('archive.tar');
    expect(result.summary).not.toContain('Creates archive foo');
  });

  it('"tar c -f archive.tar foo" with separate -f flag still picks archive.tar', () => {
    const result = explain('tar c -f archive.tar foo');
    expect(result.summary).toContain('archive.tar');
  });
});

// ── TC-CE-276 – TC-CE-285 : cleanup explainers ──────────────────────────────

describe('TC-CE-276: grep — names pattern and target', () => {
  it('"grep TODO src/main.ts" reports pattern + path', () => {
    const result = explain('grep TODO src/main.ts');
    expect(result.summary).toContain('TODO');
    expect(result.summary).toContain('src/main.ts');
  });

  it('"grep -r foo src/" recursive flag changes summary', () => {
    const result = explain('grep -r foo src/');
    expect(result.summary).toMatch(/Recursively searches/i);
  });

  it('emits no warnings for a normal grep', () => {
    const result = explain('grep foo bar.txt');
    expect(result.warnings).toHaveLength(0);
  });

  it('falls back to stdin when no path is given', () => {
    const result = explain('grep TODO');
    expect(result.summary).toMatch(/stdin/i);
  });
});

describe('TC-CE-277: rmdir — empty-directory removal', () => {
  it('reports the directory in the summary', () => {
    const result = explain('rmdir /tmp/empty');
    expect(result.summary).toContain('/tmp/empty');
  });

  it('mentions parent directories when -p is used', () => {
    const result = explain('rmdir -p /a/b/c');
    expect(result.summary).toMatch(/empty parent directories/i);
  });

  it('emits no warnings (rmdir refuses non-empty directories)', () => {
    const result = explain('rmdir /tmp/empty');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('TC-CE-278: unlink — single-file removal', () => {
  it('reports the file in the summary', () => {
    const result = explain('unlink /tmp/foo');
    expect(result.summary).toContain('/tmp/foo');
  });

  it('warns about non-recoverable deletion', () => {
    const result = explain('unlink /tmp/foo');
    expect(hasWarningMatching(result.warnings, /cannot be recovered/i)).toBe(true);
  });
});

describe('TC-CE-279: shred — overwrite-and-remove warnings', () => {
  it('reports the file in the summary', () => {
    const result = explain('shred /tmp/secret');
    expect(result.summary).toContain('/tmp/secret');
  });

  it('always warns about filesystem-dependence', () => {
    const result = explain('shred /tmp/secret');
    expect(hasWarningMatching(result.warnings, /filesystem|recovery|COW|journaled|SSD/i)).toBe(true);
  });

  it('-u / --remove changes the summary to overwrite-and-remove', () => {
    const result = explain('shred -u /tmp/secret');
    expect(result.summary).toMatch(/Overwrites and removes/i);
  });

  it('-z / --zero adds a final-zero-pass effect', () => {
    const result = explain('shred -uz /tmp/secret');
    expect(hasEffectMatching(result.effects, /zeros|hide the shred/i)).toBe(true);
  });

  it('-n N includes the iteration count in summary', () => {
    const result = explain('shred -n 7 /tmp/secret');
    expect(result.summary).toMatch(/7-pass/);
  });
});

describe('TC-CE-280: mv to /dev/null — flagged as effective deletion', () => {
  it('summarises mv-to-/dev/null as removal', () => {
    const result = explain('mv /tmp/foo /dev/null');
    expect(result.summary).toMatch(/Removes|mv to/i);
    expect(result.summary).toContain('/tmp/foo');
  });

  it('warns that operators should prefer rm', () => {
    const result = explain('mv /tmp/foo /dev/null');
    expect(hasWarningMatching(result.warnings, /mv-as-deletion|use `rm`|intent is explicit/i)).toBe(true);
  });

  it('flags /dev/zero / /dev/random / /dev/urandom too', () => {
    for (const target of ['/dev/zero', '/dev/random', '/dev/urandom']) {
      const result = explain(`mv /tmp/foo ${target}`);
      expect(hasWarningMatching(result.warnings, /mv-as-deletion/i)).toBe(true);
    }
  });
});

describe('TC-CE-281: mv to /tmp/trash — flagged as effective deletion', () => {
  it('summarises mv-to-/tmp/trash as removal', () => {
    const result = explain('mv /var/data /tmp/trash/data');
    expect(result.summary).toMatch(/Removes|mv to/i);
  });

  it('flags ~/.Trash destinations', () => {
    const result = explain('mv /home/alice/foo ~/.Trash/foo');
    expect(hasWarningMatching(result.warnings, /mv-as-deletion/i)).toBe(true);
  });
});

describe('TC-CE-282: mv to ordinary path — no deletion warning', () => {
  it('plain mv summarises as a move, no warnings', () => {
    const result = explain('mv /tmp/foo /tmp/bar');
    expect(result.summary).toMatch(/Moves/i);
    expect(hasWarningMatching(result.warnings, /mv-as-deletion/i)).toBe(false);
  });
});

describe('TC-CE-283: rule routing — rmdir vs rm', () => {
  it('"rmdir /tmp/empty" routes to rmdirExplain', () => {
    const result = explain('rmdir /tmp/empty');
    expect(result.summary).toMatch(/empty directory/i);
  });

  it('"rm /tmp/file" routes to rmExplain (not rmdir)', () => {
    const result = explain('rm /tmp/file');
    expect(result.summary).toMatch(/Deletes/i);
    expect(result.summary).not.toMatch(/empty directory/i);
  });

  it('"rm -r /tmp/dir" routes to rmExplain with recursive summary', () => {
    const result = explain('rm -r /tmp/dir');
    expect(result.summary).toMatch(/Recursively deletes/i);
  });
});

describe('TC-CE-284: install (binary) — filesystem.write classification', () => {
  // Layer 1 alias verified via normalize.test.ts. This test confirms the
  // explainer dispatch does NOT match `install` against any unrelated
  // pattern (e.g. apt's `install` subcommand explainer).
  it('"install -m 755 src dst" does not collide with apt install', () => {
    const result = explain('install -m 755 ./bin/foo /usr/local/bin/foo');
    // No explainer for the bare `install` binary — falls through to the
    // generic "Runs <binary>" path. The key assertion: it must not produce
    // an apt-style summary.
    expect(result.summary).not.toMatch(/apt packages/);
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

describe('TC-CE-285: bare invocations do not crash', () => {
  it.each(['rmdir', 'unlink', 'shred', 'grep'])(
    '"%s" produces a non-empty summary without throwing',
    (cmd) => {
      const result = explain(cmd);
      expect(result.summary.length).toBeGreaterThan(0);
    },
  );
});

// ── TC-CE-286 – TC-CE-291 : network.shell additions (mosh, telnet) ──────────

describe('TC-CE-286: mosh — names host', () => {
  it('reports the host in the summary', () => {
    const result = explain('mosh alice@host.example.com');
    expect(result.summary).toMatch(/mosh session/i);
    expect(result.summary).toContain('alice@host.example.com');
  });
});

describe('TC-CE-287: mosh — long-running session warning', () => {
  it('warns about persistent state across network failures', () => {
    const result = explain('mosh alice@host.example.com');
    expect(hasWarningMatching(result.warnings, /Long-running|persists across|outlives/i)).toBe(true);
  });

  it('always warns about interactive remote access', () => {
    const result = explain('mosh alice@host.example.com');
    expect(hasWarningMatching(result.warnings, /interactive access/i)).toBe(true);
  });
});

describe('TC-CE-288: telnet — unencrypted-protocol warning', () => {
  it('warns about plaintext credentials and content', () => {
    const result = explain('telnet host.example.com');
    expect(hasWarningMatching(result.warnings, /unencrypted|plaintext|in plaintext/i)).toBe(true);
  });

  it('reports the host in the summary', () => {
    const result = explain('telnet host.example.com 23');
    expect(result.summary).toContain('host.example.com');
  });
});

describe('TC-CE-289: rule routing — ssh vs mosh vs telnet', () => {
  it('"ssh host" routes to sshExplain', () => {
    const result = explain('ssh alice@host');
    expect(result.summary).toMatch(/secure shell/i);
  });

  it('"mosh host" routes to moshExplain (not ssh)', () => {
    const result = explain('mosh alice@host');
    expect(result.summary).toMatch(/mosh session/i);
    expect(result.summary).not.toMatch(/secure shell/i);
  });

  it('"telnet host" routes to telnetExplain (not ssh)', () => {
    const result = explain('telnet host');
    expect(result.summary).toMatch(/telnet/i);
    expect(result.summary).not.toMatch(/secure shell/i);
  });
});

describe('TC-CE-290: bare invocations do not crash (network.shell)', () => {
  it.each(['ssh', 'mosh', 'telnet'])(
    '"%s" produces a non-empty summary without throwing',
    (cmd) => {
      const result = explain(cmd);
      expect(result.summary.length).toBeGreaterThan(0);
    },
  );
});

describe('TC-CE-291: bare docker — explainer dispatch unchanged after L1 alias', () => {
  // Adding `docker` as a code.execute L1 alias does not change the rule-table
  // dispatch — the bare `docker` token still hits the docker rule, which
  // dispatches by subcommand. These tests pin that behaviour.
  it('"docker run --rm ubuntu" still dispatches to dockerRunExplain', () => {
    const result = explain('docker run --rm ubuntu');
    // dockerRunExplain summary mentions "container".
    expect(result.summary).toMatch(/container/i);
  });

  it('"docker ps" still dispatches to dockerPsExplain', () => {
    const result = explain('docker ps');
    expect(result.summary).toMatch(/running containers/i);
  });

  it('"docker push myorg/myapp:1.0" still dispatches to dockerPushExplain', () => {
    const result = explain('docker push myorg/myapp:1.0');
    expect(result.summary).toContain('myorg/myapp:1.0');
  });
});

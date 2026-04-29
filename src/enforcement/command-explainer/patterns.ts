/**
 * Command explainer pattern rules.
 *
 * Produces structured explanations (summary, effects, warnings) for common
 * developer commands observed in agent audit logs.  Each rule is matched
 * against the raw command string; when a rule fires, a context-aware
 * summary and any applicable warnings are returned to the caller.
 *
 * Detector functions always receive `args` where `args[0]` is the
 * subcommand token.  All detectors call `args.slice(1)` internally to
 * obtain the flag/argument list.
 *
 * @module
 */

// ── Public types ───────────────────────────────────────────────────────────────

/** Structured explanation produced by {@link explain}. */
export interface ExplainResult {
  /** One-line sentence-case summary of what the command does. */
  summary: string;
  /** Observable side-effects (filesystem, network, registry, etc.). */
  effects: string[];
  /** Security or operational warnings applicable to this invocation. */
  warnings: string[];
}

// ── Private helpers ────────────────────────────────────────────────────────────

/** Splits a shell-like command string into tokens, respecting quoted groups. */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;

  for (const ch of command) {
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === ' ' && !inDouble && !inSingle) {
      if (current.length > 0) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** Returns tokens that do not start with `-` (positional arguments). */
function positionalArgs(tokens: string[]): string[] {
  return tokens.filter(t => !t.startsWith('-'));
}

// ── Git detectors ──────────────────────────────────────────────────────────────

function gitCommit(args: string[]): ExplainResult {
  const flags = args.slice(1);
  const warnings: string[] = [];
  if (flags.includes('--amend')) {
    warnings.push('--amend rewrites history — avoid on shared branches');
  }
  return {
    summary: 'Commits staged changes to the local repository',
    effects: ['Writes to .git'],
    warnings,
  };
}

function gitPush(args: string[]): ExplainResult {
  const rest = args.slice(1);
  const warnings: string[] = [];
  if (rest.includes('--force') || rest.includes('-f')) {
    warnings.push('Force push rewrites remote history');
  }
  const pos = positionalArgs(rest);
  const remote = pos[0];
  const branch = pos[1];
  let summary = 'Pushes local commits to the remote repository';
  if (remote && branch) {
    summary = `Pushes local commits to ${remote}/${branch}`;
  } else if (remote) {
    summary = `Pushes local commits to ${remote}`;
  }
  return {
    summary,
    effects: ['Modifies remote branch'],
    warnings,
  };
}

function gitPull(args: string[]): ExplainResult {
  const rest = args.slice(1);
  const pos = positionalArgs(rest);
  const remote = pos[0];
  const branch = pos[1];
  let summary = 'Fetches and merges changes from the remote repository';
  if (remote && branch) {
    summary = `Fetches and merges changes from ${remote}/${branch}`;
  } else if (remote) {
    summary = `Fetches and merges changes from ${remote}`;
  }
  return { summary, effects: ['Modifies local branch'], warnings: [] };
}

function gitClone(args: string[]): ExplainResult {
  const rest = args.slice(1);
  const pos = positionalArgs(rest);
  const url = pos[0] ?? '<url>';
  return {
    summary: `Clones repository ${url} to a local directory`,
    effects: ['Creates a new directory'],
    warnings: [],
  };
}

function gitReset(args: string[]): ExplainResult {
  const flags = args.slice(1);
  const warnings: string[] = [];
  if (flags.includes('--hard')) {
    warnings.push('--hard discards all local uncommitted changes');
  }
  return {
    summary: 'Resets the current HEAD to the specified state',
    effects: ['Modifies repository state'],
    warnings,
  };
}

function gitMerge(args: string[]): ExplainResult {
  const rest = args.slice(1);
  const pos = positionalArgs(rest);
  const branch = pos[0] ?? '<branch>';
  return {
    summary: `Merges ${branch} into the current branch`,
    effects: ['Modifies current branch'],
    warnings: [],
  };
}

function gitExplain(args: string[]): ExplainResult {
  const sub = args[0];
  switch (sub) {
    case 'commit':   return gitCommit(args);
    case 'push':     return gitPush(args);
    case 'pull':     return gitPull(args);
    case 'clone':    return gitClone(args);
    case 'status':   return { summary: 'Shows the working tree status', effects: [], warnings: [] };
    case 'diff':     return { summary: 'Shows changes between commits, branches, or the working tree', effects: [], warnings: [] };
    case 'log':      return { summary: 'Shows the commit log', effects: [], warnings: [] };
    case 'merge':    return gitMerge(args);
    case 'reset':    return gitReset(args);
    case 'checkout': return { summary: 'Switches branches or restores working tree files', effects: ['Modifies working tree'], warnings: [] };
    case 'add':      return { summary: 'Stages changes for the next commit', effects: ['Modifies staging area'], warnings: [] };
    case 'stash':    return { summary: 'Stashes local modifications away', effects: ['Writes to .git/refs/stash'], warnings: [] };
    default:         return { summary: `Runs git ${sub ?? ''}`.trim(), effects: [], warnings: [] };
  }
}

// ── npm detectors ──────────────────────────────────────────────────────────────

function npmInstall(args: string[]): ExplainResult {
  const rest = args.slice(1);
  const pkgs = positionalArgs(rest);
  const summary = pkgs.length > 0
    ? `Installs node packages: ${pkgs.join(', ')}`
    : 'Installs node dependencies';
  return {
    summary,
    effects: ['Modifies node_modules', 'Modifies package-lock.json'],
    warnings: [],
  };
}

function npmRun(args: string[]): ExplainResult {
  const rest = args.slice(1);
  const script = positionalArgs(rest)[0] ?? '<script>';
  return {
    summary: `Runs the ${script} npm script`,
    effects: [],
    warnings: ['Executes arbitrary shell commands defined in package.json'],
  };
}

function npmExplain(args: string[]): ExplainResult {
  const sub = args[0];
  switch (sub) {
    case 'install':
    case 'i':
      return npmInstall(args);
    case 'run':
    case 'run-script':
      return npmRun(args);
    case 'publish':
      return {
        summary: 'Publishes the package to the npm registry',
        effects: ['Creates a remote package entry'],
        warnings: ['Publishes package to npm — version cannot be unpublished'],
      };
    case 'uninstall':
    case 'rm':
    case 'remove':
      return {
        summary: 'Uninstalls node packages',
        effects: ['Modifies node_modules', 'Modifies package-lock.json'],
        warnings: [],
      };
    case 'ci':
      return {
        summary: 'Installs a clean dependency tree from package-lock.json',
        effects: ['Replaces node_modules'],
        warnings: [],
      };
    case 'audit':
      return {
        summary: 'Audits installed packages for known vulnerabilities',
        effects: [],
        warnings: [],
      };
    default:
      return { summary: `Runs npm ${sub ?? ''}`.trim(), effects: [], warnings: [] };
  }
}

// ── pip detectors ──────────────────────────────────────────────────────────────

function pipInstall(args: string[]): ExplainResult {
  // args[0] = 'install', args.slice(1) = flags + package names
  const rest = args.slice(1);
  const pos = positionalArgs(rest);

  // Check for -r / --requirement flag (requirements file)
  const reqIdx = rest.findIndex(t => t === '-r' || t === '--requirement');
  if (reqIdx !== -1) {
    const reqFile = rest[reqIdx + 1] ?? '<file>';
    return {
      summary: `Installs Python packages from ${reqFile}`,
      effects: ['Installs packages into the Python environment'],
      warnings: [],
    };
  }

  const summary = pos.length > 0
    ? `Installs Python packages: ${pos.join(', ')}`
    : 'Installs Python packages';
  return {
    summary,
    effects: ['Installs packages into the Python environment'],
    warnings: [],
  };
}

// ── pytest detectors ───────────────────────────────────────────────────────────

function pytestExplain(args: string[]): ExplainResult {
  // args does not include 'pytest' binary — these are the remaining tokens
  const pos = positionalArgs(args);
  const summary = pos.length > 0
    ? `Runs tests in ${pos.join(', ')}`
    : 'Runs the test suite';
  return { summary, effects: [], warnings: [] };
}

// ── Docker detectors ───────────────────────────────────────────────────────────

/**
 * Checks whether a `-v` / `--volume` flag value mounts the host root
 * filesystem into the container (e.g. `/:/host` or `/:any`).
 */
function hasRootVolumeMount(rest: string[]): boolean {
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    // Handle both `-v /:/host` (two tokens) and `--volume=/:/host` (one token)
    let mountSpec: string | undefined;
    if ((tok === '-v' || tok === '--volume') && i + 1 < rest.length) {
      mountSpec = rest[i + 1];
    } else if (tok.startsWith('--volume=')) {
      mountSpec = tok.slice('--volume='.length);
    }
    if (mountSpec !== undefined && /^\/:/.test(mountSpec)) {
      return true;
    }
  }
  return false;
}

function dockerRunExplain(args: string[]): ExplainResult {
  // args[0] = 'run', args.slice(1) = options + image + [command…]
  const rest = args.slice(1);
  const image = positionalArgs(rest)[0] ?? '<image>';
  const warnings: string[] = [];

  if (hasRootVolumeMount(rest)) {
    warnings.push('Mounts host root filesystem into the container (full disk access)');
  }
  if (rest.includes('--privileged')) {
    warnings.push('Grants extended kernel capabilities to the container (privileged mode)');
  }

  return {
    summary: `Runs a container from image ${image}`,
    effects: ['Starts a container process'],
    warnings,
  };
}

function dockerBuildExplain(args: string[]): ExplainResult {
  // args[0] = 'build', args.slice(1) = options + context
  const rest = args.slice(1);
  const context = positionalArgs(rest)[0] ?? '.';
  return {
    summary: `Builds a Docker image from context ${context}`,
    effects: ['Writes image layers to the local Docker daemon'],
    warnings: [],
  };
}

function dockerExecExplain(args: string[]): ExplainResult {
  // args[0] = 'exec', args.slice(1) = options + container + command…
  const rest = args.slice(1);
  const container = positionalArgs(rest)[0] ?? '<container>';
  const effects: string[] = ['Runs a process inside a running container'];

  // Detect `bash -c` / `sh -c` anywhere in the token list after exec.
  // Check the raw token list (not positional-only) so the `-c` flag is visible.
  for (let i = 0; i < rest.length - 1; i++) {
    const tok = rest[i]!;
    if ((tok === 'bash' || tok === 'sh') && rest[i + 1] === '-c') {
      effects.push('Executes an inline shell script inside the container');
      break;
    }
  }

  return {
    summary: `Executes a command in container ${container}`,
    effects,
    warnings: ['Provides direct access to a running container environment'],
  };
}

function dockerPushExplain(args: string[]): ExplainResult {
  // args[0] = 'push', positional[0] = image[:tag]
  const positional = positionalArgs(args.slice(1));
  const image = positional[0] ?? '<image>';
  const allTags = args.includes('-a') || args.includes('--all-tags');
  return {
    summary: allTags
      ? `Pushes every tag of ${image} to the registry`
      : `Pushes ${image} to the registry`,
    effects: ['Uploads a container image to a remote registry'],
    warnings: [
      'Image upload — secrets baked into the image (env vars, credentials, source code) become visible to anyone with registry read access',
      ...(allTags ? ['--all-tags pushes every tag of the named repository'] : []),
    ],
  };
}

function dockerPsExplain(args: string[]): ExplainResult {
  const showAll = args.includes('-a') || args.includes('--all');
  return {
    summary: showAll ? 'Lists every container (running and stopped)' : 'Lists running containers',
    effects: ['Reads the local container engine state'],
    warnings: [],
  };
}

function dockerExplain(args: string[]): ExplainResult {
  const sub = args[0];
  switch (sub) {
    case 'run':   return dockerRunExplain(args);
    case 'build': return dockerBuildExplain(args);
    case 'exec':  return dockerExecExplain(args);
    case 'push':  return dockerPushExplain(args);
    case 'ps':    return dockerPsExplain(args);
    default:      return { summary: `Runs docker ${sub ?? ''}`.trim(), effects: [], warnings: [] };
  }
}

// ── make detectors ─────────────────────────────────────────────────────────────

function makeExplain(args: string[]): ExplainResult {
  const target = positionalArgs(args)[0];
  const summary = target
    ? `Runs the '${target}' make target`
    : 'Runs the default make target';
  return {
    summary,
    effects: ['Executes commands defined in the Makefile'],
    warnings: [],
  };
}

// ── cargo detectors ────────────────────────────────────────────────────────────

function cargoBuild(args: string[]): ExplainResult {
  const rest = args.slice(1);
  const isWorkspace = rest.includes('--workspace') || rest.includes('--all');
  return {
    summary: isWorkspace
      ? 'Compiles all Rust workspace members'
      : 'Compiles the Rust project',
    effects: ['Writes compiled artifacts to target/'],
    warnings: [],
  };
}

function cargoTest(args: string[]): ExplainResult {
  const rest = args.slice(1);
  const filter = positionalArgs(rest)[0];
  const summary = filter
    ? `Compiles and runs Rust tests matching '${filter}'`
    : 'Compiles and runs the Rust test suite';
  return {
    summary,
    effects: ['Writes test artifacts to target/'],
    warnings: [],
  };
}

function cargoExplain(args: string[]): ExplainResult {
  const sub = args[0];
  switch (sub) {
    case 'build': return cargoBuild(args);
    case 'test':  return cargoTest(args);
    default:      return { summary: `Runs cargo ${sub ?? ''}`.trim(), effects: [], warnings: [] };
  }
}

// ── go detectors ───────────────────────────────────────────────────────────────

function goBuild(args: string[]): ExplainResult {
  const rest = args.slice(1);
  const pkg = positionalArgs(rest)[0];
  const summary = pkg
    ? `Compiles Go packages in ${pkg}`
    : 'Compiles Go packages in the current module';
  return {
    summary,
    effects: ['Writes compiled binary to the working directory'],
    warnings: [],
  };
}

function goTest(args: string[]): ExplainResult {
  const rest = args.slice(1);
  const pkg = positionalArgs(rest)[0];
  const summary = pkg
    ? `Runs Go tests in ${pkg}`
    : 'Runs the Go test suite';
  return { summary, effects: [], warnings: [] };
}

function goExplain(args: string[]): ExplainResult {
  const sub = args[0];
  switch (sub) {
    case 'build': return goBuild(args);
    case 'test':  return goTest(args);
    default:      return { summary: `Runs go ${sub ?? ''}`.trim(), effects: [], warnings: [] };
  }
}

// ── eslint detectors ───────────────────────────────────────────────────────────

function eslintExplain(args: string[]): ExplainResult {
  const fixMode = args.includes('--fix');
  const paths = positionalArgs(args);
  const target = paths.length > 0 ? paths.join(', ') : 'the project';
  const summary = fixMode
    ? `Lints and auto-fixes code in ${target}`
    : `Lints code in ${target}`;
  const effects: string[] = fixMode ? ['Modifies source files in place'] : [];
  return { summary, effects, warnings: [] };
}

// ── prettier detectors ─────────────────────────────────────────────────────────

function prettierExplain(args: string[]): ExplainResult {
  const writeMode = args.includes('--write');
  const checkMode = args.includes('--check');
  const paths = positionalArgs(args);
  const target = paths.length > 0 ? paths.join(', ') : 'the project';
  let summary: string;
  if (writeMode) {
    summary = `Formats source files in ${target}`;
  } else if (checkMode) {
    summary = `Checks formatting of files in ${target}`;
  } else {
    summary = `Runs Prettier on ${target}`;
  }
  const effects: string[] = writeMode ? ['Modifies source files in place'] : [];
  return { summary, effects, warnings: [] };
}

// ── File system detectors ──────────────────────────────────────────────────────

function rmExplain(args: string[]): ExplainResult {
  const isRecursive = args.some(t =>
    t === '-r' || t === '-R' || t === '--recursive' ||
    (/^-[a-zA-Z]+$/.test(t) && (t.includes('r') || t.includes('R'))),
  );
  const isForce = args.some(t =>
    t === '-f' || t === '--force' ||
    (/^-[a-zA-Z]+$/.test(t) && t.includes('f')),
  );
  const paths = positionalArgs(args);
  const target = paths.length > 0 ? paths.join(', ') : 'files';
  const summary = isRecursive ? `Recursively deletes ${target}` : `Deletes ${target}`;
  const warnings: string[] = ['Deleted files cannot be recovered from the trash'];
  if (isRecursive) warnings.push('-r flag removes entire directory trees');
  if (isForce)     warnings.push('-f flag suppresses confirmation prompts');
  return { summary, effects: ['Removes files from the filesystem permanently'], warnings };
}

function cpExplain(args: string[]): ExplainResult {
  const isRecursive = args.some(t => t === '-r' || t === '-R' || t === '--recursive');
  const pos = positionalArgs(args);
  const src = pos[0] ?? '<source>';
  const dst = pos.length > 1 ? pos[pos.length - 1]! : '<destination>';
  return {
    summary: isRecursive
      ? `Recursively copies ${src} to ${dst}`
      : `Copies ${src} to ${dst}`,
    effects: ['Creates or overwrites files at destination'],
    warnings: [],
  };
}

function mvExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const src = pos[0] ?? '<source>';
  const dst = pos.length > 1 ? pos[pos.length - 1]! : '<destination>';

  // Detect mv-as-deletion patterns: /dev/null, /dev/zero, or any path
  // under a recognised throwaway directory (/tmp/trash, ~/.Trash).
  const isDeletionDestination = (path: string): boolean => {
    if (/^\/dev\/(null|zero|random|urandom)$/.test(path)) return true;
    if (/^\/tmp\/trash(\/|$)/.test(path)) return true;
    if (/^~?\/?\.Trash(\/|$)/.test(path)) return true;
    return false;
  };

  if (isDeletionDestination(dst)) {
    return {
      summary: `Removes ${src} (mv to ${dst})`,
      effects: ['Effectively deletes the source — destination discards content'],
      warnings: [
        'mv-as-deletion — operators may want to use `rm` instead so the intent is explicit in audit logs',
      ],
    };
  }

  return {
    summary: `Moves ${src} to ${dst}`,
    effects: ['Relocates or renames files on the filesystem', 'May overwrite destination if it exists'],
    warnings: [],
  };
}

// ── Additional file-utility explainers (grep / rmdir / unlink / shred) ────

function grepExplain(args: string[]): ExplainResult {
  const isRecursive = args.some(a => a === '-r' || a === '-R' || a === '--recursive');
  // First non-flag positional is the pattern; subsequent ones are paths.
  const positional = positionalArgs(args);
  const pattern = positional[0] ?? '<pattern>';
  const paths = positional.slice(1);
  const target = paths.length > 0 ? paths.join(', ') : (isRecursive ? '.' : 'stdin');

  return {
    summary: isRecursive
      ? `Recursively searches for '${pattern}' in ${target}`
      : `Searches for '${pattern}' in ${target}`,
    effects: ['Reads files and matches them against the pattern'],
    warnings: [],
  };
}

function rmdirExplain(args: string[]): ExplainResult {
  const paths = positionalArgs(args);
  const target = paths.length > 0 ? paths.join(', ') : '<directory>';
  const isParents = args.includes('-p') || args.includes('--parents');
  return {
    summary: isParents
      ? `Removes empty directory ${target} and its empty parent directories`
      : `Removes empty directory ${target}`,
    effects: ['Removes a directory only if it contains no files'],
    warnings: [],
  };
}

function unlinkExplain(args: string[]): ExplainResult {
  const paths = positionalArgs(args);
  const target = paths[0] ?? '<file>';
  return {
    summary: `Removes the link ${target}`,
    effects: ['Removes a single file or symlink (does not recurse)'],
    warnings: ['Removed files cannot be recovered from the trash'],
  };
}

function shredExplain(args: string[]): ExplainResult {
  const paths = positionalArgs(args);
  const target = paths.length > 0 ? paths.join(', ') : '<file>';
  // Flag detection handles both standalone (`-u`) and bundled (`-uz`) forms.
  const hasFlag = (ch: string, longForm?: string): boolean =>
    args.some(t =>
      t === `-${ch}` ||
      (longForm !== undefined && t === longForm) ||
      (/^-[a-zA-Z]+$/.test(t) && t.includes(ch)),
    );
  const isUnlink = hasFlag('u', '--remove');
  const isZero = hasFlag('z', '--zero');
  const nIdx = args.findIndex(a => a === '-n' || a === '--iterations');
  const iterations = nIdx >= 0 ? args[nIdx + 1] : undefined;

  const passes = iterations !== undefined ? `${iterations}-pass ` : '';
  const summary = isUnlink
    ? `Overwrites and removes ${target} (${passes}shred)`.replace(' ()', '')
    : `Overwrites ${target} in place (${passes}shred)`.replace(' ()', '');

  const effects = ['Repeatedly writes random data over the file contents to defeat recovery'];
  if (isUnlink) effects.push('Removes the file after overwriting');
  if (isZero) effects.push('Final pass writes zeros to hide the shred operation');

  return {
    summary,
    effects,
    warnings: [
      'shred relies on assumptions about the underlying filesystem — overwrite may not defeat recovery on COW / journaled / SSD-wear-levelled storage',
    ],
  };
}

function chmodExplain(args: string[]): ExplainResult {
  const isRecursive = args.some(t => t === '-R' || t === '--recursive');
  const pos = positionalArgs(args);
  const mode = pos[0] ?? '<mode>';
  const path = pos[1] ?? '<path>';
  const summary = isRecursive
    ? `Recursively changes permissions of ${path} to ${mode}`
    : `Changes permissions of ${path} to ${mode}`;
  const warnings: string[] = [];
  if (mode === '777' || mode === '0777') {
    warnings.push('World-writable permissions (777) are a security risk');
  }
  return { summary, effects: ['Modifies file access permissions'], warnings };
}

function chownExplain(args: string[]): ExplainResult {
  const isRecursive = args.some(t => t === '-R' || t === '--recursive');
  const pos = positionalArgs(args);
  const ownerSpec = pos[0] ?? '<owner>';
  const path = pos[1] ?? '<path>';
  const warnings: string[] = [];
  if (path === '/' || path.startsWith('/etc') || path.startsWith('/usr')) {
    warnings.push(`Modifying ownership under ${path} can lock out system services`);
  }
  if (ownerSpec === 'root' || ownerSpec.startsWith('root:')) {
    warnings.push('Granting root ownership — file becomes editable only by root');
  }
  return {
    summary: isRecursive
      ? `Recursively changes ownership of ${path} to ${ownerSpec}`
      : `Changes ownership of ${path} to ${ownerSpec}`,
    effects: ['Modifies file ownership (user/group)'],
    warnings,
  };
}

function umaskExplain(args: string[]): ExplainResult {
  const mask = args[0];
  if (mask === undefined) {
    return {
      summary: 'Shows the current umask',
      effects: [],
      warnings: [],
    };
  }
  const warnings: string[] = [];
  if (mask === '000') {
    warnings.push('umask 000 makes all newly-created files world-writable by default');
  }
  return {
    summary: `Sets the umask to ${mask}`,
    effects: ['Changes default permission mask for new files'],
    warnings,
  };
}

function sudoExplain(args: string[]): ExplainResult {
  // `sudo -u user cmd args...` or `sudo cmd args...`
  let i = 0;
  let targetUser = 'root';
  // Skip flags before the wrapped command. -u takes an argument.
  while (i < args.length && args[i]!.startsWith('-')) {
    if (args[i] === '-u' || args[i] === '--user') {
      const next = args[i + 1];
      if (next !== undefined) {
        targetUser = next;
        i += 2;
        continue;
      }
    }
    i += 1;
  }
  const wrappedCmd = args.slice(i).join(' ').trim();
  const warnings = ['Privilege elevation — wrapped command runs as a different user'];
  if (targetUser === 'root') {
    warnings.push('Target user is root — full administrative access');
  }
  return {
    summary: wrappedCmd.length > 0
      ? `Runs '${wrappedCmd}' as ${targetUser}`
      : `Switches privilege to ${targetUser}`,
    effects: ['Elevates privilege for the wrapped command'],
    warnings,
  };
}

function suExplain(args: string[]): ExplainResult {
  // `su -` (login shell as root), `su user`, `su - user`, `su -c 'cmd' user`
  const flags = args.filter(a => a.startsWith('-') && a !== '-');
  const isLoginShell = args.includes('-') || flags.includes('-l') || flags.includes('--login');
  const cIdx = args.findIndex(a => a === '-c' || a === '--command');
  const wrappedCmd = cIdx >= 0 ? args[cIdx + 1] : undefined;
  // When -c is absent we must NOT exclude index 0 (which would falsely match
  // `cIdx + 1` when cIdx is -1).
  const cmdArgIdx = cIdx >= 0 ? cIdx + 1 : -1;
  const positional = args.filter((a, idx) => !a.startsWith('-') && a !== '-' && idx !== cmdArgIdx);
  const targetUser = positional[0] ?? 'root';

  const warnings = ['Privilege elevation — opens a shell as a different user'];
  if (targetUser === 'root') {
    warnings.push('Target user is root — full administrative access');
  }

  let summary: string;
  if (wrappedCmd !== undefined) {
    summary = `Runs '${wrappedCmd}' as ${targetUser}`;
  } else if (isLoginShell) {
    summary = `Opens a login shell as ${targetUser}`;
  } else {
    summary = `Switches user to ${targetUser}`;
  }

  return {
    summary,
    effects: ['Switches the current user / opens a privileged shell'],
    warnings,
  };
}

function passwdExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const target = pos[0];
  const warnings = ['Credential change — affects authentication'];
  if (target === 'root' || target === undefined) {
    warnings.push('Changing the root password — coordinate with operators before proceeding');
  }
  return {
    summary: target !== undefined
      ? `Changes the password for ${target}`
      : 'Changes the current user’s password',
    effects: ['Writes to /etc/shadow (or equivalent credential store)'],
    warnings,
  };
}

// ── Process signal helpers ─────────────────────────────────────────────────────

/**
 * Parses a kill-style argument list into a signal name and a list of targets.
 *
 * `kill` accepts negative-PID targets (`-1` = broadcast, `-1234` = process
 * group), so a naive "anything starting with `-` is a flag" rule wrongly
 * eats them. Rule used here:
 *
 *   1. The FIRST signal-shaped token (`-9`, `-KILL`, `-s KILL`,
 *      `--signal=KILL`) is consumed as the signal.
 *   2. After `--`, every token is a target.
 *   3. Any subsequent `-<number>` token is treated as a target (negative
 *      PID), not a second signal.
 *
 * Returns the signal name (without `SIG` prefix, e.g. `'KILL'` or `'9'`),
 * or `undefined` when none is present.
 */
function parseKillArgs(args: string[]): { signal: string | undefined; targets: string[] } {
  let signal: string | undefined;
  let signalConsumed = false;
  let afterDoubleDash = false;
  const targets: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (afterDoubleDash) {
      targets.push(a);
      continue;
    }
    if (a === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (!signalConsumed) {
      if (a === '-s' || a === '--signal') {
        const next = args[i + 1];
        if (next !== undefined) {
          signal = next.replace(/^SIG/i, '');
          signalConsumed = true;
          i += 1;
          continue;
        }
      }
      if (a.startsWith('--signal=')) {
        signal = a.slice('--signal='.length).replace(/^SIG/i, '');
        signalConsumed = true;
        continue;
      }
      if (/^-[A-Z]+$/.test(a)) {
        signal = a.slice(1).replace(/^SIG/i, '');
        signalConsumed = true;
        continue;
      }
      if (/^-\d+$/.test(a)) {
        signal = a.slice(1);
        signalConsumed = true;
        continue;
      }
    }
    // Anything else (including subsequent -<number> tokens) is a target.
    targets.push(a);
  }

  return { signal, targets };
}

/** Signals operators almost always mean "destructive" when sent. */
const DESTRUCTIVE_SIGNALS: ReadonlySet<string> = new Set([
  '9', 'KILL', '11', 'SEGV',
]);

/** Signals that are routine reload / soft-stop operations. */
const RELOAD_SIGNALS: ReadonlySet<string> = new Set([
  '1', 'HUP',
]);

function killExplain(args: string[]): ExplainResult {
  // `kill -l` lists signals, no target — read-only.
  if (args.includes('-l') || args.includes('-L')) {
    return {
      summary: 'Lists available signal names',
      effects: [],
      warnings: [],
    };
  }

  const { signal, targets } = parseKillArgs(args);
  const targetStr = targets.length > 0 ? targets.join(', ') : '<pid>';
  const signalLabel = signal !== undefined ? signal : 'TERM';

  const warnings: string[] = [];
  if (DESTRUCTIVE_SIGNALS.has(signalLabel.toUpperCase())) {
    warnings.push(`SIG${signalLabel} cannot be caught or ignored — process exits immediately without cleanup`);
  }
  if (targets.includes('1')) {
    warnings.push('Target is PID 1 (init) — killing it crashes the host');
  }
  if (targets.includes('-1')) {
    warnings.push('Target is -1 — sends the signal to every process the caller can reach');
  }

  const effects: string[] = [];
  if (RELOAD_SIGNALS.has(signalLabel.toUpperCase())) {
    effects.push('Triggers a configuration reload (SIGHUP)');
  } else {
    effects.push(`Sends SIG${signalLabel} to the target process`);
  }

  return {
    summary: `Sends SIG${signalLabel} to ${targetStr}`,
    effects,
    warnings,
  };
}

function pkillExplain(args: string[]): ExplainResult {
  const { signal, targets } = parseKillArgs(args);
  // pkill takes a pattern as its last positional. Patterns aren't numeric,
  // so parseKillArgs's negative-PID disambiguation is harmless here.
  const pattern = targets[targets.length - 1] ?? '<pattern>';
  const signalLabel = signal !== undefined ? signal : 'TERM';

  const warnings: string[] = ['Pattern matches by name — may target multiple processes'];
  if (DESTRUCTIVE_SIGNALS.has(signalLabel.toUpperCase())) {
    warnings.push(`SIG${signalLabel} cannot be caught or ignored — affected processes exit immediately without cleanup`);
  }
  if (args.includes('-f') || args.includes('--full')) {
    warnings.push('-f / --full matches against the full command line — broader than the process name alone');
  }

  return {
    summary: `Sends SIG${signalLabel} to processes matching '${pattern}'`,
    effects: [`Sends SIG${signalLabel} to every process whose name matches the pattern`],
    warnings,
  };
}

function killallExplain(args: string[]): ExplainResult {
  const { signal, targets } = parseKillArgs(args);
  const name = targets[0] ?? '<name>';
  const signalLabel = signal !== undefined ? signal : 'TERM';

  const warnings: string[] = ['killall affects every running process with this name — may include unrelated instances'];
  if (DESTRUCTIVE_SIGNALS.has(signalLabel.toUpperCase())) {
    warnings.push(`SIG${signalLabel} cannot be caught or ignored — affected processes exit immediately without cleanup`);
  }

  return {
    summary: `Sends SIG${signalLabel} to every process named '${name}'`,
    effects: [`Sends SIG${signalLabel} to every process matching the name`],
    warnings,
  };
}

// ── Network diagnostics ────────────────────────────────────────────────────────

/** Heuristic — host name looks like an internal resolution target. */
function looksInternal(host: string): boolean {
  if (host.length === 0) return false;
  // .internal/.local/.corp/.lan/.intranet TLDs and common internal suffixes.
  if (/\.(internal|local|corp|lan|intranet|home|test|localdomain)$/i.test(host)) return true;
  // RFC 1918 / 3927 / link-local literal addresses.
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  // Bare hostnames (no dots) are usually internal — public hosts are FQDNs.
  if (!host.includes('.')) return true;
  return false;
}

function pingExplain(args: string[]): ExplainResult {
  const positional = positionalArgs(args);
  const host = positional[positional.length - 1] ?? '<host>';
  const cIdx = args.findIndex(a => a === '-c');
  const count = cIdx >= 0 ? args[cIdx + 1] : undefined;
  const summary = count !== undefined
    ? `Sends ${count} ICMP echo packets to ${host}`
    : `Sends ICMP echo packets to ${host}`;
  return {
    summary,
    effects: ['Sends ICMP echo requests over the network'],
    warnings: [],
  };
}

function tracerouteExplain(args: string[]): ExplainResult {
  const positional = positionalArgs(args);
  const host = positional[positional.length - 1] ?? '<host>';
  return {
    summary: `Traces the network path to ${host}`,
    effects: ['Probes successive hops via TTL-incremented packets'],
    warnings: [],
  };
}

function dnsLookupExplain(binary: 'dig' | 'nslookup', args: string[]): ExplainResult {
  // Accept `dig @resolver name [type]`, `nslookup name [resolver]`.
  const tokens = args.filter(a => !a.startsWith('-') && !a.startsWith('+'));
  let resolver: string | undefined;
  const queryTokens: string[] = [];
  for (const t of tokens) {
    if (t.startsWith('@')) resolver = t.slice(1);
    else queryTokens.push(t);
  }
  // nslookup convention: second positional is the resolver (no @ prefix).
  if (binary === 'nslookup' && resolver === undefined && queryTokens.length >= 2) {
    resolver = queryTokens[1];
  }
  const name = queryTokens[0] ?? '<name>';
  const recordType = binary === 'dig' ? queryTokens[1] : undefined;

  const warnings: string[] = [];
  if (resolver !== undefined && !looksInternal(resolver) && looksInternal(name)) {
    warnings.push(
      `Querying internal name '${name}' against external resolver ${resolver} — leaks infrastructure detail`,
    );
  }

  let summary: string;
  if (binary === 'dig') {
    summary = recordType !== undefined
      ? `Resolves ${recordType} records for ${name}`
      : `Resolves DNS records for ${name}`;
    if (resolver !== undefined) summary += ` against ${resolver}`;
  } else {
    summary = `Resolves DNS for ${name}`;
    if (resolver !== undefined) summary += ` against ${resolver}`;
  }

  return {
    summary,
    effects: ['Issues a DNS query'],
    warnings,
  };
}

function netstatExplain(binary: 'netstat' | 'ss', args: string[]): ExplainResult {
  const flags = args.filter(a => a.startsWith('-')).join('');
  const showsListening = /-?l/.test(flags);
  const showsAll = /-?a/.test(flags);
  const showsProcess = /-?p/.test(flags);
  const tcpOnly = /-?t/.test(flags) && !/-?u/.test(flags);
  const udpOnly = /-?u/.test(flags) && !/-?t/.test(flags);

  const parts: string[] = [];
  if (showsListening) parts.push('listening');
  else if (showsAll) parts.push('all');
  if (tcpOnly) parts.push('TCP');
  else if (udpOnly) parts.push('UDP');
  parts.push('sockets');
  if (showsProcess) parts.push('with owning process');

  const summary = `Shows ${parts.join(' ')}`;
  return {
    summary,
    effects: [`Reads kernel socket state via ${binary}`],
    warnings: [],
  };
}

function nmapExplain(args: string[]): ExplainResult {
  const targets = positionalArgs(args);
  const targetStr = targets.length > 0 ? targets.join(', ') : '<target>';

  const warnings: string[] = [
    'Active port scan — may trigger IDS / IPS alerts on the destination network',
    'May violate the destination network’s acceptable-use policy if not authorised',
  ];

  // Scan-type detection (informative, not exhaustive).
  if (args.includes('-sS')) {
    warnings.push('-sS (SYN scan) requires raw-socket privileges and is detectable by stateful firewalls');
  }
  if (args.includes('-sU')) {
    warnings.push('-sU (UDP scan) is slow and noisy — increases the chance of detection');
  }
  if (args.includes('-O')) {
    warnings.push('-O (OS fingerprinting) sends a distinctive probe sequence — readily detected');
  }
  if (args.includes('-A')) {
    warnings.push('-A enables OS detection, version detection, script scanning and traceroute — high signature');
  }
  if (args.includes('--script')) {
    warnings.push('--script runs NSE scripts which may probe for vulnerabilities');
  }

  return {
    summary: `Scans ${targetStr} with nmap`,
    effects: ['Sends probe packets to one or more remote hosts'],
    warnings,
  };
}

// ── Scheduling / persistence ───────────────────────────────────────────────────

function crontabExplain(args: string[]): ExplainResult {
  // Recognise the user / file forms:
  //   crontab -l            list current user's crontab
  //   crontab -u <user> -l  list another user's crontab
  //   crontab -e            interactive edit
  //   crontab -r            remove the entire crontab
  //   crontab <file>        install crontab from file (REPLACES existing)
  const userIdx = args.findIndex(a => a === '-u');
  const targetUser = userIdx >= 0 ? args[userIdx + 1] : undefined;
  const userSuffix = targetUser !== undefined ? ` for user ${targetUser}` : '';

  if (args.includes('-l')) {
    return {
      summary: `Lists the crontab${userSuffix}`,
      effects: ['Reads the user’s crontab entries'],
      warnings: [],
    };
  }
  if (args.includes('-r')) {
    return {
      summary: `Removes the entire crontab${userSuffix}`,
      effects: ['Deletes every scheduled cron job for the user'],
      warnings: [
        'Destructive — every existing cron entry is removed without prompt',
        'Persistence — recovery requires reinstalling each entry',
      ],
    };
  }
  if (args.includes('-e')) {
    return {
      summary: `Opens the crontab${userSuffix} in an editor`,
      effects: ['Allows interactive modification of the user’s scheduled jobs'],
      warnings: ['Interactive edit — content of the change cannot be inspected by the explainer'],
    };
  }
  // File-install form: positional arg is the file path. When `-u` is absent
  // we must NOT exclude index 0 (which would falsely match `userIdx + 1`
  // when userIdx is -1).
  const userArgIdx = userIdx >= 0 ? userIdx + 1 : -1;
  const positional = args.filter((a, i) => !a.startsWith('-') && i !== userArgIdx);
  const file = positional[0];
  if (file !== undefined) {
    return {
      summary: `Installs crontab${userSuffix} from ${file}`,
      effects: ['Replaces the entire user crontab with the file contents'],
      warnings: [
        'Destructive — every existing cron entry is replaced',
        'Persistence — installed entries run unattended on the cron schedule',
      ],
    };
  }
  return {
    summary: `Runs crontab${userSuffix}`,
    effects: [],
    warnings: [],
  };
}

function atExplain(args: string[]): ExplainResult {
  // Common forms:
  //   at <time>          schedule (commands from stdin)
  //   at -f <file> <time>schedule from file
  //   at -l / atq        list scheduled jobs
  //   at -d <id> / atrm  delete a scheduled job
  //   at -c <id>         show the script of a scheduled job
  if (args.includes('-l')) {
    return {
      summary: 'Lists scheduled at jobs',
      effects: ['Reads the at queue'],
      warnings: [],
    };
  }
  if (args.includes('-c')) {
    const cIdx = args.findIndex(a => a === '-c');
    const id = args[cIdx + 1] ?? '<job-id>';
    return {
      summary: `Shows the script for at job ${id}`,
      effects: ['Reads a scheduled job definition'],
      warnings: [],
    };
  }
  if (args.includes('-d') || args.includes('-r')) {
    const dIdx = Math.max(args.indexOf('-d'), args.indexOf('-r'));
    const id = args[dIdx + 1] ?? '<job-id>';
    return {
      summary: `Removes at job ${id}`,
      effects: ['Cancels a scheduled job'],
      warnings: ['Persistence — the cancelled job will not run as previously scheduled'],
    };
  }
  // Schedule form. Time spec is whatever's not a flag (or its argument).
  const fIdx = args.findIndex(a => a === '-f');
  const file = fIdx >= 0 ? args[fIdx + 1] : undefined;
  const skipIdx = fIdx >= 0 ? fIdx + 1 : -1;
  const positional = args.filter((a, i) => !a.startsWith('-') && i !== skipIdx);
  const timeSpec = positional.join(' ').trim();

  let summary: string;
  if (file !== undefined && timeSpec.length > 0) {
    summary = `Schedules ${file} to run at '${timeSpec}'`;
  } else if (file !== undefined) {
    summary = `Schedules ${file} to run later`;
  } else if (timeSpec.length > 0) {
    summary = `Schedules a job to run at '${timeSpec}'`;
  } else {
    summary = 'Schedules a job to run later';
  }
  return {
    summary,
    effects: ['Adds a one-shot job to the at queue'],
    warnings: [
      'Persistence — the scheduled job runs unattended at the chosen time',
    ],
  };
}

function atqExplain(_args: string[]): ExplainResult {
  return {
    summary: 'Lists scheduled at jobs',
    effects: ['Reads the at queue'],
    warnings: [],
  };
}

function atrmExplain(args: string[]): ExplainResult {
  const ids = positionalArgs(args);
  const idStr = ids.length > 0 ? ids.join(', ') : '<job-id>';
  return {
    summary: `Removes at job ${idStr}`,
    effects: ['Cancels one or more scheduled jobs'],
    warnings: ['Persistence — cancelled jobs will not run as previously scheduled'],
  };
}

function batchExplain(_args: string[]): ExplainResult {
  return {
    summary: 'Schedules a job to run when system load drops',
    effects: ['Adds a job to the batch queue (variant of at)'],
    warnings: [
      'Persistence — the scheduled job runs unattended once load conditions are met',
    ],
  };
}

// ── Distro / system package managers ───────────────────────────────────────────

/** apt / apt-get subcommand dispatch. */
function aptExplain(args: string[]): ExplainResult {
  const sub = args[0];
  const pos = positionalArgs(args.slice(1));
  const pkgs = pos.length > 0 ? pos.join(' ') : '';
  const isAssumeYes = args.includes('-y') || args.includes('--yes') || args.includes('--assume-yes');

  switch (sub) {
    case 'install':
      return {
        summary: pkgs.length > 0 ? `Installs apt packages: ${pkgs}` : 'Installs apt packages',
        effects: ['Downloads and installs system packages from configured repositories'],
        warnings: ['New code from a remote repository will run with the privileges of the installer'],
      };
    case 'remove':
    case 'purge':
      return {
        summary: pkgs.length > 0
          ? `${sub === 'purge' ? 'Purges' : 'Removes'} apt packages: ${pkgs}`
          : `${sub === 'purge' ? 'Purges' : 'Removes'} apt packages`,
        effects: [
          sub === 'purge'
            ? 'Removes packages and their configuration files'
            : 'Removes installed packages (configuration files retained)',
        ],
        warnings: ['Service interruption possible if a removed package provides a running daemon'],
      };
    case 'update':
      return {
        summary: 'Refreshes the apt package index',
        effects: ['Downloads metadata from configured repositories — does not install anything'],
        warnings: [],
      };
    case 'upgrade':
    case 'dist-upgrade':
    case 'full-upgrade':
      return {
        summary: sub === 'upgrade' ? 'Upgrades all upgradable packages' : `Upgrades all packages (${sub})`,
        effects: ['Downloads and installs newer package versions across the system'],
        warnings: [
          'Bulk operation — affects every upgradable package',
          ...(isAssumeYes ? ['-y / --yes accepts every prompt non-interactively'] : []),
        ],
      };
    case 'autoremove':
      return {
        summary: 'Removes packages no longer required',
        effects: ['Removes orphaned dependencies'],
        warnings: ['Bulk operation — packages no longer flagged as required will be uninstalled'],
      };
    default:
      return {
        summary: sub !== undefined ? `Runs apt ${sub}` : 'Runs apt',
        effects: [],
        warnings: [],
      };
  }
}

/** Shared yum / dnf dispatch — same subcommand surface. */
function yumDnfExplain(binary: 'yum' | 'dnf', args: string[]): ExplainResult {
  const sub = args[0];
  const pos = positionalArgs(args.slice(1));
  const pkgs = pos.length > 0 ? pos.join(' ') : '';
  const isAssumeYes = args.includes('-y') || args.includes('--assumeyes');

  switch (sub) {
    case 'install':
      return {
        summary: pkgs.length > 0 ? `Installs ${binary} packages: ${pkgs}` : `Installs ${binary} packages`,
        effects: ['Downloads and installs RPM packages from configured repositories'],
        warnings: ['New code from a remote repository will run with the privileges of the installer'],
      };
    case 'remove':
    case 'erase':
      return {
        summary: pkgs.length > 0 ? `Removes ${binary} packages: ${pkgs}` : `Removes ${binary} packages`,
        effects: ['Removes installed packages'],
        warnings: ['Service interruption possible if a removed package provides a running daemon'],
      };
    case 'update':
    case 'upgrade':
      return {
        summary: pkgs.length > 0
          ? `Updates ${binary} packages: ${pkgs}`
          : `Updates all installed ${binary} packages`,
        effects: ['Downloads and installs newer package versions'],
        warnings: [
          ...(pkgs.length === 0 ? ['Bulk operation — affects every upgradable package'] : []),
          ...(isAssumeYes ? ['-y / --assumeyes accepts every prompt non-interactively'] : []),
        ],
      };
    case 'check-update':
      return {
        summary: `Checks ${binary} for available updates`,
        effects: ['Reads repository metadata — does not install anything'],
        warnings: [],
      };
    default:
      return {
        summary: sub !== undefined ? `Runs ${binary} ${sub}` : `Runs ${binary}`,
        effects: [],
        warnings: [],
      };
  }
}

/** dpkg flag-driven dispatch (Debian low-level package operations). */
function dpkgExplain(args: string[]): ExplainResult {
  const positional = positionalArgs(args);
  const pkgs = positional.join(' ');
  if (args.includes('-i') || args.includes('--install')) {
    return {
      summary: pkgs.length > 0 ? `Installs .deb files: ${pkgs}` : 'Installs .deb files',
      effects: ['Installs a Debian package directly from a .deb file'],
      warnings: [
        'Bypasses the apt repository — package signature and dependency resolution are weaker than `apt install`',
      ],
    };
  }
  if (args.includes('-r') || args.includes('--remove')) {
    return {
      summary: pkgs.length > 0 ? `Removes packages: ${pkgs}` : 'Removes packages',
      effects: ['Removes installed packages (configuration files retained)'],
      warnings: ['Service interruption possible if a removed package provides a running daemon'],
    };
  }
  if (args.includes('-P') || args.includes('--purge')) {
    return {
      summary: pkgs.length > 0 ? `Purges packages: ${pkgs}` : 'Purges packages',
      effects: ['Removes packages and their configuration files'],
      warnings: ['Service interruption possible if a removed package provides a running daemon'],
    };
  }
  if (args.includes('-l') || args.includes('--list') || args.includes('-L')) {
    return {
      summary: 'Lists installed Debian packages',
      effects: ['Reads the dpkg status database'],
      warnings: [],
    };
  }
  return {
    summary: 'Runs dpkg',
    effects: [],
    warnings: [],
  };
}

/** snap subcommand dispatch. */
function snapExplain(args: string[]): ExplainResult {
  const sub = args[0];
  const pos = positionalArgs(args.slice(1));
  const pkgs = pos.length > 0 ? pos.join(' ') : '';

  switch (sub) {
    case 'install':
      return {
        summary: pkgs.length > 0 ? `Installs snaps: ${pkgs}` : 'Installs snaps',
        effects: ['Downloads and installs snap packages from the Snap Store'],
        warnings: ['Snaps can request system-wide interfaces — review the package’s declared plugs'],
      };
    case 'remove':
      return {
        summary: pkgs.length > 0 ? `Removes snaps: ${pkgs}` : 'Removes snaps',
        effects: ['Removes installed snap packages'],
        warnings: [],
      };
    case 'refresh':
      return {
        summary: pkgs.length > 0 ? `Refreshes snaps: ${pkgs}` : 'Refreshes all installed snaps',
        effects: ['Downloads and installs newer snap revisions'],
        warnings: pkgs.length === 0 ? ['Bulk operation — affects every installed snap'] : [],
      };
    case 'list':
      return {
        summary: 'Lists installed snaps',
        effects: ['Reads the snap registry'],
        warnings: [],
      };
    default:
      return {
        summary: sub !== undefined ? `Runs snap ${sub}` : 'Runs snap',
        effects: [],
        warnings: [],
      };
  }
}

/** Homebrew subcommand dispatch. */
function brewExplain(args: string[]): ExplainResult {
  const sub = args[0];
  const pos = positionalArgs(args.slice(1));
  const pkgs = pos.length > 0 ? pos.join(' ') : '';

  switch (sub) {
    case 'install':
      return {
        summary: pkgs.length > 0 ? `Installs brew packages: ${pkgs}` : 'Installs brew packages',
        effects: ['Downloads and installs Homebrew formulae'],
        warnings: ['New code from a remote tap will run with the privileges of the installer'],
      };
    case 'uninstall':
    case 'remove':
    case 'rm':
      return {
        summary: pkgs.length > 0 ? `Uninstalls brew packages: ${pkgs}` : 'Uninstalls brew packages',
        effects: ['Removes installed Homebrew formulae'],
        warnings: [],
      };
    case 'upgrade':
      return {
        summary: pkgs.length > 0 ? `Upgrades brew packages: ${pkgs}` : 'Upgrades all brew packages',
        effects: ['Downloads and installs newer formula versions'],
        warnings: pkgs.length === 0 ? ['Bulk operation — affects every installed formula'] : [],
      };
    case 'update':
      return {
        summary: 'Refreshes the Homebrew formula index',
        effects: ['Pulls the latest formula definitions from upstream'],
        warnings: [],
      };
    case 'list':
    case 'ls':
      return {
        summary: 'Lists installed Homebrew formulae',
        effects: ['Reads the local Homebrew registry'],
        warnings: [],
      };
    case 'cleanup':
      return {
        summary: 'Removes old / unused Homebrew downloads',
        effects: ['Frees disk space by removing old formula versions and caches'],
        warnings: [],
      };
    default:
      return {
        summary: sub !== undefined ? `Runs brew ${sub}` : 'Runs brew',
        effects: [],
        warnings: [],
      };
  }
}

/** pacman flag-driven dispatch (Arch). */
function pacmanExplain(args: string[]): ExplainResult {
  const flags = args.find(a => /^-[A-Z]/.test(a)) ?? '';
  const positional = positionalArgs(args);
  const pkgs = positional.join(' ');
  // pacman -S install, -R remove, -Syu upgrade, -Q query, -U install local file
  if (/^-S/.test(flags) && /y.*u|u.*y/i.test(flags)) {
    return {
      summary: 'Synchronises and upgrades all packages',
      effects: ['Refreshes the package database and upgrades every package'],
      warnings: ['Bulk operation — affects every installed package'],
    };
  }
  if (/^-S/.test(flags)) {
    return {
      summary: pkgs.length > 0 ? `Installs pacman packages: ${pkgs}` : 'Installs pacman packages',
      effects: ['Downloads and installs packages from configured repositories'],
      warnings: ['New code from a remote repository will run with the privileges of the installer'],
    };
  }
  if (/^-R/.test(flags)) {
    return {
      summary: pkgs.length > 0 ? `Removes pacman packages: ${pkgs}` : 'Removes pacman packages',
      effects: ['Removes installed packages'],
      warnings: ['Service interruption possible if a removed package provides a running daemon'],
    };
  }
  if (/^-Q/.test(flags)) {
    return {
      summary: 'Queries the local pacman database',
      effects: ['Reads installed-package metadata'],
      warnings: [],
    };
  }
  if (/^-U/.test(flags)) {
    return {
      summary: pkgs.length > 0 ? `Installs local .pkg files: ${pkgs}` : 'Installs local .pkg files',
      effects: ['Installs a package directly from a local archive'],
      warnings: ['Bypasses repository signature checks — package authenticity is weaker'],
    };
  }
  return {
    summary: 'Runs pacman',
    effects: [],
    warnings: [],
  };
}

// ── Cluster management (kubectl) + VM lifecycle (virsh) ──────────────────────

/**
 * Pulls the namespace argument from a kubectl invocation, when present.
 * Recognises both `-n <ns>` / `--namespace <ns>` and `--namespace=<ns>`.
 */
function kubectlNamespace(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-n' || a === '--namespace') {
      const next = args[i + 1];
      if (next !== undefined) return next;
    }
    if (a.startsWith('--namespace=')) return a.slice('--namespace='.length);
  }
  return undefined;
}

function kubectlSuffix(args: string[]): string {
  const ns = kubectlNamespace(args);
  return ns !== undefined ? ` in namespace ${ns}` : '';
}

/** kubectl subcommand dispatch. */
function kubectlExplain(args: string[]): ExplainResult {
  const sub = args[0];
  // Strip the leading subcommand and the namespace flag pair (or `=` form)
  // before isolating the resource / name positionals.
  const skipIdxs = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-n' || a === '--namespace') {
      skipIdxs.add(i);
      skipIdxs.add(i + 1);
    }
  }
  const filtered = args.filter((_, i) => !skipIdxs.has(i));
  const positional = positionalArgs(filtered.slice(1)); // drop subcommand
  const resource = positional[0];
  const name = positional[1];

  switch (sub) {
    case 'apply': {
      const fIdx = args.findIndex(a => a === '-f' || a === '--filename');
      const file = fIdx >= 0 ? args[fIdx + 1] : undefined;
      return {
        summary: file !== undefined
          ? `Applies the manifest at ${file}${kubectlSuffix(args)}`
          : `Applies a manifest${kubectlSuffix(args)}`,
        effects: ['Creates or updates Kubernetes resources to match the manifest'],
        warnings: [
          'Cluster mutation — affects every resource referenced by the manifest',
          ...(args.includes('--prune') ? ['--prune deletes existing resources not present in the manifest'] : []),
          ...(args.includes('--force') ? ['--force overrides conflict detection on already-managed resources'] : []),
        ],
      };
    }
    case 'delete': {
      const target = name !== undefined ? `${resource} ${name}` : resource ?? '<resource>';
      return {
        summary: `Deletes ${target}${kubectlSuffix(args)}`,
        effects: ['Removes Kubernetes resources from the cluster'],
        warnings: [
          'Cluster mutation — deletion is generally not recoverable without a fresh manifest',
          ...(args.includes('--all') ? ['--all deletes every resource of the named kind in the namespace'] : []),
          ...(args.includes('--grace-period=0') || args.includes('--force')
            ? ['--force / --grace-period=0 skips graceful shutdown — pods terminate immediately']
            : []),
        ],
      };
    }
    case 'get':
    case 'describe': {
      const target = name !== undefined ? `${resource} ${name}` : resource ?? '<resource>';
      return {
        summary: sub === 'get'
          ? `Lists ${target}${kubectlSuffix(args)}`
          : `Describes ${target}${kubectlSuffix(args)}`,
        effects: ['Reads cluster state'],
        warnings: [],
      };
    }
    case 'logs': {
      const pod = positional[0];
      return {
        summary: pod !== undefined
          ? `Reads logs from pod ${pod}${kubectlSuffix(args)}`
          : `Reads pod logs${kubectlSuffix(args)}`,
        effects: ['Reads container logs from one or more pods'],
        warnings: ['Logs may contain credentials, request bodies, or other sensitive data'],
      };
    }
    case 'exec': {
      const pod = positional[0];
      return {
        summary: pod !== undefined
          ? `Executes a command inside pod ${pod}${kubectlSuffix(args)}`
          : `Executes a command inside a pod${kubectlSuffix(args)}`,
        effects: ['Runs a process inside a running container'],
        warnings: [
          'Provides direct access to a running pod environment',
          ...(args.includes('-it') || (args.includes('-i') && args.includes('-t'))
            ? ['Interactive TTY — content of the session cannot be inspected by the explainer']
            : []),
        ],
      };
    }
    case 'port-forward': {
      return {
        summary: `Forwards local ports to a pod${kubectlSuffix(args)}`,
        effects: ['Opens a long-running tunnel from the local host to a pod inside the cluster'],
        warnings: [
          'Long-running session — the tunnel persists until the command is interrupted',
          'Local services / browsers connecting to the forwarded port reach inside the cluster',
        ],
      };
    }
    case 'rollout': {
      const action = args[1];
      // For rollout, positionals after the action are <resource> [<name>].
      // Recompute on a slice that drops both 'rollout' and the action.
      const rolloutPositional = positionalArgs(filtered.slice(2));
      const rolloutResource = rolloutPositional[0];
      const rolloutName = rolloutPositional[1];
      const target = rolloutName !== undefined
        ? `${rolloutResource} ${rolloutName}`
        : rolloutResource ?? '<resource>';
      switch (action) {
        case 'restart':
          return {
            summary: `Restarts rollout of ${target}${kubectlSuffix(args)}`,
            effects: ['Triggers a rolling restart of the resource’s pods'],
            warnings: ['Brief disruption while replacement pods come online'],
          };
        case 'undo':
          return {
            summary: `Rolls back ${target}${kubectlSuffix(args)}`,
            effects: ['Reverts the resource to its previous revision'],
            warnings: ['Cluster mutation — running pods are replaced by the previous revision'],
          };
        case 'status':
          return {
            summary: `Reports rollout status for ${target}${kubectlSuffix(args)}`,
            effects: ['Reads cluster state'],
            warnings: [],
          };
        default:
          return {
            summary: action !== undefined
              ? `Runs kubectl rollout ${action}${kubectlSuffix(args)}`
              : `Runs kubectl rollout${kubectlSuffix(args)}`,
            effects: [],
            warnings: [],
          };
      }
    }
    case 'scale': {
      const replicas = (() => {
        const idx = args.findIndex(a => a.startsWith('--replicas'));
        if (idx < 0) return undefined;
        const arg = args[idx]!;
        if (arg.includes('=')) return arg.split('=')[1];
        return args[idx + 1];
      })();
      const target = name !== undefined ? `${resource} ${name}` : resource ?? '<resource>';
      return {
        summary: replicas !== undefined
          ? `Scales ${target} to ${replicas} replicas${kubectlSuffix(args)}`
          : `Scales ${target}${kubectlSuffix(args)}`,
        effects: ['Adjusts the replica count for the resource'],
        warnings: replicas === '0' ? ['Scaling to 0 replicas takes the workload offline'] : [],
      };
    }
    case undefined:
      return { summary: 'Runs kubectl', effects: [], warnings: [] };
    default:
      return {
        summary: `Runs kubectl ${sub}${kubectlSuffix(args)}`,
        effects: [],
        warnings: [],
      };
  }
}

/** virsh (libvirt) subcommand dispatch. */
function virshExplain(args: string[]): ExplainResult {
  const sub = args[0];
  const positional = positionalArgs(args.slice(1));
  const domain = positional[0];

  switch (sub) {
    case 'list':
      return {
        summary: 'Lists virsh-managed domains',
        effects: ['Reads libvirt domain state'],
        warnings: [],
      };
    case 'start':
      return {
        summary: domain !== undefined ? `Starts VM ${domain}` : 'Starts a VM',
        effects: ['Boots a libvirt domain'],
        warnings: [],
      };
    case 'shutdown':
      return {
        summary: domain !== undefined ? `Gracefully shuts down VM ${domain}` : 'Gracefully shuts down a VM',
        effects: ['Sends an ACPI shutdown signal to the domain'],
        warnings: ['Active services on the VM will be interrupted'],
      };
    case 'destroy':
      return {
        summary: domain !== undefined ? `Forcibly stops VM ${domain}` : 'Forcibly stops a VM',
        effects: ['Terminates the libvirt domain without graceful shutdown'],
        warnings: [
          'Forceful termination — running processes inside the VM are killed without cleanup',
        ],
      };
    case 'reboot':
      return {
        summary: domain !== undefined ? `Reboots VM ${domain}` : 'Reboots a VM',
        effects: ['Triggers a graceful reboot of the libvirt domain'],
        warnings: ['Active services on the VM will be briefly unavailable'],
      };
    case 'undefine':
      return {
        summary: domain !== undefined ? `Removes VM definition for ${domain}` : 'Removes a VM definition',
        effects: ['Deletes the libvirt domain definition (the VM disk image is retained unless --remove-all-storage is used)'],
        warnings: [
          'Persistent — the VM will not auto-start at host boot after removal',
          ...(args.includes('--remove-all-storage') ? ['--remove-all-storage also deletes the VM disk image — irreversible'] : []),
        ],
      };
    case undefined:
      return { summary: 'Runs virsh', effects: [], warnings: [] };
    default:
      return {
        summary: `Runs virsh ${sub}`,
        effects: [],
        warnings: [],
      };
  }
}

// ── Light explainers — read-only file utilities (cat / head / tail / etc.) ─

function catExplain(args: string[]): ExplainResult {
  const paths = positionalArgs(args);
  if (paths.length === 0) {
    return {
      summary: 'Reads stdin and prints to stdout',
      effects: ['Reads stdin'],
      warnings: [],
    };
  }
  return {
    summary: paths.length === 1
      ? `Prints the contents of ${paths[0]}`
      : `Concatenates and prints ${paths.join(', ')}`,
    effects: ['Reads from the local filesystem'],
    warnings: [],
  };
}

function headExplain(args: string[]): ExplainResult {
  const nIdx = args.findIndex(a => a === '-n');
  const n = nIdx >= 0 ? args[nIdx + 1] : undefined;
  const numericFlag = args.find(a => /^-\d+$/.test(a));
  const lines = n ?? (numericFlag !== undefined ? numericFlag.slice(1) : '10');
  const path = positionalArgs(args).find(a => !/^-?\d+$/.test(a));
  return {
    summary: path !== undefined
      ? `Prints the first ${lines} lines of ${path}`
      : `Prints the first ${lines} lines from stdin`,
    effects: ['Reads from the local filesystem'],
    warnings: [],
  };
}

function tailExplain(args: string[]): ExplainResult {
  const nIdx = args.findIndex(a => a === '-n');
  const n = nIdx >= 0 ? args[nIdx + 1] : undefined;
  const numericFlag = args.find(a => /^-\d+$/.test(a));
  const lines = n ?? (numericFlag !== undefined ? numericFlag.slice(1) : '10');
  const isFollow = args.includes('-f') || args.includes('--follow') || args.includes('-F');
  const path = positionalArgs(args).find(a => !/^-?\d+$/.test(a));

  const summary = isFollow
    ? path !== undefined
      ? `Streams ${path} as new lines are appended (tail -f)`
      : 'Streams stdin as new content arrives (tail -f)'
    : path !== undefined
      ? `Prints the last ${lines} lines of ${path}`
      : `Prints the last ${lines} lines from stdin`;

  const warnings = isFollow
    ? ['Long-running — the command does not return until interrupted']
    : [];

  return {
    summary,
    effects: ['Reads from the local filesystem'],
    warnings,
  };
}

function diffExplain(args: string[]): ExplainResult {
  const paths = positionalArgs(args);
  const a = paths[0] ?? '<file-a>';
  const b = paths[1] ?? '<file-b>';
  return {
    summary: `Compares ${a} against ${b}`,
    effects: ['Reads two files and reports differences'],
    warnings: [],
  };
}

function findExplain(args: string[]): ExplainResult {
  const path = positionalArgs(args)[0] ?? '.';
  const warnings: string[] = [];
  if (args.includes('-delete')) {
    warnings.push('-delete removes every file matching the predicate');
  }
  if (args.includes('-exec')) {
    warnings.push('-exec runs the supplied command for every match');
  }
  return {
    summary: `Searches the filesystem under ${path}`,
    effects: ['Walks the filesystem looking for entries matching the predicate'],
    warnings,
  };
}

function locateExplain(args: string[]): ExplainResult {
  const pattern = positionalArgs(args)[0] ?? '<pattern>';
  return {
    summary: `Searches the locate index for '${pattern}'`,
    effects: ['Reads the pre-built locate database'],
    warnings: [],
  };
}

function treeExplain(args: string[]): ExplainResult {
  const path = positionalArgs(args)[0] ?? '.';
  return {
    summary: `Lists the directory tree starting at ${path}`,
    effects: ['Walks and prints the directory hierarchy'],
    warnings: [],
  };
}

function lsExplain(args: string[]): ExplainResult {
  const positional = positionalArgs(args);
  const target = positional.length > 0 ? positional.join(', ') : '.';
  const isLong = args.some(a => /^-[a-zA-Z]*l/.test(a)) || args.includes('--long');
  return {
    summary: isLong ? `Lists ${target} with file metadata` : `Lists ${target}`,
    effects: ['Reads directory entries from the local filesystem'],
    warnings: [],
  };
}

// ── Light explainers — write-side utilities (tee / touch) ──────────────────

function teeExplain(args: string[]): ExplainResult {
  const paths = positionalArgs(args);
  const target = paths.length > 0 ? paths.join(', ') : '<file>';
  const isAppend = args.includes('-a') || args.includes('--append');
  return {
    summary: isAppend
      ? `Reads stdin and appends to ${target}`
      : `Reads stdin and writes to ${target}`,
    effects: ['Reads stdin and writes the same content to one or more files'],
    warnings: isAppend ? [] : ['Existing file content at the target path is overwritten'],
  };
}

function touchExplain(args: string[]): ExplainResult {
  const paths = positionalArgs(args);
  const target = paths.length > 0 ? paths.join(', ') : '<file>';
  return {
    summary: `Creates or updates the timestamp of ${target}`,
    effects: ['Creates an empty file when the target does not exist; updates mtime/atime when it does'],
    warnings: [],
  };
}

function echoExplain(args: string[]): ExplainResult {
  const text = args.join(' ');
  const truncated = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  return {
    summary: text.length > 0 ? `Prints '${truncated}' to stdout` : 'Prints to stdout',
    effects: ['Writes to stdout'],
    warnings: [],
  };
}

function printfExplain(args: string[]): ExplainResult {
  const fmt = args[0] ?? '';
  const truncated = fmt.length > 60 ? `${fmt.slice(0, 57)}…` : fmt;
  return {
    summary: fmt.length > 0 ? `Prints formatted output: '${truncated}'` : 'Prints formatted output',
    effects: ['Writes to stdout'],
    warnings: [],
  };
}

// ── Light explainers — system info / monitoring ────────────────────────────

function staticReadOnlyExplain(summary: string, effect: string): ExplainResult {
  return { summary, effects: [effect], warnings: [] };
}

function unameExplain(args: string[]): ExplainResult {
  const isAll = args.includes('-a') || args.includes('--all');
  return {
    summary: isAll ? 'Reports the full kernel and system identification' : 'Reports the kernel name',
    effects: ['Reads kernel / system metadata'],
    warnings: [],
  };
}

function psExplain(_args: string[]): ExplainResult {
  return staticReadOnlyExplain('Lists running processes', 'Reads kernel process state');
}
function topExplain(_args: string[]): ExplainResult {
  return {
    summary: 'Opens an interactive process monitor',
    effects: ['Continuously reads kernel process state'],
    warnings: ['Long-running — does not return until interrupted'],
  };
}
function htopExplain(_args: string[]): ExplainResult {
  return {
    summary: 'Opens htop, an interactive process monitor',
    effects: ['Continuously reads kernel process state'],
    warnings: ['Long-running — does not return until interrupted'],
  };
}
function dfExplain(_args: string[]): ExplainResult {
  return staticReadOnlyExplain('Reports disk space usage by mounted filesystem', 'Reads filesystem statistics');
}
function duExplain(args: string[]): ExplainResult {
  const path = positionalArgs(args)[0] ?? '.';
  return staticReadOnlyExplain(`Reports disk usage for ${path}`, 'Walks the filesystem and totals sizes');
}
function freeExplain(_args: string[]): ExplainResult {
  return staticReadOnlyExplain('Reports memory and swap usage', 'Reads kernel memory statistics');
}
function hostnameExplain(_args: string[]): ExplainResult {
  return staticReadOnlyExplain('Reports the system hostname', 'Reads the kernel hostname');
}
function uptimeExplain(_args: string[]): ExplainResult {
  return staticReadOnlyExplain('Reports system uptime and load averages', 'Reads kernel uptime / load statistics');
}
function lsofExplain(_args: string[]): ExplainResult {
  return staticReadOnlyExplain('Lists open files and sockets', 'Reads kernel file-descriptor state');
}
function idExplain(args: string[]): ExplainResult {
  const user = positionalArgs(args)[0];
  return staticReadOnlyExplain(
    user !== undefined ? `Reports the user/group IDs for ${user}` : 'Reports the current user/group IDs',
    'Reads user / group identity from the system',
  );
}
function whoamiExplain(_args: string[]): ExplainResult {
  return staticReadOnlyExplain('Reports the effective username', 'Reads the current process user identity');
}

// ── Compression / archive utilities ────────────────────────────────────────────

/** Mode classification for `tar` based on flag bundle + long-form flags. */
type TarMode = 'create' | 'extract' | 'list' | 'append' | 'update' | 'unknown';

function tarMode(args: string[]): TarMode {
  // Long-form flags take precedence.
  if (args.some(a => a === '--create')) return 'create';
  if (args.some(a => a === '--extract' || a === '--get')) return 'extract';
  if (args.some(a => a === '--list')) return 'list';
  if (args.some(a => a === '--append')) return 'append';
  if (args.some(a => a === '--update')) return 'update';
  // Short-form flag bundles. The first non-`--` token may be either a flag
  // bundle (`czf`) or a dashed bundle (`-czf`). Inspect both.
  for (const tok of args) {
    if (tok.startsWith('--')) continue;
    const body = tok.startsWith('-') ? tok.slice(1) : tok;
    // The first letter that's a mode flag wins.
    for (const ch of body) {
      switch (ch) {
        case 'c': return 'create';
        case 'x': return 'extract';
        case 't': return 'list';
        case 'r': return 'append';
        case 'u': return 'update';
      }
    }
    // Stop at the first positional that isn't a recognisable flag bundle —
    // it's the archive file or content paths.
    if (!tok.startsWith('-')) break;
  }
  return 'unknown';
}

/** Returns the archive path (`-f <file>` or `--file=<file>` or first positional after the mode bundle). */
function tarArchive(args: string[]): string | undefined {
  // -f <archive>
  const fIdx = args.findIndex(a => a === '-f' || a === '--file');
  if (fIdx >= 0 && args[fIdx + 1] !== undefined) return args[fIdx + 1];
  // --file=archive
  const longFile = args.find(a => a.startsWith('--file='));
  if (longFile !== undefined) return longFile.slice('--file='.length);
  // Bundled flag with `f` (e.g. `czf archive.tar.gz dir/`) — the next positional is the archive.
  const bundleIdx = args.findIndex(a => /^-?[A-Za-z]+$/.test(a) && /f/.test(a));
  if (bundleIdx >= 0) {
    const next = positionalArgs(args.slice(bundleIdx + 1))[0];
    if (next !== undefined) return next;
  }
  // Fallback: first positional after the mode bundle.
  return positionalArgs(args)[0];
}

function tarExplain(args: string[]): ExplainResult {
  const mode = tarMode(args);
  const archive = tarArchive(args) ?? '<archive>';

  switch (mode) {
    case 'create':
      return {
        summary: `Creates archive ${archive}`,
        effects: ['Reads files from the local filesystem and writes them into a single archive'],
        warnings: [],
      };
    case 'extract':
      return {
        summary: `Extracts archive ${archive}`,
        effects: ['Writes archive contents into the destination directory'],
        warnings: [
          'Path-traversal — crafted entries (../) can write outside the destination if --absolute-names is set or the implementation does not sanitise',
          'Decompression bombs — extremely large extracted output is possible from a small input',
        ],
      };
    case 'list':
      return {
        summary: `Lists the contents of ${archive}`,
        effects: ['Reads archive metadata'],
        warnings: [],
      };
    case 'append':
    case 'update':
      return {
        summary: `${mode === 'append' ? 'Appends to' : 'Updates'} archive ${archive}`,
        effects: ['Modifies an existing archive in place'],
        warnings: [],
      };
    default:
      return {
        summary: 'Runs tar',
        effects: [],
        warnings: [],
      };
  }
}

function zipExplain(args: string[]): ExplainResult {
  // `zip [opts] <archive> <file…>` — first positional is the archive.
  const positional = positionalArgs(args);
  const archive = positional[0] ?? '<archive>';
  const files = positional.slice(1);
  return {
    summary: files.length > 0
      ? `Creates ZIP archive ${archive} containing ${files.join(', ')}`
      : `Creates ZIP archive ${archive}`,
    effects: ['Reads files from the local filesystem and writes them into a ZIP archive'],
    warnings: args.includes('-e') || args.includes('--encrypt')
      ? ['Encrypted ZIPs use weak ZipCrypto by default — prefer 7z / GPG for sensitive data']
      : [],
  };
}

function unzipExplain(args: string[]): ExplainResult {
  const positional = positionalArgs(args);
  const archive = positional[0] ?? '<archive>';
  const dIdx = args.findIndex(a => a === '-d');
  const dest = dIdx >= 0 ? args[dIdx + 1] : undefined;
  return {
    summary: dest !== undefined
      ? `Extracts ${archive} into ${dest}`
      : `Extracts ${archive} into the current directory`,
    effects: ['Writes archive contents to the local filesystem'],
    warnings: [
      'Path-traversal — crafted ZIP entries (../) can write outside the destination',
      'Decompression bombs — extremely large extracted output is possible from a small input',
    ],
  };
}

function compressExplain(binary: string, args: string[]): ExplainResult {
  const isDecompress = args.includes('-d') || args.includes('--decompress')
    || args.includes('--uncompress');
  const isKeep = args.includes('-k') || args.includes('--keep');
  const positional = positionalArgs(args);
  const target = positional[0];

  if (isDecompress) {
    return {
      summary: target !== undefined
        ? `Decompresses ${target}`
        : `Decompresses ${binary} input`,
      effects: ['Reads the compressed input and writes the decompressed output'],
      warnings: ['Decompression bomb — small input can produce arbitrarily large output'],
    };
  }
  return {
    summary: target !== undefined
      ? `Compresses ${target}`
      : `Compresses ${binary} input`,
    effects: isKeep
      ? ['Compresses the input — original file retained because of -k / --keep']
      : ['Compresses the input — original file is replaced by the compressed copy'],
    warnings: [],
  };
}

/** gunzip / bunzip2 / unxz are explicit-decompress entry points. */
function decompressorExplain(binary: string, args: string[]): ExplainResult {
  const positional = positionalArgs(args);
  const target = positional[0];
  return {
    summary: target !== undefined
      ? `Decompresses ${target}`
      : `Decompresses ${binary} input`,
    effects: ['Reads the compressed input and writes the decompressed output'],
    warnings: ['Decompression bomb — small input can produce arbitrarily large output'],
  };
}

function sevenZipExplain(args: string[]): ExplainResult {
  // 7z uses sub-action letters: a (add/create), x (extract preserving paths),
  // e (extract flat), l/t (list), d (delete from archive), u (update).
  const sub = args[0];
  const archive = positionalArgs(args.slice(1))[0] ?? '<archive>';
  switch (sub) {
    case 'a':
    case 'u':
      return {
        summary: sub === 'u'
          ? `Updates 7z archive ${archive}`
          : `Adds files to 7z archive ${archive}`,
        effects: ['Reads files from the local filesystem and writes into a 7z archive'],
        warnings: [],
      };
    case 'x':
    case 'e':
      return {
        summary: sub === 'x'
          ? `Extracts 7z archive ${archive} preserving paths`
          : `Extracts 7z archive ${archive} (flat — paths discarded)`,
        effects: ['Writes archive contents to the local filesystem'],
        warnings: [
          'Path-traversal — crafted entries (../) can write outside the destination',
          'Decompression bombs — extremely large extracted output is possible from a small input',
        ],
      };
    case 'l':
    case 't':
      return {
        summary: `Lists the contents of 7z archive ${archive}`,
        effects: ['Reads archive metadata'],
        warnings: [],
      };
    case 'd':
      return {
        summary: `Removes entries from 7z archive ${archive}`,
        effects: ['Modifies an existing 7z archive in place'],
        warnings: [],
      };
    default:
      return {
        summary: sub !== undefined ? `Runs 7z ${sub}` : 'Runs 7z',
        effects: [],
        warnings: [],
      };
  }
}

function mkdirExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const path = pos[0] ?? '<directory>';
  return {
    summary: `Creates directory ${path}`,
    effects: ['Creates a new directory on the filesystem'],
    warnings: [],
  };
}

/**
 * Heuristic — token looks like a remote endpoint for rsync / scp / sftp.
 *
 * Matches `user@host:path`, `host:path`, `rsync://...`, and `sftp://...`.
 * Plain local paths (`/foo`, `./foo`, `foo/bar`) and Windows-style paths
 * (`C:\...` — already handled because `:` only counts when followed by a
 * non-backslash) do not match.
 */
function looksRemoteTransferTarget(token: string): boolean {
  if (token.length === 0) return false;
  if (/^rsync:\/\//i.test(token) || /^sftp:\/\//i.test(token)) return true;
  // user@host:path or host:path. Reject Windows drive letters by requiring
  // either a user@ prefix, or at least one dot in the host portion (so plain
  // colon-separated tokens like `C:foo` don't match).
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/.test(token)) return true;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+:/.test(token)) return true;
  return false;
}

function rsyncExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const src = pos[0] ?? '<source>';
  const dst = pos[1] ?? '<destination>';
  const isDelete = args.includes('--delete');
  const warnings: string[] = [];
  if (isDelete) warnings.push('--delete removes files at destination absent in source');

  const remoteSrc = looksRemoteTransferTarget(src);
  const remoteDst = looksRemoteTransferTarget(dst);
  if (remoteDst) {
    warnings.push(`Destination ${dst} is remote — local data is being uploaded over the network`);
  }
  if (remoteSrc && !remoteDst) {
    warnings.push(`Source ${src} is remote — pulling data into the local filesystem`);
  }

  return {
    summary: `Syncs files from ${src} to ${dst}`,
    effects: ['Modifies the destination filesystem'],
    warnings,
  };
}

// ── Network detectors ──────────────────────────────────────────────────────────

function curlExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const url = pos[0] ?? '<url>';
  const isPost =
    args.some((t, i) => (t === '-X' || t === '--request') && args[i + 1] === 'POST') ||
    args.some(t => t === '--data' || t === '-d' || t === '--data-raw' || t === '--data-binary');
  const hasOutput = args.some(t => t === '-o' || t === '--output' || t === '-O');
  const summary = isPost
    ? `Sends an HTTP POST request to ${url}`
    : `Fetches content from ${url}`;
  const effects: string[] = ['Makes a network request'];
  if (hasOutput) effects.push('Writes response to a local file');
  return { summary, effects, warnings: [] };
}

function wgetExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const url = pos[0] ?? '<url>';
  return {
    summary: `Downloads ${url}`,
    effects: ['Creates a local file from network content'],
    warnings: [],
  };
}

function sshExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const host = pos[0] ?? '<host>';
  return {
    summary: `Opens a secure shell connection to ${host}`,
    effects: ['Establishes a remote network connection'],
    warnings: ['Grants interactive access to a remote system'],
  };
}

function moshExplain(args: string[]): ExplainResult {
  const host = positionalArgs(args)[0] ?? '<host>';
  return {
    summary: `Opens a mosh session to ${host}`,
    effects: ['Establishes a UDP-based remote terminal that persists across network changes'],
    warnings: [
      'Grants interactive access to a remote system',
      'Long-running session — mosh state outlives transient network failures',
    ],
  };
}

function telnetExplain(args: string[]): ExplainResult {
  const positional = positionalArgs(args);
  const host = positional[0] ?? '<host>';
  return {
    summary: `Opens a telnet connection to ${host}`,
    effects: ['Establishes an unencrypted remote terminal connection'],
    warnings: [
      'Grants interactive access to a remote system',
      'Telnet is unencrypted — credentials and session content cross the network in plaintext',
    ],
  };
}

function scpExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const src = pos[0] ?? '<source>';
  const dst = pos.length > 1 ? pos[pos.length - 1]! : '<destination>';

  const warnings: string[] = [];
  const remoteSrc = looksRemoteTransferTarget(src);
  const remoteDst = looksRemoteTransferTarget(dst);
  if (remoteDst) {
    warnings.push(`Destination ${dst} is remote — local data is being uploaded over the network`);
  }
  if (remoteSrc && !remoteDst) {
    warnings.push(`Source ${src} is remote — pulling data into the local filesystem`);
  }

  return {
    summary: `Securely copies files from ${src} to ${dst}`,
    effects: ['Transfers files over a network connection'],
    warnings,
  };
}

function sftpExplain(args: string[]): ExplainResult {
  // `sftp [user@]host` opens an interactive session.
  // `sftp -b <batchfile> [user@]host` runs a batch script.
  // `sftp -P 2222 user@host` overrides port.
  const positional = positionalArgs(args);
  // Skip a port number that follows -P / -p.
  const skipIdx = (() => {
    const pIdx = args.findIndex(a => a === '-P' || a === '-p');
    if (pIdx < 0) return -1;
    const skip = args[pIdx + 1];
    return positional.indexOf(skip!);
  })();
  const filtered = positional.filter((_, i) => i !== skipIdx);
  const host = filtered[filtered.length - 1] ?? '<host>';

  const bIdx = args.findIndex(a => a === '-b');
  const batchFile = bIdx >= 0 ? args[bIdx + 1] : undefined;

  const warnings: string[] = [
    'Interactive or scripted file transfer — files in either direction cross the network',
  ];

  let summary: string;
  if (batchFile !== undefined) {
    summary = `Runs sftp batch file ${batchFile} against ${host}`;
  } else {
    summary = `Opens an sftp session to ${host}`;
    warnings.push('Interactive — content of the transfer cannot be inspected by the explainer');
  }

  return {
    summary,
    effects: ['Establishes an SFTP connection to a remote host'],
    warnings,
  };
}

function ncExplain(args: string[]): ExplainResult {
  const isListen = args.includes('-l') || args.includes('--listen');
  const pos = positionalArgs(args);
  let summary: string;
  if (isListen) {
    const port = pos[0];
    summary = port
      ? `Listens for incoming connections on port ${port}`
      : 'Listens for incoming network connections';
  } else {
    const host = pos[0];
    const port = pos[1];
    if (host && port) {
      summary = `Opens a TCP connection to ${host}:${port}`;
    } else if (host) {
      summary = `Opens a network connection to ${host}`;
    } else {
      summary = 'Opens a network connection';
    }
  }
  return { summary, effects: ['Establishes a network connection'], warnings: [] };
}

// ── Service management detectors ───────────────────────────────────────────────

function systemctlExplain(args: string[]): ExplainResult {
  const sub = args[0];
  const unit = positionalArgs(args.slice(1))[0];
  const unitLabel = unit !== undefined && unit.length > 0 ? ` ${unit}` : '';

  switch (sub) {
    case undefined:
      return { summary: 'Runs systemctl', effects: [], warnings: [] };
    case 'start':
      return {
        summary: `Starts service${unitLabel}`,
        effects: ['Starts a system service'],
        warnings: [],
      };
    case 'stop':
      return {
        summary: `Stops service${unitLabel}`,
        effects: ['Stops a running service'],
        warnings: ['Active service users will be disconnected'],
      };
    case 'restart':
      return {
        summary: `Restarts service${unitLabel}`,
        effects: ['Stops then starts a service'],
        warnings: ['Brief downtime during restart'],
      };
    case 'reload':
      return {
        summary: `Reloads configuration for service${unitLabel}`,
        effects: ['Triggers SIGHUP on the service'],
        warnings: [],
      };
    case 'enable':
      return {
        summary: `Enables service${unitLabel} at boot`,
        effects: ['Adds boot-time start hook'],
        warnings: ['Persistent — survives reboot'],
      };
    case 'disable':
      return {
        summary: `Disables service${unitLabel} at boot`,
        effects: ['Removes boot-time start hook'],
        warnings: ['Persistent — survives reboot'],
      };
    case 'mask':
      return {
        summary: `Masks service${unitLabel}`,
        effects: ['Symlinks the unit file to /dev/null'],
        warnings: ['Service cannot be started until unmasked'],
      };
    case 'unmask':
      return {
        summary: `Unmasks service${unitLabel}`,
        effects: ['Removes the /dev/null symlink'],
        warnings: [],
      };
    case 'daemon-reload':
      return {
        summary: 'Reloads systemd unit files',
        effects: ['Re-reads /etc/systemd/system/'],
        warnings: [],
      };
    case 'status':
      return {
        summary: `Shows status for service${unitLabel}`,
        effects: [],
        warnings: [],
      };
    case 'reboot':
    case 'poweroff':
    case 'halt':
    case 'kexec':
    case 'suspend':
    case 'hibernate':
      return {
        summary: `${sub === 'reboot' ? 'Reboots' : sub === 'poweroff' ? 'Powers off' : sub === 'halt' ? 'Halts' : sub === 'kexec' ? 'Kexec-restarts' : sub === 'suspend' ? 'Suspends' : 'Hibernates'} the host`,
        effects: ['Terminates or pauses all running processes'],
        warnings: ['Host-level disruption — all connections drop'],
      };
    default:
      return {
        summary: `Runs systemctl ${sub}${unitLabel}`,
        effects: [],
        warnings: [],
      };
  }
}

function serviceExplain(args: string[]): ExplainResult {
  // SysV-style `service <unit> <action>` — args[0] is the unit, args[1] is the action.
  const unit = args[0];
  const action = args[1];
  if (unit === undefined) {
    return { summary: 'Runs service', effects: [], warnings: [] };
  }
  if (action === undefined) {
    return {
      summary: `Runs service ${unit}`,
      effects: [],
      warnings: [],
    };
  }
  switch (action) {
    case 'start':
      return {
        summary: `Starts service ${unit}`,
        effects: ['Starts a system service'],
        warnings: [],
      };
    case 'stop':
      return {
        summary: `Stops service ${unit}`,
        effects: ['Stops a running service'],
        warnings: ['Active service users will be disconnected'],
      };
    case 'restart':
      return {
        summary: `Restarts service ${unit}`,
        effects: ['Stops then starts a service'],
        warnings: ['Brief downtime during restart'],
      };
    case 'reload':
      return {
        summary: `Reloads configuration for service ${unit}`,
        effects: ['Triggers SIGHUP on the service'],
        warnings: [],
      };
    case 'status':
      return {
        summary: `Shows status for service ${unit}`,
        effects: [],
        warnings: [],
      };
    default:
      return {
        summary: `Runs service ${unit} ${action}`,
        effects: [],
        warnings: [],
      };
  }
}

function rebootExplain(_args: string[]): ExplainResult {
  return {
    summary: 'Reboots the host',
    effects: ['Terminates all running processes'],
    warnings: ['Host-level disruption — all connections drop'],
  };
}

function shutdownExplain(args: string[]): ExplainResult {
  // `shutdown -r now` reboots; `shutdown -h now` (or default) powers off; `shutdown -c` cancels.
  const flags = args.filter(a => a.startsWith('-'));
  const positional = positionalArgs(args);
  const time = positional[0]; // 'now', '+10', '23:30', etc.

  if (flags.includes('-c')) {
    return {
      summary: 'Cancels a pending shutdown',
      effects: ['Aborts the scheduled host shutdown'],
      warnings: [],
    };
  }
  const isReboot = flags.includes('-r');
  const verb = isReboot ? 'Reboots' : 'Shuts down';
  const summary = time !== undefined && time.length > 0
    ? `${verb} the host (scheduled: ${time})`
    : `${verb} the host`;
  return {
    summary,
    effects: ['Terminates all running processes'],
    warnings: ['Host-level disruption — all connections drop'],
  };
}

function initExplain(args: string[]): ExplainResult {
  const level = args[0];
  // `init 0` powers off; `init 6` reboots; `init 1` is single-user; `init 3`/`5` are multi-user.
  switch (level) {
    case '0':
      return {
        summary: 'Switches to runlevel 0 — powers off the host',
        effects: ['Terminates all running processes'],
        warnings: ['Host-level disruption — all connections drop'],
      };
    case '6':
      return {
        summary: 'Switches to runlevel 6 — reboots the host',
        effects: ['Terminates all running processes'],
        warnings: ['Host-level disruption — all connections drop'],
      };
    case '1':
    case 'S':
    case 's':
      return {
        summary: `Switches to single-user mode (runlevel ${level})`,
        effects: ['Stops most system services'],
        warnings: ['Network and multi-user services will be unavailable'],
      };
    case undefined:
      return { summary: 'Runs init', effects: [], warnings: [] };
    default:
      return {
        summary: `Switches to runlevel ${level}`,
        effects: [],
        warnings: ['Service availability may change'],
      };
  }
}

// ── Rule table ─────────────────────────────────────────────────────────────────

interface CommandRule {
  /** Tested against the raw command string to select this rule. */
  match: RegExp;
  /** Receives all tokens after the binary (args[0] = subcommand when present). */
  explain: (args: string[]) => ExplainResult;
}

const rules: CommandRule[] = [
  { match: /^git\b/,             explain: gitExplain },
  { match: /^npm\b/,             explain: npmExplain },
  { match: /^pip3?\s+install\b/, explain: pipInstall },
  { match: /^pytest\b/,          explain: (args) => pytestExplain(args) },
  { match: /^docker\b/,          explain: dockerExplain },
  { match: /^make\b/,            explain: makeExplain },
  { match: /^cargo\b/,           explain: cargoExplain },
  { match: /^go\b/,              explain: goExplain },
  { match: /^eslint\b/,          explain: eslintExplain },
  { match: /^prettier\b/,        explain: prettierExplain },
  // File system operations
  { match: /^rmdir\b/,           explain: rmdirExplain },
  { match: /^rm\b/,              explain: rmExplain },
  { match: /^cp\b/,              explain: cpExplain },
  { match: /^mv\b/,              explain: mvExplain },
  { match: /^chmod\b/,           explain: chmodExplain },
  { match: /^mkdir\b/,           explain: mkdirExplain },
  { match: /^rsync\b/,           explain: rsyncExplain },
  { match: /^unlink\b/,          explain: unlinkExplain },
  { match: /^shred\b/,           explain: shredExplain },
  { match: /^grep\b/,            explain: grepExplain },
  // Network commands
  { match: /^curl\b/,            explain: curlExplain },
  { match: /^wget\b/,            explain: wgetExplain },
  { match: /^ssh\b/,             explain: sshExplain },
  { match: /^mosh\b/,            explain: moshExplain },
  { match: /^telnet\b/,          explain: telnetExplain },
  { match: /^scp\b/,             explain: scpExplain },
  { match: /^sftp\b/,            explain: sftpExplain },
  { match: /^(nc|netcat)\b/,     explain: ncExplain },
  // Service / host-lifecycle management
  { match: /^systemctl\b/,       explain: systemctlExplain },
  { match: /^service\b/,         explain: serviceExplain },
  { match: /^reboot\b/,          explain: rebootExplain },
  { match: /^shutdown\b/,        explain: shutdownExplain },
  { match: /^init\b/,            explain: initExplain },
  // Permissions — modify (file ownership / mode / umask)
  { match: /^chown\b/,           explain: chownExplain },
  { match: /^umask\b/,           explain: umaskExplain },
  // Permissions — elevate (privilege change)
  { match: /^sudo\b/,            explain: sudoExplain },
  { match: /^su\b/,              explain: suExplain },
  { match: /^passwd\b/,          explain: passwdExplain },
  // Process signalling
  { match: /^kill\b/,            explain: killExplain },
  { match: /^pkill\b/,           explain: pkillExplain },
  { match: /^killall\b/,         explain: killallExplain },
  // Network diagnostics
  { match: /^ping\b/,             explain: pingExplain },
  { match: /^traceroute\b/,       explain: tracerouteExplain },
  { match: /^nslookup\b/,         explain: (args) => dnsLookupExplain('nslookup', args) },
  { match: /^dig\b/,              explain: (args) => dnsLookupExplain('dig', args) },
  { match: /^netstat\b/,          explain: (args) => netstatExplain('netstat', args) },
  { match: /^ss\b/,               explain: (args) => netstatExplain('ss', args) },
  { match: /^nmap\b/,             explain: nmapExplain },
  // Scheduling / persistence
  { match: /^crontab\b/,          explain: crontabExplain },
  { match: /^atq\b/,              explain: atqExplain },
  { match: /^atrm\b/,              explain: atrmExplain },
  { match: /^at\b/,               explain: atExplain },
  { match: /^batch\b/,            explain: batchExplain },
  // Distro / system package managers
  { match: /^apt(-get)?\b/,       explain: aptExplain },
  { match: /^yum\b/,              explain: (args) => yumDnfExplain('yum', args) },
  { match: /^dnf\b/,              explain: (args) => yumDnfExplain('dnf', args) },
  { match: /^dpkg\b/,             explain: dpkgExplain },
  { match: /^snap\b/,             explain: snapExplain },
  { match: /^brew\b/,             explain: brewExplain },
  { match: /^pacman\b/,           explain: pacmanExplain },
  // Cluster management + VM lifecycle
  { match: /^kubectl\b/,          explain: kubectlExplain },
  { match: /^virsh\b/,            explain: virshExplain },
  // Read-only file utilities
  { match: /^cat\b/,              explain: catExplain },
  { match: /^head\b/,             explain: headExplain },
  { match: /^tail\b/,             explain: tailExplain },
  { match: /^less\b/,             explain: (args) => ({ summary: positionalArgs(args)[0] !== undefined ? `Pages through ${positionalArgs(args)[0]} interactively` : 'Pages through stdin interactively', effects: ['Reads from the local filesystem'], warnings: ['Long-running — interactive pager does not return until quit'] }) },
  { match: /^more\b/,             explain: (args) => ({ summary: positionalArgs(args)[0] !== undefined ? `Pages through ${positionalArgs(args)[0]}` : 'Pages through stdin', effects: ['Reads from the local filesystem'], warnings: ['Long-running — interactive pager does not return until quit'] }) },
  { match: /^diff\b/,             explain: diffExplain },
  { match: /^find\b/,             explain: findExplain },
  { match: /^locate\b/,           explain: locateExplain },
  { match: /^tree\b/,             explain: treeExplain },
  { match: /^ls\b/,               explain: lsExplain },
  // Write-side file utilities
  { match: /^tee\b/,              explain: teeExplain },
  { match: /^touch\b/,            explain: touchExplain },
  { match: /^echo\b/,             explain: echoExplain },
  { match: /^printf\b/,           explain: printfExplain },
  // Compression / archives
  { match: /^tar\b/,              explain: tarExplain },
  { match: /^unzip\b/,            explain: unzipExplain },
  { match: /^zip\b/,              explain: zipExplain },
  { match: /^gunzip\b/,           explain: (args) => decompressorExplain('gunzip', args) },
  { match: /^bunzip2\b/,          explain: (args) => decompressorExplain('bunzip2', args) },
  { match: /^unxz\b/,             explain: (args) => decompressorExplain('unxz', args) },
  { match: /^gzip\b/,             explain: (args) => compressExplain('gzip', args) },
  { match: /^bzip2\b/,            explain: (args) => compressExplain('bzip2', args) },
  { match: /^xz\b/,               explain: (args) => compressExplain('xz', args) },
  { match: /^7z\b/,               explain: sevenZipExplain },
  // System info / monitoring
  { match: /^uname\b/,            explain: unameExplain },
  { match: /^ps\b/,               explain: psExplain },
  { match: /^top\b/,              explain: topExplain },
  { match: /^htop\b/,             explain: htopExplain },
  { match: /^df\b/,               explain: dfExplain },
  { match: /^du\b/,               explain: duExplain },
  { match: /^free\b/,             explain: freeExplain },
  { match: /^hostname\b/,         explain: hostnameExplain },
  { match: /^uptime\b/,           explain: uptimeExplain },
  { match: /^lsof\b/,             explain: lsofExplain },
  { match: /^id\b/,               explain: idExplain },
  { match: /^whoami\b/,           explain: whoamiExplain },
];

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns a structured explanation for `command`.
 *
 * When no rule matches the command a generic fallback summary is returned
 * so callers always receive a well-formed {@link ExplainResult}.
 *
 * @param command Raw command string (may include flags and arguments).
 */
export function explain(command: string): ExplainResult {
  const tokens = tokenize(command.trim());
  if (tokens.length === 0) {
    return { summary: 'Runs an unrecognised command', effects: [], warnings: [] };
  }

  const binary = tokens[0]!;
  const args = tokens.slice(1); // args[0] = subcommand when present

  for (const rule of rules) {
    if (rule.match.test(command)) {
      return rule.explain(args);
    }
  }

  return { summary: `Runs ${binary}`, effects: [], warnings: [] };
}

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

function dockerExplain(args: string[]): ExplainResult {
  const sub = args[0];
  switch (sub) {
    case 'run':   return dockerRunExplain(args);
    case 'build': return dockerBuildExplain(args);
    case 'exec':  return dockerExecExplain(args);
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
  return {
    summary: `Moves ${src} to ${dst}`,
    effects: ['Relocates or renames files on the filesystem', 'May overwrite destination if it exists'],
    warnings: [],
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

function mkdirExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const path = pos[0] ?? '<directory>';
  return {
    summary: `Creates directory ${path}`,
    effects: ['Creates a new directory on the filesystem'],
    warnings: [],
  };
}

function rsyncExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const src = pos[0] ?? '<source>';
  const dst = pos[1] ?? '<destination>';
  const isDelete = args.includes('--delete');
  const warnings: string[] = [];
  if (isDelete) warnings.push('--delete removes files at destination absent in source');
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

function scpExplain(args: string[]): ExplainResult {
  const pos = positionalArgs(args);
  const src = pos[0] ?? '<source>';
  const dst = pos.length > 1 ? pos[pos.length - 1]! : '<destination>';
  return {
    summary: `Securely copies files from ${src} to ${dst}`,
    effects: ['Transfers files over a network connection'],
    warnings: [],
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
  { match: /^rm\b/,              explain: rmExplain },
  { match: /^cp\b/,              explain: cpExplain },
  { match: /^mv\b/,              explain: mvExplain },
  { match: /^chmod\b/,           explain: chmodExplain },
  { match: /^mkdir\b/,           explain: mkdirExplain },
  { match: /^rsync\b/,           explain: rsyncExplain },
  // Network commands
  { match: /^curl\b/,            explain: curlExplain },
  { match: /^wget\b/,            explain: wgetExplain },
  { match: /^ssh\b/,             explain: sshExplain },
  { match: /^scp\b/,             explain: scpExplain },
  { match: /^(nc|netcat)\b/,     explain: ncExplain },
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

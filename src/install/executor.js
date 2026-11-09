const { hintFor } = require('./hints');
const { repairNpmPrefix, npmBinDir } = require('./npm-prefix');

// Executes install-plan entries produced by buildToolPlan (#28) for real
// (#29). Per tool it returns one of:
//   { status: 'installed', command, binDirs? }
//   { status: 'skipped',   reason: 'already installed' }
//   { status: 'failed',    command, error, hint }   ← hint = copyable fix
//
// Contract details the acceptance criteria pin down:
//   - every command runs through POSIX `sh` (the shell option literally says
//     "sh") — no /bin/bash hardcode, Alpine/NixOS keep working (story 13)
//   - after a successful install the tool's bin dir is prepended to THIS
//     process' PATH, so later installs in the same run see the new binary
//   - an npm EACCES triggers the no-sudo prefix repair (~/.npm-global) and
//     exactly one retry; a second failure returns `failed` + hint

const EXEC_TIMEOUT_MS = 20 * 60 * 1000; // generous: heavy deps (aider-chat, torch…) build for a long time

// Default executor shell per platform: POSIX `sh` everywhere (story 13 — no
// /bin/bash hardcode), cmd.exe on Windows (sh.exe is not part of the OS;
// winget/choco/scoop commands are cmd-compatible).
function defaultShell(platform) {
  return platform === 'win32' ? true : 'sh';
}

// The status probe text (`command -v <bin>`) is POSIX; cmd.exe needs `where`.
function probeCommand(statusSource, platform) {
  if (platform === 'win32') return String(statusSource).replace(/^command -v\s+/, 'where ');
  return statusSource;
}

// Runs a command. execFunc injectable for tests (they assert the shell option
// is 'sh' on POSIX). Resolves { code, stdout, stderr }.
function shExec(command, opts = {}) {
  const execFunc = opts.execFunc || require('child_process').exec;
  const shell = opts.shell === undefined ? defaultShell(opts.platform || process.platform) : opts.shell;
  return new Promise(resolve => {
    execFunc(command, {
      shell,
      timeout: opts.timeoutMs || EXEC_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: opts.env,
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code === undefined ? 1 : err.code) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        err,
      });
    });
  });
}

// Status probe: runs the entry's statusSource (`command -v <bin>` / `where`
// on Windows). Unix probes always run in sh.
async function isInstalled(entry, opts = {}) {
  const platform = opts.platform || process.platform;
  const source = entry.statusSource || `command -v ${entry.id}`;
  const res = await shExec(probeCommand(source, platform), {
    execFunc: opts.execFunc,
    shell: platform === 'win32' ? true : 'sh',
    platform,
  });
  return res.code === 0;
}

// Well-known bin dirs per install method — used for the in-process PATH
// refresh. Candidates that don't exist on disk are skipped by refreshPath.
const METHOD_BIN_CANDIDATES = {
  npm: (entry, ctx) => (ctx.npmBin ? [ctx.npmBin] : []),
  node: (entry, ctx) => (ctx.npmBin ? [ctx.npmBin] : []),
  nvm: () => [], // resolved dynamically via `nvm which current`
  cargo: () => ['~/.cargo/bin'],
  go: () => ['~/go/bin'],
  gem: () => ['~/.gem/ruby/bin'],
  composer: () => ['~/.composer/vendor/bin', '~/.config/composer/vendor/bin'],
  dotnet: () => ['~/.dotnet/tools'],
  pip: () => ['~/.local/bin'],
  python: () => ['~/.local/bin'],
  script: () => ['~/.local/bin'],
  rustup: () => ['~/.cargo/bin'],
};

// Resolves bin dirs for a freshly installed entry (exec for dynamic ones).
async function resolveBinDirs(entry, opts = {}) {
  const home = opts.home || require('os').homedir();
  const platform = opts.platform || process.platform;
  const expand = p => p.replace(/^~(?=\/|$)/, home);
  const dirs = [];
  const fs = opts.fs || require('fs');

  const push = d => { if (!dirs.includes(d)) dirs.push(d); };

  const candidates = (METHOD_BIN_CANDIDATES[entry.method] || (() => []))(entry, opts) || [];
  for (const c of candidates) {
    const dir = expand(c);
    try { fs.accessSync(dir); push(dir); } catch { /* not created — skip */ }
  }

  if (entry.method === 'nvm') {
    const res = await shExec('. "$HOME/.nvm/nvm.sh" && nvm which current', {
      execFunc: opts.execFunc, shell: 'sh',
    });
    if (res.code === 0 && res.stdout.trim()) {
      const nodeBin = require('path').dirname(res.stdout.trim().split('\n').pop().trim());
      try { fs.accessSync(nodeBin); push(nodeBin); } catch { /* skip */ }
    }
  }

  if (entry.method === 'npm' || entry.method === 'node') {
    // A repaired prefix means the bin dir is ~/.npm-global/bin, not the
    // system prefix the process started with.
    const { getNpmPrefix } = require('./npm-prefix');
    const prefix = opts.npmPrefix || await getNpmPrefix({ execFunc: opts.execFunc, platform });
    const bin = npmBinDir(prefix, platform);
    if (bin) {
      try { fs.accessSync(expand(bin)); push(expand(bin)); } catch { /* skip */ }
    }
  }

  return dirs;
}

// Prepends dirs to THIS process' PATH so later installs see new binaries.
// Returns the dirs actually added (dedup, existence-checked upstream).
function refreshProcessPath(dirs, { env, platform } = {}) {
  env = env || process.env;
  platform = platform || process.platform;
  const key = platform === 'win32' ? 'Path' in env ? 'Path' : 'PATH' : 'PATH';
  const sep = platform === 'win32' ? ';' : ':';
  const current = (env[key] || '').split(sep).filter(Boolean);
  const added = dirs.filter(d => !current.includes(d));
  if (added.length > 0) {
    env[key] = [...added, ...current].join(sep);
  }
  return added;
}

function isEaccsFailure(res) {
  const text = `${res.stderr}\n${res.stdout}\n${res.err && res.err.message || ''}`;
  return /EACCES|EPERM|permission denied/i.test(text);
}

// Installs ONE entry. Returns the per-tool result (see module doc).
async function installEntry(entry, opts = {}) {
  const platform = opts.platform || process.platform;
  const base = { id: entry.id, name: entry.name, category: entry.category, method: entry.method };

  if (entry.status === 'manual') {
    return { ...base, status: 'failed', error: entry.reason, hint: entry.reason };
  }
  if (entry.status === 'link') {
    return { ...base, status: 'skipped', reason: 'manual extension — install from the link', url: entry.url };
  }

  // Already present → skipped (AC: rerun → all skipped).
  if (await isInstalled(entry, opts)) {
    return { ...base, status: 'skipped', reason: 'already installed', statusSource: entry.statusSource };
  }

  const command = entry.command;
  // shell: 'powershell' only for Windows script-tools that need it; otherwise
  // the per-platform default (sh on unix, cmd on Windows).
  const shell = platform === 'win32' && entry.shell ? entry.shell : undefined;

  const run = () => shExec(command, { execFunc: opts.execFunc, shell, timeoutMs: opts.timeoutMs, platform });

  let res = await run();

  // npm global EACCES → no-sudo prefix repair + one retry.
  if (res.code !== 0 && isEaccsFailure(res) &&
      (entry.method === 'npm' || entry.method === 'node') && platform !== 'win32' &&
      opts.npmPrefixRepair !== false) {
    const repairFn = opts.repairNpmPrefix || repairNpmPrefix;
    const repair = await repairFn({
      home: opts.home, platform, execFunc: opts.execFunc, rcFile: opts.rcFile,
    });
    if (repair.repaired) {
      res = await run();
      if (res.code === 0) {
        const binDirs = await resolveBinDirs(entry, { ...opts, npmPrefix: repair.prefix });
        return {
          ...base, status: 'installed', command, binDirs,
          note: 'npm prefix repaired (~/.npm-global); future installs need no sudo',
        };
      }
    }
  }

  if (res.code !== 0) {
    const error = (res.stderr || res.stdout || '').trim().split('\n').slice(-6).join('\n')
      || (res.err && res.err.message) || `exit code ${res.code}`;
    return {
      ...base,
      status: 'failed',
      command,
      error,
      hint: hintFor(`${res.stderr}\n${res.stdout}\n${res.err && res.err.message || ''}`, {
        method: entry.method, command, manager: entry.manager, rcFile: opts.rcFile, platform,
      }),
    };
  }

  const binDirs = await resolveBinDirs(entry, opts);
  return { ...base, status: 'installed', command, binDirs };
}

// Installs a list of entries sequentially, refreshing the in-process PATH
// after each success. onProgress({ tool, result }) fires per finished tool
// (the wizard drives its spinner from it); onInstalled fires per successful
// install (the wizard/router hook the registry up to it).
async function executeInstall(entries, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const onStart = opts.onStart || (() => {});
  const onInstalled = opts.onInstalled || null;
  const results = [];

  for (const entry of entries) {
    onStart({ tool: entry });
    const result = await installEntry(entry, opts);
    if (result.status === 'installed' && result.binDirs && result.binDirs.length > 0) {
      result.pathAdded = refreshProcessPath(result.binDirs, { env: opts.env, platform: opts.platform });
    }
    if (result.status === 'installed' && onInstalled) {
      try {
        await onInstalled({ id: entry.id, name: entry.name, method: entry.method });
      } catch { /* registry must never break an install */ }
    }
    onProgress({ tool: entry, result });
    results.push(result);
  }

  return {
    results,
    installed: results.filter(r => r.status === 'installed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'failed').length,
  };
}

module.exports = {
  executeInstall,
  installEntry,
  isInstalled,
  refreshProcessPath,
  resolveBinDirs,
  shExec,
  probeCommand,
  defaultShell,
  METHOD_BIN_CANDIDATES,
  EXEC_TIMEOUT_MS,
};

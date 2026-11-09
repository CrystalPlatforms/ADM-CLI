const fs = require('fs');

// Map a shell name to the rc file ADM writes PATH entries to (#29 uses this).
const RC_FILES = {
  bash: '.bashrc',
  zsh: '.zshrc',
  sh: '.profile',
  ksh: '.kshrc',
  fish: '.config/fish/config.fish',
};

function rcFileFor(shellName) {
  return RC_FILES[shellName] || null;
}

function basename(p) {
  return String(p || '').split(/[\\/]/).pop().trim().toLowerCase();
}

function normalizeShellName(name) {
  const base = basename(name);
  if (!base) return null;
  // Strip version suffixes and login-shell markers: "zsh-5.9" → "zsh"
  if (base.startsWith('bash')) return 'bash';
  if (base.startsWith('zsh')) return 'zsh';
  if (base.startsWith('fish')) return 'fish';
  if (base.startsWith('ksh')) return 'ksh';
  if (base === 'sh' || base === 'dash' || base === 'ash') return 'sh';
  if (base.startsWith('powershell')) return 'powershell';
  if (base === 'pwsh') return 'pwsh';
  if (base === 'cmd') return 'cmd';
  return null;
}

// Walks up the parent process chain (ppid → parent → grandparent…) and
// returns the first ancestor whose name is a known shell. `readParentName(pid)`
// returns the process name for a pid, or null when it can't be read.
// `readPpid(pid)` returns the parent pid, or null to stop walking.
function shellFromParentChain(ppid, readParentName, readPpid, maxDepth = 4) {
  let pid = ppid;
  for (let depth = 0; depth < maxDepth && pid && pid > 1; depth++) {
    const shell = normalizeShellName(readParentName(pid));
    if (shell) return shell;
    if (!readPpid) break;
    pid = readPpid(pid);
    if (pid === null || pid === undefined) break;
  }
  return null;
}

function linuxParentName(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
  } catch {
    return null;
  }
}

function linuxParentPpid(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 4 (ppid) sits after the comm field, which may contain spaces and
    // parens — find the last ')' and parse fields after it.
    const afterComm = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    return parseInt(afterComm[1], 10) || null;
  } catch {
    return null;
  }
}

function darwinParentName(pid) {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' });
    return out.trim() || null;
  } catch {
    return null;
  }
}

// Detects the CURRENT shell (the one that launched adm):
//   1. parent process chain (works even when $SHELL points at the login shell)
//   2. fallback: $SHELL
// Windows: git-bash (MSYSTEM) → bash; otherwise powershell/cmd.
function detectShell(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;

  if (platform === 'win32') {
    if (env.MSYSTEM) return 'bash';
    if (env.PSModulePath) return 'powershell';
    return 'cmd';
  }

  const readParentName = opts.readParentName ||
    (platform === 'darwin' ? darwinParentName : linuxParentName);
  const readPpid = opts.readPpid || (platform === 'darwin' ? null : linuxParentPpid);

  const chainShell = shellFromParentChain(
    opts.ppid || process.ppid,
    readParentName,
    readPpid,
  );
  if (chainShell) return chainShell;

  const fromEnv = normalizeShellName(env.SHELL);
  if (fromEnv) return fromEnv;
  return 'unknown';
}

module.exports = { detectShell, rcFileFor, normalizeShellName, shellFromParentChain, RC_FILES };

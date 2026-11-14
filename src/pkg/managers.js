const fs = require('fs');
const path = require('path');

// Package-manager abstraction: which binary to look up and how to build the
// install command for a package name. All commands are POSIX `sh` compatible —
// no /bin/bash hardcoding (Alpine, NixOS…).
const MANAGERS = {
  brew:   { os: 'darwin', bin: 'brew',   install: pkgName => `brew install ${pkgName}` },
  apt:    { os: 'linux',  bin: 'apt-get', install: pkgName => `sudo apt-get install -y ${pkgName}` },
  dnf:    { os: 'linux',  bin: 'dnf',     install: pkgName => `sudo dnf install -y ${pkgName}` },
  pacman: { os: 'linux',  bin: 'pacman',  install: pkgName => `sudo pacman -S --noconfirm ${pkgName}` },
  zypper: { os: 'linux',  bin: 'zypper',  install: pkgName => `sudo zypper install -y ${pkgName}` },
  apk:    { os: 'linux',  bin: 'apk',     install: pkgName => `sudo apk add ${pkgName}` },
  winget: { os: 'win32',  bin: 'winget',  install: pkgName => `winget install --id ${pkgName} --exact --accept-source-agreements --accept-package-agreements` },
  choco:  { os: 'win32',  bin: 'choco',   install: pkgName => `choco install ${pkgName} --yes` },
  scoop:  { os: 'win32',  bin: 'scoop',   install: pkgName => `scoop install ${pkgName}` },
};

const SUPPORTED_MANAGERS = Object.keys(MANAGERS);

// PATH walk for a single binary name. Pure fs — no exec, fast enough for
// dry-run planning, deterministic and testable via env override.
function binaryAvailable(binName, opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const statSync = opts.statSync || fs.statSync;
  const accessSync = opts.accessSync || fs.accessSync;

  const sep = platform === 'win32' ? ';' : ':';
  const dirs = (env.PATH || env.Path || '').split(sep).filter(Boolean);
  const exts = platform === 'win32'
    ? ['', '.exe', '.cmd', '.bat', '.ps1']
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = `${dir}${path.sep}${binName}${ext}`;
      try {
        statSync(candidate);
        accessSync(candidate);
        return true;
      } catch {
        // next candidate
      }
    }
  }
  return false;
}

// Checks whether the manager's binary exists in PATH (delegates to the walk).
function isManagerAvailable(name, opts = {}) {
  const def = MANAGERS[name];
  if (!def) return false;
  return binaryAvailable(def.bin, opts);
}

// Install command for a manager + package name, or null for unknown manager.
function installCommand(manager, pkgName) {
  const def = MANAGERS[manager];
  if (!def) return null;
  return def.install(pkgName);
}

module.exports = { MANAGERS, SUPPORTED_MANAGERS, binaryAvailable, isManagerAvailable, installCommand };

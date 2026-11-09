const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseOsRelease } = require('./os-release');
const { detectShell, rcFileFor } = require('./shell');

// Maps a distro id (or an id from ID_LIKE) to its default package manager.
const DISTRO_MANAGERS = {
  ubuntu: 'apt',
  debian: 'apt',
  linuxmint: 'apt',
  pop: 'apt',
  neon: 'apt',
  kali: 'apt',
  raspbian: 'apt',
  fedora: 'dnf',
  rhel: 'dnf',
  centos: 'dnf',
  rocky: 'dnf',
  almalinux: 'dnf',
  amzn: 'dnf',
  ol: 'dnf',
  arch: 'pacman',
  manjaro: 'pacman',
  endeavouros: 'pacman',
  garuda: 'pacman',
  opensuse: 'zypper',
  'opensuse-leap': 'zypper',
  'opensuse-tumbleweed': 'zypper',
  suse: 'zypper',
  sles: 'zypper',
  alpine: 'apk',
};

// Normalizes process.arch to the supported set (others pass through).
function normalizeArch(arch) {
  if (arch === 'x64' || arch === 'ia32') return 'x64';
  if (arch === 'arm64') return 'arm64';
  return arch;
}

function readOsRelease(readFile) {
  for (const file of ['/etc/os-release', '/usr/lib/os-release']) {
    try {
      return readFile(file, 'utf8');
    } catch {
      // try next location
    }
  }
  return null;
}

function isWSL({ platform, env, readFile }) {
  if (platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    return /microsoft/i.test(readFile('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

// Resolves the package manager for a linux distro:
// exact ID first, then any ID_LIKE entry.
function linuxManager(osReleaseInfo) {
  if (osReleaseInfo.id && DISTRO_MANAGERS[osReleaseInfo.id]) {
    return DISTRO_MANAGERS[osReleaseInfo.id];
  }
  for (const like of osReleaseInfo.idLike || []) {
    if (DISTRO_MANAGERS[like]) return DISTRO_MANAGERS[like];
  }
  return 'none';
}

// Detects the full execution environment. All system access is injectable
// via opts (env/platform/arch/readFile) for deterministic tests.
//
// Result shape (frozen — also emitted by `adm config --json`):
//   os, distro, distroVersion, manager, arch, isWSL, shell, rcFile
function detectEnvironment(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const readFile = opts.readFile || fs.readFileSync;
  const arch = normalizeArch(opts.arch || process.arch);

  let distro = null;
  let distroVersion = null;
  let manager = 'none';

  if (platform === 'linux') {
    const info = parseOsRelease(opts.osRelease || readOsRelease(readFile) || '');
    if (info.id) distro = info.id;
    distroVersion = info.version;
    manager = linuxManager(info);
  } else if (platform === 'darwin') {
    manager = 'brew';
  } else if (platform === 'win32') {
    manager = 'winget';
  }

  const shell = detectShell({ env, platform, readParentName: opts.readParentName, readPpid: opts.readPpid, ppid: opts.ppid });

  return {
    os: platform,
    distro,
    distroVersion,
    manager,
    arch,
    isWSL: isWSL({ platform, env, readFile }),
    shell,
    rcFile: rcFileFor(shell),
  };
}

// Text block for `adm config`.
function formatEnvironment(env) {
  const osPart = env.distro
    ? `${env.os} — ${env.distro}${env.distroVersion ? ' ' + env.distroVersion : ''}`
    : env.os;
  const lines = [
    `  OS:        ${osPart}${env.isWSL ? ' (WSL)' : ''}`,
    `  Arch:      ${env.arch}`,
    `  Packages:  ${env.manager}`,
    `  Shell:     ${env.shell}${env.rcFile ? ` (${env.rcFile})` : ''}`,
  ];
  return lines.join('\n');
}

module.exports = { detectEnvironment, formatEnvironment, normalizeArch, DISTRO_MANAGERS };

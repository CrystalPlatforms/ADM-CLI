const fs = require('fs');
const os = require('os');
const path = require('path');
const { findOnPath, managerAvailable } = require('./inventory');

// tool-info (plan plans/adm-tools-tui.md, Phase 3, #38) — terminal-neutral
// data module behind the `adm tools` side panel. ONE deep call:
//
//   getToolInfo(entry, opts) → { version, binPath, method, size, sizeLabel,
//     configPaths, cachePaths, docsPaths,
//     flags: { canUpdate, canRemove, hasCache, canReveal } }
//
// LAZINESS CONTRACT: the disk size is computed HERE — when a tool gets
// selected — never in scanInventory (which does not import this module).
// Flags are the ONLY truth for dimming the u/r/f/c shortcuts; executing the
// actions is Phase 4, the reveal command itself Phase 5.

// Size of a target: file → its bytes; directory (brew keg, tool folder) →
// recursive walk. Unreadable/missing target → null (the panel shows "—").
function computeSize(target, { fs: fsMod = fs } = {}) {
  let st;
  try {
    st = fsMod.statSync(target);
  } catch {
    return null;
  }
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return null;
  let total = 0;
  let names;
  try {
    names = fsMod.readdirSync(target);
  } catch {
    return null;
  }
  for (const name of names) {
    const child = path.join(target, name);
    try {
      if (fsMod.statSync(child).isDirectory()) {
        const nested = computeSize(child, { fs: fsMod });
        if (nested !== null) total += nested;
      } else {
        total += fsMod.statSync(child).size;
      }
    } catch {
      // unreadable entry — skipped, not fatal
    }
  }
  return total;
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const u of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = u;
  }
  return `${value.toFixed(1)} ${unit}`;
}

// Conventional per-platform locations; ONLY actually-existing paths come
// back (checked here, at tool-info time — not during the scan).
function existingAmong(candidates, { fs: fsMod = fs } = {}) {
  return candidates.filter(p => {
    try {
      return fsMod.existsSync(p);
    } catch {
      return false;
    }
  });
}

// Well-known REAL locations for popular tools (owner fix: the generic
// per-id conventions rarely match actual apps, so config/cache rendered
// "—" almost everywhere). Paths are relative to the home directory.
// WELL-KNOWN candidates come FIRST; only existing paths survive (the same
// existingAmong gate as the generic ones — we never invent a location).
const WELL_KNOWN = {
  git: {
    config: { default: ['.gitconfig'], win32: ['.gitconfig', 'AppData/Roaming/git/config'] },
  },
  gh: {
    config: {
      win32: ['AppData/Roaming/GitHub CLI'],
      darwin: ['.config/gh'],
      linux: ['.config/gh'],
    },
  },
  npm: {
    config: { default: ['.npmrc'] },
    cache: {
      win32: ['AppData/Local/npm-cache'],
      default: ['.npm'],
    },
  },
  pip: {
    config: {
      win32: ['AppData/Roaming/pip/pip.ini'],
      default: ['.config/pip/pip.conf'],
    },
    cache: {
      win32: ['AppData/Local/pip/cache'],
      darwin: ['Library/Caches/pip'],
      linux: ['.cache/pip'],
    },
  },
  cargo: {
    config: { default: ['.cargo/config.toml'] },
    cache: { default: ['.cargo/registry'] },
  },
  rustup: {
    config: { default: ['.cargo/config.toml'] },
    cache: { default: ['.rustup'] },
  },
  docker: {
    config: { default: ['.docker/config.json'] },
  },
  ssh: {
    config: { default: ['.ssh'] },
  },
  starship: {
    config: { default: ['.config/starship.toml'] },
  },
};

function resolveLocations(id, platform, { home, env, fs: fsMod, manager, binPath }) {
  const join = (...parts) => path.join(...parts);
  const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
  const localAppData = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  const programData = env.ProgramData || join(home, 'ProgramData');
  const config = {
    win32: [join(appData, id)],
    darwin: [join(home, 'Library', 'Application Support', id), join(home, '.config', id)],
    linux: [join(home, '.config', id)],
  }[platform] || [join(home, '.config', id)];
  const cache = {
    win32: [join(localAppData, id, 'cache')],
    darwin: [join(home, 'Library', 'Caches', id)],
    linux: [join(home, '.cache', id)],
  }[platform] || [join(home, '.cache', id)];
  // docs candidates (owner fix: on Windows /usr/share/doc-style paths never
  // exist, so docs rendered "—" forever). Windows tools keep docs in real,
  // checkable places: the chocolatey lib dir, the scoop app dir, ProgramData;
  // npm-managed tools keep theirs (README/LICENSE) inside the package dir.
  const docs = {
    win32: [
      join(programData, id, 'docs'),
      join(programData, 'chocolatey', 'lib', id),
      join(home, 'scoop', 'apps', id, 'current'),
      join(programData, id),
    ],
    darwin: [join('/usr/local/share/doc', id)],
    linux: [join('/usr/share/doc', id)],
  }[platform] || [];
  if (manager === 'npm' && binPath) {
    if (platform === 'win32') {
      docs.push(join(path.dirname(binPath), 'node_modules', id));
    } else {
      docs.push(join(path.dirname(path.dirname(binPath)), 'lib', 'node_modules', id));
    }
  }
  // well-known REAL locations first (git → ~/.gitconfig, npm → ~/.npm …)
  const wk = WELL_KNOWN[id];
  const wellKnown = section => {
    if (!wk || !wk[section]) return [];
    const map = wk[section];
    return (map[platform] || map.default || []).map(rel => join(home, ...rel.split('/')));
  };
  return {
    config: [...wellKnown('config'), ...config],
    cache: [...wellKnown('cache'), ...cache],
    docs,
  };
}

// Platform reveal availability (Phase 5 composes the actual command):
//   win32 → explorer.exe, darwin → /usr/bin/open, linux → xdg-open on PATH.
function revealAvailable(platform, { env, fs: fsMod }) {
  try {
    if (platform === 'win32') {
      const root = env.SystemRoot || 'C:\\Windows';
      return fsMod.existsSync(path.join(root, 'explorer.exe'));
    }
    if (platform === 'darwin') return fsMod.existsSync('/usr/bin/open');
    return Boolean(findOnPath('xdg-open', {
      env,
      platform,
      statSync: fsMod.statSync,
      accessSync: fsMod.accessSync,
    }));
  } catch {
    return false;
  }
}

// Manager availability lives in inventory (managerAvailable) — the scan uses
// the same map for registry healing (owner fix: a recorded method whose
// manager is absent must not claim attribution NOR enable actions).

function getToolInfo(entry, opts = {}) {
  const platform = opts.platform || process.platform;
  const home = opts.home || os.homedir();
  const env = opts.env || process.env;
  const fsMod = opts.fs || fs;

  const locations = resolveLocations(entry.id, platform, {
    home, env, fs: fsMod, manager: entry.manager, binPath: entry.binPath,
  });
  const configPaths = existingAmong(locations.config, { fs: fsMod });
  const cachePaths = existingAmong(locations.cache, { fs: fsMod });
  const docsPaths = existingAmong(locations.docs, { fs: fsMod });

  const size = entry.binPath ? computeSize(entry.binPath, { fs: fsMod }) : null;
  const available = managerAvailable(entry.manager, {
    env, platform, statSync: fsMod.statSync, accessSync: fsMod.accessSync,
  });
  const flags = {
    canUpdate: Boolean(entry.manager) && available,
    canRemove: Boolean(entry.manager) && (entry.manager === 'go' || available),
    hasCache: cachePaths.length > 0,
    canReveal: Boolean(entry.binPath) && revealAvailable(platform, { env, fs: fsMod }),
  };

  return {
    id: entry.id,
    name: entry.name || entry.id,
    version: entry.version || null,
    binPath: entry.binPath || null,
    method: entry.manager || null,
    size,
    sizeLabel: formatSize(size),
    configPaths,
    cachePaths,
    docsPaths,
    flags,
  };
}

module.exports = { getToolInfo };

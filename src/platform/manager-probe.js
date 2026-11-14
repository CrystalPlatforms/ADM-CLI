// Manager availability detection (PRD #42, C1): ADM probes which package
// managers REALLY exist instead of assuming brew on macOS / winget on Windows.
//
// The probe runs ONCE per run (the whole availability snapshot in one call —
// never per tool) and is pure fs PATH-walking: no exec, deterministic, and
// injectable for tests (env / platform / isManagerAvailable overrides).
//
// Native-priority order:
//   Linux:  the distro's own manager (from /etc/os-release) first, then the
//           remaining managers in apt → dnf → pacman → zypper → apk order
//   macOS:  brew
//   Windows: winget → choco → scoop

const { isManagerAvailable, binaryAvailable } = require('../pkg/managers');

const LINUX_ORDER = ['apt', 'dnf', 'pacman', 'zypper', 'apk'];
const WIN_ORDER = ['winget', 'choco', 'scoop'];
const DARWIN_ORDER = ['brew'];

// Ecosystem managers probed in the SAME one-shot snapshot (the consent
// engine, #44, consumes these — it never samples PATH itself). pip counts as
// available when any of pip/pip3/python3 is on PATH (`python3 -m pip` is the
// builders' fallback).
const ECOSYSTEM_BINS = {
  npm: ['npm'],
  pip: ['pip', 'pip3', 'python3'],
  cargo: ['cargo'],
  go: ['go'],
  gem: ['gem'],
  composer: ['composer'],
  dotnet: ['dotnet'],
};

// Manager candidates for a platform, most native first. On Linux the distro
// manager (mapped from os-release) leads when it is one of the known ones.
function managerCandidates(platform, distroManager) {
  if (platform === 'linux') {
    if (distroManager && LINUX_ORDER.includes(distroManager)) {
      return [distroManager, ...LINUX_ORDER.filter(m => m !== distroManager)];
    }
    return [...LINUX_ORDER];
  }
  if (platform === 'darwin') return [...DARWIN_ORDER];
  if (platform === 'win32') return [...WIN_ORDER];
  return [];
}

// Pure selection: the first candidate present in the availability map wins;
// 'none' when nothing is available. availability: { [managerId]: boolean }.
function selectManager({ platform, distroManager, availability }) {
  for (const m of managerCandidates(platform, distroManager)) {
    if (availability[m]) return m;
  }
  return 'none';
}

// One-shot availability probe: the platform's candidate managers AND the
// ecosystem managers, in a single snapshot. opts: { platform, env,
// distroManager, isManagerAvailable, ecosystems, statSync, accessSync } —
// all injectable; pass `ecosystems: false` to probe system managers only.
function probeManagers(opts = {}) {
  const platform = opts.platform || process.platform;
  const check = opts.isManagerAvailable || isManagerAvailable;
  const fsOpts = {
    env: opts.env,
    platform,
    statSync: opts.statSync,
    accessSync: opts.accessSync,
  };
  const availability = {};
  for (const m of managerCandidates(platform, opts.distroManager)) {
    availability[m] = check(m, fsOpts);
  }
  if (opts.ecosystems !== false) {
    for (const [name, bins] of Object.entries(ECOSYSTEM_BINS)) {
      availability[name] = bins.some(bin => binaryAvailable(bin, fsOpts));
    }
  }
  return availability;
}

module.exports = { managerCandidates, selectManager, probeManagers, ECOSYSTEM_BINS, LINUX_ORDER, WIN_ORDER, DARWIN_ORDER };

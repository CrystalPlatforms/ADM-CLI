const fs = require('fs');
const os = require('os');
const path = require('path');
const { registryFile } = require('../setup/registry');
const { loadCatalog } = require('../setup/catalog');
const { resolvePackageName } = require('../pkg/package-names');
const {
  parseBrewList,
  parsePipList,
  parseCargoInstallList,
  parseDpkgQuery,
  parseRpmQa,
  parsePacmanQ,
  parseZypperSearch,
  parseApkInfo,
  parseWingetList,
  parseChocoList,
  parseScoopList,
  goBinEntries,
  parseNpmList,
} = require('./managers');

// Inventory (plan plans/adm-tools-tui.md, Phase 2, #37).
//
// Merges every source into one ToolEntry per tool:
//   1. registry  (~/.adm/installed.json) → source 'adm'   (highest priority)
//   2. managers  (npm, brew, pip, cargo, go, system-*)   → per-manager groups
//   3. catalog   (PATH scan of catalog tools)            → 'other' (lowest)
//
// Attribution priority: registry > manager > catalog. Later sources only
// FILL blanks (version, binPath) — they never re-attribute a merged entry.
// Manager probes are PLATFORM-GATED (winget/choco/scoop only on win32, the
// Linux system managers only on linux, brew on darwin+linux) and run in
// PARALLEL. Result always carries all 8 groups in a fixed order; a failed,
// missing or unparseable source yields an empty group + warning — never a
// crash.

// Group order is the display order in the TUI (frozen, plan decision).
const GROUPS = [
  { id: 'adm', label: 'ADM' },
  { id: 'npm', label: 'npm' },
  { id: 'brew', label: 'brew' },
  { id: 'pip', label: 'pip' },
  { id: 'cargo', label: 'cargo' },
  { id: 'go', label: 'go' },
  { id: 'system', label: 'system' },
  { id: 'other', label: 'other' },
];

// Manager probe registry. `platforms: null` = probe everywhere. Raw output can
// be injected per manager via `optKey` (fixtures / tests) — an injection is
// honored on ANY platform and bypasses exec entirely; only the real probes
// respect platform gating. `go` is a directory scan, not a command.
const MANAGER_SOURCES = [
  {
    key: 'npm', group: 'npm', platforms: null,
    command: 'npm ls -g --json', parse: parseNpmList, optKey: 'npmJson',
    missing: 'npm not found — global packages not scanned',
    broken: 'npm global list not parseable — skipped',
  },
  {
    key: 'brew', group: 'brew', platforms: ['darwin', 'linux'],
    command: 'brew list --json=v2', parse: parseBrewList, optKey: 'brewJson',
    missing: 'brew not found — Homebrew packages not scanned',
    broken: 'brew list output not parseable — skipped',
  },
  {
    key: 'pip', group: 'pip', platforms: null,
    command: 'pip3 list --format=json', parse: parsePipList, optKey: 'pipJson',
    missing: 'pip3 not found — pip packages not scanned',
    broken: 'pip list output not parseable — skipped',
  },
  {
    key: 'cargo', group: 'cargo', platforms: null,
    command: 'cargo install --list', parse: parseCargoInstallList, optKey: 'cargoList',
    missing: 'cargo not found — installed crates not scanned',
    broken: 'cargo install --list output not parseable — skipped',
  },
  {
    key: 'go', group: 'go', platforms: null,
    command: null, parse: null, optKey: 'goBinDir',
    missing: 'go bin directory not found — go installs not scanned',
    broken: 'go bin directory not found — go installs not scanned',
  },
  {
    key: 'dpkg', group: 'system', platforms: ['linux'],
    command: "dpkg-query -W -f='${Package}\\t${Version}\\n'", parse: parseDpkgQuery, optKey: 'dpkgOut',
    missing: 'dpkg not found — dpkg packages not scanned',
    broken: 'dpkg-query output not parseable — skipped',
  },
  {
    key: 'rpm', group: 'system', platforms: ['linux'],
    command: "rpm -qa --qf='%{NAME}\\t%{VERSION}-%{RELEASE}\\n'", parse: parseRpmQa, optKey: 'rpmOut',
    missing: 'rpm not found — rpm packages not scanned',
    broken: 'rpm -qa output not parseable — skipped',
  },
  {
    key: 'pacman', group: 'system', platforms: ['linux'],
    command: 'pacman -Q', parse: parsePacmanQ, optKey: 'pacmanOut',
    missing: 'pacman not found — pacman packages not scanned',
    broken: 'pacman -Q output not parseable — skipped',
  },
  {
    key: 'zypper', group: 'system', platforms: ['linux'],
    command: 'zypper --quiet search --installed-only', parse: parseZypperSearch, optKey: 'zypperOut',
    missing: 'zypper not found — zypper packages not scanned',
    broken: 'zypper output not parseable — skipped',
  },
  {
    key: 'apk', group: 'system', platforms: ['linux'],
    command: 'apk info -v', parse: parseApkInfo, optKey: 'apkOut',
    missing: 'apk not found — apk packages not scanned',
    broken: 'apk info output not parseable — skipped',
  },
  {
    key: 'winget', group: 'system', platforms: ['win32'],
    command: 'winget list --accept-source-agreements', parse: parseWingetList, optKey: 'wingetOut',
    missing: 'winget not found — winget packages not scanned',
    broken: 'winget list output not parseable — skipped',
  },
  {
    key: 'choco', group: 'system', platforms: ['win32'],
    command: 'choco list', parse: parseChocoList, optKey: 'chocoOut',
    missing: 'choco not found — Chocolatey packages not scanned',
    broken: 'choco list output not parseable — skipped',
  },
  {
    key: 'scoop', group: 'system', platforms: ['win32'],
    command: 'scoop list', parse: parseScoopList, optKey: 'scoopOut',
    missing: 'scoop not found — scoop packages not scanned',
    broken: 'scoop list output not parseable — skipped',
  },
];

// Pure PATH walk (same contract as pkg/managers.isManagerAvailable):
// returns the first existing executable candidate or null.
function findOnPath(binName, { env, platform, statSync, accessSync }) {
  const sep = platform === 'win32' ? ';' : ':';
  // Path separator follows the INJECTED platform (tests may fake 'linux' on
  // a Windows host — path.sep alone would build '\Users\…' candidates).
  const psep = platform === 'win32' ? path.sep : '/';
  const dirs = String(env.PATH || env.Path || '').split(sep).filter(Boolean);
  const exts = platform === 'win32' ? ['', '.exe', '.cmd', '.bat', '.ps1'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = `${dir}${psep}${binName}${ext}`;
      try {
        accessSync(candidate);
      } catch {
        continue; // not reachable → next candidate
      }
      // ACCESS is the authority: statSync can throw EACCES on Windows
      // app-execution aliases (winget.exe is a reparse point in
      // WindowsApps) even though the executable works. statSync still
      // filters directories that merely share the tool's name.
      let ok = true;
      try {
        ok = statSync(candidate).isFile();
      } catch {
        // stat unavailable (alias) — the reachable candidate wins
      }
      if (ok) return candidate;
    }
  }
  return null;
}

// Manager-binary map (owner fix): the registry records a method family, but
// the COMMANDS run a specific binary — dpkg-query READS, apt REMOVES; the
// read probe may differ from the action binary, hence dpkg→apt / rpm→dnf.
// Shared by the scan (registry healing) and tool-info (capability flags).
const MANAGER_BIN = {
  npm: 'npm', brew: 'brew', pip: 'pip3', cargo: 'cargo', go: 'go',
  dpkg: 'apt', rpm: 'dnf', pacman: 'pacman', zypper: 'zypper', apk: 'apk',
  winget: 'winget', choco: 'choco', scoop: 'scoop',
};

// Is the manager binary actually reachable? Registry entries can carry a
// method whose manager does not exist on THIS machine (git recorded 'brew'
// on Windows) — such a method must not claim attribution nor enable actions.
function managerAvailable(managerKey, { env, platform, statSync, accessSync }) {
  const bin = MANAGER_BIN[managerKey];
  if (!bin) return false;
  try {
    return Boolean(findOnPath(bin, { env, platform, statSync, accessSync }));
  } catch {
    return false;
  }
}

// Healed registry entries fall back to the DETECTED system manager of this
// machine (same first-available order the adm wizard uses for installs) —
// a manager-backed registry method that is absent almost certainly belongs
// to this manager instead. Null when no system manager exists at all.
const SYSTEM_MANAGERS_BY_PLATFORM = {
  win32: ['winget', 'choco', 'scoop'],
  linux: ['apt', 'dnf', 'pacman', 'zypper', 'apk'],
  darwin: ['brew'],
};

function detectSystemManager({ env, platform, statSync, accessSync }) {
  for (const m of SYSTEM_MANAGERS_BY_PLATFORM[platform] || []) {
    if (managerAvailable(m, { env, platform, statSync, accessSync })) return m;
  }
  return null;
}

// Runs one manager command. Never throws — a failed/missing manager becomes
// { ok: false, missing: true } (empty group + warning).
async function fetchManagerOutput(command, opts) {
  const execFunc = opts.execFunc || require('child_process').exec;
  const res = await new Promise(resolve => {
    execFunc(command, { shell: process.platform === 'win32' ? undefined : 'sh' }, (err, stdout) => {
      resolve({ err, stdout: String(stdout || '') });
    });
  });
  if (res.err) return { ok: false, missing: true };
  return { ok: true, raw: res.stdout };
}

// exit-0 with EMPTY output is a normal "zero packages" state for every
// manager — only NON-empty unparseable output counts as broken.
function parseSourceRaw(src, raw) {
  const s = String(raw || '');
  const parsed = s.trim() === '' ? [] : src.parse(s);
  return parsed === null
    ? { ok: false, missing: false, entries: [] }
    : { ok: true, entries: parsed };
}

// Evaluates ONE manager source to { ok, missing?, entries } (never throws).
async function evaluateSource(src, opts, platform) {
  // go: a directory scan of ~/go/bin (or injected goBinDir), not a command
  if (src.key === 'go') {
    const dir = opts.goBinDir !== undefined
      ? opts.goBinDir
      : path.join(opts.home || os.homedir(), 'go', 'bin');
    const entries = goBinEntries(dir, { fs: opts.fs || fs, platform });
    return entries === null ? { ok: false, missing: true, entries: [] } : { ok: true, entries };
  }
  // raw injection (fixtures): honored on any platform, exec bypassed
  if (opts[src.optKey] !== undefined) {
    return parseSourceRaw(src, opts[src.optKey]);
  }
  const fetched = await fetchManagerOutput(src.command, opts);
  if (!fetched.ok) return { ok: false, missing: true, entries: [] };
  return parseSourceRaw(src, fetched.raw);
}

// Group warning policy (owner fix): a MISSING manager (binary absent — brew
// on Windows, ~/go/bin without go) is normal, not noise → silent. Only
// PRESENT-but-BROKEN output (unparseable, corrupt) warns: an empty group
// without a warning is hidden entirely by the TUI.
function groupWarning(results, srcByKey) {
  const msgs = results
    .filter(r => !r.ok && !r.missing)
    .map(f => srcByKey.get(f.key).broken);
  return msgs.filter(Boolean).join('; ') || null;
}

// Finds the stored entry this manager PACKAGE belongs to: 'Git.Git' matches
// the stored 'git' (resolvePackageName('git', 'winget') === 'Git.Git').
// Unmapped/manual mappings never match (a { manual } result has no name).
function findPackageMatch(stored, packageId, managerKey) {
  for (const e of stored) {
    if (e.manager === managerKey || e.manager === null || e.manager === undefined) {
      const r = resolvePackageName(e.id, managerKey);
      if (r && r.name === packageId) return e;
    }
  }
  return null;
}

// Registry read that reports STATUS (unlike setup/registry.readRegistry,
// which silently returns []): a missing or corrupt file becomes a warning
// row in the ADM group, not silence.
function readRegistrySource(opts = {}) {
  const fsMod = opts.fs || fs;
  try {
    const data = JSON.parse(fsMod.readFileSync(registryFile(opts), 'utf8'));
    return { ok: true, entries: Array.isArray(data) ? data : [] };
  } catch {
    return { ok: false, entries: [] };
  }
}

// Single-manager probe (Phase 4 auto-refresh after `u`): re-evaluates ONE
// source — injections honored, real probes exec — and returns its entries.
// Used by tool-actions.refreshEntryAfterUpdate; never throws.
async function probeManager(key, opts = {}) {
  const src = MANAGER_SOURCES.find(s => s.key === key);
  if (!src) return { ok: false, entries: [] };
  return evaluateSource(src, opts, opts.platform || process.platform);
}

async function scanInventory(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const statSync = opts.statSync || fs.statSync;
  const accessSync = opts.accessSync || fs.accessSync;
  const onProgress = opts.onProgress || (() => {});
  const srcByKey = new Map(MANAGER_SOURCES.map(s => [s.key, s]));

  // Progress model for the TUI scan counter: 1 registry step + one step per
  // PROBED manager (settles out of order — parallel) + one per catalog tool.
  // Strictly monotonic, ends at (total, total).
  const probedSources = MANAGER_SOURCES.filter(s => {
    if (opts[s.optKey] !== undefined) return true; // injected fixtures always count
    return !s.platforms || s.platforms.includes(platform);
  });
  let catalogList;
  let catalogWarning = null;
  if (opts.catalog !== undefined) {
    catalogList = opts.catalog;
  } else {
    try {
      catalogList = (opts.catalogLoader || (() => loadCatalog().flatMap(c => c.tools)))();
    } catch {
      catalogList = [];
      catalogWarning = 'tool catalog not readable — PATH scan skipped';
    }
  }
  const total = 1 + probedSources.length + catalogList.length;
  let done = 0;
  const tick = () => { done += 1; onProgress(done, total); };

  const byId = new Map();

  // 1. registry — highest attribution priority ('adm')
  let registryWarning = null;
  const registrySource = opts.registry !== undefined
    ? { ok: true, entries: opts.registry }
    : readRegistrySource(opts);
  if (!registrySource.ok) registryWarning = 'ADM registry not found — ADM-installed tools not listed';
  tick(); // step 1: registry
  for (const r of registrySource.entries) {
    if (!r || !r.id) continue;
    // HEALING (owner fix): the registry can carry a method whose manager is
    // absent on this machine (older installs recorded the catalog family —
    // 'brew' — even when winget actually ran). Such a method falls back to
    // the DETECTED system manager (u/r stay ACTIVE, running the manager that
    // really owns the tool); null only when no system manager exists.
    let manager = r.method || null;
    if (manager && !managerAvailable(manager, { env, platform, statSync, accessSync })) {
      manager = detectSystemManager({ env, platform, statSync, accessSync });
    }
    byId.set(r.id, {
      id: r.id,
      name: r.name || r.id,
      version: null,
      binPath: null,
      source: 'adm',
      manager,
      installedAt: r.installedAt || null,
    });
  }

  // 2. manager probes in PARALLEL — merged in MANAGER_SOURCES order
  //    (fixed attribution order among managers: first source that saw the id wins)
  const results = new Map();
  await Promise.all(probedSources.map(async src => {
    const r = await evaluateSource(src, opts, platform);
    results.set(src.key, { ...r, key: src.key });
    tick(); // one step per settled probe
  }));

  const mergeManagerEntries = (entries, src) => {
    for (const e of entries) {
      if (!e || !e.id) continue;
      // Managers report PACKAGE ids ('Git.Git'), not tool ids ('git') — a
      // manager entry also matches an EXISTING entry whose id resolves to
      // that package for this manager (registry 'git' then receives winget's
      // version/path, and no duplicate 'Git.Git' row appears in "system").
      const existing = byId.get(e.id)
        || findPackageMatch([...byId.values()], e.id, src.key);
      if (existing) {
        if (!existing.version && e.version) existing.version = e.version;
        if (!existing.binPath && e.binPath) existing.binPath = e.binPath;
        if (!existing.manager) existing.manager = src.key;
      } else {
        byId.set(e.id, {
          id: e.id,
          name: e.name || e.id,
          version: e.version || null,
          binPath: e.binPath || null,
          source: src.group,
          manager: src.key,
          installedAt: null,
        });
      }
    }
  };

  for (const src of MANAGER_SOURCES) {
    const r = results.get(src.key);
    if (r) mergeManagerEntries(r.entries, src);
  }

  // 3. catalog-driven PATH scan (v0.3 detection) — fills binPath; a tool
  //    seen nowhere else lands in 'other' (no manager can be proven)
  for (const tool of catalogList) {
    tick(); // one per catalog tool (even malformed entries)
    if (!tool || !tool.id) continue;
    const binPath = findOnPath(tool.id, { env, platform, statSync, accessSync });
    if (!binPath) continue;
    const existing = byId.get(tool.id);
    if (existing) {
      if (!existing.binPath) existing.binPath = binPath;
      // a name equal to the raw id counts as blank — the catalog's display
      // name fills it (npm package names carry no display name)
      if (existing.name === existing.id && tool.name && tool.name !== tool.id) existing.name = tool.name;
    } else {
      byId.set(tool.id, {
        id: tool.id,
        name: tool.name || tool.id,
        version: null,
        binPath,
        source: 'other',
        manager: null,
        installedAt: null,
      });
    }
  }

  const groups = GROUPS.map(g => ({ ...g, entries: [], warning: null }));
  for (const g of groups) {
    if (g.id === 'adm') {
      g.warning = registryWarning;
    } else if (g.id === 'other') {
      g.warning = catalogWarning;
    } else {
      const groupSources = MANAGER_SOURCES.filter(s => s.group === g.id && results.has(s.key));
      g.warning = groupWarning(groupSources.map(s => results.get(s.key)), srcByKey);
    }
  }
  const sorted = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const entry of sorted) {
    const group = groups.find(g => g.id === entry.source);
    if (group) group.entries.push(entry);
  }

  return { entries: groups.flatMap(g => g.entries), groups };
}

module.exports = { scanInventory, findOnPath, probeManager, managerAvailable, detectSystemManager };

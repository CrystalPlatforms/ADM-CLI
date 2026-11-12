const fs = require('fs');
const path = require('path');
const { registryFile } = require('../setup/registry');
const { loadCatalog } = require('../setup/catalog');

// Inventory (plan plans/adm-tools-tui.md, Phase 1 tracer, #36).
//
// Merges three sources into one ToolEntry per tool:
//   1. registry  (~/.adm/installed.json)      → source 'adm'    (highest)
//   2. npm       (`npm ls -g --json`)         → source 'npm'
//   3. catalog   (PATH scan of catalog tools) → source 'other'  (lowest)
//
// Attribution priority: registry > manager > catalog. Later sources only
// FILL blanks (version, binPath) — they never re-attribute a merged entry.
// Result always carries all 8 groups in a fixed order; a failed or missing
// source yields an empty group + warning — never a crash (Phase 2 adds the
// remaining managers).

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
        statSync(candidate);
        accessSync(candidate);
        return candidate;
      } catch {
        // next candidate
      }
    }
  }
  return null;
}

// Parses `npm ls -g --json` output into [{ id, name, version }].
// Returns null when the output is not parseable (caller warns).
function parseNpmList(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const deps = data && data.dependencies ? data.dependencies : {};
    return Object.entries(deps).map(([name, info]) => ({
      id: name,
      name,
      version: (info && info.version) || null,
    }));
  } catch {
    return null;
  }
}

// Production npm source: runs `npm ls -g --json`. Never throws — a missing
// npm or a failed spawn becomes { ok: false, error } (empty group + warning).
async function fetchNpmList(opts = {}) {
  const execFunc = opts.execFunc || require('child_process').exec;
  const res = await new Promise(resolve => {
    execFunc('npm ls -g --json', { shell: process.platform === 'win32' ? undefined : 'sh' }, (err, stdout) => {
      resolve({ err, stdout: String(stdout || '') });
    });
  });
  if (res.err) return { ok: false, error: 'npm not found — global packages not scanned' };
  return { ok: true, raw: res.stdout };
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

async function scanInventory(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const statSync = opts.statSync || fs.statSync;
  const accessSync = opts.accessSync || fs.accessSync;
  const onProgress = opts.onProgress || (() => {});
  // Progress model for the TUI scan counter: 2 source steps (registry, npm)
  // + one step per catalog tool. Strictly monotonic, ends at (total, total).
  const catalogList = opts.catalog || loadCatalog().flatMap(c => c.tools);
  const total = 2 + catalogList.length;
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
    byId.set(r.id, {
      id: r.id,
      name: r.name || r.id,
      version: null,
      binPath: null,
      source: 'adm',
      manager: r.method || null,
      installedAt: r.installedAt || null,
    });
  }

  // 2. npm global list — fills versions, never re-attributes
  let npmWarning = null;
  let npmPackages = [];
  const npmSource = opts.npmJson !== undefined
    ? { ok: true, raw: opts.npmJson }
    : await fetchNpmList(opts);
  if (!npmSource.ok) {
    npmWarning = npmSource.error;
  } else {
    const parsed = parseNpmList(npmSource.raw);
    if (parsed === null) npmWarning = 'npm global list not parseable — skipped';
    else npmPackages = parsed;
  }
  tick(); // step 2: npm
  for (const p of npmPackages) {
    const existing = byId.get(p.id);
    if (existing) {
      if (!existing.version && p.version) existing.version = p.version;
      if (!existing.manager) existing.manager = 'npm';
    } else {
      byId.set(p.id, {
        id: p.id,
        name: p.name || p.id,
        version: p.version,
        binPath: null,
        source: 'npm',
        manager: 'npm',
        installedAt: null,
      });
    }
  }

  // 3. catalog-driven PATH scan (v0.3 detection) — fills binPath; a tool
  //    seen nowhere else lands in 'other' (no manager can be proven)
  for (const tool of catalogList) {
    tick(); // steps 3..N: one per catalog tool (even malformed entries)
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
  const admGroup = groups.find(g => g.id === 'adm');
  if (admGroup) admGroup.warning = registryWarning;
  const npmGroup = groups.find(g => g.id === 'npm');
  if (npmGroup) npmGroup.warning = npmWarning;
  const sorted = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const entry of sorted) {
    const group = groups.find(g => g.id === entry.source);
    if (group) group.entries.push(entry);
  }

  return { entries: groups.flatMap(g => g.entries), groups };
}

module.exports = { scanInventory };

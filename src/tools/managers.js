// Read-only parsers for the `adm tools` inventory (plan plans/adm-tools-tui.md,
// Phase 2, #37). Terminal-neutral (no ink) — unit-tested on realistic output
// fixtures; inventory.js wires them to exec/fs sources.
//
// Contract per parser: (raw output string) => [{ id, name, version, binPath }]
// or null. null = output not parseable (the caller turns that into an empty
// group + warning — never a crash); [] = manager present with zero packages
// (a normal state, not a warning). Every parser tolerates \r\n line endings —
// managers on Windows and ConPTY-wrapped exec emit them.

// brew (`brew list --json=v2`): formulae carry versions.stable and optionally
// a linked_keg path (brew DOES provide a path for linked formulae — used as
// binPath); casks carry a plain version and no path.
function parseBrewList(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const entries = [];
    for (const f of (data && data.formulae) || []) {
      if (!f || !f.name) continue;
      const keg = f.linked_keg;
      const kegPath = typeof keg === 'string' ? keg : (keg && keg.path) || null;
      entries.push({
        id: f.name,
        name: f.name,
        version: (f.versions && f.versions.stable) || null,
        binPath: kegPath || null,
      });
    }
    for (const c of (data && data.casks) || []) {
      if (!c || !c.name) continue;
      entries.push({ id: c.name, name: c.name, version: c.version || null, binPath: null });
    }
    return entries;
  } catch {
    return null;
  }
}

// pip (`pip3 list --format=json`): a plain JSON array of {name, version}.
function parsePipList(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(data)) return null;
    return data
      .filter(p => p && p.name)
      .map(p => ({ id: p.name, name: p.name, version: p.version || null, binPath: null }));
  } catch {
    return null;
  }
}

// cargo (`cargo install --list`): text — "<crate> v<version>:" per installed
// crate, indented binary names below (NOT entries). A non-empty output with
// zero crate lines is garbage → null.
function parseCargoInstallList(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    const m = line.match(/^(\S+) v(\S+):$/);
    if (m) entries.push({ id: m[1], name: m[1], version: m[2], binPath: null });
  }
  if (!String(raw || '').trim()) return [];
  return entries.length > 0 ? entries : null;
}

// Shared helper for the tab-separated system-manager outputs (dpkg-query and
// rpm --qf). Empty output = valid zero packages; non-empty output that yields
// no rows is garbage → null.
function parseTabSeparated(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length >= 2 && cols[0].trim() && cols[1].trim()) {
      entries.push({ id: cols[0].trim(), name: cols[0].trim(), version: cols[1].trim(), binPath: null });
    }
  }
  if (!String(raw || '').trim()) return [];
  return entries.length > 0 ? entries : null;
}

// dpkg (`dpkg-query -W -f='${Package}\t${Version}\n'`)
const parseDpkgQuery = raw => parseTabSeparated(raw);
// rpm (`rpm -qa --qf='%{NAME}\t%{VERSION}-%{RELEASE}\n'`)
const parseRpmQa = raw => parseTabSeparated(raw);

// pacman (`pacman -Q`): "name version" per line. Names never contain spaces.
function parsePacmanQ(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    const m = line.trim().match(/^(\S+)\s+(\S+)$/);
    if (m) entries.push({ id: m[1], name: m[1], version: m[2], binPath: null });
  }
  if (!String(raw || '').trim()) return [];
  return entries.length > 0 ? entries : null;
}

// zypper (`zypper search --installed-only`): pipe-delimited table whose rows
// start with the installed status flag (i / i+).
function parseZypperSearch(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    const cols = line.split('|');
    if (cols.length >= 3 && /^[i+]/.test(cols[0].trim())) {
      entries.push({
        id: cols[1].trim(),
        name: cols[1].trim(),
        version: cols[2].trim() || null,
        binPath: null,
      });
    }
  }
  if (!String(raw || '').trim()) return [];
  return entries.length > 0 ? entries : null;
}

// apk (`apk info -v`): "name-version" per line where BOTH sides may contain
// hyphens. apk's own convention: the version starts with a digit — split at
// the LAST hyphen followed by a digit (zsh-syntax-highlighting-0.7.1-r0 →
// name zsh-syntax-highlighting, version 0.7.1-r0).
function parseApkInfo(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    let split = -1;
    for (let i = s.length - 2; i >= 0; i -= 1) {
      if (s[i] === '-' && /[0-9]/.test(s[i + 1])) { split = i; break; }
    }
    if (split > 0) entries.push({ id: s.slice(0, split), name: s.slice(0, split), version: s.slice(split + 1), binPath: null });
  }
  if (!String(raw || '').trim()) return [];
  return entries.length > 0 ? entries : null;
}

// Locale-proof table parsing for winget / scoop: the dashes separator line is
// the only stable landmark (headers are localized — "Nazwa"/"Name"). Data rows
// are everything BELOW the first all-dashes line; the localized header and any
// banner above it are skipped. Columns split on 2+ spaces (names like
// "Node.js LTS" survive single spaces). Non-empty output with no table → null.
function parseAlignedTable(raw, pick) {
  const lines = String(raw || '').split(/\r?\n/);
  const sepIdx = lines.findIndex(l => /^[\s-]+$/.test(l) && l.includes('-'));
  const dataLines = sepIdx >= 0 ? lines.slice(sepIdx + 1) : [];
  const entries = [];
  for (const line of dataLines) {
    const cols = line.trim().split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
    const picked = pick(cols);
    if (picked) entries.push(picked);
  }
  if (!String(raw || '').trim()) return [];
  return entries.length > 0 || sepIdx >= 0 ? entries : null;
}

// winget: Name | Id | Version | [Available] — Id column is the package id.
const parseWingetList = raw => parseAlignedTable(raw, cols => (cols.length >= 3
  ? { id: cols[1], name: cols[0], version: cols[2], binPath: null }
  : null));

// scoop: Name | Version | [Source] [Info]
const parseScoopList = raw => parseAlignedTable(raw, cols => (cols.length >= 2
  ? { id: cols[0], name: cols[0], version: cols[1], binPath: null }
  : null));

// choco (`choco list`): v1/v2 both emit a banner ("Chocolatey vX"), optional
// header and a "N/N packages installed." summary — everything else that
// splits into name+version is a row.
function parseChocoList(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const entries = [];
  let sawChocoShell = false; // banner or summary → the output IS choco's
  let unexplained = false;   // non-empty lines that are neither skippable nor rows
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    if (/^Chocolatey v/.test(s)) { sawChocoShell = true; continue; }
    if (/^\d+\/\d+ packages? installed\.?$/.test(s)) { sawChocoShell = true; continue; }
    if (/^(Name|name)\s+Version/i.test(s)) continue;
    if (/^[-=\s]+$/.test(s)) continue;
    const m = s.match(/^(\S+)\s+(\S+)$/);
    if (m) entries.push({ id: m[1], name: m[1], version: m[2], binPath: null });
    else unexplained = true;
  }
  if (!String(raw || '').trim()) return [];
  if (entries.length > 0) return entries;
  // zero rows: choco's own banner/summary means "installed, zero packages" —
  // anything else unexplained is garbage
  return sawChocoShell && !unexplained ? [] : null;
}

// go (`~/go/bin` fs scan — go install doesn't track versions): regular files
// become entries with the full binPath; on win32 a trailing .exe is stripped
// from the id/name but kept in binPath. Dotfiles (.DS_Store) and directories
// are skipped. Returns null when the directory doesn't exist / isn't readable
// (the caller warns — go missing is a real state worth surfacing).
function goBinEntries(binDir, { fs: fsMod = require('fs'), platform = process.platform } = {}) {
  let names;
  try {
    names = fsMod.readdirSync(binDir);
  } catch {
    return null;
  }
  const pathMod = require('path');
  const entries = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = pathMod.join(binDir, name);
    try {
      if (!fsMod.statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    const id = platform === 'win32' && /\.exe$/i.test(name) ? name.slice(0, -4) : name;
    entries.push({ id, name: id, version: null, binPath: full });
  }
  return entries;
}

// npm (`npm ls -g --json`) — the Phase 1 parser, re-exported here so every
// manager fixture lives in one test matrix.
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

module.exports = {
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
};

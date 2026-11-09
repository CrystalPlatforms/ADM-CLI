const fs = require('fs');
const path = require('path');
const os = require('os');

// Idempotent writer of PATH entries into shell rc files (#29, #31).
//
// Contract:
//   - writes to the rc of the CURRENT shell (bash → .bashrc, zsh → .zshrc …)
//   - double run = zero duplicates (marker is replaced, not appended)
//   - cleans old ADM markers from any previous version (v0.2 included)

// Every marker string ADM has ever written into rc files. Cleaning removes
// every line containing any of them; `upsertRcEntry` re-adds only the current
// marker + entry pair.
const ADM_RC_MARKERS = ['# adm-cli', 'adm completion', 'adm-cli npm path'];

// Canonical managed entries: marker line + the PATH line appended after it.
// Keys are purposes; both entries are cleaned from any rc we touch.
const RC_ENTRIES = {
  'npm-global': {
    marker: '# adm-cli npm path',
    line: 'export PATH="$HOME/.npm-global/bin:$PATH"',
  },
  launcher: {
    marker: '# adm-cli',
    line: 'export PATH="$HOME/.local/bin:$PATH"',
  },
};

function entryFor(entry) {
  if (typeof entry === 'string') {
    const def = RC_ENTRIES[entry];
    if (!def) throw new Error(`unknown rc entry "${entry}" — valid: ${Object.keys(RC_ENTRIES).join(', ')}`);
    return def;
  }
  return entry; // { marker, line } custom pair
}

// Builds the managed block ("marker\nline") for an entry.
function entryBlock(entry) {
  const def = entryFor(entry);
  return `${def.marker}\n${def.line}`;
}

// Lines this module considers "managed by ADM" for a given entry: the marker
// lines of ANY ADM version plus the exact canonical PATH lines. Removing them
// before appending is what makes old markers disappear on the way.
function managedLines(entry) {
  const def = entryFor(entry);
  const lines = [...ADM_RC_MARKERS];
  for (const key of Object.keys(RC_ENTRIES)) {
    if (key !== 'launcher' && key !== 'npm-global') continue;
    lines.push(RC_ENTRIES[key].line);
  }
  // Custom entries carry their own line.
  if (!def.marker) lines.push(def.line);
  else lines.push(def.line);
  return lines;
}

// Reads an rc file; returns '' when missing (fresh machine).
function readRc(rcPath, readFile) {
  try {
    return readFile(rcPath, 'utf8');
  } catch {
    return '';
  }
}

// Upserts the entry block into the rc file.
//   rcFile — basename in home (".bashrc") or an absolute path; null → no rc
//            known for this shell → { changed: false, reason: 'no-rc-file' }.
// Returns { changed, rcFile, removed } (removed = ADM-managed lines cleaned).
function upsertRcEntry(opts = {}) {
  const {
    rcFile,
    entry,
    home = os.homedir(),
    readFile = fs.readFileSync,
    writeFile = fs.writeFileSync,
    existsSync = fs.existsSync,
  } = opts;

  if (!rcFile) return { changed: false, rcFile: null, removed: 0, reason: 'no-rc-file' };

  const rcPath = path.isAbsolute(rcFile) ? rcFile : path.join(home, rcFile);
  const def = entryFor(entry);
  const original = readRc(rcPath, readFile);
  const lines = original.split('\n');

  const strip = managedLines(entry);
  const kept = lines.filter(line => !strip.some(s => line.trim() === s.trim() || line.includes(s)));
  const removed = lines.length - kept.length;

  // Drop leading/trailing blank lines left over by removals, keep body intact.
  const body = kept.join('\n').replace(/\n{3,}$/, '\n\n').replace(/^\n+/, '');
  const block = entryBlock(entry);
  const content = body ? `${body.replace(/\n+$/, '')}\n\n${block}\n` : `${block}\n`;

  const unchanged = original === content;
  if (!unchanged) {
    if (!existsSync(path.dirname(rcPath))) {
      return { changed: false, rcFile: rcPath, removed, reason: 'no-home-dir' };
    }
    writeFile(rcPath, content, 'utf8');
  }
  return { changed: !unchanged, rcFile: rcPath, removed };
}

// Only removes ADM-managed lines (no re-add). Used by uninstall flows that
// want a surgical cleanup for a single rc.
function cleanRcEntry(opts = {}) {
  const {
    rcFile,
    home = os.homedir(),
    readFile = fs.readFileSync,
    writeFile = fs.writeFileSync,
  } = opts;
  if (!rcFile) return { changed: false, removed: 0 };
  const rcPath = path.isAbsolute(rcFile) ? rcFile : path.join(home, rcFile);
  const original = readRc(rcPath, readFile);
  const lines = original.split('\n');
  const kept = lines.filter(line => !ADM_RC_MARKERS.some(m => line.includes(m)));
  const removed = lines.length - kept.length;
  if (removed > 0) writeFile(rcPath, kept.join('\n'), 'utf8');
  return { changed: removed > 0, removed };
}

module.exports = { upsertRcEntry, cleanRcEntry, RC_ENTRIES, ADM_RC_MARKERS, entryBlock };

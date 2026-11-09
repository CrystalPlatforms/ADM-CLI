const fs = require('fs');
const path = require('path');
const os = require('os');

// Installed-tools registry (v0.4.0 groundwork, #30): every real install
// appends { id, name, method, installedAt } to ~/.adm/installed.json.
// Same id → the entry is replaced (updated timestamp), never duplicated.

function registryFile(opts = {}) {
  const dir = opts.configDir || process.env.ADM_CONFIG_DIR || path.join(os.homedir(), '.adm');
  return path.join(dir, 'installed.json');
}

function readRegistry(opts = {}) {
  const fsMod = opts.fs || fs;
  try {
    const data = JSON.parse(fsMod.readFileSync(registryFile(opts), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeRegistry(entries, opts = {}) {
  const fsMod = opts.fs || fs;
  const file = registryFile(opts);
  fsMod.mkdirSync(path.dirname(file), { recursive: true });
  fsMod.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  return file;
}

// Appends/updates an entry. Returns the registry file path.
function appendInstalled(entry, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const items = readRegistry(opts);
  const record = {
    id: entry.id,
    name: entry.name || entry.id,
    method: entry.method || null,
    installedAt: now,
  };
  const existing = items.findIndex(e => e.id === record.id);
  if (existing >= 0) items[existing] = record;
  else items.push(record);
  return writeRegistry(items, opts);
}

module.exports = { appendInstalled, readRegistry, registryFile };

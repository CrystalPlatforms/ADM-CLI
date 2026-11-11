const fs = require('fs');
const path = require('path');
const os = require('os');
const { saveReport } = require('../reports');
const { getVersion } = require('../commands/version');

// Removes ADM's footprint:
//   1. the config dir (~/.adm, or ADM_CONFIG_DIR)
//   2. PATH entries ADM wrote into shell rc files (marker lines)
// Idempotent by contract: removing nothing still exits 0 ("already removed").
const RC_FILES = ['.bashrc', '.bash_profile', '.zprofile', '.zshrc', '.profile'];
const RC_MARKERS = ['# adm-cli', 'adm completion', 'adm-cli npm path'];

function cleanRcFile(rcPath) {
  let content;
  try {
    content = fs.readFileSync(rcPath, 'utf8');
  } catch {
    return { cleaned: false, lines: 0 };
  }
  const lines = content.split('\n');
  const kept = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i++) {
    if (RC_MARKERS.some(m => lines[i].includes(m))) {
      removed++;
      // The PATH line ADM appends right after its marker goes too —
      // leave zero trace (v0.3 installer layout).
      if (lines[i + 1] && /^\s*export\s+PATH=/.test(lines[i + 1])) {
        i++;
        removed++;
      }
      continue;
    }
    kept.push(lines[i]);
  }
  if (removed === 0) {
    return { cleaned: false, lines: 0 };
  }
  fs.writeFileSync(rcPath, kept.join('\n'), 'utf8');
  return { cleaned: true, lines: removed };
}

async function runUninstall({ log, err, configDir: cfgDir, home } = {}) {
  log = log || (s => process.stdout.write(s + '\n'));
  err = err || (s => process.stderr.write(s + '\n'));
  const dir = cfgDir || process.env.ADM_CONFIG_DIR || path.join(home || os.homedir(), '.adm');
  const homeDir = home || os.homedir();

  const dirExisted = fs.existsSync(dir);
  if (dirExisted) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      err(`ADM uninstall: failed to remove ${dir}: ${e.message}`);
      return 2;
    }
  }

  const cleanedRcs = [];
  for (const rc of RC_FILES) {
    const result = cleanRcFile(path.join(homeDir, rc));
    if (result.cleaned) cleanedRcs.push(`${rc} (${result.lines} line${result.lines === 1 ? '' : 's'})`);
  }

  if (dirExisted) {
    log(`Removed ${dir}`);
  } else {
    log(`${dir} already removed`);
  }
  if (cleanedRcs.length > 0) {
    for (const rc of cleanedRcs) log(`Cleaned PATH entries from ~/${rc}`);
  }

  log('ADM data removed. To uninstall the program itself, remove the npm package: npm rm -g @crystalplatforms/adm');

  // Persist the uninstall report (owner decision: all reports are saved) —
  // but the config dir is GONE by design, so the report lands in the OS
  // temp dir instead of resurrecting ~/.adm.
  const body = [
    `ADM uninstall report — ${new Date().toISOString()}`,
    `ADM ${getVersion()}`,
    `config dir: ${dirExisted ? `removed (${dir})` : `already removed (${dir})`}`,
    cleanedRcs.length ? `cleaned rc entries: ${cleanedRcs.join(', ')}` : 'no rc entries cleaned',
  ].join('\n') + '\n';
  const saved = saveReport('uninstall', body, { configDir: os.tmpdir() });
  if (saved.file) log(`Uninstall report saved: ${saved.file}`);
  return 0;
}

module.exports = { runUninstall, RC_FILES, RC_MARKERS };

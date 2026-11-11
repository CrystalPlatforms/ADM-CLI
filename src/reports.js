// Report persistence (owner decision, 0.3.x): every report ADM generates
// (wizard install, ADM_TOOLS install, upgrade, uninstall) is written to the
// global cache <configDir>/reports/ — one file per run.
//
// Owner requirement: if the config dir itself does not exist the save FAILS
// LOUDLY (the caller shows a ⚠ line) — ADM must not silently skip
// persistence and must not resurrect ~/.adm just to store a report. The
// reports/ subfolder IS auto-created when the config dir exists.
const fs = require('fs');
const path = require('path');
const os = require('os');

// <configDir>/reports — same resolution rules as the registry/config dir.
function reportsDir(opts = {}) {
  const dir = opts.configDir || process.env.ADM_CONFIG_DIR || path.join(opts.home || os.homedir(), '.adm');
  return path.join(dir, 'reports');
}

// saveReport(kind, body, opts) → { file } on success, { error } when the
// config dir is missing (nothing is written, nothing auto-created).
function saveReport(kind, body, opts = {}) {
  const fsMod = opts.fs || fs;
  const dir = reportsDir(opts);
  const configDirPath = path.dirname(dir);
  if (!fsMod.existsSync(configDirPath)) {
    return { error: `cannot save report: ${configDirPath} does not exist` };
  }
  fsMod.mkdirSync(dir, { recursive: true });
  const stamp = (opts.now || new Date()).toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19); // 2026-11-11T15-42-08
  const file = path.join(dir, `report-${stamp}.txt`);
  fsMod.writeFileSync(file, String(body), 'utf8');
  return { file };
}

module.exports = { saveReport, reportsDir };
